/**
 * Species-related database queries
 */

import { getDrizzleDb, getStudyDatabase, deployments, media, observations } from '../index.js'
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
import { getStudyIdFromPath } from './utils.js'
import { BLANK_SENTINEL } from '../../../shared/constants.js'

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

    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

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
 * Counts media with no linked observations via mediaID foreign key.
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<number>} - Count of media files with no observations
 */
export async function getBlankMediaCount(dbPath) {
  const startTime = Date.now()
  log.info(`Querying blank media count from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

    // Count media with no linked observations
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

/**
 * Get species distribution data grouped by media for sequence-aware counting.
 * Returns one row per (species, media) combination with the count of observations.
 * Used by the frontend to calculate sequence-aware species counts by:
 * 1. Grouping media into sequences based on timestamp proximity
 * 2. Taking the MAX count of each species within each sequence
 * 3. Summing the max counts across all sequences
 *
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Array of { scientificName, mediaID, timestamp, deploymentID, eventID, fileMediatype, count }
 */
export async function getSpeciesDistributionByMedia(dbPath) {
  const startTime = Date.now()
  log.info(`Querying species distribution by media from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

    const result = await db
      .select({
        scientificName: observations.scientificName,
        mediaID: media.mediaID,
        timestamp: media.timestamp,
        deploymentID: media.deploymentID,
        eventID: observations.eventID,
        fileMediatype: media.fileMediatype,
        count: count(observations.observationID).as('count')
      })
      .from(observations)
      .innerJoin(media, eq(observations.mediaID, media.mediaID))
      .where(
        and(
          isNotNull(observations.scientificName),
          ne(observations.scientificName, ''),
          sql`(${observations.observationType} IS NULL OR ${observations.observationType} != 'blank')`
        )
      )
      .groupBy(observations.scientificName, media.mediaID)
      .orderBy(media.timestamp)

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved species distribution by media: ${result.length} species-media combinations in ${elapsedTime}ms`
    )

    return result
  } catch (error) {
    log.error(`Error querying species distribution by media: ${error.message}`)
    throw error
  }
}

/**
 * Compute the sequence-aware species distribution entirely in SQL for speed,
 * producing the same aggregated result as:
 *   getSpeciesDistributionByMedia(dbPath) + calculateSequenceAwareSpeciesCounts(rows, gapSeconds)
 * on the happy-path gap values (null / 0). For positive gapSeconds the
 * timestamp-gap grouping logic is non-trivial to replicate in SQL (deployment-
 * scoped, video-aware, dual-direction gap check); this function returns null
 * so callers fall back to the JS implementation.
 *
 * Semantics mirror the current JS implementation:
 *  - gapSeconds === 0        → group by eventID per deployment-agnostic event;
 *                              per (species, event) take MAX count, SUM by species
 *                              (media without eventID become their own event).
 *  - null/undefined/<= 0
 *    (not a positive number) → "each media is its own sequence": count of
 *                              observations per species (matches the
 *                              null-gap short-circuit at grouping.js:59).
 *  - gapSeconds > 0          → returns null (caller must fall back to JS).
 *
 * INNER JOIN on media is preserved to mirror the current behavior: observations
 * whose mediaID has no matching media row are dropped from counts.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {number|null|undefined} gapSeconds - Sequence gap threshold
 * @returns {Promise<Array<{scientificName: string, count: number}>|null>}
 *   Sorted by count desc, or null if the caller must use the JS fallback.
 */
export async function getSequenceAwareSpeciesCountsSQL(dbPath, gapSeconds) {
  const isPositiveGap = typeof gapSeconds === 'number' && gapSeconds > 0
  if (isPositiveGap) return null

  const startTime = Date.now()
  const studyId = getStudyIdFromPath(dbPath)
  const manager = await getStudyDatabase(studyId, dbPath, { readonly: true })
  const sqlite = manager.getSqlite()

  const useEventIDPath = gapSeconds === 0

  try {
    let rows
    if (useEventIDPath) {
      // eventID path: per (species, eventID) take MAX(per-media count), SUM by species.
      // Media without eventID contribute as their own single-media "event" via COALESCE.
      // Null-timestamp media are separated out and contribute as individual single-media
      // "sequences" (mirrors the nullTimestampMedia branch in speciesCounts.js:112-130),
      // which differs from valid-ts-with-eventID grouping in the edge case where a null-ts
      // media shares its eventID with valid-ts media.
      rows = sqlite
        .prepare(
          `
          WITH per_media AS (
            SELECT o.scientificName AS scientificName,
                   o.eventID AS eventID,
                   m.mediaID AS mediaID,
                   m.timestamp AS timestamp,
                   COUNT(o.observationID) AS cnt
              FROM observations o
              INNER JOIN media m ON o.mediaID = m.mediaID
              WHERE o.scientificName IS NOT NULL AND o.scientificName != ''
                AND (o.observationType IS NULL OR o.observationType != 'blank')
              GROUP BY o.scientificName, m.mediaID
          ),
          classified AS (
            SELECT scientificName, eventID, mediaID, cnt,
                   CASE
                     WHEN timestamp IS NULL OR timestamp = '' OR julianday(timestamp) IS NULL
                     THEN 1 ELSE 0
                   END AS is_null_ts
              FROM per_media
          ),
          valid_per_event AS (
            SELECT scientificName,
                   COALESCE(NULLIF(eventID, ''), 'solo:' || mediaID) AS event_key,
                   MAX(cnt) AS max_cnt
              FROM classified
              WHERE is_null_ts = 0
              GROUP BY scientificName, event_key
          ),
          valid_totals AS (
            SELECT scientificName, SUM(max_cnt) AS count
              FROM valid_per_event GROUP BY scientificName
          ),
          null_ts_totals AS (
            SELECT scientificName, SUM(cnt) AS count
              FROM classified WHERE is_null_ts = 1
              GROUP BY scientificName
          )
          SELECT scientificName, SUM(count) AS count FROM (
            SELECT scientificName, count FROM valid_totals
            UNION ALL
            SELECT scientificName, count FROM null_ts_totals
          )
          GROUP BY scientificName ORDER BY count DESC
        `
        )
        .all()
    } else {
      // Per-media path: each media is its own sequence, so MAX == count per media,
      // SUM over media reduces to COUNT(observationID) per species.
      rows = sqlite
        .prepare(
          `
          SELECT o.scientificName AS scientificName,
                 COUNT(o.observationID) AS count
            FROM observations o
            INNER JOIN media m ON o.mediaID = m.mediaID
            WHERE o.scientificName IS NOT NULL AND o.scientificName != ''
              AND (o.observationType IS NULL OR o.observationType != 'blank')
            GROUP BY o.scientificName
            ORDER BY count DESC
        `
        )
        .all()
    }

    const elapsed = Date.now() - startTime
    log.info(
      `[SQL-agg] sequence-aware species counts (gap=${gapSeconds}, path=${useEventIDPath ? 'eventID' : 'per-media'}): ${rows.length} species in ${elapsed}ms`
    )
    return rows
  } catch (error) {
    log.error(`Error in getSequenceAwareSpeciesCountsSQL: ${error.message}`)
    throw error
  }
}

/**
 * Weekly sequence-aware timeseries computed entirely in SQL — fast path
 * that avoids shipping millions of raw observation rows to the worker for
 * JS-side aggregation (and the worker heap pressure that comes with it).
 *
 * Returns an array of `{ scientificName, weekStart, count }` suitable for
 * pivoting into the Timeline chart's `{ timeseries, allSpecies }` shape.
 *
 * Semantics mirror calculateSequenceAwareTimeseries + the null/0 branch of
 * calculateSequenceAwareSpeciesCounts:
 *  - weekStart derives from `media.timestamp` (NOT observations.eventStart —
 *    those can differ on some datasets; see validation run).
 *  - rows with null m.timestamp are skipped (JS treats them as "no week"
 *    and continues).
 *  - gapSeconds === 0          → per-(species, week, eventID) take MAX of
 *                                per-media obs count, SUM by (species, week).
 *                                Media with null/empty eventID become their
 *                                own single-media event via COALESCE.
 *  - null / undefined / ≤ 0
 *    (not positive)            → "each media is its own sequence": MAX
 *                                reduces to obs count per media, SUM
 *                                reduces to COUNT(observationID).
 *  - gapSeconds > 0            → returns null (JS fallback required for
 *                                time-gap-based sequence grouping).
 *
 * @param {string} dbPath
 * @param {Array<string>} speciesNames - scientificName filter (empty = all)
 * @param {number|null|undefined} gapSeconds
 * @returns {Promise<Array<{scientificName: string, weekStart: string, count: number}>|null>}
 */
export async function getSequenceAwareTimeseriesSQL(dbPath, speciesNames = [], gapSeconds) {
  const isPositiveGap = typeof gapSeconds === 'number' && gapSeconds > 0
  if (isPositiveGap) return null

  const regularSpecies = speciesNames.filter((s) => s !== BLANK_SENTINEL)
  // Fast path only handles regular-species filtering. Blank-inclusion requests
  // still need the JS path (would require a UNION with a notExists branch).
  if (speciesNames.includes(BLANK_SENTINEL)) return null

  const startTime = Date.now()
  const studyId = getStudyIdFromPath(dbPath)
  const manager = await getStudyDatabase(studyId, dbPath, { readonly: true })
  const sqlite = manager.getSqlite()

  const useEventIDPath = gapSeconds === 0
  const speciesPlaceholders = regularSpecies.map(() => '?').join(',')
  const speciesFilter =
    regularSpecies.length > 0
      ? `AND o.scientificName IN (${speciesPlaceholders})`
      : ''

  try {
    let rows
    if (useEventIDPath) {
      rows = sqlite
        .prepare(
          `
          WITH media_counts AS (
            SELECT o.scientificName AS scientificName,
                   COALESCE(NULLIF(o.eventID, ''), 'solo:' || o.mediaID) AS event_key,
                   date(substr(m.timestamp, 1, 10), 'weekday 0', '-7 days') AS weekStart,
                   COUNT(*) AS media_count
              FROM observations o
              INNER JOIN media m ON o.mediaID = m.mediaID
              WHERE o.scientificName IS NOT NULL AND o.scientificName != ''
                AND (o.observationType IS NULL OR o.observationType != 'blank')
                AND m.timestamp IS NOT NULL
                ${speciesFilter}
              GROUP BY o.scientificName, o.mediaID
          ),
          event_maxes AS (
            SELECT scientificName, weekStart, event_key, MAX(media_count) AS max_count
              FROM media_counts
              GROUP BY scientificName, weekStart, event_key
          )
          SELECT scientificName, weekStart, SUM(max_count) AS count
            FROM event_maxes
            GROUP BY scientificName, weekStart
            ORDER BY weekStart
        `
        )
        .all(...regularSpecies)
    } else {
      rows = sqlite
        .prepare(
          `
          SELECT o.scientificName AS scientificName,
                 date(substr(m.timestamp, 1, 10), 'weekday 0', '-7 days') AS weekStart,
                 COUNT(o.observationID) AS count
            FROM observations o
            INNER JOIN media m ON o.mediaID = m.mediaID
            WHERE o.scientificName IS NOT NULL AND o.scientificName != ''
              AND (o.observationType IS NULL OR o.observationType != 'blank')
              AND m.timestamp IS NOT NULL
              ${speciesFilter}
            GROUP BY o.scientificName, weekStart
            ORDER BY weekStart
        `
        )
        .all(...regularSpecies)
    }

    const elapsed = Date.now() - startTime
    log.info(
      `[SQL-agg] sequence-aware timeseries (gap=${gapSeconds}, path=${useEventIDPath ? 'eventID' : 'per-media'}): ${rows.length} (species,week) rows in ${elapsed}ms`
    )
    return rows
  } catch (error) {
    log.error(`Error in getSequenceAwareTimeseriesSQL: ${error.message}`)
    throw error
  }
}

/**
 * Get species timeseries data by media for sequence-aware counting.
 * Returns observations with media-level detail for frontend sequence grouping.
 * @param {string} dbPath - Path to the SQLite database
 * @param {Array<string>} speciesNames - List of scientific names to include
 * @returns {Promise<Array>} - Array of { scientificName, mediaID, timestamp, deploymentID, eventID, fileMediatype, weekStart, count }
 */
export async function getSpeciesTimeseriesByMedia(dbPath, speciesNames = []) {
  const startTime = Date.now()
  log.info(`Querying species timeseries by media from: ${dbPath}`)

  const requestingBlanks = speciesNames.includes(BLANK_SENTINEL)
  const regularSpecies = speciesNames.filter((s) => s !== BLANK_SENTINEL)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

    const shouldRunSpeciesQuery = regularSpecies.length > 0 || !requestingBlanks

    let results = []

    if (shouldRunSpeciesQuery) {
      // Build species filter condition
      const speciesCondition =
        regularSpecies.length > 0
          ? inArray(observations.scientificName, regularSpecies)
          : isNotNull(observations.scientificName)

      // Week start calculation using SQLite date functions
      const weekStartColumn =
        sql`date(substr(${media.timestamp}, 1, 10), 'weekday 0', '-7 days')`.as('weekStart')

      results = await db
        .select({
          scientificName: observations.scientificName,
          mediaID: media.mediaID,
          timestamp: media.timestamp,
          deploymentID: media.deploymentID,
          eventID: observations.eventID,
          fileMediatype: media.fileMediatype,
          weekStart: weekStartColumn,
          count: count(observations.observationID).as('count')
        })
        .from(observations)
        .innerJoin(media, eq(observations.mediaID, media.mediaID))
        .where(
          and(
            isNotNull(observations.scientificName),
            ne(observations.scientificName, ''),
            or(isNull(observations.observationType), ne(observations.observationType, 'blank')),
            speciesCondition
          )
        )
        .groupBy(observations.scientificName, media.mediaID)
        .orderBy(media.timestamp)
    }

    // Handle blanks if requested
    if (requestingBlanks) {
      const weekStartColumn =
        sql`date(substr(${media.timestamp}, 1, 10), 'weekday 0', '-7 days')`.as('weekStart')

      // Correlated subquery for blank detection
      const matchingObservations = db
        .select({ one: sql`1` })
        .from(observations)
        .where(eq(observations.mediaID, media.mediaID))

      const blankResults = await db
        .select({
          scientificName: sql`${BLANK_SENTINEL}`.as('scientificName'),
          mediaID: media.mediaID,
          timestamp: media.timestamp,
          deploymentID: media.deploymentID,
          eventID: sql`NULL`.as('eventID'),
          fileMediatype: media.fileMediatype,
          weekStart: weekStartColumn,
          count: sql`1`.as('count')
        })
        .from(media)
        .where(and(isNotNull(media.timestamp), notExists(matchingObservations)))
        .orderBy(media.timestamp)

      results = [...results, ...blankResults]
    }

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved species timeseries by media: ${results.length} rows in ${elapsedTime}ms`)

    return results
  } catch (error) {
    log.error(`Error querying species timeseries by media: ${error.message}`)
    throw error
  }
}

