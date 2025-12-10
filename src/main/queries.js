import {
  getDrizzleDb,
  deployments,
  media,
  observations,
  modelRuns,
  modelOutputs,
  getStudyDatabase,
  executeRawQuery
} from './db/index.js'
import { union } from 'drizzle-orm/sqlite-core'
import {
  eq,
  and,
  desc,
  count,
  sql,
  isNotNull,
  ne,
  inArray,
  gte,
  lte,
  isNull,
  or
} from 'drizzle-orm'
import log from 'electron-log'
import { DateTime } from 'luxon'

/**
 * Detect timestamp format characteristics and format a DateTime to match the original format
 * This preserves the original format (with/without milliseconds, timezone, seconds)
 * @param {DateTime} newDateTime - Luxon DateTime object with the new time
 * @param {string} originalString - Original timestamp string to match format from
 * @returns {string} - Formatted timestamp string matching original format
 */
function formatToMatchOriginal(newDateTime, originalString) {
  if (!originalString || !newDateTime || !newDateTime.isValid) {
    return newDateTime?.toISO() || null
  }

  // Detect format characteristics from original string
  const hasMilliseconds = /\.\d{3}/.test(originalString)
  const hasTimezone = /Z|[+-]\d{2}:\d{2}$/.test(originalString)
  const hasSeconds = /T\d{2}:\d{2}:\d{2}/.test(originalString)

  // Build Luxon toISO options to match original format
  const options = {
    suppressMilliseconds: !hasMilliseconds,
    suppressSeconds: !hasSeconds,
    includeOffset: hasTimezone
  }

  let result = newDateTime.toISO(options)

  // If original had no timezone indicator, remove it
  if (!hasTimezone && result) {
    result = result.replace(/Z|[+-]\d{2}:\d{2}$/, '')
  }

  return result
}

/**
 * Get species distribution from the database using Drizzle ORM
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Species distribution data
 */
export async function getSpeciesDistribution(dbPath) {
  const startTime = Date.now()
  log.info(`Querying species distribution from: ${dbPath}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    const result = await db
      .select({
        scientificName: observations.scientificName,
        count: count(observations.observationID).as('count')
      })
      .from(observations)
      .where(
        and(
          isNotNull(observations.scientificName),
          ne(observations.scientificName, ''),
          sql`(${observations.observationType} IS NULL OR ${observations.observationType} != 'blank')`
        )
      )
      .groupBy(observations.scientificName)
      .orderBy(desc(count(observations.observationID)))

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved species distribution: ${result.length} species found in ${elapsedTime}ms`)

    return result
  } catch (error) {
    log.error(`Error querying species distribution: ${error.message}`)
    throw error
  }
}

/**
 * Get deployment information from the database using Drizzle ORM
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Deployment data with one row per location
 */
export async function getDeployments(dbPath) {
  const startTime = Date.now()
  log.info(`Querying deployments from: ${dbPath}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    // Create subquery with ORDER BY to get deployments sorted by locationID and deploymentStart DESC
    const subquery = db
      .select({
        locationName: deployments.locationName,
        locationID: deployments.locationID,
        deploymentID: deployments.deploymentID,
        deploymentStart: deployments.deploymentStart,
        deploymentEnd: deployments.deploymentEnd,
        longitude: deployments.longitude,
        latitude: deployments.latitude
      })
      .from(deployments)
      .orderBy(deployments.locationID, desc(deployments.deploymentStart))
      .as('subquery')

    // Select distinct with GROUP BY to get one deployment per location
    // SQLite returns the first row in each group based on the subquery's ORDER BY
    const result = await db
      .selectDistinct({
        locationID: subquery.locationID,
        locationName: subquery.locationName,
        deploymentID: subquery.deploymentID,
        deploymentStart: subquery.deploymentStart,
        deploymentEnd: subquery.deploymentEnd,
        longitude: subquery.longitude,
        latitude: subquery.latitude
      })
      .from(subquery)
      .groupBy(subquery.locationID)

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved distinct deployments: ${result.length} locations found in ${elapsedTime}ms`)

    return result
  } catch (error) {
    log.error(`Error querying deployments: ${error.message}`)
    throw error
  }
}

/**
 * Get activity data (observation counts) per location over time periods
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Object>} - Activity data with periods and counts per location
 */
export async function getLocationsActivity(dbPath) {
  const startTime = Date.now()
  log.info(`Querying location activity from: ${dbPath}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    // First get the total date range to calculate period size
    const dateRange = await db
      .select({
        minDate: sql`MIN(${deployments.deploymentStart})`.as('minDate'),
        maxDate: sql`MAX(${deployments.deploymentEnd})`.as('maxDate')
      })
      .from(deployments)
      .get()

    if (!dateRange) {
      throw new Error('No deployment date range found')
    }

    // Get all locations
    const locations = await db
      .selectDistinct({
        locationID: deployments.locationID,
        locationName: deployments.locationName,
        longitude: deployments.longitude,
        latitude: deployments.latitude
      })
      .from(deployments)

    // Get all observations with their location IDs and event start times
    const observationData = await db
      .select({
        locationID: deployments.locationID,
        eventID: observations.eventID,
        eventStart: observations.eventStart
      })
      .from(observations)
      .innerJoin(deployments, eq(observations.deploymentID, deployments.deploymentID))

    // Process the data in JavaScript
    const minDate = new Date(dateRange.minDate)
    const maxDate = new Date(dateRange.maxDate)
    const totalDays = (maxDate - minDate) / (1000 * 60 * 60 * 24)
    const periodDays = Math.ceil(totalDays / 20)

    // Generate periods
    const periods = []
    let currentStart = new Date(minDate)

    while (currentStart < maxDate) {
      const periodEnd = new Date(currentStart)
      periodEnd.setDate(periodEnd.getDate() + periodDays)

      periods.push({
        start: currentStart.toISOString(),
        end: periodEnd.toISOString()
      })

      currentStart = new Date(periodEnd)
    }

    // Create location map
    const locationMap = new Map()
    locations.forEach((location) => {
      locationMap.set(location.locationID, {
        locationID: location.locationID,
        locationName: location.locationName,
        longitude: location.longitude,
        latitude: location.latitude,
        periods: periods.map((period) => ({
          start: period.start,
          end: period.end,
          count: 0
        }))
      })
    })

    // Count observations per location per period
    const allCounts = []

    observationData.forEach((obs) => {
      const location = locationMap.get(obs.locationID)
      if (!location) return

      const obsDate = new Date(obs.eventStart)

      for (let i = 0; i < periods.length; i++) {
        const periodStart = new Date(periods[i].start)
        const periodEnd = new Date(periods[i].end)

        if (obsDate >= periodStart && obsDate < periodEnd) {
          location.periods[i].count++
          break
        }
      }
    })

    // Collect all non-zero counts for percentile calculation
    locationMap.forEach((location) => {
      location.periods.forEach((period) => {
        if (period.count > 0) {
          allCounts.push(period.count)
        }
      })
    })

    // Sort counts for percentile calculations
    allCounts.sort((a, b) => a - b)

    // Calculate 95th percentile of period counts
    const percentile95Index = Math.floor(allCounts.length * 0.95)
    const percentile90Count = allCounts[percentile95Index] || 1

    const result = {
      startDate: dateRange.minDate,
      endDate: dateRange.maxDate,
      percentile90Count,
      locations: Array.from(locationMap.values())
    }

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved location activity data for ${result.locations.length} locations in ${elapsedTime}ms`
    )
    return result
  } catch (error) {
    log.error(`Error querying location activity: ${error.message}`)
    throw error
  }
}

