/**
 * Prediction utility functions for ML inference.
 *
 * Extracted from importer.js to break the circular dependency:
 * inference-consumer → importer → queue-scheduler → inference-consumer
 */

import crypto from 'crypto'
import exifr from 'exifr'
import geoTz from 'geo-tz'
import { DateTime } from 'luxon'
import path from 'path'
import { eq } from 'drizzle-orm'
import { transformBboxToCamtrapDP } from '../utils/bbox.js'
import { selectVideoClassificationWinner } from './ml/classification.js'
import { insertModelOutput } from '../database/index.js'
import { media, observations, deployments } from '../database/models.js'
import { resolveVideoTimestamp } from './import/timestamp.js'
import { resolveCommonName } from '../../shared/commonNames/index.js'
import log from './logger.js'

/**
 * Check whether a MIME type represents a video format
 * @param {string} mediatype - IANA media type (e.g. 'video/mp4')
 * @returns {boolean}
 */
function isVideoMediatype(mediatype) {
  return mediatype.startsWith('video/')
}

/**
 * Serialize EXIF data for JSON storage, converting Date objects to ISO strings
 * @param {Object} exifData - Raw exifr output
 * @returns {Object|null} - Serialized EXIF data safe for JSON storage
 */
function serializeExifData(exifData) {
  if (!exifData || typeof exifData !== 'object') return null
  try {
    return JSON.parse(
      JSON.stringify(exifData, (key, value) => {
        if (value instanceof Date) {
          return value.toISOString()
        }
        return value
      })
    )
  } catch (error) {
    log.warn(`Failed to serialize EXIF data: ${error.message}`)
    return null
  }
}

/**
 * Extract deployment-level metadata from EXIF data for CamtrapDP compliance
 * @param {Object} exifData - Parsed EXIF data from exifr (or deserialized from media.exifData)
 * @returns {Object} - Deployment metadata fields { cameraModel, cameraID, coordinateUncertainty }
 */
function extractDeploymentMetadata(exifData) {
  if (!exifData || typeof exifData !== 'object') {
    return { cameraModel: null, cameraID: null, coordinateUncertainty: null }
  }

  // Extract camera model: "Make-Model" format per CamtrapDP spec
  let cameraModel = null
  const make = exifData.Make?.trim()
  const model = exifData.Model?.trim()
  if (make && model) {
    cameraModel = `${make}-${model}`
  } else if (model) {
    cameraModel = model
  }

  // Extract camera serial number (try multiple EXIF fields)
  const cameraID =
    exifData.SerialNumber || exifData.BodySerialNumber || exifData.CameraSerialNumber || null

  // Extract GPS horizontal positioning error (in meters, must be integer >= 1)
  let coordinateUncertainty = null
  if (exifData.GPSHPositioningError) {
    const uncertainty = Math.round(exifData.GPSHPositioningError)
    if (uncertainty >= 1) {
      coordinateUncertainty = uncertainty
    }
  }

  return { cameraModel, cameraID, coordinateUncertainty }
}

/**
 * Calculate mode (most common value) from an array
 * @param {Array} arr - Array of values
 * @returns {*} - Most common value or null if empty
 */