/**
 * Get species heatmap data by media for sequence-aware counting.
 * Returns observations with media-level detail for frontend sequence grouping.
 * @param {string} dbPath - Path to the SQLite database
 * @param {Array<string>} species - List of scientific names to include
 * @param {string} startDate - ISO date string for range start
 * @param {string} endDate - ISO date string for range end
 * @param {number} startHour - Starting hour of day (0-24)
 * @param {number} endHour - Ending hour of day (0-24)
 * @param {boolean} includeNullTimestamps - Whether to include observations with null timestamps
 * @returns {Promise<Array>} - Array of { scientificName, mediaID, timestamp, deploymentID, eventID, fileMediatype, latitude, longitude, locationName, count }
 */
export async function getSpeciesHeatmapDataByMedia(
  dbPath,
  species,
  startDate,
  endDate,
  startHour = 0,
  endHour = 24,
  includeNullTimestamps = false
) {
  const startTime = Date.now()
  log.info(`Querying species heatmap data by media from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

    // Build base conditions
    const baseConditions = [
      inArray(observations.scientificName, species),
      isNotNull(deployments.latitude),
      isNotNull(deployments.longitude)
    ]

    // Add date range filter with null timestamp support
    // Skip date filtering entirely if includeNullTimestamps=true and no dates provided
    if (includeNullTimestamps && (!startDate || !endDate)) {
      // No date filtering - include all records regardless of timestamp
    } else if (includeNullTimestamps) {
      baseConditions.push(
        or(
          isNull(media.timestamp),
          and(gte(media.timestamp, startDate), lte(media.timestamp, endDate))
        )
      )
    } else {
      baseConditions.push(gte(media.timestamp, startDate))
      baseConditions.push(lte(media.timestamp, endDate))
    }

    // Add time-of-day condition using sql template for SQLite strftime
    // When includeNullTimestamps=true, also allow null timestamps through
    const hourColumn = sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER)`
    if (startHour < endHour) {
      // Simple range (e.g., 8:00 to 17:00)
      const timeCondition = and(sql`${hourColumn} >= ${startHour}`, sql`${hourColumn} < ${endHour}`)
      baseConditions.push(
        includeNullTimestamps ? or(isNull(media.timestamp), timeCondition) : timeCondition
      )
    } else if (startHour > endHour) {
      // Wrapping range (e.g., 22:00 to 6:00)
      const timeCondition = or(sql`${hourColumn} >= ${startHour}`, sql`${hourColumn} < ${endHour}`)
      baseConditions.push(
        includeNullTimestamps ? or(isNull(media.timestamp), timeCondition) : timeCondition
      )
    }
    // If startHour equals endHour, we include all hours (full day)

    const results = await db
      .select({
        scientificName: observations.scientificName,
        mediaID: media.mediaID,
        timestamp: media.timestamp,
        deploymentID: media.deploymentID,
        eventID: observations.eventID,
        fileMediatype: media.fileMediatype,
        latitude: deployments.latitude,
        longitude: deployments.longitude,
        locationName: deployments.locationName,
        count: count(observations.observationID).as('count')
      })
      .from(observations)
      .innerJoin(media, eq(observations.mediaID, media.mediaID))
      .innerJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
      .where(and(...baseConditions))
      .groupBy(observations.scientificName, media.mediaID)
      .orderBy(media.timestamp)

    const elapsedTime = Date.now() - startTime
    log.info(`Retrieved species heatmap data by media: ${results.length} rows in ${elapsedTime}ms`)

    return results
  } catch (error) {
    log.error(`Error querying species heatmap data by media: ${error.message}`)
    throw error
  }
}