/**
 * Get daily timeseries data for specific species
 * @param {string} dbPath - Path to the SQLite database
 * @param {Array<string>} speciesNames - List of scientific names to include
 * @returns {Promise<Object>} - Timeseries data for specified species
 */
export async function getSpeciesTimeseries(dbPath, speciesNames = []) {
  const startTime = Date.now()
  log.info(`Querying species timeseries from: ${dbPath} for specific species`)
  log.info(`Selected species: ${speciesNames.join(', ')}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    // Prepare species filter for the complex CTE query
    let speciesFilter = ''
    if (speciesNames && speciesNames.length > 0) {
      const quotedSpecies = speciesNames.map((name) => `'${name.replace(/'/g, "''")}'`).join(',')
      speciesFilter = `AND scientificName IN (${quotedSpecies})`
    }

    // Use raw SQL for complex CTE query that's difficult to express in Drizzle
    const timeseriesQuery = `
      WITH date_range AS (
        SELECT
          date(min(substr(eventStart, 1, 10)), 'weekday 0', '-7 days') AS start_week,
          date(max(substr(eventStart, 1, 10)), 'weekday 0') AS end_week
        FROM observations
        WHERE substr(eventStart, 1, 4) > '1970'
      ),
      weeks(week_start) AS (
        SELECT start_week FROM date_range
        UNION ALL
        SELECT date(week_start, '+7 days')
        FROM weeks, date_range
        WHERE week_start < end_week
      ),
      species_list AS (
        SELECT
          scientificName,
          COUNT(*) as count
        FROM observations
        WHERE scientificName IS NOT NULL AND scientificName != ''
        ${speciesFilter}
        GROUP BY scientificName
      ),
      week_species_combinations AS (
        SELECT
          weeks.week_start,
          species_list.scientificName
        FROM weeks
        CROSS JOIN species_list
      ),
      weekly_counts AS (
        SELECT
          date(substr(eventStart, 1, 10), 'weekday 0', '-7 days') as week_start,
          scientificName,
          COUNT(*) as count
        FROM observations
        WHERE scientificName IS NOT NULL AND scientificName != ''
        ${speciesFilter}
        GROUP BY week_start, scientificName
      )
      SELECT
        wsc.week_start as date,
        wsc.scientificName,
        COALESCE(wc.count, 0) as count,
        sl.count as total_count
      FROM week_species_combinations wsc
      LEFT JOIN weekly_counts wc ON wsc.week_start = wc.week_start
        AND wsc.scientificName = wc.scientificName
      JOIN species_list sl ON wsc.scientificName = sl.scientificName
      ORDER BY wsc.week_start ASC, wsc.scientificName
    `

    const timeseries = await executeRawQuery(studyId, dbPath, timeseriesQuery)

    // Process the SQL results into the expected format
    const processedData = processTimeseriesDataFromSql(timeseries)

    // Extract species metadata from the timeseries data
    const speciesMap = new Map()
    timeseries.forEach((row) => {
      if (!speciesMap.has(row.scientificName)) {
        speciesMap.set(row.scientificName, {
          scientificName: row.scientificName,
          count: row.total_count
        })
      }
    })

    // Convert the map to an array and sort by count descending
    const speciesData = Array.from(speciesMap.values()).sort((a, b) => b.count - a.count)

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved timeseries data: ${processedData.length} weeks for ${speciesData.length} species in ${elapsedTime}ms`
    )
    return {
      allSpecies: speciesData,
      timeseries: processedData
    }
  } catch (error) {
    log.error(`Error querying timeseries: ${error.message}`)
    throw error
  }
}

/**
 * Get species geolocation data for heatmap visualization
 * @param {string} dbPath - Path to the SQLite database
 * @param {Array<string>} species - List of scientific names to include
 * @param {string} startDate - ISO date string for range start
 * @param {string} endDate - ISO date string for range end
 * @param {number} startHour - Starting hour of day (0-24)
 * @param {number} endHour - Ending hour of day (0-24)
 * @returns {Promise<Object>} - Species geolocation data for heatmap
 */
export async function getSpeciesHeatmapData(
  dbPath,
  species,
  startDate,
  endDate,
  startHour = 0,
  endHour = 24
) {
  const startTime = Date.now()
  log.info(`Querying species heatmap data from: ${dbPath}`)
  log.info(`Date range: ${startDate} to ${endDate}`)
  log.info(`Time range: ${startHour} to ${endHour} hours`)
  log.info(`Species: ${species.join(', ')}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    // Build base conditions
    const baseConditions = [
      inArray(observations.scientificName, species),
      gte(observations.eventStart, startDate),
      lte(observations.eventStart, endDate),
      isNotNull(deployments.latitude),
      isNotNull(deployments.longitude)
    ]

    // Add time-of-day condition using sql template for SQLite strftime
    if (startHour < endHour) {
      // Simple range (e.g., 8:00 to 17:00)
      baseConditions.push(
        sql`CAST(strftime('%H', ${observations.eventStart}) AS INTEGER) >= ${startHour}`
      )
      baseConditions.push(
        sql`CAST(strftime('%H', ${observations.eventStart}) AS INTEGER) < ${endHour}`
      )
    } else if (startHour > endHour) {
      // Wrapping range (e.g., 22:00 to 6:00)
      baseConditions.push(
        or(
          sql`CAST(strftime('%H', ${observations.eventStart}) AS INTEGER) >= ${startHour}`,
          sql`CAST(strftime('%H', ${observations.eventStart}) AS INTEGER) < ${endHour}`
        )
      )
    }
    // If startHour equals endHour, we include all hours (full day)

    const rows = await db
      .select({
        locationName: deployments.locationName,
        latitude: deployments.latitude,
        longitude: deployments.longitude,
        scientificName: observations.scientificName,
        count: count().as('count')
      })
      .from(observations)
      .innerJoin(deployments, eq(observations.deploymentID, deployments.deploymentID))
      .where(and(...baseConditions))
      .groupBy(deployments.latitude, deployments.longitude, observations.scientificName)
      .orderBy(desc(count()))

    // Process the data to create species-specific datasets
    const speciesData = {}
    species.forEach((s) => {
      speciesData[s] = []
    })

    rows.forEach((row) => {
      if (speciesData[row.scientificName]) {
        speciesData[row.scientificName].push({
          lat: parseFloat(row.latitude), // Convert to number here
          lng: parseFloat(row.longitude), // Convert to number here
          count: row.count,
          locationName: row.locationName
        })
      }
    })

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved heatmap data: ${rows.length} location points in ${elapsedTime}ms`)
    return speciesData
  } catch (error) {
    log.error(`Error querying species heatmap data: ${error.message}`)
    throw error
  }
}

/**
 * Get media files from the database that have animal observations with optional filtering
 * @param {string} dbPath - Path to the SQLite database
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of media files to return
 * @param {number} options.offset - Number of records to skip for pagination
 * @param {Array<string>} options.species - List of species to filter by (optional)
 * @param {Object} options.dateRange - Date range to filter by (optional)
 * @param {string} options.dateRange.start - Start date (ISO string)
 * @param {string} options.dateRange.end - End date (ISO string)
 * @param {Object} options.timeRange - Time of day range to filter by (optional)
 * @param {number} options.timeRange.start - Start hour (0-23)
 * @param {number} options.timeRange.end - End hour (0-23)
 * @returns {Promise<Array>} - Media files matching the criteria
 */
export async function getMedia(dbPath, options = {}) {
  const {
    limit: queryLimit = 10,
    offset: queryOffset = 0,
    species = [],
    dateRange = {},
    timeRange = {}
  } = options

  const startTime = Date.now()
  log.info(`Querying media files from: ${dbPath} with filtering options`)
  log.info(`Pagination: limit ${queryLimit}, offset ${queryOffset}`)

  if (species.length > 0) {
    log.info(`Species filter: ${species.join(', ')}`)
  }

  if (dateRange.start && dateRange.end) {
    log.info(`Date range: ${typeof dateRange.start} to ${dateRange.end}`)
  }

  if (timeRange.start !== undefined && timeRange.end !== undefined) {
    log.info(`Time range: ${timeRange.start}:00 to ${timeRange.end}:00`)
  }

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    // Build dynamic filter conditions array for base query
    const baseConditions = [
      isNotNull(observations.scientificName),
      ne(observations.scientificName, '')
    ]

    // Add species filter if provided
    if (species.length > 0) {
      baseConditions.push(inArray(observations.scientificName, species))
    }

    // Add date range filter if provided
    if (dateRange.start && dateRange.end) {
      const startDate =
        dateRange.start instanceof Date ? dateRange.start.toISOString() : dateRange.start
      const endDate = dateRange.end instanceof Date ? dateRange.end.toISOString() : dateRange.end

      log.info(`Formatted date range: ${startDate} to ${endDate}`)

      baseConditions.push(gte(media.timestamp, startDate))
      baseConditions.push(lte(media.timestamp, endDate))
    }

    // Add time of day filter if provided
    if (timeRange.start !== undefined && timeRange.end !== undefined) {
      if (timeRange.start < timeRange.end) {
        // Simple range (e.g., 8:00 to 17:00)
        baseConditions.push(
          sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${timeRange.start}`
        )
        baseConditions.push(
          sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${timeRange.end}`
        )
      } else if (timeRange.start > timeRange.end) {
        // Wrapping range (e.g., 22:00 to 6:00)
        baseConditions.push(
          or(
            sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${timeRange.start}`,
            sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${timeRange.end}`
          )
        )
      }
    }

    // Select fields for both branches
    const selectFields = {
      mediaID: media.mediaID,
      filePath: media.filePath,
      fileName: media.fileName,
      timestamp: media.timestamp,
      deploymentID: media.deploymentID,
      scientificName: observations.scientificName,
      fileMediatype: media.fileMediatype,
      eventID: observations.eventID
    }

    // Branch 1: Direct mediaID link (for ML runs, Wildlife Insights, Deepfaune imports)
    const branch1 = db
      .selectDistinct(selectFields)
      .from(media)
      .innerJoin(observations, eq(media.mediaID, observations.mediaID))
      .where(and(...baseConditions))

    // Branch 2: Timestamp link (for CamTrap DP datasets where observations have NULL mediaID)
    const branch2Conditions = [...baseConditions, isNull(observations.mediaID)]
    const branch2 = db
      .selectDistinct(selectFields)
      .from(media)
      .innerJoin(observations, eq(media.timestamp, observations.eventStart))
      .where(and(...branch2Conditions))

    // Combine with UNION, order, and paginate
    // UNION deduplicates results and allows each branch to use indexes efficiently
    const rows = await union(branch1, branch2)
      .orderBy(desc(media.timestamp))
      .limit(queryLimit)
      .offset(queryOffset)

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved ${rows.length} media files matching criteria (offset: ${queryOffset}) in ${elapsedTime}ms`
    )
    return rows
  } catch (error) {
    log.error(`Error querying media with observations: ${error.message}`)
    throw error
  }
}

