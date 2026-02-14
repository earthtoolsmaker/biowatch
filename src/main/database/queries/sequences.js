/**
 * Sequence-related database queries
 *
 * Provides cursor-based pagination for sequence grouping in the main process.
 */

import { getDrizzleDb, media, observations } from '../index.js'
import {
  eq,
  and,
  sql,
  isNotNull,
  ne,
  inArray,
  gte,
  lte,
  lt,
  isNull,
  or,
  notExists
} from 'drizzle-orm'
import { union } from 'drizzle-orm/sqlite-core'
import log from '../../services/logger.js'
import { getStudyIdFromPath } from './utils.js'
import { BLANK_SENTINEL } from '../../../shared/constants.js'

/**
 * Get media for sequence pagination with cursor support.
 * Returns media ordered by timestamp DESC, filtered by species/date/time.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {Object} options - Query options
 * @param {Object} options.cursor - Cursor object (null for first page)
 * @param {string} options.cursor.phase - 'timestamped' or 'null'
 * @param {string} options.cursor.t - Timestamp for cursor position (timestamped phase)
 * @param {string} options.cursor.m - Media ID for cursor position (timestamped phase)
 * @param {number} options.cursor.offset - Offset for null-timestamp phase
 * @param {number} options.batchSize - Number of media items to fetch
 * @param {Array<string>} options.species - Species filter (optional)
 * @param {Object} options.dateRange - Date range filter (optional)
 * @param {Object} options.timeRange - Time of day range filter (optional)
 * @returns {Promise<{ media: Array, hasMoreTimestamped: boolean, hasMoreNull: boolean }>}
 */
