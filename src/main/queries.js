import {
  getDrizzleDb,
  deployments,
  media,
  observations,
  getStudyDatabase,
  executeRawQuery
} from './db/index.js'
import { eq, and, desc, count, sql, isNotNull, ne } from 'drizzle-orm'
import log from 'electron-log'

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

    // Use raw SQL for complex GROUP BY query that's hard to express in Drizzle
    const result = await db.all(sql`
      SELECT DISTINCT
        locationID,
        locationName,
        deploymentID,
        deploymentStart,
        deploymentEnd,
        longitude,
        latitude
      FROM (
        SELECT
          locationName,
          locationID,
          deploymentID,
          deploymentStart,
          deploymentEnd,
          longitude,
          latitude
        FROM deployments
        ORDER BY locationID, deploymentStart DESC
      )
      GROUP BY locationID
    `)

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

    // Extract species names for the IN clause with proper escaping
    const speciesNames = species.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')

    // Time of day query condition
    let timeCondition = ''
    if (startHour < endHour) {
      // Simple range (e.g., 8:00 to 17:00)
      timeCondition = `
        AND CAST(strftime('%H', o.eventStart) AS INTEGER) >= ${startHour}
        AND CAST(strftime('%H', o.eventStart) AS INTEGER) < ${endHour}
      `
    } else if (startHour > endHour) {
      // Wrapping range (e.g., 22:00 to 6:00)
      timeCondition = `
        AND CAST(strftime('%H', o.eventStart) AS INTEGER) >= ${startHour}
        OR CAST(strftime('%H', o.eventStart) AS INTEGER) < ${endHour}
      `
    }
    // If startHour equals endHour, we include all hours (full day)

    // Use raw SQL for complex time filtering that's easier to express in SQL
    const query = `
      SELECT
        d.locationName,
        d.latitude,
        d.longitude,
        o.scientificName,
        COUNT(*) as count
      FROM observations o
      JOIN deployments d ON o.deploymentID = d.deploymentID
      WHERE
        o.scientificName IN (${speciesNames})
        AND o.eventStart >= ?
        AND o.eventStart <= ?
        AND d.latitude IS NOT NULL
        AND d.longitude IS NOT NULL
        ${timeCondition}
      GROUP BY d.latitude, d.longitude, o.scientificName
      ORDER BY count DESC
    `

    const rows = await executeRawQuery(studyId, dbPath, query, [startDate, endDate])

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
  const { limit = 10, offset = 0, species = [], dateRange = {}, timeRange = {} } = options

  const startTime = Date.now()
  log.info(`Querying media files from: ${dbPath} with filtering options`)
  log.info(`Pagination: limit ${limit}, offset ${offset}`)

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

    // Build the query with optional filters using raw SQL for complex filtering
    let query = `
      SELECT DISTINCT
        m.mediaID,
        m.filePath,
        m.fileName,
        m.timestamp,
        m.deploymentID,
        o.scientificName
      FROM media m
      JOIN observations o ON m.timestamp = o.eventStart
      WHERE o.scientificName IS NOT NULL
        AND o.scientificName != ''
    `

    const queryParams = []

    // Add species filter if provided
    if (species.length > 0) {
      const placeholders = species.map(() => '?').join(',')
      query += ` AND o.scientificName IN (${placeholders})`
      queryParams.push(...species)
    }

    // Add date range filter if provided
    if (dateRange.start && dateRange.end) {
      // Format Date objects to ISO strings if they're not already
      const startDate =
        dateRange.start instanceof Date ? dateRange.start.toISOString() : dateRange.start
      const endDate = dateRange.end instanceof Date ? dateRange.end.toISOString() : dateRange.end

      log.info(`Formatted date range: ${startDate} to ${endDate}`)

      query += ` AND m.timestamp >= ? AND m.timestamp <= ?`
      queryParams.push(startDate, endDate)
    }

    // Add time of day filter if provided
    if (timeRange.start !== undefined && timeRange.end !== undefined) {
      if (timeRange.start < timeRange.end) {
        // Simple range (e.g., 8:00 to 17:00)
        query += ` AND CAST(strftime('%H', m.timestamp) AS INTEGER) >= ?
                   AND CAST(strftime('%H', m.timestamp) AS INTEGER) < ?`
        queryParams.push(timeRange.start, timeRange.end)
      } else if (timeRange.start > timeRange.end) {
        // Wrapping range (e.g., 22:00 to 6:00)
        query += ` AND (CAST(strftime('%H', m.timestamp) AS INTEGER) >= ?
                   OR CAST(strftime('%H', m.timestamp) AS INTEGER) < ?)`
        queryParams.push(timeRange.start, timeRange.end)
      }
    }

    // Add ordering and limit with offset for pagination
    query += `
      ORDER BY m.timestamp DESC
      LIMIT ? OFFSET ?
    `
    queryParams.push(limit, offset)

    // Use the executeRawQuery helper for complex parameterized queries
    const rows = await executeRawQuery(studyId, dbPath, query, queryParams)

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved ${rows.length} media files matching criteria (offset: ${offset}) in ${elapsedTime}ms`
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

    // Extract species names for the IN clause with proper escaping
    const speciesNames = species.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')

    // Use raw SQL for hour extraction which is easier in SQL
    const query = `
      SELECT
        CAST(strftime('%H', eventStart) AS INTEGER) as hour,
        scientificName,
        COUNT(*) as count
      FROM observations
      WHERE
        scientificName IN (${speciesNames})
        AND eventStart >= ?
        AND eventStart <= ?
      GROUP BY hour, scientificName
      ORDER BY hour, scientificName
    `

    const rows = await executeRawQuery(studyId, dbPath, query, [startDate, endDate])

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
            confidence: observation.confidence !== undefined ? observation.confidence : null,
            count: observation.count !== undefined ? observation.count : null,
            prediction: observation.prediction || null
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

    // Query to get directory statistics
    const rows = await db
      .select({
        folderName: media.folderName,
        importFolder: media.importFolder,
        imageCount: count(media.mediaID).as('imageCount'),
        processedCount: count(observations.observationID).as('processedCount')
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