/**
 * Get species daily activity data by media for sequence-aware counting.
 * Returns observations with media-level detail for frontend sequence grouping.
 * @param {string} dbPath - Path to the SQLite database
 * @param {Array<string>} species - List of scientific names to include
 * @param {string} startDate - ISO date string for range start
 * @param {string} endDate - ISO date string for range end
 * @returns {Promise<Array>} - Array of { scientificName, mediaID, timestamp, deploymentID, eventID, fileMediatype, hour, count }
 */
export async function getSpeciesDailyActivityByMedia(dbPath, species, startDate, endDate) {
  const startTime = Date.now()
  log.info(`Querying species daily activity by media from: ${dbPath}`)

  const requestingBlanks = species.includes(BLANK_SENTINEL)
  const regularSpecies = species.filter((s) => s !== BLANK_SENTINEL)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

    let results = []

    // Hour extraction using SQLite strftime
    const hourColumn = sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER)`.as('hour')

    if (regularSpecies.length > 0) {
      results = await db
        .select({
          scientificName: observations.scientificName,
          mediaID: media.mediaID,
          timestamp: media.timestamp,
          deploymentID: media.deploymentID,
          eventID: observations.eventID,
          fileMediatype: media.fileMediatype,
          hour: hourColumn,
          count: count(observations.observationID).as('count')
        })
        .from(observations)
        .innerJoin(media, eq(observations.mediaID, media.mediaID))
        .where(
          and(
            inArray(observations.scientificName, regularSpecies),
            gte(media.timestamp, startDate),
            lte(media.timestamp, endDate)
          )
        )
        .groupBy(observations.scientificName, media.mediaID)
        .orderBy(media.timestamp)
    }

    // Handle blanks if requested
    if (requestingBlanks) {
      // Correlated subquery for blank detection
      const matchingObservations = db
        .select({ one: sql`1` })
        .from(observations)
        .where(eq(observations.mediaID, media.mediaID))

      const blankResults = await db
        .select({
          scientificName: sql`${BLANK_SENTINEL}`.as('scientificName'),
          mediaID: media.mediaID,
          timestamp: media.timestamp,
          deploymentID: media.deploymentID,
          eventID: sql`NULL`.as('eventID'),
          fileMediatype: media.fileMediatype,
          hour: hourColumn,
          count: sql`1`.as('count')
        })
        .from(media)
        .where(
          and(
            isNotNull(media.timestamp),
            gte(media.timestamp, startDate),
            lte(media.timestamp, endDate),
            notExists(matchingObservations)
          )
        )
        .orderBy(media.timestamp)

      results = [...results, ...blankResults]
    }

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved species daily activity by media: ${results.length} rows in ${elapsedTime}ms`
    )

    return results
  } catch (error) {
    log.error(`Error querying species daily activity by media: ${error.message}`)
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

    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })

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