export async function getMediaForSequencePagination(dbPath, options = {}) {
  const { cursor = null, batchSize = 200, species = [], dateRange = {}, timeRange = {} } = options

  const startTime = Date.now()
  const phase = cursor?.phase || 'timestamped'
  log.info(`[Sequences] Fetching media for pagination (phase: ${phase}, batchSize: ${batchSize})`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    // Check if requesting blanks (media without observations)
    const requestingBlanks = species.includes(BLANK_SENTINEL)
    const regularSpecies = species.filter((s) => s !== BLANK_SENTINEL)

    // Date range filter (only applies to timestamped phase)
    let startDate, endDate
    if (dateRange.start && dateRange.end) {
      startDate = dateRange.start instanceof Date ? dateRange.start.toISOString() : dateRange.start
      endDate = dateRange.end instanceof Date ? dateRange.end.toISOString() : dateRange.end
      log.info(`[Sequences] Date range: ${startDate} to ${endDate}`)
    }

    // Time of day filter (only applies to timestamped media)
    const hasTimeFilter = timeRange.start !== undefined && timeRange.end !== undefined

    // Select fields for all queries
    const selectFields = {
      mediaID: media.mediaID,
      filePath: media.filePath,
      fileName: media.fileName,
      timestamp: media.timestamp,
      deploymentID: media.deploymentID,
      scientificName: sql`NULL`.as('scientificName'),
      fileMediatype: media.fileMediatype,
      eventID: sql`NULL`.as('eventID'),
      favorite: media.favorite
    }

    const selectFieldsWithObs = {
      mediaID: media.mediaID,
      filePath: media.filePath,
      fileName: media.fileName,
      timestamp: media.timestamp,
      deploymentID: media.deploymentID,
      scientificName: observations.scientificName,
      fileMediatype: media.fileMediatype,
      eventID: observations.eventID,
      favorite: media.favorite
    }

    // Correlated subquery for blank detection
    // Excludes observationType='blank' so media with only blank observations are still considered blank
    const matchingObservations = db
      .select({ one: sql`1` })
      .from(observations)
      .where(
        and(
          eq(observations.mediaID, media.mediaID),
          or(isNull(observations.observationType), ne(observations.observationType, 'blank'))
        )
      )

    // Phase 1: Timestamped media
    if (phase === 'timestamped') {
      const timestampedConditions = [isNotNull(media.timestamp)]

      // Apply date range filter
      if (startDate && endDate) {
        timestampedConditions.push(gte(media.timestamp, startDate))
        timestampedConditions.push(lte(media.timestamp, endDate))
      }

      // Apply time of day filter
      if (hasTimeFilter) {
        if (timeRange.start < timeRange.end) {
          timestampedConditions.push(
            and(
              sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${timeRange.start}`,
              sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${timeRange.end}`
            )
          )
        } else if (timeRange.start > timeRange.end) {
          // Wraps around midnight
          timestampedConditions.push(
            or(
              sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${timeRange.start}`,
              sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${timeRange.end}`
            )
          )
        }
      }

      // Apply cursor position
      if (cursor?.t) {
        // Fetch items with timestamp < cursor.t, OR same timestamp but mediaID < cursor.m
        timestampedConditions.push(
          or(
            lt(media.timestamp, cursor.t),
            and(eq(media.timestamp, cursor.t), lt(media.mediaID, cursor.m))
          )
        )
      }

      let timestampedMedia = []

      // Build query based on species filter
      if (species.length === 0) {
        // No species filter - get all media
        timestampedMedia = await db
          .selectDistinct(selectFields)
          .from(media)
          .where(and(...timestampedConditions))
          .orderBy(sql`${media.timestamp} DESC, ${media.mediaID} DESC`)
          .limit(batchSize)
      } else if (requestingBlanks && regularSpecies.length === 0) {
        // Only blanks
        timestampedMedia = await db
          .selectDistinct(selectFields)
          .from(media)
          .where(and(...timestampedConditions, notExists(matchingObservations)))
          .orderBy(sql`${media.timestamp} DESC, ${media.mediaID} DESC`)
          .limit(batchSize)
      } else if (requestingBlanks && regularSpecies.length > 0) {
        // Mixed: species + blanks
        const speciesQuery = db
          .selectDistinct(selectFieldsWithObs)
          .from(media)
          .innerJoin(observations, eq(media.mediaID, observations.mediaID))
          .where(
            and(
              ...timestampedConditions,
              isNotNull(observations.scientificName),
              ne(observations.scientificName, ''),
              inArray(observations.scientificName, regularSpecies)
            )
          )

        const blankQuery = db
          .selectDistinct(selectFields)
          .from(media)
          .where(and(...timestampedConditions, notExists(matchingObservations)))

        timestampedMedia = await union(speciesQuery, blankQuery)
          .orderBy(sql`timestamp DESC, mediaID DESC`)
          .limit(batchSize)
      } else {
        // Regular species query
        timestampedMedia = await db
          .selectDistinct(selectFieldsWithObs)
          .from(media)
          .innerJoin(observations, eq(media.mediaID, observations.mediaID))
          .where(
            and(
              ...timestampedConditions,
              isNotNull(observations.scientificName),
              ne(observations.scientificName, ''),
              inArray(observations.scientificName, regularSpecies)
            )
          )
          .orderBy(sql`${media.timestamp} DESC, ${media.mediaID} DESC`)
          .limit(batchSize)
      }

      // Check if there's more timestamped media
      const hasMoreTimestamped = timestampedMedia.length === batchSize

      // Check if there's any null-timestamp media (for phase transition)
      let hasMoreNull = false
      if (timestampedMedia.length < batchSize) {
        // We've exhausted timestamped media, check for null-timestamp media
        const nullConditions = [isNull(media.timestamp)]

        let nullCountResult
        if (species.length === 0) {
          nullCountResult = await db
            .select({ count: sql`COUNT(DISTINCT ${media.mediaID})`.as('count') })
            .from(media)
            .where(and(...nullConditions))
        } else if (requestingBlanks && regularSpecies.length === 0) {
          nullCountResult = await db
            .select({ count: sql`COUNT(DISTINCT ${media.mediaID})`.as('count') })
            .from(media)
            .where(and(...nullConditions, notExists(matchingObservations)))
        } else if (requestingBlanks && regularSpecies.length > 0) {
          // For mixed case, need to count both species and blanks
          const speciesCount = db
            .select({ mediaID: media.mediaID })
            .from(media)
            .innerJoin(observations, eq(media.mediaID, observations.mediaID))
            .where(
              and(
                ...nullConditions,
                isNotNull(observations.scientificName),
                ne(observations.scientificName, ''),
                inArray(observations.scientificName, regularSpecies)
              )
            )

          const blankCount = db
            .select({ mediaID: media.mediaID })
            .from(media)
            .where(and(...nullConditions, notExists(matchingObservations)))

          const combined = await union(speciesCount, blankCount)
          nullCountResult = [{ count: combined.length }]
        } else {
          nullCountResult = await db
            .select({ count: sql`COUNT(DISTINCT ${media.mediaID})`.as('count') })
            .from(media)
            .innerJoin(observations, eq(media.mediaID, observations.mediaID))
            .where(
              and(
                ...nullConditions,
                isNotNull(observations.scientificName),
                ne(observations.scientificName, ''),
                inArray(observations.scientificName, regularSpecies)
              )
            )
        }

        hasMoreNull = (nullCountResult[0]?.count || 0) > 0
      }

      const elapsedTime = Date.now() - startTime
      log.info(
        `[Sequences] Retrieved ${timestampedMedia.length} timestamped media in ${elapsedTime}ms`
      )

      return {
        media: timestampedMedia,
        hasMoreTimestamped,
        hasMoreNull
      }
    }

    // Phase 2: Null-timestamp media
    if (phase === 'null') {
      const offset = cursor?.offset || 0
      const nullConditions = [isNull(media.timestamp)]

      let nullMedia = []

      if (species.length === 0) {
        nullMedia = await db
          .selectDistinct(selectFields)
          .from(media)
          .where(and(...nullConditions))
          .orderBy(sql`${media.mediaID} DESC`)
          .limit(batchSize)
          .offset(offset)
      } else if (requestingBlanks && regularSpecies.length === 0) {
        nullMedia = await db
          .selectDistinct(selectFields)
          .from(media)
          .where(and(...nullConditions, notExists(matchingObservations)))
          .orderBy(sql`${media.mediaID} DESC`)
          .limit(batchSize)
          .offset(offset)
      } else if (requestingBlanks && regularSpecies.length > 0) {
        const speciesQuery = db
          .selectDistinct(selectFieldsWithObs)
          .from(media)
          .innerJoin(observations, eq(media.mediaID, observations.mediaID))
          .where(
            and(
              ...nullConditions,
              isNotNull(observations.scientificName),
              ne(observations.scientificName, ''),
              inArray(observations.scientificName, regularSpecies)
            )
          )

        const blankQuery = db
          .selectDistinct(selectFields)
          .from(media)
          .where(and(...nullConditions, notExists(matchingObservations)))

        nullMedia = await union(speciesQuery, blankQuery)
          .orderBy(sql`mediaID DESC`)
          .limit(batchSize)
          .offset(offset)
      } else {
        nullMedia = await db
          .selectDistinct(selectFieldsWithObs)
          .from(media)
          .innerJoin(observations, eq(media.mediaID, observations.mediaID))
          .where(
            and(
              ...nullConditions,
              isNotNull(observations.scientificName),
              ne(observations.scientificName, ''),
              inArray(observations.scientificName, regularSpecies)
            )
          )
          .orderBy(sql`${media.mediaID} DESC`)
          .limit(batchSize)
          .offset(offset)
      }

      const hasMoreNull = nullMedia.length === batchSize

      const elapsedTime = Date.now() - startTime
      log.info(
        `[Sequences] Retrieved ${nullMedia.length} null-timestamp media (offset: ${offset}) in ${elapsedTime}ms`
      )

      return {
        media: nullMedia,
        hasMoreTimestamped: false,
        hasMoreNull
      }
    }

    // Invalid phase
    throw new Error(`Invalid cursor phase: ${phase}`)
  } catch (error) {
    log.error(`[Sequences] Error fetching media for pagination: ${error.message}`)
    throw error
  }
}

