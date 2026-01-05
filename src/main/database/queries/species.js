/**
 * Species-related database queries
 */

import { getDrizzleDb, executeRawQuery, deployments, media, observations } from '../index.js'
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
  or,
  notExists
} from 'drizzle-orm'
import log from 'electron-log'
import { getStudyIdFromPath, isTimestampBasedDataset } from './utils.js'

/**
 * Get species distribution from the database using Drizzle ORM
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Species distribution data
 */
export async function getSpeciesDistribution(dbPath) {
  const startTime = Date.now()
  log.info(`Querying species distribution from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

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
 * Get count of blank media (media with no observations) from the database
 * For mediaID-based datasets: counts media with no linked observations
 * For timestamp-based datasets (CamTrap DP): returns 0 (blank detection not supported)
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<number>} - Count of media files with no observations
 */
export async function getBlankMediaCount(dbPath) {
  const startTime = Date.now()
  log.info(`Querying blank media count from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    // Check if this is a timestamp-based dataset (CamTrap DP)
    // These datasets use eventStart/eventEnd ranges which are slow to query
    // Return 0 blanks for now (better than showing animals incorrectly as blanks)
    if (await isTimestampBasedDataset(db)) {
      const elapsedTime = Date.now() - startTime
      log.info(`Timestamp-based dataset detected, returning 0 blanks in ${elapsedTime}ms`)
      return 0
    }

    // For mediaID-based datasets, count media with no linked observations
    const matchingObservations = db
      .select({ one: sql`1` })
      .from(observations)
      .where(eq(observations.mediaID, media.mediaID))

    const result = await db
      .select({ count: count().as('count') })
      .from(media)
      .where(notExists(matchingObservations))
      .get()

    const blankCount = result?.count || 0
    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved blank media count: ${blankCount} in ${elapsedTime}ms`)

    return blankCount
  } catch (error) {
    log.error(`Error querying blank media count: ${error.message}`)
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
 * Get daily timeseries data for specific species
 * @param {string} dbPath - Path to the SQLite database
 * @param {Array<string>} speciesNames - List of scientific names to include
 * @returns {Promise<Object>} - Timeseries data for specified species
 */
export async function getSpeciesTimeseries(dbPath, speciesNames = []) {
  const startTime = Date.now()
  log.info(`Querying species timeseries from: ${dbPath} for specific species`)
  log.info(`Selected species: ${speciesNames.join(', ')}`)

  // Check if requesting blanks (media without observations)
  const BLANK_SENTINEL = '__blank__'
  const requestingBlanks = speciesNames.includes(BLANK_SENTINEL)
  const regularSpecies = speciesNames.filter((s) => s !== BLANK_SENTINEL)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    // Check if this is a timestamp-based dataset (CamTrap DP)
    // For these datasets, blank queries are not supported (would require slow range queries)
    const isTimestampBased = requestingBlanks ? await isTimestampBasedDataset(db) : false
    const effectiveRequestingBlanks = requestingBlanks && !isTimestampBased
    if (requestingBlanks && isTimestampBased) {
      log.info('Timestamp-based dataset: skipping blank timeseries')
    }

    // Prepare species filter for the complex CTE query
    let speciesFilter = ''
    if (regularSpecies && regularSpecies.length > 0) {
      const quotedSpecies = regularSpecies.map((name) => `'${name.replace(/'/g, "''")}'`).join(',')
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

    let timeseries = []
    let speciesData = []

    // Run species query if:
    // - Specific species are requested (regularSpecies.length > 0), OR
    // - No species filter provided at all (speciesNames.length === 0 = get all species)
    // Only skip when ONLY blanks are requested (regularSpecies.length === 0 AND requestingBlanks)
    const shouldRunSpeciesQuery = regularSpecies.length > 0 || !requestingBlanks
    if (shouldRunSpeciesQuery) {
      timeseries = await executeRawQuery(studyId, dbPath, timeseriesQuery)

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
      speciesData = Array.from(speciesMap.values()).sort((a, b) => b.count - a.count)
    }

    // If requesting blanks, add blank media weekly counts
    if (effectiveRequestingBlanks) {
      const blankTimeseriesQuery = `
        WITH date_range AS (
          SELECT
            date(min(substr(timestamp, 1, 10)), 'weekday 0', '-7 days') AS start_week,
            date(max(substr(timestamp, 1, 10)), 'weekday 0') AS end_week
          FROM media
          WHERE timestamp IS NOT NULL AND substr(timestamp, 1, 4) > '1970'
        ),
        weeks(week_start) AS (
          SELECT start_week FROM date_range
          UNION ALL
          SELECT date(week_start, '+7 days')
          FROM weeks, date_range
          WHERE week_start < end_week
        ),
        blank_media AS (
          SELECT m.mediaID, m.timestamp
          FROM media m
          WHERE m.timestamp IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM observations o
              WHERE o.mediaID = m.mediaID
            )
        ),
        blank_weekly_counts AS (
          SELECT
            date(substr(timestamp, 1, 10), 'weekday 0', '-7 days') as week_start,
            COUNT(*) as count
          FROM blank_media
          GROUP BY week_start
        ),
        blank_total AS (
          SELECT COUNT(*) as total_count FROM blank_media
        )
        SELECT
          w.week_start as date,
          '${BLANK_SENTINEL}' as scientificName,
          COALESCE(bwc.count, 0) as count,
          (SELECT total_count FROM blank_total) as total_count
        FROM weeks w
        LEFT JOIN blank_weekly_counts bwc ON w.week_start = bwc.week_start
        ORDER BY w.week_start ASC
      `

      const blankTimeseries = await executeRawQuery(studyId, dbPath, blankTimeseriesQuery)

      // Add blank data to timeseries
      if (blankTimeseries.length > 0) {
        timeseries = [...timeseries, ...blankTimeseries]

        // Add blank to species data
        const blankTotalCount = blankTimeseries[0]?.total_count || 0
        if (blankTotalCount > 0) {
          speciesData.push({
            scientificName: BLANK_SENTINEL,
            count: blankTotalCount
          })
        }
      }
    }

    // Process the SQL results into the expected format
    const processedData = processTimeseriesDataFromSql(timeseries)

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
  endHour = 24,
  includeNullTimestamps = false
) {
  const startTime = Date.now()
  log.info(`Querying species heatmap data from: ${dbPath}`)
  log.info(`Date range: ${startDate} to ${endDate}`)
  log.info(`Time range: ${startHour} to ${endHour} hours`)
  log.info(`Species: ${species.join(', ')}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    // Build base conditions
    const baseConditions = [
      inArray(observations.scientificName, species),
      isNotNull(deployments.latitude),
      isNotNull(deployments.longitude)
    ]

    // Add date range filter with null timestamp support
    if (includeNullTimestamps) {
      // Include observations with null eventStart OR within date range
      baseConditions.push(
        or(
          isNull(observations.eventStart),
          and(gte(observations.eventStart, startDate), lte(observations.eventStart, endDate))
        )
      )
    } else {
      baseConditions.push(gte(observations.eventStart, startDate))
      baseConditions.push(lte(observations.eventStart, endDate))
    }

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

  // Check if requesting blanks (media without observations)
  const BLANK_SENTINEL = '__blank__'
  const requestingBlanks = species.includes(BLANK_SENTINEL)
  const regularSpecies = species.filter((s) => s !== BLANK_SENTINEL)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    // Check if this is a timestamp-based dataset (CamTrap DP)
    // For these datasets, blank queries are not supported (would require slow range queries)
    const isTimestampBased = requestingBlanks ? await isTimestampBasedDataset(db) : false
    const effectiveRequestingBlanks = requestingBlanks && !isTimestampBased
    if (requestingBlanks && isTimestampBased) {
      log.info('Timestamp-based dataset: skipping blank activity data')
    }

    let rows = []

    // Query regular species if any
    if (regularSpecies.length > 0) {
      // Use sql template for SQLite-specific hour extraction via strftime
      const hourColumn = sql`CAST(strftime('%H', ${observations.eventStart}) AS INTEGER)`.as('hour')

      rows = await db
        .select({
          hour: hourColumn,
          scientificName: observations.scientificName,
          count: count().as('count')
        })
        .from(observations)
        .where(
          and(
            inArray(observations.scientificName, regularSpecies),
            gte(observations.eventStart, startDate),
            lte(observations.eventStart, endDate)
          )
        )
        .groupBy(hourColumn, observations.scientificName)
        .orderBy(hourColumn, observations.scientificName)
    }

    // Query blank media hourly distribution if requested
    if (effectiveRequestingBlanks) {
      const blankHourColumn = sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER)`.as('hour')

      // Correlated subquery for blank detection (only used for mediaID-based datasets)
      // For timestamp-based datasets, effectiveRequestingBlanks is already false
      const matchingObservations = db
        .select({ one: sql`1` })
        .from(observations)
        .where(eq(observations.mediaID, media.mediaID))

      const blankRows = await db
        .select({
          hour: blankHourColumn,
          count: count().as('count')
        })
        .from(media)
        .where(
          and(
            notExists(matchingObservations),
            gte(media.timestamp, startDate),
            lte(media.timestamp, endDate)
          )
        )
        .groupBy(blankHourColumn)
        .orderBy(blankHourColumn)

      // Add blank rows with the sentinel as scientificName
      blankRows.forEach((row) => {
        rows.push({
          hour: row.hour,
          scientificName: BLANK_SENTINEL,
          count: row.count
        })
      })
    }

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
      if (row.hour !== null && hourlyData[row.hour]) {
        hourlyData[row.hour][row.scientificName] = row.count
      }
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
    const studyId = getStudyIdFromPath(dbPath)

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
