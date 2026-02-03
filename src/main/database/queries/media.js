/**
 * Media-related database queries
 */

import { getDrizzleDb, media, observations, modelRuns, modelOutputs } from '../index.js'
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
  or,
  notExists
} from 'drizzle-orm'
import { DateTime } from 'luxon'
import log from 'electron-log'
import { getStudyIdFromPath, formatToMatchOriginal } from './utils.js'

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
    timeRange = {},
    includeNullTimestamps = false
  } = options

  const startTime = Date.now()
  log.info(`Querying media files from: ${dbPath} with filtering options`)
  log.info(`Pagination: limit ${queryLimit}, offset ${queryOffset}`)

  // Check if requesting blanks (media without observations)
  const BLANK_SENTINEL = '__blank__'
  const requestingBlanks = species.includes(BLANK_SENTINEL)
  const regularSpecies = species.filter((s) => s !== BLANK_SENTINEL)

  if (species.length > 0) {
    log.info(`Species filter: ${species.join(', ')}`)
    if (requestingBlanks) {
      log.info(`Including blank media (no observations)`)
    }
  }

  if (dateRange.start && dateRange.end) {
    log.info(`Date range: ${typeof dateRange.start} to ${dateRange.end}`)
  }

  if (timeRange.start !== undefined && timeRange.end !== undefined) {
    log.info(`Time range: ${timeRange.start}:00 to ${timeRange.end}:00`)
  }

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    // Build date/time conditions for media table (used for blank queries)
    const mediaDateTimeConditions = []

    // Add date range filter if provided
    let startDate, endDate
    if (dateRange.start && dateRange.end) {
      startDate = dateRange.start instanceof Date ? dateRange.start.toISOString() : dateRange.start
      endDate = dateRange.end instanceof Date ? dateRange.end.toISOString() : dateRange.end

      log.info(`Formatted date range: ${startDate} to ${endDate}`)

      if (includeNullTimestamps) {
        mediaDateTimeConditions.push(
          or(
            isNull(media.timestamp),
            and(gte(media.timestamp, startDate), lte(media.timestamp, endDate))
          )
        )
      } else {
        mediaDateTimeConditions.push(gte(media.timestamp, startDate))
        mediaDateTimeConditions.push(lte(media.timestamp, endDate))
      }
    }

    // Add time of day filter if provided
    if (timeRange.start !== undefined && timeRange.end !== undefined) {
      if (timeRange.start < timeRange.end) {
        const timeCondition = and(
          sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${timeRange.start}`,
          sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${timeRange.end}`
        )
        mediaDateTimeConditions.push(
          includeNullTimestamps ? or(isNull(media.timestamp), timeCondition) : timeCondition
        )
      } else if (timeRange.start > timeRange.end) {
        const timeCondition = or(
          sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${timeRange.start}`,
          sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${timeRange.end}`
        )
        mediaDateTimeConditions.push(
          includeNullTimestamps ? or(isNull(media.timestamp), timeCondition) : timeCondition
        )
      }
    }

    // Select fields for blank media (no observations, so NULL for observation fields)
    const blankSelectFields = {
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

    // Select fields for species query (with observation data)
    const speciesSelectFields = {
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

    // Correlated subquery for blank detection (media with no linked observations)
    const matchingObservations = db
      .select({ one: sql`1` })
      .from(observations)
      .where(eq(observations.mediaID, media.mediaID))

    // Case 1: Only blanks requested
    if (requestingBlanks && regularSpecies.length === 0) {
      const blankConditions = [notExists(matchingObservations), ...mediaDateTimeConditions]

      const blankQuery = db
        .selectDistinct(blankSelectFields)
        .from(media)
        .where(and(...blankConditions))
        .orderBy(sql`${media.timestamp} DESC NULLS LAST`)
        .limit(queryLimit)
        .offset(queryOffset)

      const rows = await blankQuery

      const elapsedTime = Date.now() - startTime
      log.info(
        `Retrieved ${rows.length} blank media files (offset: ${queryOffset}) in ${elapsedTime}ms`
      )
      return rows
    }

    // Build conditions for species query
    const baseConditions = [
      isNotNull(observations.scientificName),
      ne(observations.scientificName, ''),
      ...mediaDateTimeConditions
    ]

    // Add species filter if provided
    if (regularSpecies.length > 0) {
      baseConditions.push(inArray(observations.scientificName, regularSpecies))
    }

    // Species query using direct mediaID join (all observations now have mediaID populated)
    const speciesQuery = db
      .selectDistinct(speciesSelectFields)
      .from(media)
      .innerJoin(observations, eq(media.mediaID, observations.mediaID))
      .where(and(...baseConditions))

    // Case 2: Mixed selection (species + blanks)
    if (requestingBlanks && regularSpecies.length > 0) {
      // Use notExists with the correlated subquery for blank detection
      const blankConditions = [notExists(matchingObservations), ...mediaDateTimeConditions]

      const blankQuery = db
        .selectDistinct(blankSelectFields)
        .from(media)
        .where(and(...blankConditions))

      // Combine species query and blank query with UNION
      const rows = await union(speciesQuery, blankQuery)
        .orderBy(sql`timestamp DESC NULLS LAST`)
        .limit(queryLimit)
        .offset(queryOffset)

      const elapsedTime = Date.now() - startTime
      log.info(
        `Retrieved ${rows.length} media files (species + blanks, offset: ${queryOffset}) in ${elapsedTime}ms`
      )
      return rows
    }

    // Case 3: Regular species query (no blanks)
    const rows = await speciesQuery
      .orderBy(sql`${media.timestamp} DESC NULLS LAST`)
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
 * Get files data (directories with image counts and processing progress) for local/ml_run studies
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<Array>} - Array of directory objects with image counts and processing progress
 */
export async function getFilesData(dbPath) {
  const startTime = Date.now()
  log.info(`Querying files data from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    // Query to get directory statistics with most recent model used
    const rows = await db
      .select({
        folderName: media.folderName,
        importFolder: media.importFolder,
        imageCount:
          sql`COUNT(DISTINCT CASE WHEN ${media.fileMediatype} NOT LIKE 'video/%' THEN ${media.mediaID} END)`.as(
            'imageCount'
          ),
        videoCount:
          sql`COUNT(DISTINCT CASE WHEN ${media.fileMediatype} LIKE 'video/%' THEN ${media.mediaID} END)`.as(
            'videoCount'
          ),
        processedCount:
          sql`COUNT(DISTINCT CASE WHEN ${observations.observationID} IS NOT NULL THEN ${media.mediaID} END)`.as(
            'processedCount'
          ),
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
    const studyId = getStudyIdFromPath(dbPath)

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
        sex: observations.sex,
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
    const studyId = getStudyIdFromPath(dbPath)

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
        classificationTimestamp: observations.classificationTimestamp,
        sex: observations.sex
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
    const studyId = getStudyIdFromPath(dbPath)

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

    const studyId = getStudyIdFromPath(dbPath)

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
 * Update media favorite status
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} mediaID - Media ID to update
 * @param {boolean} favorite - New favorite status
 * @returns {Promise<Object>} - Result with success status
 */
export async function updateMediaFavorite(dbPath, mediaID, favorite) {
  const startTime = Date.now()
  log.info(`Updating favorite status for media ${mediaID} to ${favorite}`)

  try {
    // Validate input parameters
    if (!mediaID) {
      throw new Error('Media ID is required')
    }

    if (typeof favorite !== 'boolean') {
      throw new Error('Favorite must be a boolean value')
    }

    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    // Check if media exists
    const existingMedia = await db
      .select({ mediaID: media.mediaID })
      .from(media)
      .where(eq(media.mediaID, mediaID))
      .get()

    if (!existingMedia) {
      throw new Error(`Media not found: ${mediaID}`)
    }

    // Update the favorite status
    await db.update(media).set({ favorite }).where(eq(media.mediaID, mediaID))

    const elapsedTime = Date.now() - startTime
    log.info(`Updated favorite status for media ${mediaID} in ${elapsedTime}ms`)

    return { success: true, mediaID, favorite }
  } catch (error) {
    log.error(`Error updating media favorite: ${error.message}`)
    throw error
  }
}

/**
 * Count media files with null timestamps
 * @param {string} dbPath - Path to the SQLite database
 * @returns {Promise<number>} - Count of media files with null timestamps
 */
export async function countMediaWithNullTimestamps(dbPath) {
  const startTime = Date.now()
  log.info(`Counting media with null timestamps from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)

    const db = await getDrizzleDb(studyId, dbPath)

    const result = await db
      .select({ count: count().as('count') })
      .from(media)
      .where(isNull(media.timestamp))
      .get()

    const nullCount = result?.count || 0
    const elapsedTime = Date.now() - startTime
    log.info(`Found ${nullCount} media with null timestamps in ${elapsedTime}ms`)

    return nullCount
  } catch (error) {
    log.error(`Error counting media with null timestamps: ${error.message}`)
    throw error
  }
}