/**
 * Get hourly activity data for species
 * @param {string} dbPath - Path to the SQLite database
 * @param {Array<string>} species - List of scientific names to include
 * @param {string} startDate - ISO date string for range start
 * @param {string} endDate - ISO date string for range end
 * @returns {Promise<Object>} - Hourly activity data for specified species
 */
export async function getSpeciesDailyActivity(dbPath, species, startDate, endDate) {
  const startTime = Date.now()
  log.info(`Querying species daily activity from: ${dbPath}`)
  log.info(`Date range: ${startDate} to ${endDate}`)
  log.info(`Species: ${species.join(', ')}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    // Use sql template for SQLite-specific hour extraction via strftime
    const hourColumn = sql`CAST(strftime('%H', ${observations.eventStart}) AS INTEGER)`.as('hour')

    const rows = await db
      .select({
        hour: hourColumn,
        scientificName: observations.scientificName,
        count: count().as('count')
      })
      .from(observations)
      .where(
        and(
          inArray(observations.scientificName, species),
          gte(observations.eventStart, startDate),
          lte(observations.eventStart, endDate)
        )
      )
      .groupBy(hourColumn, observations.scientificName)
      .orderBy(hourColumn, observations.scientificName)

    // Process the data to create species-specific hourly patterns
    const hourlyData = Array(24)
      .fill()
      .map((_, i) => ({
        hour: i,
        // Initialize with 0 for each species
        ...Object.fromEntries(species.map((s) => [s, 0]))
      }))

    // Fill in the actual data from the query results
    rows.forEach((row) => {
      hourlyData[row.hour][row.scientificName] = row.count
    })

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved daily activity data: ${rows.length} hour/species combinations in ${elapsedTime}ms`
    )
    return hourlyData
  } catch (error) {
    log.error(`Error querying species daily activity data: ${error.message}`)
    throw error
  }
}