function calculateMode(arr) {
  if (!arr || arr.length === 0) return null
  const counts = {}
  arr.forEach((v) => {
    counts[v] = (counts[v] || 0) + 1
  })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

/**
 * Aggregate deployment metadata from all media EXIF data using mode (most common value)
 * @param {Object} db - Drizzle database instance
 * @param {string} deploymentID - Deployment ID to aggregate metadata for
 */
export async function aggregateDeploymentMetadata(db, deploymentID) {
  try {
    // Query all media with exifData for this deployment
    const mediaRecords = await db
      .select({ exifData: media.exifData })
      .from(media)
      .where(eq(media.deploymentID, deploymentID))

    // Collect values for each field
    const cameraModels = []
    const cameraIDs = []
    const uncertainties = []

    for (const record of mediaRecords) {
      if (!record.exifData) continue
      const meta = extractDeploymentMetadata(record.exifData)
      if (meta.cameraModel) cameraModels.push(meta.cameraModel)
      if (meta.cameraID) cameraIDs.push(meta.cameraID)
      if (meta.coordinateUncertainty) uncertainties.push(meta.coordinateUncertainty)
    }

    // Calculate mode for each field and update deployment
    const updates = {}
    const modelMode = calculateMode(cameraModels)
    const idMode = calculateMode(cameraIDs)
    const uncertaintyMode = calculateMode(uncertainties)

    if (modelMode) updates.cameraModel = modelMode
    if (idMode) updates.cameraID = idMode
    if (uncertaintyMode) updates.coordinateUncertainty = parseInt(uncertaintyMode)

    if (Object.keys(updates).length > 0) {
      await db.update(deployments).set(updates).where(eq(deployments.deploymentID, deploymentID))
      log.info(`Updated deployment ${deploymentID} with EXIF metadata: ${JSON.stringify(updates)}`)
    }
  } catch (error) {
    log.error(`Error aggregating deployment metadata for ${deploymentID}:`, error)
  }
}

export async function* getPredictions(mediaPaths, port, signal = null, sampleFps = 1) {
  try {
    // Send request and handle streaming response
    // Include sample_fps for video frame extraction (Python auto-detects video vs image)
    const response = await fetch(`http://localhost:${port}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        instances: mediaPaths.map((filepath) => ({
          filepath,
          sample_fps: sampleFps // Integer, always provided
        }))
      }),
      signal
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    // Check if the response is streamed
    if (
      response.headers.get('Transfer-Encoding') !== 'chunked' &&
      !response.headers.get('Content-Type')?.includes('stream')
    ) {
      throw new Error('Response is not streamed, expected a streaming response')
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      // Process chunk data - assuming each chunk is a JSON prediction
      try {
        // Handle different formats of streaming responses
        const lines = chunk.trim().split('\n')
        for (const line of lines) {
          if (line.trim()) {
            const response = JSON.parse(line)
            const preds = response.output.predictions

            // Yield each prediction as it arrives
            for (const pred of preds) {
              yield pred
            }
          }
        }
      } catch (e) {
        log.error('Error parsing prediction chunk:', e)
      }
    }
  } catch (error) {
    // Don't log or throw if this was an intentional abort
    if (error.name === 'AbortError') {
      log.info('Prediction request was aborted')
      return
    }
    log.error('Error in prediction process:', error)
    throw error
  }
}

export async function getMedia(db, filepath) {
  try {
    const result = await db.select().from(media).where(eq(media.filePath, filepath)).limit(1)
    return result[0] || null
  } catch (error) {
    log.error(`Error getting media for path ${filepath}:`, error)
    return null
  }
}

/**
 * Parse scientific name from prediction based on model type
 * @param {Object} prediction - Model prediction output
 * @param {string} modelType - 'speciesnet' | 'deepfaune' | 'manas'
 * @returns {string|null} Scientific name or null for blank predictions
 */
function parseScientificName(prediction, modelType) {
  if (modelType === 'deepfaune' || modelType === 'manas') {
    // DeepFaune/Manas: Simple label like "chamois", "panthera_uncia", "blank", "empty", "vide"
    const label = prediction.prediction
    if (!label || label === 'blank' || label === 'empty' || label === 'vide' || label === 'error') {
      return null
    }
    return label
  } else {
    // SpeciesNet: Hierarchical "uuid;class;order;family;genus;species;common name"
    const parts = prediction.prediction.split(';')
    const isblank = ['blank', 'no cv result', 'error'].includes(parts.at(-1))
    if (isblank) {
      return null
    }
    const scientificName = parts.at(-3) + ' ' + parts.at(-2)
    return scientificName.trim() === '' ? parts.at(-1) : scientificName
  }
}

/**
 * Insert a prediction into the database with model provenance tracking
 * Creates one observation per detection that passes the confidence threshold.
 * If no detections pass the threshold, creates one observation with null bbox.
 * @param {Object} db - Drizzle database instance
 * @param {Object} prediction - Model prediction output
 * @param {Object} modelInfo - Model information { modelOutputID, modelID, modelVersion, detectionConfidenceThreshold }
 */
export async function insertPrediction(db, prediction, modelInfo = {}) {
  const mediaRecord = await getMedia(db, prediction.filepath)
  if (!mediaRecord) {
    log.warn(`No media found for prediction: ${prediction.filepath}`)
    return
  }

  // If media hasn't been processed yet, extract metadata and associate with deployment
  if (!mediaRecord.timestamp || !mediaRecord.deploymentID) {
    const result = await processMediaDeployment(db, {
      ...mediaRecord,
      filePath: prediction.filepath // Image uses prediction.filepath
    })
    if (result) {
      mediaRecord.timestamp = result.timestamp
      mediaRecord.deploymentID = result.deploymentID
    } else {
      return // Skip this prediction if deployment processing failed
    }
  }

  // Parse scientific name based on model type
  const modelType = modelInfo.modelID || 'speciesnet'
  const resolvedScientificName = parseScientificName(prediction, modelType)

  // Camtrap DP classification fields
  const classificationTimestamp = new Date().toISOString()
  const classifiedBy =
    modelInfo.modelID && modelInfo.modelVersion
      ? `${modelInfo.modelID} ${modelInfo.modelVersion}`
      : null

  // Create one observation per valid detection
  // Best detection is always kept; threshold applies only to additional detections
  const detections = prediction.detections || []
  const threshold = modelInfo.detectionConfidenceThreshold ?? 0.5

  // Common observation data (shared across all observations for this media)
  const eventID = crypto.randomUUID()
  const baseObservationData = {
    mediaID: mediaRecord.mediaID,
    deploymentID: mediaRecord.deploymentID,
    eventID: eventID,
    eventStart: mediaRecord.timestamp,
    eventEnd: mediaRecord.timestamp,
    scientificName: resolvedScientificName,
    commonName: resolveCommonName(resolvedScientificName),
    classificationProbability: prediction.prediction_score,
    count: 1,
    modelOutputID: modelInfo.modelOutputID || null,
    classificationMethod: modelInfo.modelOutputID ? 'machine' : null,
    classifiedBy: classifiedBy,
    classificationTimestamp: classificationTimestamp
  }

  if (detections.length > 0) {
    // Sort detections by confidence descending
    const sortedDetections = [...detections].sort((a, b) => b.conf - a.conf)

    // Best detection is always kept (regardless of threshold)
    const bestDetection = sortedDetections[0]

    // Additional detections only if they pass threshold
    const additionalDetections = sortedDetections.slice(1).filter((d) => d.conf >= threshold)

    // Combine: best + filtered additional
    const validDetections = [bestDetection, ...additionalDetections]

    // Create one observation per valid detection
    for (const detection of validDetections) {
      const bbox = transformBboxToCamtrapDP(detection, modelType)
      const observationData = {
        ...baseObservationData,
        observationID: crypto.randomUUID(),
        bboxX: bbox?.bboxX ?? null,
        bboxY: bbox?.bboxY ?? null,
        bboxWidth: bbox?.bboxWidth ?? null,
        bboxHeight: bbox?.bboxHeight ?? null,
        detectionConfidence: detection.conf
      }
      await db.insert(observations).values(observationData)
    }
  } else {
    // No detections at all: create one observation with null bbox
    const observationData = {
      ...baseObservationData,
      observationID: crypto.randomUUID(),
      bboxX: null,
      bboxY: null,
      bboxWidth: null,
      bboxHeight: null,
      detectionConfidence: null
    }
    await db.insert(observations).values(observationData)
  }
}

/**
 * Calculate ISO 8601 timestamp from base timestamp + frame offset
 * @param {string} baseTimestamp - Base ISO timestamp (media capture time)
 * @param {number} frameNumber - Frame index within video
 * @param {number} fps - Frames per second of the video
 * @returns {string} ISO 8601 timestamp
 */
function calculateTimestamp(baseTimestamp, frameNumber, fps) {
  const baseDate = DateTime.fromISO(baseTimestamp)
  const offsetSeconds = frameNumber / fps
  return baseDate.plus({ seconds: offsetSeconds }).toISO()
}

/**
 * Insert aggregated video predictions into the database.
 * Creates ONE observation per unique species detected in the video (not per frame).
 * Full frame-level data is preserved in modelOutputs.rawOutput for provenance.
 *
 * @param {Object} db - Drizzle database instance
 * @param {Array} predictions - Array of frame predictions from Python server
 * @param {Object} mediaRecord - Media record from database
 * @param {Object} modelInfo - Model information { runID, modelID, modelVersion, detectionConfidenceThreshold }
 */
export async function insertVideoPredictions(db, predictions, mediaRecord, modelInfo = {}) {
  if (!predictions || predictions.length === 0) {
    log.warn(`No predictions for video: ${mediaRecord.filePath}`)
    return
  }

  // If media hasn't been processed yet, extract metadata and associate with deployment
  if (!mediaRecord.timestamp || !mediaRecord.deploymentID) {
    const result = await processMediaDeployment(db, mediaRecord)
    if (result) {
      mediaRecord.timestamp = result.timestamp
      mediaRecord.deploymentID = result.deploymentID
    }
    // Continue even if deployment processing failed - video can still create observations
  }

  // 1. Update media with video metadata in exifData field (Camtrap DP compliant)
  const firstPrediction = predictions[0]
  if (firstPrediction?.metadata) {
    const videoMetadata = {
      fps: firstPrediction.metadata.fps,
      duration: firstPrediction.metadata.duration,
      frameCount: Math.round(firstPrediction.metadata.duration * firstPrediction.metadata.fps)
    }

    // Update media with exifData (timestamp is extracted in deployment handling above, may be null)
    await db
      .update(media)
      .set({ exifData: videoMetadata })
      .where(eq(media.mediaID, mediaRecord.mediaID))

    // Update local mediaRecord for observation timestamp calculation
    mediaRecord.exifData = videoMetadata
  }

  // 2. Store ALL frame predictions in modelOutputs.rawOutput (full provenance)
  const modelOutputID = crypto.randomUUID()
  const modelOutput = await insertModelOutput(db, {
    id: modelOutputID,
    mediaID: mediaRecord.mediaID,
    runID: modelInfo.runID,
    rawOutput: { frames: predictions } // Complete frame-by-frame data
  })

  if (!modelOutput) {
    log.info(`Model output already exists for video ${mediaRecord.filePath}, skipping`)
    return
  }

  // 3. Aggregate species across all frames (skip blanks)
  const modelType = modelInfo.modelID || 'speciesnet'
  const speciesMap = new Map() // scientificName -> { frames, scores, firstFrame, lastFrame }

  for (const pred of predictions) {
    const species = parseScientificName(pred, modelType)
    if (!species) continue // Skip blank/empty predictions

    if (!speciesMap.has(species)) {
      speciesMap.set(species, {
        frames: [],
        scores: [], // Track all scores for averaging
        firstFrame: pred.frame_number,
        lastFrame: pred.frame_number
      })
    }
    const entry = speciesMap.get(species)
    entry.frames.push(pred.frame_number)
    entry.scores.push(pred.prediction_score || 0) // Collect scores for averaging
    entry.firstFrame = Math.min(entry.firstFrame, pred.frame_number)
    entry.lastFrame = Math.max(entry.lastFrame, pred.frame_number)
  }

  // 4. Select winner using majority voting with average confidence tiebreaker
  const { winner, winnerData } = selectVideoClassificationWinner(speciesMap)

  // 5. Create exactly ONE observation (winner or blank)
  const fps = mediaRecord.exifData?.fps || 1
  const classificationTimestamp = new Date().toISOString()
  const classifiedBy =
    modelInfo.modelID && modelInfo.modelVersion
      ? `${modelInfo.modelID} ${modelInfo.modelVersion}`
      : null

  const eventID = crypto.randomUUID()

  if (winner && winnerData) {
    // Calculate ISO 8601 timestamps from frame numbers
    const eventStart = mediaRecord.timestamp
      ? calculateTimestamp(mediaRecord.timestamp, winnerData.firstFrame, fps)
      : null
    const eventEnd = mediaRecord.timestamp
      ? calculateTimestamp(mediaRecord.timestamp, winnerData.lastFrame, fps)
      : null

    await db.insert(observations).values({
      observationID: crypto.randomUUID(),
      mediaID: mediaRecord.mediaID,
      deploymentID: mediaRecord.deploymentID,
      eventID: eventID,
      eventStart: eventStart,
      eventEnd: eventEnd,
      scientificName: winner,
      commonName: resolveCommonName(winner),
      confidence: winnerData.avgConfidence, // Use average confidence
      count: 1,
      // No bbox for video (movement can't be represented by single bbox)
      bboxX: null,
      bboxY: null,
      bboxWidth: null,
      bboxHeight: null,
      detectionConfidence: null,
      modelOutputID: modelOutputID,
      classificationMethod: 'machine',
      classifiedBy: classifiedBy,
      classificationTimestamp: classificationTimestamp
    })
  } else {
    // No species detected in any frame -> blank observation
    await db.insert(observations).values({
      observationID: crypto.randomUUID(),
      mediaID: mediaRecord.mediaID,
      deploymentID: mediaRecord.deploymentID,
      eventID: eventID,
      eventStart: mediaRecord.timestamp,
      eventEnd: mediaRecord.timestamp,
      scientificName: null,
      observationType: 'blank',
      confidence: null,
      count: 0,
      bboxX: null,
      bboxY: null,
      bboxWidth: null,
      bboxHeight: null,
      detectionConfidence: null,
      modelOutputID: modelOutputID,
      classificationMethod: 'machine',
      classifiedBy: classifiedBy,
      classificationTimestamp: classificationTimestamp
    })
  }

  log.info(
    `Inserted 1 observation for video ${mediaRecord.fileName}: ${winner || 'blank'} ` +
      `(winner from ${speciesMap.size} species across ${predictions.length} frames)`
  )
}

async function getDeployment(db, locationID) {
  try {
    const result = await db
      .select()
      .from(deployments)
      .where(eq(deployments.locationID, locationID))
      .limit(1)
    return result[0] || null
  } catch (error) {
    log.error(`Error getting deployment for locationID ${locationID}:`, error)
    return null
  }
}

/**
 * Extract metadata from media file and associate with deployment
 * Works for both images and videos
 * @param {Object} db - Database instance
 * @param {Object} mediaRecord - Media record (must have filePath, importFolder, mediaID)
 * @returns {Promise<{timestamp: string, deploymentID: string}|null>} - Updated values or null on error
 */
export async function processMediaDeployment(db, mediaRecord) {
  // 1. Extract metadata using exifr (works for images and videos)
  let exifData = {}
  try {
    const parsedExif = await exifr.parse(mediaRecord.filePath, {
      gps: true,
      exif: true,
      reviveValues: true
    })
    exifData = parsedExif || {}
  } catch (exifError) {
    log.warn(`Could not extract metadata from ${mediaRecord.filePath}: ${exifError.message}`)
  }

  // 2. Extract GPS coordinates
  let latitude = null
  let longitude = null
  if (exifData.latitude && exifData.longitude) {
    latitude = exifData.latitude.toFixed(6)
    longitude = exifData.longitude.toFixed(6)
  }

  // 3. Determine timestamp (support both image and video metadata fields)
  const zones = latitude && longitude ? geoTz.find(latitude, longitude) : null
  const captureDate = exifData.DateTimeOriginal || exifData.CreateDate || exifData.MediaCreateDate
  let date = captureDate ? DateTime.fromJSDate(captureDate, { zone: zones?.[0] }) : null

  // 3b. For video files, fall back to video-specific timestamp extraction
  if (!date && isVideoMediatype(mediaRecord.fileMediatype)) {
    const videoResult = await resolveVideoTimestamp(mediaRecord.filePath, mediaRecord.fileName)
    if (videoResult.timestamp) {
      date = DateTime.fromJSDate(videoResult.timestamp, { zone: zones?.[0] || 'utc' })
      exifData.timestampSource = videoResult.source
    }
  }

  // 4. Calculate parentFolder for deployment lookup
  const parentFolder =
    mediaRecord.importFolder === path.dirname(mediaRecord.filePath)
      ? path.basename(mediaRecord.importFolder)
      : path.relative(mediaRecord.importFolder, path.dirname(mediaRecord.filePath))

  // 5. Look up or create deployment
  try {
    let deployment = await getDeployment(db, parentFolder)

    if (deployment) {
      // Expand date range if this media extends it (only if we have a valid timestamp)
      if (date && deployment.deploymentStart && deployment.deploymentEnd) {
        await db
          .update(deployments)
          .set({
            deploymentStart: DateTime.min(
              date,
              DateTime.fromISO(deployment.deploymentStart)
            ).toISO(),
            deploymentEnd: DateTime.max(date, DateTime.fromISO(deployment.deploymentEnd)).toISO()
          })
          .where(eq(deployments.deploymentID, deployment.deploymentID))
      } else if (date && (!deployment.deploymentStart || !deployment.deploymentEnd)) {
        // Deployment exists but has no date range - set it from this media
        await db
          .update(deployments)
          .set({
            deploymentStart: deployment.deploymentStart || date.toISO(),
            deploymentEnd: deployment.deploymentEnd || date.toISO()
          })
          .where(eq(deployments.deploymentID, deployment.deploymentID))
      }
    } else {
      // Create new deployment
      const deploymentID = crypto.randomUUID()
      log.info(`Creating new deployment at: ${parentFolder}`)

      await db.insert(deployments).values({
        deploymentID,
        locationID: parentFolder,
        locationName: parentFolder,
        deploymentStart: date ? date.toISO() : null,
        deploymentEnd: date ? date.toISO() : null,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude)
      })

      deployment = { deploymentID, latitude, longitude }
    }

    // 6. Update database with timestamp, deployment, and EXIF data
    const timestamp = date ? date.toISO() : null
    const serializedExifData = serializeExifData(exifData)

    await db
      .update(media)
      .set({
        timestamp,
        deploymentID: deployment.deploymentID,
        exifData: serializedExifData
      })
      .where(eq(media.mediaID, mediaRecord.mediaID))

    log.info(`Media ${mediaRecord.mediaID} associated with deployment ${deployment.deploymentID}`)

    return { timestamp, deploymentID: deployment.deploymentID }
  } catch (error) {
    log.error(`Error processing deployment for ${mediaRecord.filePath}:`, error)
    return null
  }
}