/**
 * Check if there are any timestamped media matching the filters
 * Used to determine initial phase
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {Object} options - Filter options
 * @returns {Promise<boolean>}
 */
export async function hasTimestampedMedia(dbPath, options = {}) {
  const { species = [], dateRange = {}, timeRange = {} } = options

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    const requestingBlanks = species.includes(BLANK_SENTINEL)
    const regularSpecies = species.filter((s) => s !== BLANK_SENTINEL)

    const conditions = [isNotNull(media.timestamp)]

    // Apply date range
    if (dateRange.start && dateRange.end) {
      const startDate =
        dateRange.start instanceof Date ? dateRange.start.toISOString() : dateRange.start
      const endDate = dateRange.end instanceof Date ? dateRange.end.toISOString() : dateRange.end
      conditions.push(gte(media.timestamp, startDate))
      conditions.push(lte(media.timestamp, endDate))
    }

    // Apply time range
    if (timeRange.start !== undefined && timeRange.end !== undefined) {
      if (timeRange.start < timeRange.end) {
        conditions.push(
          and(
            sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${timeRange.start}`,
            sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${timeRange.end}`
          )
        )
      } else if (timeRange.start > timeRange.end) {
        conditions.push(
          or(
            sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${timeRange.start}`,
            sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${timeRange.end}`
          )
        )
      }
    }

    // Correlated subquery for blank detection
    // Excludes observationType='blank' so media with only blank observations are still considered blank
    const matchingObservations = db
      .select({ one: sql`1` })
      .from(observations)
      .where(
        and(
          eq(observations.mediaID, media.mediaID),
          or(isNull(observations.observationType), ne(observations.observationType, 'blank'))
        )
      )

    let result

    if (species.length === 0) {
      result = await db
        .select({ exists: sql`1` })
        .from(media)
        .where(and(...conditions))
        .limit(1)
    } else if (requestingBlanks && regularSpecies.length === 0) {
      result = await db
        .select({ exists: sql`1` })
        .from(media)
        .where(and(...conditions, notExists(matchingObservations)))
        .limit(1)
    } else if (requestingBlanks && regularSpecies.length > 0) {
      // Check for either species match or blank
      const speciesResult = await db
        .select({ exists: sql`1` })
        .from(media)
        .innerJoin(observations, eq(media.mediaID, observations.mediaID))
        .where(
          and(
            ...conditions,
            isNotNull(observations.scientificName),
            ne(observations.scientificName, ''),
            inArray(observations.scientificName, regularSpecies)
          )
        )
        .limit(1)

      if (speciesResult.length > 0) {
        return true
      }

      result = await db
        .select({ exists: sql`1` })
        .from(media)
        .where(and(...conditions, notExists(matchingObservations)))
        .limit(1)
    } else {
      result = await db
        .select({ exists: sql`1` })
        .from(media)
        .innerJoin(observations, eq(media.mediaID, observations.mediaID))
        .where(
          and(
            ...conditions,
            isNotNull(observations.scientificName),
            ne(observations.scientificName, ''),
            inArray(observations.scientificName, regularSpecies)
          )
        )
        .limit(1)
    }

    return result.length > 0
  } catch (error) {
    log.error(`[Sequences] Error checking for timestamped media: ${error.message}`)
    throw error
  }
}