// Helper function to process timeseries data from SQL query
function processTimeseriesDataFromSql(rawData) {
  const resultMap = new Map()

  // Group by date and collect counts for each species
  rawData.forEach((entry) => {
    if (!resultMap.has(entry.date)) {
      resultMap.set(entry.date, {})
    }
    const dateEntry = resultMap.get(entry.date)
    dateEntry[entry.scientificName] = entry.count
  })

  // Convert map to array format
  return Array.from(resultMap.entries())
    .map(([date, speciesCounts]) => ({
      date,
      ...speciesCounts
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Create and initialize a new database for an image directory
 * @param {string} dbPath - Path for the new SQLite database
 * @returns {Promise<Object>} - Database manager instance
 */
export async function createImageDirectoryDatabase(dbPath) {
  log.info(`Creating new database at: ${dbPath}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    // Use the Drizzle database manager which will create the database and run migrations
    const manager = await getStudyDatabase(studyId, dbPath)

    log.info(`Successfully created database for study ${studyId} at: ${dbPath}`)
    return manager
  } catch (error) {
    log.error(`Error creating database: ${error.message}`)
    throw error
  }
}

/**
 * Insert deployment data into the database
 * @param {Object} manager - Database manager instance
 * @param {Array} deploymentsData - Array of deployment objects
 * @returns {Promise<void>}
 */
export async function insertDeployments(manager, deploymentsData) {
  log.info(`Inserting ${Object.keys(deploymentsData).length} deployments into database`)

  try {
    const db = manager.getDb()

    manager.transaction(() => {
      for (const depKey of Object.keys(deploymentsData)) {
        const dep = deploymentsData[depKey]
        db.insert(deployments)
          .values({
            deploymentID: dep.deploymentID,
            locationID: dep.locationID,
            locationName: dep.locationName,
            deploymentStart: dep.deploymentStart ? dep.deploymentStart.toISO() : null,
            deploymentEnd: dep.deploymentEnd ? dep.deploymentEnd.toISO() : null,
            latitude: dep.latitude,
            longitude: dep.longitude
          })
          .run()
      }
    })

    log.info(`Successfully inserted ${Object.keys(deploymentsData).length} deployments`)
  } catch (error) {
    log.error(`Error inserting deployments: ${error.message}`)
    throw error
  }
}

/**
 * Insert media data into the database
 * @param {Object} manager - Database manager instance
 * @param {Array} mediaData - Array of media objects
 * @returns {Promise<void>}
 */
export async function insertMedia(manager, mediaData) {
  log.info(`Inserting ${Object.keys(mediaData).length} media items into database`)

  try {
    const db = manager.getDb()

    manager.transaction(() => {
      let count = 0
      for (const mediaPath of Object.keys(mediaData)) {
        const item = mediaData[mediaPath]
        db.insert(media)
          .values({
            mediaID: item.mediaID,
            deploymentID: item.deploymentID,
            timestamp: item.timestamp ? item.timestamp.toISO() : null,
            filePath: item.filePath,
            fileName: item.fileName,
            importFolder: item.importFolder || null,
            folderName: item.folderName || null
          })
          .run()

        count++
        if (count % 1000 === 0) {
          log.info(`Inserted ${count}/${Object.keys(mediaData).length} media items`)
        }
      }
    })

    log.info(`Successfully inserted ${Object.keys(mediaData).length} media items`)
  } catch (error) {
    log.error(`Error inserting media: ${error.message}`)
    throw error
  }
}

/**
 * Insert observations data into the database
 * @param {Object} manager - Database manager instance
 * @param {Array} observationsData - Array of observation objects
 * @returns {Promise<void>}
 */
export async function insertObservations(manager, observationsData) {
  log.info(`Inserting ${observationsData.length} observations into database`)

  try {
    const db = manager.getDb()

    manager.transaction(() => {
      let count = 0
      for (const observation of observationsData) {
        db.insert(observations)
          .values({
            observationID: observation.observationID,
            mediaID: observation.mediaID,
            deploymentID: observation.deploymentID,
            eventID: observation.eventID,
            eventStart: observation.eventStart ? observation.eventStart.toISO() : null,
            eventEnd: observation.eventEnd ? observation.eventEnd.toISO() : null,
            scientificName: observation.scientificName,
            commonName: observation.commonName,
            classificationProbability:
              observation.classificationProbability !== undefined
                ? observation.classificationProbability
                : null,
            count: observation.count !== undefined ? observation.count : null
          })
          .run()

        count++
        if (count % 1000 === 0) {
          log.info(`Inserted ${count}/${observationsData.length} observations`)
        }
      }
    })

    log.info(`Successfully inserted ${observationsData.length} observations`)
  } catch (error) {
    log.error(`Error inserting observations: ${error.message}`)
    throw error
  }
}

/**
 * Get activity data (observation counts) per deployment over time periods
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Object>} - Activity data with periods and counts per deployment
 */
export async function getDeploymentsActivity(dbPath) {
  const startTime = Date.now()
  log.info(`Querying deployment activity from: ${dbPath}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    // First get the total date range to calculate period size
    const dateRange = await db
      .select({
        minDate: sql`MIN(${deployments.deploymentStart})`.as('minDate'),
        maxDate: sql`MAX(${deployments.deploymentEnd})`.as('maxDate')
      })
      .from(deployments)
      .get()

    if (!dateRange) {
      throw new Error('No deployment date range found')
    }

    // Get all deployments
    const deploymentsData = await db
      .selectDistinct({
        deploymentID: deployments.deploymentID,
        locationName: deployments.locationName,
        locationID: deployments.locationID,
        deploymentStart: deployments.deploymentStart,
        deploymentEnd: deployments.deploymentEnd,
        latitude: deployments.latitude,
        longitude: deployments.longitude
      })
      .from(deployments)

    // Get all observations with their deployment IDs and event start times
    const observationData = await db
      .select({
        deploymentID: observations.deploymentID,
        eventID: observations.eventID,
        eventStart: observations.eventStart
      })
      .from(observations)

    // Process the data in JavaScript
    const minDate = new Date(dateRange.minDate)
    const maxDate = new Date(dateRange.maxDate)
    const totalDays = (maxDate - minDate) / (1000 * 60 * 60 * 24)
    const periodDays = Math.ceil(totalDays / 20)

    // Generate periods
    const periods = []
    let currentStart = new Date(minDate)

    while (currentStart < maxDate) {
      const periodEnd = new Date(currentStart)
      periodEnd.setDate(periodEnd.getDate() + periodDays)

      periods.push({
        start: currentStart.toISOString(),
        end: periodEnd.toISOString()
      })

      currentStart = new Date(periodEnd)
    }

    // Create deployment map
    const deploymentMap = new Map()
    deploymentsData.forEach((deployment) => {
      deploymentMap.set(deployment.deploymentID, {
        deploymentID: deployment.deploymentID,
        locationName: deployment.locationName,
        locationID: deployment.locationID,
        deploymentStart: deployment.deploymentStart,
        deploymentEnd: deployment.deploymentEnd,
        latitude: deployment.latitude,
        longitude: deployment.longitude,
        periods: periods.map((period) => ({
          start: period.start,
          end: period.end,
          count: 0
        }))
      })
    })

    // Count observations per deployment per period
    const allCounts = []

    observationData.forEach((obs) => {
      const deployment = deploymentMap.get(obs.deploymentID)
      if (!deployment) return

      const obsDate = new Date(obs.eventStart)

      for (let i = 0; i < periods.length; i++) {
        const periodStart = new Date(periods[i].start)
        const periodEnd = new Date(periods[i].end)

        if (obsDate >= periodStart && obsDate < periodEnd) {
          deployment.periods[i].count++
          break
        }
      }
    })

    // Collect all non-zero counts for percentile calculation
    deploymentMap.forEach((deployment) => {
      deployment.periods.forEach((period) => {
        if (period.count > 0) {
          allCounts.push(period.count)
        }
      })
    })

    // Sort counts for percentile calculations
    allCounts.sort((a, b) => a - b)

    // Calculate 95th percentile of period counts
    const percentile95Index = Math.floor(allCounts.length * 0.95)
    const percentile90Count = allCounts[percentile95Index] || 1

    const result = {
      startDate: dateRange.minDate,
      endDate: dateRange.maxDate,
      percentile90Count,
      deployments: Array.from(deploymentMap.values())
    }

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved deployment activity data for ${result.deployments.length} deployments in ${elapsedTime}ms`
    )
    return result
  } catch (error) {
    log.error(`Error querying deployment activity: ${error.message}`)
    throw error
  }
}

/**
 * Get files data (directories with image counts and processing progress) for local/speciesnet studies
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Array of directory objects with image counts and processing progress
 */
export async function getFilesData(dbPath) {
  const startTime = Date.now()
  log.info(`Querying files data from: ${dbPath}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    // Query to get directory statistics with most recent model used
    const rows = await db
      .select({
        folderName: media.folderName,
        importFolder: media.importFolder,
        imageCount: count(sql`CASE WHEN ${media.fileMediatype} NOT LIKE 'video/%' THEN 1 END`).as(
          'imageCount'
        ),
        videoCount: count(sql`CASE WHEN ${media.fileMediatype} LIKE 'video/%' THEN 1 END`).as(
          'videoCount'
        ),
        processedCount: count(observations.observationID).as('processedCount'),
        lastModelUsed: sql`(
          SELECT mr.modelID || ' ' || mr.modelVersion
          FROM model_outputs mo
          INNER JOIN media m2 ON mo.mediaID = m2.mediaID
          INNER JOIN model_runs mr ON mo.runID = mr.id
          WHERE m2.folderName = ${media.folderName}
          ORDER BY mr.startedAt DESC
          LIMIT 1
        )`.as('lastModelUsed')
      })
      .from(media)
      .leftJoin(observations, eq(media.mediaID, observations.mediaID))
      .groupBy(media.folderName)
      .orderBy(media.folderName)

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved files data: ${rows.length} directories found in ${elapsedTime}ms`)
    return rows
  } catch (error) {
    log.error(`Error querying files data: ${error.message}`)
    throw error
  }
}

/**
 * Get all bounding boxes for a specific media file with model provenance
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} mediaID - The media ID to get bboxes for
 * @returns {Promise<Array>} - Array of observations with bbox data and model info
 */
export async function getMediaBboxes(dbPath, mediaID, includeWithoutBbox = false) {
  const startTime = Date.now()
  log.info(`Querying bboxes for media: ${mediaID} (includeWithoutBbox: ${includeWithoutBbox})`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    // Build where clause - optionally include observations without bbox (for videos)
    const whereClause = includeWithoutBbox
      ? eq(observations.mediaID, mediaID)
      : and(eq(observations.mediaID, mediaID), isNotNull(observations.bboxX))

    const rows = await db
      .select({
        observationID: observations.observationID,
        scientificName: observations.scientificName,
        classificationProbability: observations.classificationProbability,
        detectionConfidence: observations.detectionConfidence,
        bboxX: observations.bboxX,
        bboxY: observations.bboxY,
        bboxWidth: observations.bboxWidth,
        bboxHeight: observations.bboxHeight,
        classificationMethod: observations.classificationMethod,
        classifiedBy: observations.classifiedBy,
        classificationTimestamp: observations.classificationTimestamp,
        modelID: modelRuns.modelID,
        modelVersion: modelRuns.modelVersion
      })
      .from(observations)
      .leftJoin(modelOutputs, eq(observations.modelOutputID, modelOutputs.id))
      .leftJoin(modelRuns, eq(modelOutputs.runID, modelRuns.id))
      .where(whereClause)
      .orderBy(desc(observations.detectionConfidence))

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved ${rows.length} bboxes for media ${mediaID} in ${elapsedTime}ms`)
    return rows
  } catch (error) {
    log.error(`Error querying media bboxes: ${error.message}`)
    throw error
  }
}

/**
 * Get bboxes for multiple media items in a single query
 * @param {string} dbPath - Path to the SQLite database
 * @param {string[]} mediaIDs - Array of media IDs to fetch bboxes for
 * @returns {Promise<Object>} - Map of mediaID -> bboxes[]
 */
export async function getMediaBboxesBatch(dbPath, mediaIDs) {
  if (!mediaIDs || mediaIDs.length === 0) return {}

  const startTime = Date.now()
  log.info(`Querying bboxes for ${mediaIDs.length} media items`)

  try {
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    const rows = await db
      .select({
        mediaID: observations.mediaID,
        observationID: observations.observationID,
        scientificName: observations.scientificName,
        classificationProbability: observations.classificationProbability,
        detectionConfidence: observations.detectionConfidence,
        bboxX: observations.bboxX,
        bboxY: observations.bboxY,
        bboxWidth: observations.bboxWidth,
        bboxHeight: observations.bboxHeight,
        classificationMethod: observations.classificationMethod,
        classifiedBy: observations.classifiedBy,
        classificationTimestamp: observations.classificationTimestamp
      })
      .from(observations)
      .where(and(inArray(observations.mediaID, mediaIDs), isNotNull(observations.bboxX)))
      .orderBy(observations.mediaID, desc(observations.detectionConfidence))

    // Group results by mediaID
    const bboxesByMedia = {}
    for (const row of rows) {
      if (!bboxesByMedia[row.mediaID]) {
        bboxesByMedia[row.mediaID] = []
      }
      bboxesByMedia[row.mediaID].push(row)
    }

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved bboxes for ${Object.keys(bboxesByMedia).length} media items in ${elapsedTime}ms`
    )
    return bboxesByMedia
  } catch (error) {
    log.error(`Error querying media bboxes batch: ${error.message}`)
    throw error
  }
}

/**
 * Check if any observations with bboxes exist for the given media IDs
 * Lightweight query that returns only a boolean (uses LIMIT 1 for efficiency)
 * @param {string} dbPath - Path to the SQLite database
 * @param {string[]} mediaIDs - Array of media IDs to check
 * @returns {Promise<boolean>} - True if at least one media has bboxes
 */
export async function checkMediaHaveBboxes(dbPath, mediaIDs) {
  if (!mediaIDs || mediaIDs.length === 0) return false

  const startTime = Date.now()
  log.info(`Checking bbox existence for ${mediaIDs.length} media items`)

  try {
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    const result = await db
      .select({ exists: sql`1` })
      .from(observations)
      .where(and(inArray(observations.mediaID, mediaIDs), isNotNull(observations.bboxX)))
      .limit(1)

    const hasBboxes = result.length > 0
    const elapsedTime = Date.now() - startTime
    log.info(`Bbox existence check completed in ${elapsedTime}ms: ${hasBboxes}`)

    return hasBboxes
  } catch (error) {
    log.error(`Error checking bbox existence: ${error.message}`)
    throw error
  }
}

/**
 * Get all model runs for a study
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Array of model run records
 */
export async function getModelRuns(dbPath) {
  const startTime = Date.now()
  log.info(`Querying model runs from: ${dbPath}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    const rows = await db.select().from(modelRuns).orderBy(desc(modelRuns.startedAt))

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved ${rows.length} model runs in ${elapsedTime}ms`)
    return rows
  } catch (error) {
    log.error(`Error querying model runs: ${error.message}`)
    throw error
  }
}

/**
 * Get model output with observations for a specific media
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} mediaID - The media ID to get predictions for
 * @returns {Promise<Array>} - Array of predictions with model info
 */
export async function getMediaPredictions(dbPath, mediaID) {
  const startTime = Date.now()
  log.info(`Querying predictions for media: ${mediaID}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    const rows = await db
      .select({
        // All observation fields (22 columns from schema.js)
        observationID: observations.observationID,
        mediaID: observations.mediaID,
        deploymentID: observations.deploymentID,
        eventID: observations.eventID,
        eventStart: observations.eventStart,
        eventEnd: observations.eventEnd,
        scientificName: observations.scientificName,
        observationType: observations.observationType,
        commonName: observations.commonName,
        classificationProbability: observations.classificationProbability,
        count: observations.count,
        lifeStage: observations.lifeStage,
        age: observations.age,
        sex: observations.sex,
        behavior: observations.behavior,
        bboxX: observations.bboxX,
        bboxY: observations.bboxY,
        bboxWidth: observations.bboxWidth,
        bboxHeight: observations.bboxHeight,
        detectionConfidence: observations.detectionConfidence,
        modelOutputID: observations.modelOutputID,
        classificationMethod: observations.classificationMethod,
        classifiedBy: observations.classifiedBy,
        classificationTimestamp: observations.classificationTimestamp,
        // Model run fields (aliased to match original query)
        runID: modelRuns.id,
        modelID: modelRuns.modelID,
        modelVersion: modelRuns.modelVersion,
        runStartedAt: modelRuns.startedAt,
        runStatus: modelRuns.status
      })
      .from(observations)
      .leftJoin(modelOutputs, eq(observations.modelOutputID, modelOutputs.id))
      .leftJoin(modelRuns, eq(modelOutputs.runID, modelRuns.id))
      .where(eq(observations.mediaID, mediaID))
      .orderBy(desc(modelRuns.startedAt), desc(observations.classificationProbability))

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved ${rows.length} predictions for media ${mediaID} in ${elapsedTime}ms`)
    return rows
  } catch (error) {
    log.error(`Error querying media predictions: ${error.message}`)
    throw error
  }
}

/**
 * Update media timestamp and propagate changes to related observations
 * Observations are updated with the same offset to preserve duration
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} mediaID - Media ID to update
 * @param {string} newTimestamp - New timestamp in ISO 8601 format
 * @returns {Promise<Object>} - Result with success status and updated counts
 */
export async function updateMediaTimestamp(dbPath, mediaID, newTimestamp) {
  const startTime = Date.now()
  log.info(`Updating timestamp for media ${mediaID} to ${newTimestamp}`)

  try {
    // Validate input parameters
    if (!mediaID) {
      throw new Error('Media ID is required')
    }

    if (!newTimestamp || typeof newTimestamp !== 'string') {
      throw new Error('A valid timestamp string is required')
    }

    // Parse and validate the new timestamp
    const newTimestampDT = DateTime.fromISO(newTimestamp)

    if (!newTimestampDT.isValid) {
      throw new Error(
        `Invalid timestamp format: "${newTimestamp}". Please use ISO 8601 format (e.g., 2024-01-15T10:30:00.000Z)`
      )
    }

    // Validate timestamp is within reasonable bounds (1970 to 2100)
    const year = newTimestampDT.year
    if (year < 1970 || year > 2100) {
      throw new Error(`Timestamp year must be between 1970 and 2100, got ${year}`)
    }

    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    // 1. Get current media timestamp
    const currentMedia = await db
      .select({ timestamp: media.timestamp })
      .from(media)
      .where(eq(media.mediaID, mediaID))
      .get()

    if (!currentMedia) {
      throw new Error(`Media not found: ${mediaID}`)
    }

    // Handle case where current timestamp is null or invalid
    const oldTimestamp = currentMedia.timestamp ? DateTime.fromISO(currentMedia.timestamp) : null

    if (!oldTimestamp || !oldTimestamp.isValid) {
      // If no valid old timestamp, just set the new one without offset calculation
      log.info(`No valid existing timestamp for media ${mediaID}, setting directly`)

      await db.update(media).set({ timestamp: newTimestamp }).where(eq(media.mediaID, mediaID))

      // Update observations with the new timestamp directly (no offset)
      const relatedObservations = await db
        .select({ observationID: observations.observationID })
        .from(observations)
        .where(eq(observations.mediaID, mediaID))

      let updatedCount = 0
      for (const obs of relatedObservations) {
        await db
          .update(observations)
          .set({ eventStart: newTimestamp })
          .where(eq(observations.observationID, obs.observationID))
        updatedCount++
      }

      const elapsedTime = Date.now() - startTime
      log.info(`Set media timestamp and ${updatedCount} observations in ${elapsedTime}ms`)

      return {
        success: true,
        mediaID,
        newTimestamp,
        observationsUpdated: updatedCount
      }
    }

    // Calculate the offset in milliseconds
    const offsetMs = newTimestampDT.toMillis() - oldTimestamp.toMillis()

    // 2. Update media.timestamp - format to match original
    const formattedNewTimestamp = formatToMatchOriginal(newTimestampDT, currentMedia.timestamp)
    await db
      .update(media)
      .set({ timestamp: formattedNewTimestamp })
      .where(eq(media.mediaID, mediaID))

    // 3. Get all related observations
    const relatedObservations = await db
      .select({
        observationID: observations.observationID,
        eventStart: observations.eventStart,
        eventEnd: observations.eventEnd
      })
      .from(observations)
      .where(eq(observations.mediaID, mediaID))

    // 4. Update each observation with offset-preserved times (preserving original format)
    let updatedCount = 0
    for (const obs of relatedObservations) {
      const updateData = {}

      // Update eventStart with offset - preserve original format
      if (obs.eventStart) {
        const oldEventStart = DateTime.fromISO(obs.eventStart)
        if (oldEventStart.isValid) {
          const newEventStart = oldEventStart.plus({ milliseconds: offsetMs })
          updateData.eventStart = formatToMatchOriginal(newEventStart, obs.eventStart)
        }
      }

      // Update eventEnd with SAME offset (preserving duration) - preserve original format
      if (obs.eventEnd) {
        const oldEventEnd = DateTime.fromISO(obs.eventEnd)
        if (oldEventEnd.isValid) {
          const newEventEnd = oldEventEnd.plus({ milliseconds: offsetMs })
          updateData.eventEnd = formatToMatchOriginal(newEventEnd, obs.eventEnd)
        }
      }

      if (Object.keys(updateData).length > 0) {
        await db
          .update(observations)
          .set(updateData)
          .where(eq(observations.observationID, obs.observationID))
        updatedCount++
      }
    }

    const elapsedTime = Date.now() - startTime
    log.info(
      `Updated media timestamp to "${formattedNewTimestamp}" and ${updatedCount} observations in ${elapsedTime}ms`
    )

    return {
      success: true,
      mediaID,
      newTimestamp: formattedNewTimestamp,
      observationsUpdated: updatedCount
    }
  } catch (error) {
    log.error(`Error updating media timestamp: ${error.message}`)
    throw error
  }
}

/**
 * Update an observation's classification (species) with CamTrap DP compliant fields.
 * When a human updates the classification:
 * - scientificName is updated to the new value
 * - classificationMethod is set to 'human'
 * - classifiedBy is set to 'User'
 * - classificationTimestamp is set to current ISO 8601 timestamp
 * - classificationProbability is cleared (null) for human classifications per CamTrap DP spec
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} observationID - The observation ID to update
 * @param {Object} updates - The update values
 * @param {string} updates.scientificName - The new scientific name (can be empty for blank)
 * @param {string} [updates.commonName] - Optional common name
 * @param {string} [updates.observationType] - Optional observation type (e.g., 'blank', 'animal')
 * @returns {Promise<Object>} - The updated observation
 */
export async function updateObservationClassification(dbPath, observationID, updates) {
  const startTime = Date.now()
  log.info(`Updating observation classification: ${observationID}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    // Prepare update values following CamTrap DP specification
    const updateValues = {
      scientificName: updates.scientificName || null,
      classificationMethod: 'human',
      classifiedBy: 'User',
      classificationTimestamp: new Date().toISOString(),
      // Per CamTrap DP spec: "Omit or provide an approximate probability for human classifications"
      // We set to null to indicate this is a human classification without probability
      classificationProbability: null
    }

    // Add optional fields if provided
    if (updates.commonName !== undefined) {
      updateValues.commonName = updates.commonName
    }

    if (updates.observationType !== undefined) {
      updateValues.observationType = updates.observationType
    }

    // Perform the update
    await db
      .update(observations)
      .set(updateValues)
      .where(eq(observations.observationID, observationID))

    // Fetch and return the updated observation
    const updatedObservation = await db
      .select()
      .from(observations)
      .where(eq(observations.observationID, observationID))
      .get()

    const elapsedTime = Date.now() - startTime
    log.info(
      `Updated observation ${observationID} to "${updates.scientificName || 'blank'}" in ${elapsedTime}ms`
    )
    return updatedObservation
  } catch (error) {
    log.error(`Error updating observation classification: ${error.message}`)
    throw error
  }
}

/**
 * Update an observation's bounding box coordinates.
 * When a human updates the bbox:
 * - Bbox coordinates are updated (bboxX, bboxY, bboxWidth, bboxHeight)
 * - classificationMethod is set to 'human'
 * - classifiedBy is set to 'User'
 * - classificationTimestamp is updated
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} observationID - The observation ID to update
 * @param {Object} bboxUpdates - The new bbox coordinates
 * @param {number} bboxUpdates.bboxX - Left edge (0-1 normalized)
 * @param {number} bboxUpdates.bboxY - Top edge (0-1 normalized)
 * @param {number} bboxUpdates.bboxWidth - Width (0-1 normalized)
 * @param {number} bboxUpdates.bboxHeight - Height (0-1 normalized)
 * @returns {Promise<Object>} - The updated observation
 */
export async function updateObservationBbox(dbPath, observationID, bboxUpdates) {
  const startTime = Date.now()
  log.info(`Updating observation bbox: ${observationID}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    const { bboxX, bboxY, bboxWidth, bboxHeight } = bboxUpdates

    // Validate bbox values are in valid range
    if (
      bboxX < 0 ||
      bboxX > 1 ||
      bboxY < 0 ||
      bboxY > 1 ||
      bboxWidth <= 0 ||
      bboxWidth > 1 ||
      bboxHeight <= 0 ||
      bboxHeight > 1 ||
      bboxX + bboxWidth > 1.001 ||
      bboxY + bboxHeight > 1.001
    ) {
      throw new Error('Invalid bbox coordinates: must be normalized (0-1) and within bounds')
    }

    // Prepare update values
    const updateValues = {
      bboxX,
      bboxY,
      bboxWidth,
      bboxHeight,
      classificationMethod: 'human',
      classifiedBy: 'User',
      classificationTimestamp: new Date().toISOString()
    }

    // Perform the update
    await db
      .update(observations)
      .set(updateValues)
      .where(eq(observations.observationID, observationID))

    // Fetch and return the updated observation
    const updatedObservation = await db
      .select()
      .from(observations)
      .where(eq(observations.observationID, observationID))
      .get()

    const elapsedTime = Date.now() - startTime
    log.info(`Updated observation ${observationID} bbox in ${elapsedTime}ms`)
    return updatedObservation
  } catch (error) {
    log.error(`Error updating observation bbox: ${error.message}`)
    throw error
  }
}

/**
 * Delete an observation from the database.
 * This permanently removes the observation record.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} observationID - The observation ID to delete
 * @returns {Promise<Object>} - Success indicator with deleted observationID
 */
export async function deleteObservation(dbPath, observationID) {
  const startTime = Date.now()
  log.info(`Deleting observation: ${observationID}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    // Delete the observation
    await db.delete(observations).where(eq(observations.observationID, observationID))

    const elapsedTime = Date.now() - startTime
    log.info(`Deleted observation ${observationID} in ${elapsedTime}ms`)
    return { success: true, observationID }
  } catch (error) {
    log.error(`Error deleting observation: ${error.message}`)
    throw error
  }
}

/**
 * Create a new observation with bounding box (human-drawn).
 * Follows CamTrap DP specification for human classifications.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {Object} observationData - The observation data
 * @param {string} observationData.mediaID - Associated media ID
 * @param {string} observationData.deploymentID - Associated deployment ID
 * @param {string} observationData.timestamp - Media timestamp (ISO 8601)
 * @param {string|null} observationData.scientificName - Species (null for unknown)
 * @param {string|null} observationData.commonName - Common name (optional)
 * @param {number} observationData.bboxX - Left edge (0-1 normalized)
 * @param {number} observationData.bboxY - Top edge (0-1 normalized)
 * @param {number} observationData.bboxWidth - Width (0-1 normalized)
 * @param {number} observationData.bboxHeight - Height (0-1 normalized)
 * @returns {Promise<Object>} - The created observation
 */
export async function createObservation(dbPath, observationData) {
  const startTime = Date.now()
  log.info(`Creating new observation for media: ${observationData.mediaID}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    const {
      mediaID,
      deploymentID,
      timestamp,
      scientificName,
      commonName,
      bboxX,
      bboxY,
      bboxWidth,
      bboxHeight
    } = observationData

    // Only validate bbox if coordinates are provided (allow null for observations without bbox)
    const hasBbox = bboxX !== null && bboxX !== undefined
    if (hasBbox) {
      if (
        bboxX < 0 ||
        bboxX > 1 ||
        bboxY < 0 ||
        bboxY > 1 ||
        bboxWidth <= 0 ||
        bboxWidth > 1 ||
        bboxHeight <= 0 ||
        bboxHeight > 1 ||
        bboxX + bboxWidth > 1.001 ||
        bboxY + bboxHeight > 1.001
      ) {
        throw new Error('Invalid bbox coordinates: must be normalized (0-1) and within bounds')
      }
    }

    // Generate IDs
    const observationID = crypto.randomUUID()
    const eventID = crypto.randomUUID()

    // Prepare observation data following CamTrap DP specification
    const newObservation = {
      observationID,
      mediaID,
      deploymentID,
      eventID,
      eventStart: timestamp,
      eventEnd: timestamp,
      scientificName: scientificName || null,
      commonName: commonName || null,
      observationType: 'animal',
      classificationProbability: null, // Human classification - no classificationProbability score
      count: 1,
      bboxX: hasBbox ? bboxX : null,
      bboxY: hasBbox ? bboxY : null,
      bboxWidth: hasBbox ? bboxWidth : null,
      bboxHeight: hasBbox ? bboxHeight : null,
      modelOutputID: null, // No model involved
      classificationMethod: 'human',
      classifiedBy: 'User',
      classificationTimestamp: new Date().toISOString()
    }

    // Insert the observation
    await db.insert(observations).values(newObservation)

    // Fetch and return the created observation
    const createdObservation = await db
      .select()
      .from(observations)
      .where(eq(observations.observationID, observationID))
      .get()

    const elapsedTime = Date.now() - startTime
    log.info(
      `Created observation ${observationID} for species "${scientificName || 'unknown'}" in ${elapsedTime}ms`
    )
    return createdObservation
  } catch (error) {
    log.error(`Error creating observation: ${error.message}`)
    throw error
  }
}

/**
 * Get all distinct species names from the observations table
 * Used to populate dropdowns for species selection
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Array of distinct species with scientificName and commonName
 */
export async function getDistinctSpecies(dbPath) {
  const startTime = Date.now()
  log.info(`Querying distinct species from: ${dbPath}`)

  try {
    // Extract study ID from path
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'

    const db = await getDrizzleDb(studyId, dbPath)

    const rows = await db
      .select({
        scientificName: observations.scientificName,
        commonName: observations.commonName,
        observationCount: count(observations.observationID).as('observationCount')
      })
      .from(observations)
      .where(and(isNotNull(observations.scientificName), ne(observations.scientificName, '')))
      .groupBy(observations.scientificName)
      .orderBy(desc(count(observations.observationID)), observations.scientificName)

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved ${rows.length} distinct species in ${elapsedTime}ms`)
    return rows
  } catch (error) {
    log.error(`Error querying distinct species: ${error.message}`)
    throw error
  }
}

/**
 * Check if a study has observations with non-null eventIDs (imported from CamtrapDP)
 * Used to determine default sequence grouping behavior in the UI
 */
export async function checkStudyHasEventIDs(dbPath) {
  const startTime = Date.now()
  log.info(`Checking if study has eventIDs: ${dbPath}`)

  try {
    const pathParts = dbPath.split('/')
    const studyId = pathParts[pathParts.length - 2] || 'unknown'
    const db = await getDrizzleDb(studyId, dbPath)

    const result = await db
      .select({ eventID: observations.eventID })
      .from(observations)
      .where(and(isNotNull(observations.eventID), ne(observations.eventID, '')))
      .limit(1)

    const hasEventIDs = result.length > 0
    const elapsedTime = Date.now() - startTime
    log.info(`Study has eventIDs: ${hasEventIDs} (checked in ${elapsedTime}ms)`)
    return hasEventIDs
  } catch (error) {
    log.error(`Error checking study eventIDs: ${error.message}`)
    throw error
  }
}
