/**
 * Media-related database queries
 */

import {
  getDrizzleDb,
  media,
  observations,
  modelRuns,
  modelOutputs,
  deployments
} from '../index.js'
import { eq, and, desc, count, sql, isNotNull, inArray, isNull } from 'drizzle-orm'
import { DateTime } from 'luxon'
import log from 'electron-log'
import { getStudyIdFromPath, formatToMatchOriginal } from './utils.js'
import { transformBboxToCamtrapDP, detectModelType } from '../../utils/bbox.js'

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
        commonName: observations.commonName,
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
        lifeStage: observations.lifeStage,
        behavior: observations.behavior,
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
        commonName: observations.commonName,
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
        lifeStage: observations.lifeStage,
        behavior: observations.behavior
      })
      .from(observations)
      .where(inArray(observations.mediaID, mediaIDs))
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

/**
 * Get per-frame detector bboxes for a video, sourced from modelOutputs.rawOutput.frames.
 *
 * Applies the same confidence filter as the image write path:
 * - Always keep the highest-confidence detection per frame.
 * - Keep additional detections only if conf >= DETECTION_CONFIDENCE_THRESHOLD.
 *
 * Returns a flat array of { frameNumber, bboxX, bboxY, bboxWidth, bboxHeight, conf }
 * sorted by frameNumber ascending.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} mediaID - The media ID to get frame detections for
 * @returns {Promise<Array>}
 */
