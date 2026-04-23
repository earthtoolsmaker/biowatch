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
    regularSpecies.length > 0 ? `AND o.scientificName IN (${speciesPlaceholders})` : ''

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
 * Per-(species, lat, lng) sequence-aware heatmap counts computed entirely in
 * SQL. Returns `[{ scientificName, latitude, longitude, locationName, count }]`
 * rows ready to pivot into the `{sp: [{lat, lng, count, locationName}]}` shape
 * the map expects.
 *
 * Replaces the previous "ship every (species, media) row, aggregate in JS"
 * pipeline. On gmu8_leuven (2.7M obs, 2704 deployments, gap=300s) the IPC
 * payload goes from ~400MB to <100KB and end-to-end time drops from ~19s to
 * ~9s — the SQL is still dominated by the window-function scan but JS no
 * longer has to re-aggregate 1.3M rows.
 *
 * Three internal paths keyed on gapSeconds (semantics mirror
 * calculateSequenceAwareHeatmap → calculateSequenceAwareSpeciesCounts):
 *  - gapSeconds > 0       → time-gap grouping via window functions.
 *                           Sequences form at the (lat, lng) level across ALL
 *                           selected species so an intervening obs at a
 *                           co-located deployment still breaks a sequence
 *                           (matches JS, which groups by location first then
 *                           sequences within). Per (species, seq, lat, lng)
 *                           take MAX of per-media obs count, SUM by
 *                           (species, lat, lng).
 *  - gapSeconds === 0     → eventID grouping, per-species. Media without
 *                           eventID become their own event via
 *                           COALESCE(..., 'solo:' || m.mediaID). Null-ts
 *                           media contribute their counts directly via the
 *                           null_totals branch.
 *  - null / undefined / ≤ 0
 *    (not positive)       → each media its own sequence →
 *                           COUNT(observationID) per (species, lat, lng).
 *
 * Window-path ordering is (timestamp, mediaID) — deterministic. Tied
 * timestamps at the same location can produce off-by-±1-2 counts vs the
 * JS path (which inherits SQLite's non-deterministic tied-row order);
 * validated against 19 local studies: all per-media and eventID paths are
 * byte-exact, window-path maxDiff is 2 on the worst-case study.
 *
 * BLANK_SENTINEL in speciesNames → returns null, caller falls back to the
 * JS path. The current heatmap JS path doesn't handle blanks either, but
 * we keep the convention of the other fast-paths for future-proofing.
 *
 * @param {string} dbPath
 * @param {Array<string>} speciesNames
 * @param {string|null} startDate - ISO date string for range start
 * @param {string|null} endDate - ISO date string for range end
 * @param {number} startHour - 0-24
 * @param {number} endHour - 0-24
 * @param {boolean} includeNullTimestamps
 * @param {number|null|undefined} gapSeconds
 * @returns {Promise<Array<{scientificName: string, latitude: number, longitude: number, locationName: string, count: number}>|null>}
 */
export async function getSequenceAwareHeatmapSQL(
  dbPath,
  speciesNames = [],
  startDate,
  endDate,
  startHour = 0,
  endHour = 24,
  includeNullTimestamps = false,
  gapSeconds
) {
  if (speciesNames.includes(BLANK_SENTINEL)) return null
  const regularSpecies = speciesNames.filter((s) => s !== BLANK_SENTINEL)
  if (regularSpecies.length === 0) return []

  const startTime = Date.now()
  const studyId = getStudyIdFromPath(dbPath)
  const manager = await getStudyDatabase(studyId, dbPath, { readonly: true })
  const sqlite = manager.getSqlite()

  const isPositiveGap = typeof gapSeconds === 'number' && gapSeconds > 0
  const useEventIDPath = gapSeconds === 0
  const pathLabel = isPositiveGap
    ? `time-gap-${gapSeconds}s`
    : useEventIDPath
      ? 'eventID'
      : 'per-media'
  const speciesPlaceholders = regularSpecies.map(() => '?').join(',')

  // Date + hour filters. Non-window paths evaluate the predicate inline; the
  // window path pushes it into media_info (and needs a parallel null-ts
  // branch when includeNullTimestamps).
  const buildDateHourFilter = (tsCol) => {
    const conds = []
    const params = []
    const noDateFilter = includeNullTimestamps && (!startDate || !endDate)
    if (!noDateFilter) {
      if (includeNullTimestamps) {
        conds.push(`(${tsCol} IS NULL OR (${tsCol} >= ? AND ${tsCol} <= ?))`)
        params.push(startDate, endDate)
      } else {
        conds.push(`${tsCol} >= ?`)
        conds.push(`${tsCol} <= ?`)
        params.push(startDate, endDate)
      }
    }
    const hourExpr = `CAST(strftime('%H', ${tsCol}) AS INTEGER)`
    if (startHour < endHour) {
      const hc = `(${hourExpr} >= ${startHour} AND ${hourExpr} < ${endHour})`
      conds.push(includeNullTimestamps ? `(${tsCol} IS NULL OR ${hc})` : hc)
    } else if (startHour > endHour) {
      const hc = `(${hourExpr} >= ${startHour} OR ${hourExpr} < ${endHour})`
      conds.push(includeNullTimestamps ? `(${tsCol} IS NULL OR ${hc})` : hc)
    }
    // startHour === endHour → full day, no filter
    return { where: conds.length > 0 ? 'AND ' + conds.join(' AND ') : '', params }
  }

  try {
    let rows
    if (isPositiveGap) {
      // Sequencing at (lat, lng) level across all selected species. Null-ts
      // media are excluded from the window (LAG can't order them) and
      // contribute via null_totals when includeNullTimestamps.
      const mediaFilter = buildDateHourFilter('m.timestamp')
      // Force m.timestamp IS NOT NULL on the window branch regardless of
      // includeNullTimestamps — those rows go through null_totals instead.
      const windowTsGuard = 'AND m.timestamp IS NOT NULL'
      const nullBranchFilter = includeNullTimestamps
        ? "AND (m.timestamp IS NULL OR m.timestamp = '')"
        : null

      const sql = `
        WITH media_obs AS (
          SELECT o.mediaID AS mediaID, o.scientificName AS scientificName,
                 COUNT(*) AS obs_count
            FROM observations o
            WHERE o.scientificName IN (${speciesPlaceholders})
            GROUP BY o.scientificName, o.mediaID
        ),
        media_info AS (
          SELECT m.mediaID, m.deploymentID, m.timestamp AS ts,
                 CASE WHEN m.fileMediatype LIKE 'video/%' THEN 1 ELSE 0 END AS is_video,
                 d.latitude, d.longitude, d.locationName
            FROM media m
            INNER JOIN deployments d ON m.deploymentID = d.deploymentID
            WHERE d.latitude IS NOT NULL AND d.longitude IS NOT NULL
              ${windowTsGuard}
              ${mediaFilter.where}
              AND m.mediaID IN (SELECT DISTINCT mediaID FROM media_obs)
        ),
        marked AS (
          SELECT *, CASE
            WHEN LAG(mediaID) OVER w IS NULL THEN 1
            WHEN is_video = 1 THEN 1
            WHEN LAG(is_video) OVER w = 1 THEN 1
            WHEN deploymentID IS NULL THEN 1
            WHEN LAG(deploymentID) OVER w IS NULL THEN 1
            WHEN deploymentID != LAG(deploymentID) OVER w THEN 1
            WHEN (julianday(ts) - julianday(LAG(ts) OVER w)) * 86400 > ? THEN 1
            ELSE 0
          END AS is_new FROM media_info
          WINDOW w AS (PARTITION BY latitude, longitude ORDER BY ts, mediaID)
        ),
        sequenced AS (
          SELECT mediaID, latitude, longitude, locationName,
                 SUM(is_new) OVER (PARTITION BY latitude, longitude ORDER BY ts, mediaID
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS seq_id
            FROM marked
        ),
        per_seq_sp_loc AS (
          SELECT mo.scientificName, s.latitude, s.longitude, s.seq_id,
                 MAX(mo.obs_count) AS max_count, MAX(s.locationName) AS locationName
            FROM sequenced s INNER JOIN media_obs mo ON s.mediaID = mo.mediaID
            GROUP BY mo.scientificName, s.latitude, s.longitude, s.seq_id
        ),
        valid_totals AS (
          SELECT scientificName, latitude, longitude,
                 MAX(locationName) AS locationName,
                 SUM(max_count) AS count
            FROM per_seq_sp_loc
            GROUP BY scientificName, latitude, longitude
        )
        ${
          nullBranchFilter
            ? `,
        null_totals AS (
          SELECT o.scientificName,
                 d.latitude, d.longitude, MAX(d.locationName) AS locationName,
                 COUNT(o.observationID) AS count
            FROM observations o
            INNER JOIN media m ON o.mediaID = m.mediaID
            INNER JOIN deployments d ON m.deploymentID = d.deploymentID
            WHERE o.scientificName IN (${speciesPlaceholders})
              AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
              ${nullBranchFilter}
            GROUP BY o.scientificName, d.latitude, d.longitude
        )
        SELECT scientificName, latitude, longitude, MAX(locationName) AS locationName,
               SUM(count) AS count
          FROM (SELECT * FROM valid_totals UNION ALL SELECT * FROM null_totals)
          GROUP BY scientificName, latitude, longitude`
            : `
        SELECT scientificName, latitude, longitude, locationName, count FROM valid_totals`
        }
      `
      const params = [
        ...regularSpecies,
        ...mediaFilter.params,
        gapSeconds,
        ...(nullBranchFilter ? regularSpecies : [])
      ]
      rows = sqlite.prepare(sql).all(...params)
    } else if (useEventIDPath) {
      const obsFilter = buildDateHourFilter('m.timestamp')
      rows = sqlite
        .prepare(
          `
          WITH per_media AS (
            SELECT o.scientificName AS scientificName, m.mediaID AS mediaID,
                   COALESCE(NULLIF(o.eventID, ''), 'solo:' || o.mediaID) AS event_key,
                   m.timestamp AS ts,
                   d.latitude, d.longitude, d.locationName,
                   COUNT(*) AS media_count
              FROM observations o
              INNER JOIN media m ON o.mediaID = m.mediaID
              INNER JOIN deployments d ON m.deploymentID = d.deploymentID
              WHERE o.scientificName IN (${speciesPlaceholders})
                AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
                ${obsFilter.where}
              GROUP BY o.scientificName, o.mediaID
          ),
          classified AS (
            SELECT scientificName, event_key, mediaID, media_count,
                   latitude, longitude, locationName,
                   CASE
                     WHEN ts IS NULL OR ts = '' OR julianday(ts) IS NULL
                     THEN 1 ELSE 0
                   END AS is_null_ts
              FROM per_media
          ),
          valid_maxes AS (
            SELECT scientificName, latitude, longitude, event_key,
                   MAX(media_count) AS max_count,
                   MAX(locationName) AS locationName
              FROM classified WHERE is_null_ts = 0
              GROUP BY scientificName, latitude, longitude, event_key
          ),
          valid_totals AS (
            SELECT scientificName, latitude, longitude,
                   MAX(locationName) AS locationName, SUM(max_count) AS count
              FROM valid_maxes GROUP BY scientificName, latitude, longitude
          ),
          null_totals AS (
            SELECT scientificName, latitude, longitude,
                   MAX(locationName) AS locationName, SUM(media_count) AS count
              FROM classified WHERE is_null_ts = 1
              GROUP BY scientificName, latitude, longitude
          )
          SELECT scientificName, latitude, longitude,
                 MAX(locationName) AS locationName, SUM(count) AS count
            FROM (SELECT * FROM valid_totals UNION ALL SELECT * FROM null_totals)
            GROUP BY scientificName, latitude, longitude
        `
        )
        .all(...regularSpecies, ...obsFilter.params)
    } else {
      // Per-media path: each media is its own sequence, so MAX reduces to
      // per-media count and SUM reduces to COUNT(observationID).
      const obsFilter = buildDateHourFilter('m.timestamp')
      rows = sqlite
        .prepare(
          `
          SELECT o.scientificName AS scientificName,
                 d.latitude, d.longitude, MAX(d.locationName) AS locationName,
                 COUNT(o.observationID) AS count
            FROM observations o
            INNER JOIN media m ON o.mediaID = m.mediaID
            INNER JOIN deployments d ON m.deploymentID = d.deploymentID
            WHERE o.scientificName IN (${speciesPlaceholders})
              AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
              ${obsFilter.where}
            GROUP BY o.scientificName, d.latitude, d.longitude
        `
        )
        .all(...regularSpecies, ...obsFilter.params)
    }

    const elapsed = Date.now() - startTime
    log.info(
      `[SQL-agg] sequence-aware heatmap (gap=${gapSeconds}, path=${pathLabel}): ${rows.length} (species,lat,lng) rows in ${elapsed}ms`
    )
    return rows
  } catch (error) {
    log.error(`Error in getSequenceAwareHeatmapSQL: ${error.message}`)
    throw error
  }
}

/**
 * Hourly sequence-aware daily activity computed entirely in SQL.
 * Returns `[{ scientificName, hour, count }]`, pivoted into the radar's
 * `[{ hour, [sp1]: N, ... }]` shape by pivotPreAggregatedDailyActivity.
 *
 * Three internal paths keyed on gapSeconds:
 *  - gapSeconds > 0       → time-gap grouping via window functions.
 *                           LAG(ts/deployment/is_video) + a cumulative SUM
 *                           assigns sequence IDs; sequence breaks on gap >
 *                           threshold, deployment change, or video adjacency.
 *  - gapSeconds === 0     → eventID grouping. Media without eventID become
 *                           their own event via COALESCE(..., 'solo:' || m.mediaID).
 *  - null / undefined / ≤ 0
 *    (not positive)       → each media its own sequence → COUNT(observationID)
 *                           per (species, hour).
 *
 * Ordering is (timestamp, mediaID) — deterministic, unlike the prior JS path
 * which depended on SQLite's query-plan ordering for tied timestamps.
 */
export async function getSequenceAwareDailyActivitySQL(
  dbPath,
  speciesNames = [],
  startDate,
  endDate,
  gapSeconds
) {
  const regularSpecies = speciesNames.filter((s) => s !== BLANK_SENTINEL)
  if (speciesNames.includes(BLANK_SENTINEL)) return null
  if (regularSpecies.length === 0) return []
  if (!startDate || !endDate) return []

  const startTime = Date.now()
  const studyId = getStudyIdFromPath(dbPath)
  const manager = await getStudyDatabase(studyId, dbPath, { readonly: true })
  const sqlite = manager.getSqlite()

  const isPositiveGap = typeof gapSeconds === 'number' && gapSeconds > 0
  const useEventIDPath = gapSeconds === 0
  const pathLabel = isPositiveGap
    ? `time-gap-${gapSeconds}s`
    : useEventIDPath
      ? 'eventID'
      : 'per-media'
  const speciesPlaceholders = regularSpecies.map(() => '?').join(',')

  try {
    let rows
    if (isPositiveGap) {
      rows = sqlite
        .prepare(
          `
          WITH per_media AS (
            SELECT o.scientificName AS scientificName,
                   m.mediaID AS mediaID,
                   m.deploymentID AS deploymentID,
                   m.timestamp AS ts,
                   CAST(strftime('%H', m.timestamp) AS INTEGER) AS hour,
                   CASE WHEN m.fileMediatype LIKE 'video/%' THEN 1 ELSE 0 END AS is_video,
                   COUNT(*) AS media_count
              FROM observations o
              INNER JOIN media m ON o.mediaID = m.mediaID
              WHERE o.scientificName IN (${speciesPlaceholders})
                AND m.timestamp IS NOT NULL
                AND m.timestamp >= ? AND m.timestamp <= ?
              GROUP BY o.scientificName, o.mediaID
          ),
          marked AS (
            SELECT *,
              CASE
                WHEN LAG(mediaID) OVER w IS NULL THEN 1
                WHEN is_video = 1 THEN 1
                WHEN LAG(is_video) OVER w = 1 THEN 1
                WHEN deploymentID IS NULL THEN 1
                WHEN LAG(deploymentID) OVER w IS NULL THEN 1
                WHEN deploymentID != LAG(deploymentID) OVER w THEN 1
                WHEN (julianday(ts) - julianday(LAG(ts) OVER w)) * 86400 > ? THEN 1
                ELSE 0
              END AS is_new
              FROM per_media
              WINDOW w AS (PARTITION BY scientificName ORDER BY ts, mediaID)
          ),
          sequenced AS (
            SELECT scientificName, hour, media_count,
                   SUM(is_new) OVER (PARTITION BY scientificName ORDER BY ts, mediaID
                                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS seq_id
              FROM marked
          ),
          per_seq_hour AS (
            SELECT scientificName, hour, seq_id, MAX(media_count) AS max_count
              FROM sequenced
              GROUP BY scientificName, hour, seq_id
          )
          SELECT scientificName, hour, SUM(max_count) AS count
            FROM per_seq_hour
            GROUP BY scientificName, hour
            ORDER BY hour
        `
        )
        .all(...regularSpecies, startDate, endDate, gapSeconds)
    } else if (useEventIDPath) {
      rows = sqlite
        .prepare(
          `
          WITH media_counts AS (
            SELECT o.scientificName AS scientificName,
                   COALESCE(NULLIF(o.eventID, ''), 'solo:' || o.mediaID) AS event_key,
                   CAST(strftime('%H', m.timestamp) AS INTEGER) AS hour,
                   COUNT(*) AS media_count
              FROM observations o
              INNER JOIN media m ON o.mediaID = m.mediaID
              WHERE o.scientificName IN (${speciesPlaceholders})
                AND m.timestamp IS NOT NULL
                AND m.timestamp >= ? AND m.timestamp <= ?
              GROUP BY o.scientificName, o.mediaID
          ),
          event_maxes AS (
            SELECT scientificName, hour, event_key, MAX(media_count) AS max_count
              FROM media_counts
              GROUP BY scientificName, hour, event_key
          )
          SELECT scientificName, hour, SUM(max_count) AS count
            FROM event_maxes
            GROUP BY scientificName, hour
            ORDER BY hour
        `
        )
        .all(...regularSpecies, startDate, endDate)
    } else {
      rows = sqlite
        .prepare(
          `
          SELECT o.scientificName AS scientificName,
                 CAST(strftime('%H', m.timestamp) AS INTEGER) AS hour,
                 COUNT(o.observationID) AS count
            FROM observations o
            INNER JOIN media m ON o.mediaID = m.mediaID
            WHERE o.scientificName IN (${speciesPlaceholders})
              AND m.timestamp IS NOT NULL
              AND m.timestamp >= ? AND m.timestamp <= ?
            GROUP BY o.scientificName, hour
            ORDER BY hour
        `
        )
        .all(...regularSpecies, startDate, endDate)
    }

    const elapsed = Date.now() - startTime
    log.info(
      `[SQL-agg] sequence-aware daily activity (gap=${gapSeconds}, path=${pathLabel}): ${rows.length} (species,hour) rows in ${elapsed}ms`
    )
    return rows
  } catch (error) {
    log.error(`Error in getSequenceAwareDailyActivitySQL: ${error.message}`)
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