export async function getVideoFrameDetections(dbPath, mediaID) {
  const DETECTION_CONFIDENCE_THRESHOLD = 0.5
  const startTime = Date.now()

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    const rows = await db
      .select({ rawOutput: modelOutputs.rawOutput })
      .from(modelOutputs)
      .where(eq(modelOutputs.mediaID, mediaID))
      .limit(1)

    if (rows.length === 0) return []

    const rawOutput = rows[0].rawOutput
    const frames = rawOutput?.frames
    if (!Array.isArray(frames) || frames.length === 0) return []

    const modelType = detectModelType(frames[0])

    const result = []
    for (const frame of frames) {
      const frameNumber = frame?.frame_number
      const detections = frame?.detections
      if (
        typeof frameNumber !== 'number' ||
        !Array.isArray(detections) ||
        detections.length === 0
      ) {
        continue
      }

      // Sort by conf desc. Always keep the top; keep others only if >= threshold.
      const sorted = [...detections].sort((a, b) => (b?.conf ?? 0) - (a?.conf ?? 0))
      const kept = sorted.filter(
        (d, i) => i === 0 || (d?.conf ?? 0) >= DETECTION_CONFIDENCE_THRESHOLD
      )

      for (const detection of kept) {
        const bbox = transformBboxToCamtrapDP(detection, modelType)
        if (!bbox) continue
        result.push({
          frameNumber,
          bboxX: bbox.bboxX,
          bboxY: bbox.bboxY,
          bboxWidth: bbox.bboxWidth,
          bboxHeight: bbox.bboxHeight,
          conf: detection.conf
        })
      }
    }

    result.sort((a, b) => a.frameNumber - b.frameNumber)

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved ${result.length} video frame detections for media ${mediaID} in ${elapsedTime}ms`
    )
    return result
  } catch (error) {
    log.error(`Error querying video frame detections: ${error.message}`)
    throw error
  }
}

/**
 * Get sources data — one row per distinct media.importFolder, with rollup stats.
 * @param {string} dbPath
 * @returns {Promise<Array>} array of SourceRow
 */
export async function getSourcesData(dbPath) {
  const startTime = Date.now()
  log.info(`Querying sources data from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    // Pass 1: media-only deployment-grain rollup. SUM(CASE) is dramatically
    // faster than COUNT(DISTINCT mediaID) because mediaID is the PK of media —
    // no LEFT JOIN observations multiplying rows means we avoid distinct dedup
    // entirely. ~10x faster on 2M-row studies.
    const deploymentMediaRows = await db
      .select({
        importFolder: media.importFolder,
        deploymentID: media.deploymentID,
        folderName: media.folderName,
        locationName: deployments.locationName,
        // Classify by file extension instead of fileMediatype: pre-fix LILA
        // imports stamped video files as 'image/jpeg', but the actual extension
        // is preserved in fileName (e.g. 'DSCF0004.AVI'). Falling back to the
        // fileName check fixes existing studies without a data migration.
        imageCount: sql`SUM(CASE WHEN
          LOWER(${media.fileName}) LIKE '%.mp4' OR
          LOWER(${media.fileName}) LIKE '%.mkv' OR
          LOWER(${media.fileName}) LIKE '%.mov' OR
          LOWER(${media.fileName}) LIKE '%.webm' OR
          LOWER(${media.fileName}) LIKE '%.avi' OR
          LOWER(${media.fileName}) LIKE '%.m4v'
          THEN 0 ELSE 1 END)`.as('imageCount'),
        videoCount: sql`SUM(CASE WHEN
          LOWER(${media.fileName}) LIKE '%.mp4' OR
          LOWER(${media.fileName}) LIKE '%.mkv' OR
          LOWER(${media.fileName}) LIKE '%.mov' OR
          LOWER(${media.fileName}) LIKE '%.webm' OR
          LOWER(${media.fileName}) LIKE '%.avi' OR
          LOWER(${media.fileName}) LIKE '%.m4v'
          THEN 1 ELSE 0 END)`.as('videoCount'),
        isRemoteAny: sql`MAX(CASE WHEN ${media.filePath} LIKE 'http%' THEN 1 ELSE 0 END)`.as(
          'isRemoteAny'
        ),
        sampleRemoteUrl:
          sql`MAX(CASE WHEN ${media.filePath} LIKE 'http%' THEN ${media.filePath} END)`.as(
            'sampleRemoteUrl'
          )
      })
      .from(media)
      .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
      .groupBy(media.importFolder, media.deploymentID)
      .orderBy(media.importFolder, media.deploymentID)

    // Pass 2: observation count grouped by (importFolder, deploymentID). One
    // pass over observations + indexed mediaID join into media; we roll up to
    // source-level in JS instead of running a second SQL aggregation.
    const observationCountRows = await db
      .select({
        importFolder: media.importFolder,
        deploymentID: media.deploymentID,
        observationCount: sql`COUNT(*)`.as('observationCount')
      })
      .from(observations)
      .innerJoin(media, eq(media.mediaID, observations.mediaID))
      .groupBy(media.importFolder, media.deploymentID)

    const observationsByDeployment = new Map() // key = `${folder} ${deploymentID}`
    for (const row of observationCountRows) {
      const key = `${row.importFolder ?? ''} ${row.deploymentID ?? ''}`
      observationsByDeployment.set(key, Number(row.observationCount))
    }

    // Build deployment sub-rows + roll source-level totals from per-deployment data.
    const deploymentsByFolder = new Map()
    const sourceTotals = new Map() // folder -> { imageCount, videoCount, observationCount, deploymentCount, isRemote }
    for (const d of deploymentMediaRows) {
      const folder = d.importFolder ?? ''
      const obsKey = `${folder} ${d.deploymentID ?? ''}`
      const observationCount = observationsByDeployment.get(obsKey) ?? 0
      const imageCount = Number(d.imageCount)
      const videoCount = Number(d.videoCount)

      if (!deploymentsByFolder.has(folder)) deploymentsByFolder.set(folder, [])
      deploymentsByFolder.get(folder).push({
        deploymentID: d.deploymentID,
        label: d.locationName ?? d.folderName ?? d.deploymentID,
        imageCount,
        videoCount,
        observationCount,
        activeRun: null
      })

      const t = sourceTotals.get(folder) ?? {
        importFolder: d.importFolder,
        imageCount: 0,
        videoCount: 0,
        observationCount: 0,
        deploymentCount: 0,
        isRemote: 0,
        sampleRemoteUrl: null
      }
      t.imageCount += imageCount
      t.videoCount += videoCount
      t.observationCount += observationCount
      // Count distinct deployments per folder; the GROUP BY guarantees one row per pair
      t.deploymentCount += 1
      if (Number(d.isRemoteAny) === 1) t.isRemote = 1
      if (!t.sampleRemoteUrl && d.sampleRemoteUrl) t.sampleRemoteUrl = d.sampleRemoteUrl
      sourceTotals.set(folder, t)
    }
    const rows = Array.from(sourceTotals.values()).sort((a, b) =>
      String(a.importFolder ?? '').localeCompare(String(b.importFolder ?? ''))
    )

    // Aggregate to one row per (importFolder, runID) so we don't drag every
    // model_output into JS just to keep the most recent run per folder. On a
    // study with N folders × M runs this returns N×M rows instead of
    // ~count(model_outputs).
    const lastModelRows = await db
      .select({
        importFolder: media.importFolder,
        modelID: modelRuns.modelID,
        modelVersion: modelRuns.modelVersion,
        startedAt: modelRuns.startedAt
      })
      .from(modelOutputs)
      .innerJoin(media, eq(modelOutputs.mediaID, media.mediaID))
      .innerJoin(modelRuns, eq(modelOutputs.runID, modelRuns.id))
      .groupBy(media.importFolder, modelRuns.id)
      .orderBy(media.importFolder, desc(modelRuns.startedAt))

    const lastModelByFolder = new Map()
    for (const row of lastModelRows) {
      const key = row.importFolder ?? ''
      if (!lastModelByFolder.has(key)) {
        lastModelByFolder.set(key, {
          modelID: row.modelID,
          modelVersion: row.modelVersion
        })
      }
    }

    const activeRunRows = await db
      .select({
        importFolder: modelRuns.importPath,
        runID: modelRuns.id,
        modelID: modelRuns.modelID,
        modelVersion: modelRuns.modelVersion
      })
      .from(modelRuns)
      .where(eq(modelRuns.status, 'running'))

    const activeRunByFolder = new Map()
    for (const r of activeRunRows) {
      if (r.importFolder) activeRunByFolder.set(r.importFolder, r)
    }

    const processedByFolder = new Map()
    const processedByDeployment = new Map() // key = `${folder} ${deploymentID}`
    const activeFolders = Array.from(activeRunByFolder.keys())
    if (activeFolders.length > 0) {
      const processedRows = await db
        .select({
          importFolder: media.importFolder,
          deploymentID: media.deploymentID,
          processed: sql`COUNT(DISTINCT ${modelOutputs.mediaID})`.as('processed')
        })
        .from(modelOutputs)
        .innerJoin(media, eq(modelOutputs.mediaID, media.mediaID))
        .innerJoin(modelRuns, eq(modelOutputs.runID, modelRuns.id))
        .where(and(eq(modelRuns.status, 'running'), inArray(media.importFolder, activeFolders)))
        .groupBy(media.importFolder, media.deploymentID)

      for (const row of processedRows) {
        const folder = row.importFolder ?? ''
        const n = Number(row.processed)
        processedByFolder.set(folder, (processedByFolder.get(folder) ?? 0) + n)
        processedByDeployment.set(`${folder} ${row.deploymentID ?? ''}`, n)
      }
    }

    // Populate per-deployment activeRun from the in-flight processed counts.
    for (const [folder, deps] of deploymentsByFolder) {
      const folderActive = activeRunByFolder.get(folder)
      if (!folderActive) continue
      for (const d of deps) {
        const total = d.imageCount + d.videoCount
        d.activeRun = {
          runID: folderActive.runID,
          processed: processedByDeployment.get(`${folder} ${d.deploymentID ?? ''}`) ?? 0,
          total
        }
      }
    }

    const result = rows.map((r) => {
      const folder = r.importFolder ?? ''
      const activeRun = activeRunByFolder.get(folder)
      const total = Number(r.imageCount) + Number(r.videoCount)
      const finalActive = activeRun
        ? {
            runID: activeRun.runID,
            modelID: activeRun.modelID,
            modelVersion: activeRun.modelVersion,
            processed: processedByFolder.get(folder) ?? 0,
            total
          }
        : null

      return {
        importFolder: folder,
        isRemote: Number(r.isRemote) === 1,
        sampleRemoteUrl: r.sampleRemoteUrl || null,
        imageCount: Number(r.imageCount),
        videoCount: Number(r.videoCount),
        deploymentCount: Number(r.deploymentCount),
        observationCount: Number(r.observationCount),
        activeRun: finalActive,
        lastModelUsed: lastModelByFolder.get(folder) ?? null,
        deployments: deploymentsByFolder.get(folder) ?? []
      }
    })

    log.info(`Sources data: ${result.length} sources in ${Date.now() - startTime}ms`)
    return result
  } catch (error) {
    log.error(`Error querying sources data: ${error.message}`)
    throw error
  }
}
