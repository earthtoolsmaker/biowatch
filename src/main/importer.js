import { app, dialog, ipcMain } from 'electron'
import log from 'electron-log'
import exifr from 'exifr'
import fs from 'fs'
import geoTz from 'geo-tz'
import luxon, { DateTime } from 'luxon'
import path from 'path'
import crypto from 'crypto'
import {
  getDrizzleDb,
  getReadonlyDrizzleDb,
  getStudyDatabase,
  deployments,
  media,
  observations,
  modelRuns,
  closeStudyDatabase,
  insertMetadata,
  insertModelOutput,
  getLatestModelRun,
  updateMetadata,
  getMetadata
} from './db/index.js'
import { transformBboxToCamtrapDP } from './transformers/index.js'
import { eq, isNull, count, sql } from 'drizzle-orm'
import models from './models.js'
import mlmodels from '../shared/mlmodels.js'
import { selectVideoClassificationWinner } from './videoClassification.js'

// Map file extensions to IANA media types (Camtrap DP compliant)
const extensionToMediatype = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/x-m4v'
}

const mediaExtensions = new Set(Object.keys(extensionToMediatype))

function getFileMediatype(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return extensionToMediatype[ext] || 'application/octet-stream'
}

function isVideoMediatype(mediatype) {
  return mediatype.startsWith('video/')
}

async function* walkMediaFiles(dir) {
  const dirents = await fs.promises.opendir(dir)
  for await (const dirent of dirents) {
    const fullPath = path.join(dir, dirent.name)
    if (dirent.isDirectory()) {
      yield* walkMediaFiles(fullPath)
    } else if (dirent.isFile() && mediaExtensions.has(path.extname(dirent.name).toLowerCase())) {
      yield fullPath
    }
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
            // log.info('Received prediction:', response.output, preds)

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

async function insertMedia(db, fullPath, importFolder) {
  const folderName =
    importFolder === path.dirname(fullPath)
      ? path.basename(importFolder)
      : path.relative(importFolder, path.dirname(fullPath))
  const mediaData = {
    mediaID: crypto.randomUUID(),
    deploymentID: null,
    timestamp: null,
    filePath: fullPath,
    fileName: path.basename(fullPath),
    importFolder: importFolder,
    folderName: folderName,
    fileMediatype: getFileMediatype(fullPath),
    exifData: null // Populated from Python response for videos (fps, duration, etc.)
  }

  await db.insert(media).values(mediaData)
  return mediaData
}

async function getMedia(db, filepath) {
  console.log('getMedia', filepath)
  try {
    const result = await db.select().from(media).where(eq(media.filePath, filepath)).limit(1)
    return result[0] || null
  } catch (error) {
    log.error(`Error getting media for path ${filepath}:`, error)
    return null
  }
}

// {
//   filepath: '/Users/iorek/Downloads/species/0b87ee8f-bf2c-4154-82fd-500b3a8b88ae.JPG',
//   classifications: {
//     classes: [
//       '5a565886-156e-4b19-a017-6a5bbae4df0f;mammalia;lagomorpha;leporidae;oryctolagus;cuniculus;european rabbit',
//       '6c09fa63-2acc-4915-a60b-bd8cee40aedb;mammalia;lagomorpha;leporidae;;;rabbit and hare family',
//       'ce9a5481-b3f7-4e42-8b8b-382f601fded0;mammalia;lagomorpha;leporidae;lepus;europaeus;european hare',
//       '667a4650-a141-4c4e-844e-58cdeaeb4ae1;mammalia;lagomorpha;leporidae;sylvilagus;floridanus;eastern cottontail',
//       'cacc63d7-b949-4731-abce-a403ba76ee34;mammalia;lagomorpha;leporidae;sylvilagus;;sylvilagus species'
//     ],
//     scores: [
//       0.9893904328346252,
//       0.009531639516353607,
//       0.00039335378096438944,
//       0.00019710895139724016,
//       0.00010050772834802046
//     ]
//   },
//   detections: [
//     {
//       category: '1',
//       label: 'animal',
//       conf: 0.9739366769790649,
//       bbox: [Array]
//     },
//     {
//       category: '1',
//       label: 'animal',
//       conf: 0.029717758297920227,
//       bbox: [Array]
//     }
//   ],
//   prediction: '5a565886-156e-4b19-a017-6a5bbae4df0f;mammalia;lagomorpha;leporidae;oryctolagus;cuniculus;european rabbit',
//   prediction_score: 0.9893904328346252,
//   prediction_source: 'classifier',
//   model_version: '4.0.1a'
// }

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
    if (!label || label === 'blank' || label === 'empty' || label === 'vide') {
      return null
    }
    return label
  } else {
    // SpeciesNet: Hierarchical "uuid;class;order;family;genus;species;common name"
    const parts = prediction.prediction.split(';')
    const isblank = ['blank', 'no cv result'].includes(parts.at(-1))
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
async function insertPrediction(db, prediction, modelInfo = {}) {
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
    confidence: prediction.prediction_score,
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
  // log.info(`Inserted prediction for ${mediaRecord.fileName} into database`)
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
async function insertVideoPredictions(db, predictions, mediaRecord, modelInfo = {}) {
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

    // Update media with exifData (timestamp is now extracted in deployment handling above)
    const updateData = { exifData: videoMetadata }
    if (!mediaRecord.timestamp) {
      // Fallback if deployment handling didn't set timestamp (shouldn't happen normally)
      updateData.timestamp = new Date().toISOString()
    }

    await db.update(media).set(updateData).where(eq(media.mediaID, mediaRecord.mediaID))

    // Update local mediaRecord for observation timestamp calculation
    mediaRecord.exifData = videoMetadata
    if (updateData.timestamp) {
      mediaRecord.timestamp = updateData.timestamp
    }
  }

  // 2. Store ALL frame predictions in modelOutputs.rawOutput (full provenance)
  const modelOutputID = crypto.randomUUID()
  await insertModelOutput(db, {
    id: modelOutputID,
    mediaID: mediaRecord.mediaID,
    runID: modelInfo.runID,
    rawOutput: { frames: predictions } // Complete frame-by-frame data
  })

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

async function nextMediaToPredict(db, batchSize = 100) {
  try {
    const results = await db
      .select({
        mediaID: media.mediaID,
        filePath: media.filePath,
        fileName: media.fileName,
        timestamp: media.timestamp,
        deploymentID: media.deploymentID,
        fileMediatype: media.fileMediatype,
        exifData: media.exifData
      })
      .from(media)
      .leftJoin(observations, eq(media.mediaID, observations.mediaID))
      .where(isNull(observations.observationID))
      .limit(batchSize)

    return results.map((row) => ({
      mediaID: row.mediaID,
      deploymentID: row.deploymentID,
      timestamp: row.timestamp,
      filePath: row.filePath,
      fileName: row.fileName,
      fileMediatype: row.fileMediatype,
      exifData: row.exifData
    }))
  } catch (error) {
    log.error('Error getting next media to predict:', error)
    return []
  }
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
async function processMediaDeployment(db, mediaRecord) {
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
  const date = captureDate
    ? luxon.DateTime.fromJSDate(captureDate, { zone: zones?.[0] })
    : luxon.DateTime.now()

  // 4. Calculate parentFolder for deployment lookup
  const parentFolder =
    mediaRecord.importFolder === path.dirname(mediaRecord.filePath)
      ? path.basename(mediaRecord.importFolder)
      : path.relative(mediaRecord.importFolder, path.dirname(mediaRecord.filePath))

  // 5. Look up or create deployment
  try {
    let deployment = await getDeployment(db, parentFolder)

    if (deployment) {
      // Expand date range if this media extends it
      await db
        .update(deployments)
        .set({
          deploymentStart: DateTime.min(date, DateTime.fromISO(deployment.deploymentStart)).toISO(),
          deploymentEnd: DateTime.max(date, DateTime.fromISO(deployment.deploymentEnd)).toISO()
        })
        .where(eq(deployments.deploymentID, deployment.deploymentID))
    } else {
      // Create new deployment
      const deploymentID = crypto.randomUUID()
      log.info(`Creating new deployment at: ${parentFolder}`)

      await db.insert(deployments).values({
        deploymentID,
        locationID: parentFolder,
        locationName: parentFolder,
        deploymentStart: date.toISO(),
        deploymentEnd: date.toISO(),
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude)
      })

      deployment = { deploymentID, latitude, longitude }
    }

    // 6. Update database
    const timestamp = date.toISO()
    await db
      .update(media)
      .set({ timestamp, deploymentID: deployment.deploymentID })
      .where(eq(media.mediaID, mediaRecord.mediaID))

    log.info(`Media ${mediaRecord.mediaID} associated with deployment ${deployment.deploymentID}`)

    return { timestamp, deploymentID: deployment.deploymentID }
  } catch (error) {
    log.error(`Error processing deployment for ${mediaRecord.filePath}:`, error)
    return null
  }
}

let lastBatchDuration = null
const batchSize = 5

/**
 * Insert media records in batch using Drizzle ORM with transaction for performance
 * @param {Object} db - Drizzle database instance
 * @param {Object} manager - StudyDatabaseManager instance for transaction support
 * @param {Array} mediaDataArray - Array of media data objects to insert
 */
async function insertMediaBatch(db, manager, mediaDataArray) {
  if (mediaDataArray.length === 0) return

  try {
    // Use transaction for bulk insert performance
    // Insert in chunks to avoid SQLite parameter limits (999 per statement)
    const CHUNK_SIZE = 100

    manager.transaction(() => {
      for (let i = 0; i < mediaDataArray.length; i += CHUNK_SIZE) {
        const chunk = mediaDataArray.slice(i, i + CHUNK_SIZE)
        db.insert(media)
          .values(
            chunk.map((m) => ({
              mediaID: m.mediaID,
              deploymentID: m.deploymentID,
              timestamp: m.timestamp,
              filePath: m.filePath,
              fileName: m.fileName,
              importFolder: m.importFolder,
              folderName: m.folderName,
              fileMediatype: m.fileMediatype,
              exifData: m.exifData
            }))
          )
          .run()
      }
    })

    log.info(`Inserted ${mediaDataArray.length} media records using Drizzle transaction`)
  } catch (error) {
    log.error('Error inserting media batch:', error)
    throw error
  }
}

export class Importer {
  constructor(id, folder, modelReference, country = null) {
    this.id = id
    this.folder = folder
    this.modelReference = modelReference
    this.country = country
    this.pythonProcess = null
    this.pythonProcessPort = null
    this.pythonProcessShutdownApiKey = null
    this.abortController = null
    this.batchSize = batchSize
    this.dbPath = null
  }

  async cleanup() {
    log.info(`Cleaning up importer with ID ${this.id}`)

    // Abort any in-flight fetch requests first
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }

    if (this.pythonProcess) {
      return await models.stopMLModelHTTPServer({
        pid: this.pythonProcess.pid,
        port: this.pythonProcessPort,
        shutdownApiKey: this.pythonProcessShutdownApiKey
      })
    }
    return Promise.resolve() // Return resolved promise if no process to kill
  }

  async start(addingMore = false) {
    try {
      this.dbPath = path.join(
        app.getPath('userData'),
        'biowatch-data',
        'studies',
        this.id,
        'study.db'
      )
      const dbPath = this.dbPath
      if (!fs.existsSync(dbPath)) {
        log.info(`Database not found at ${dbPath}, creating new one`)
        // Ensure the directory exists
        const dbDir = path.dirname(dbPath)
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true })
        }

        // Get database manager for transaction support
        const manager = await getStudyDatabase(this.id, dbPath)
        this.db = manager.getDb()

        log.info('scanning images in folder:', this.folder)
        console.time('Insert media')

        const mediaBatch = []
        const insertBatchSize = 100000

        for await (const mediaPath of walkMediaFiles(this.folder)) {
          const folderName =
            this.folder === path.dirname(mediaPath)
              ? path.basename(this.folder)
              : path.relative(this.folder, path.dirname(mediaPath))

          const mediaData = {
            mediaID: crypto.randomUUID(),
            deploymentID: null,
            timestamp: null,
            filePath: mediaPath,
            fileName: path.basename(mediaPath),
            importFolder: this.folder,
            folderName: folderName,
            fileMediatype: getFileMediatype(mediaPath),
            exifData: null // Populated from Python response for videos (fps, duration, etc.)
          }

          mediaBatch.push(mediaData)

          if (mediaBatch.length >= insertBatchSize) {
            await insertMediaBatch(this.db, manager, mediaBatch)
            mediaBatch.length = 0 // Clear the array
          }
        }

        // Insert any remaining items
        if (mediaBatch.length > 0) {
          await insertMediaBatch(this.db, manager, mediaBatch)
        }

        console.timeEnd('Insert media')
      } else {
        this.db = await getDrizzleDb(this.id, dbPath)
        if (addingMore) {
          log.info('scanning media files in folder:', this.folder)

          for await (const mediaPath of walkMediaFiles(this.folder)) {
            await insertMedia(this.db, mediaPath, this.folder)
          }
        }
      }

      // const temporalData = await getTemporalData(this.db)

      try {
        const modelReference = this.modelReference
        const model = mlmodels.findModel(modelReference)
        if (!model) {
          throw new Error(`Model not found: ${modelReference.id} ${modelReference.version}`)
        }
        const pythonEnvironment = mlmodels.findPythonEnvironment(model.pythonEnvironment)
        if (!pythonEnvironment) {
          throw new Error(
            `Python environment not found: ${model.pythonEnvironment.id} ${model.pythonEnvironment.version}`
          )
        }
        models
          .startMLModelHTTPServer({
            pythonEnvironment: pythonEnvironment,
            modelReference: modelReference,
            country: this.country
          })
          .then(async ({ port, process, shutdownApiKey }) => {
            log.info('New python process', port, process.pid)
            this.pythonProcess = process
            this.pythonProcessPort = port
            this.pythonProcessShutdownApiKey = shutdownApiKey

            // Create AbortController for cancelling in-flight requests
            this.abortController = new AbortController()

            // Create a model run record for this processing session
            const runID = crypto.randomUUID()
            await this.db.insert(modelRuns).values({
              id: runID,
              modelID: modelReference.id,
              modelVersion: modelReference.version,
              startedAt: new Date().toISOString(),
              status: 'running',
              importPath: this.folder,
              options: this.country ? { country: this.country } : null
            })
            log.info(
              `Created model run ${runID} for ${modelReference.id} v${modelReference.version}`
            )

            try {
              while (true) {
                // Check if we've been aborted before starting a new batch
                if (!this.abortController || this.abortController.signal.aborted) {
                  log.info('Processing aborted, stopping batch loop')
                  break
                }

                const batchStart = DateTime.now()
                const mediaBatch = await nextMediaToPredict(this.db, this.batchSize)
                if (mediaBatch.length === 0) {
                  log.info('No more media to process')
                  break
                }

                // Separate images and videos for different processing
                const images = mediaBatch.filter((m) => !isVideoMediatype(m.fileMediatype))
                const videos = mediaBatch.filter((m) => isVideoMediatype(m.fileMediatype))
                const mediaQueue = mediaBatch.map((m) => m.filePath)

                log.info(
                  `Processing batch of ${mediaQueue.length} media files (${images.length} images, ${videos.length} videos)`
                )

                // Create a fresh AbortController for each batch to prevent listener accumulation
                const batchAbortController = new AbortController()

                // Link main abort to batch abort so external cancellation still works
                const abortHandler = () => batchAbortController.abort()
                this.abortController.signal.addEventListener('abort', abortHandler)

                try {
                  // For videos, we need to collect all frame predictions before processing
                  const videoPredictionsMap = new Map() // filepath -> predictions[]

                  for await (const prediction of getPredictions(
                    mediaQueue,
                    port,
                    batchAbortController.signal
                  )) {
                    // Check if this is a video frame prediction
                    const isVideoFrame = prediction.frame_number !== undefined

                    if (isVideoFrame) {
                      // Collect video frame predictions
                      if (!videoPredictionsMap.has(prediction.filepath)) {
                        videoPredictionsMap.set(prediction.filepath, [])
                      }
                      videoPredictionsMap.get(prediction.filepath).push(prediction)
                    } else {
                      // Process image prediction immediately (existing logic)
                      const mediaRecord = await getMedia(this.db, prediction.filepath)
                      if (!mediaRecord) {
                        log.warn(`No media found for prediction: ${prediction.filepath}`)
                        continue
                      }

                      // Create model_output record for this media (with validated rawOutput)
                      const modelOutputID = crypto.randomUUID()
                      await insertModelOutput(this.db, {
                        id: modelOutputID,
                        mediaID: mediaRecord.mediaID,
                        runID: runID,
                        rawOutput: prediction // Store full prediction as JSON
                      })

                      // Insert prediction with model provenance
                      await insertPrediction(this.db, prediction, {
                        modelOutputID,
                        modelID: modelReference.id,
                        modelVersion: modelReference.version,
                        detectionConfidenceThreshold: model.detectionConfidenceThreshold
                      })
                    }
                  }

                  // Process collected video predictions (aggregate per video)
                  for (const [filepath, predictions] of videoPredictionsMap) {
                    const mediaRecord = await getMedia(this.db, filepath)
                    if (!mediaRecord) {
                      log.warn(`No media found for video: ${filepath}`)
                      continue
                    }

                    await insertVideoPredictions(this.db, predictions, mediaRecord, {
                      runID: runID,
                      modelID: modelReference.id,
                      modelVersion: modelReference.version,
                      detectionConfidenceThreshold: model.detectionConfidenceThreshold
                    })
                  }
                } finally {
                  // Clean up listener to prevent memory leaks on the main abort controller
                  this.abortController.signal.removeEventListener('abort', abortHandler)
                }

                log.info(`Processed batch of ${mediaQueue.length} media files`)
                const batchEnd = DateTime.now()
                lastBatchDuration = batchEnd.diff(batchStart, 'seconds').seconds
              }

              // Auto-populate temporal dates from media timestamps (if not already set)
              // This must happen BEFORE setting status to 'completed' so the renderer
              // sees the updated dates when it invalidates the query
              try {
                log.info(`Attempting to auto-populate temporal dates for study ${this.id}`)

                // Calculate cutoff date (24 hours ago) to exclude media without EXIF data
                // (which default to DateTime.now())
                const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

                const dateRange = await this.db
                  .select({
                    minDate:
                      sql`MIN(CASE WHEN ${media.timestamp} < ${oneDayAgo} THEN ${media.timestamp} ELSE NULL END)`.as(
                        'minDate'
                      ),
                    maxDate:
                      sql`MAX(CASE WHEN ${media.timestamp} < ${oneDayAgo} THEN ${media.timestamp} ELSE NULL END)`.as(
                        'maxDate'
                      )
                  })
                  .from(media)
                  .get()

                log.info(`Date range query result: ${JSON.stringify(dateRange)}`)

                if (dateRange && dateRange.minDate && dateRange.maxDate) {
                  // Get current metadata to check if dates are already set
                  const currentMetadata = await getMetadata(this.db)

                  // Only update if values are not already set (don't overwrite user edits)
                  const updates = {}
                  if (!currentMetadata?.startDate) {
                    updates.startDate = dateRange.minDate.split('T')[0]
                  }
                  if (!currentMetadata?.endDate) {
                    updates.endDate = dateRange.maxDate.split('T')[0]
                  }

                  if (Object.keys(updates).length > 0) {
                    await updateMetadata(this.db, this.id, updates)
                    log.info(
                      `Updated temporal dates for study ${this.id}: ${updates.startDate || 'unchanged'} to ${updates.endDate || 'unchanged'}`
                    )
                  }
                }
              } catch (temporalError) {
                log.warn(`Could not auto-populate temporal dates: ${temporalError.message}`)
              }

              // Update model run status to completed
              await this.db
                .update(modelRuns)
                .set({ status: 'completed' })
                .where(eq(modelRuns.id, runID))
              log.info(`Model run ${runID} completed`)
            } catch (error) {
              // Handle AbortError gracefully - not a real error when stopping
              if (error.name === 'AbortError') {
                log.info('Background processing was aborted')
                // Update model run status to aborted
                await this.db
                  .update(modelRuns)
                  .set({ status: 'aborted' })
                  .where(eq(modelRuns.id, runID))
              } else {
                // Update model run status to failed
                await this.db
                  .update(modelRuns)
                  .set({ status: 'failed' })
                  .where(eq(modelRuns.id, runID))
                log.error(`Model run ${runID} failed:`, error)
                throw error
              }
            }

            this.cleanup()
          })
          .catch(async (error) => {
            // Handle AbortError gracefully - not a real error when stopping
            if (error.name === 'AbortError') {
              log.info('Background processing was aborted')
              return
            }
            log.error('Error during background processing:', error)
            await closeStudyDatabase(this.id, this.dbPath)
            this.cleanup()
          })
        //it's important to return after the db is created. Other parts of the app depend on this
        return this.id
      } catch (error) {
        log.error('Error starting ML model server:', error)
        await closeStudyDatabase(this.id, this.dbPath)
        this.cleanup()
      }
    } catch (error) {
      console.error('Error starting importer:', error)
      if (this.db) {
        await closeStudyDatabase(this.id, this.dbPath)
      }
      this.cleanup()
    }
  }
}

let importers = {}

async function status(id) {
  const dbPath = path.join(app.getPath('userData'), 'biowatch-data', 'studies', id, 'study.db')

  try {
    const db = await getReadonlyDrizzleDb(id, dbPath)

    // Get total count of media
    const mediaResult = await db
      .select({ mediaCount: count(media.mediaID) })
      .from(media)
      .get()

    // Get count of observations
    const obsResult = await db
      .select({ obsCount: count(observations.observationID) })
      .from(observations)
      .get()

    const mediaCount = mediaResult?.mediaCount || 0
    const obsCount = obsResult?.obsCount || 0
    const remain = mediaCount - obsCount
    const estimatedMinutesRemaining = lastBatchDuration
      ? (remain * lastBatchDuration) / batchSize / 60
      : null

    const speed = lastBatchDuration ? (batchSize / lastBatchDuration) * 60 : null

    await closeStudyDatabase(id, dbPath)

    return {
      total: mediaCount,
      done: obsCount,
      isRunning: !!importers[id],
      estimatedMinutesRemaining: estimatedMinutesRemaining,
      speed: Math.round(speed)
    }
  } catch (error) {
    log.error(`Error getting status for importer ${id}:`, error)
    throw error
  }
}

ipcMain.handle('importer:get-status', async (event, id) => {
  return await status(id)
})

ipcMain.handle('importer:select-images-directory-only', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Images Directory'
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: 'Selection canceled' }
  }

  const directoryPath = result.filePaths[0]
  return { success: true, directoryPath }
})

ipcMain.handle(
  'importer:select-images-directory-with-model',
  async (event, directoryPath, modelReference, countryCode = null) => {
    try {
      const id = crypto.randomUUID()
      if (importers[id]) {
        log.warn(`Importer with ID ${id} already exists, skipping creation`)
        return { success: false, message: 'Importer already exists' }
      }
      log.info(
        `Creating new importer with ID ${id} for directory: ${directoryPath} with model: ${modelReference.id} and country: ${countryCode}`
      )
      const importer = new Importer(id, directoryPath, modelReference, countryCode)
      importers[id] = importer
      await importer.start()

      // Insert metadata into the database
      const dbPath = path.join(app.getPath('userData'), 'biowatch-data', 'studies', id, 'study.db')
      const db = await getDrizzleDb(id, dbPath)
      const metadataRecord = {
        id,
        name: path.basename(directoryPath),
        title: null,
        description: null,
        created: new Date().toISOString(),
        importerName: `local/${modelReference.id}`,
        contributors: null
      }
      await insertMetadata(db, metadataRecord)
      log.info('Inserted study metadata into database')

      return metadataRecord
    } catch (error) {
      log.error('Error processing images directory with model:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }
)

ipcMain.handle('importer:select-more-images-directory', async (event, id) => {
  if (importers[id]) {
    log.warn(`Importer with ID ${id} is already running`)
    return { success: false, message: 'Importer already running' }
  }

  const dbPath = path.join(app.getPath('userData'), 'biowatch-data', 'studies', id, 'study.db')
  if (!fs.existsSync(dbPath)) {
    log.warn(`Study database not found for ID ${id}`)
    return { success: false, message: 'Study not found' }
  }

  // Get latest model run to retrieve model reference and options
  const db = await getDrizzleDb(id, dbPath)
  const latestRun = await getLatestModelRun(db)
  if (!latestRun) {
    log.warn(`No model run found for study ${id}`)
    return { success: false, message: 'No model run found for study' }
  }

  const modelReference = { id: latestRun.modelID, version: latestRun.modelVersion }
  const options = latestRun.options || {}
  const country = options.country || null

  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Images Directory'
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: 'Selection canceled' }
  }

  const directoryPath = result.filePaths[0]
  const importer = new Importer(id, directoryPath, modelReference, country)
  importers[id] = importer
  await importer.start(true)
  return { success: true, message: 'Importer started successfully' }
})

ipcMain.handle('importer:stop', async (event, id) => {
  if (!importers[id]) {
    log.warn(`No importer found with ID ${id}`)
    return { success: false, message: 'Importer not found' }
  }

  try {
    await importers[id].cleanup()
    delete importers[id]
    log.info('Importers', importers)
    log.info(`Importer with ID ${id} stopped successfully`)
    return { success: true, message: 'Importer stopped successfully' }
  } catch (error) {
    log.error(`Error stopping importer with ID ${id}:`, error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('importer:resume', async (event, id) => {
  const dbPath = path.join(app.getPath('userData'), 'biowatch-data', 'studies', id, 'study.db')

  // Check if the database exists
  if (!fs.existsSync(dbPath)) {
    log.warn(`No database found for importer with ID ${id}`)
    return { success: false, message: 'Importer not found' }
  }

  // Get latest model run to retrieve model reference, importPath and options
  const db = await getDrizzleDb(id, dbPath)
  const latestRun = await getLatestModelRun(db)
  if (!latestRun) {
    log.warn(`No model run found for study ${id}`)
    return { success: false, message: 'No model run found for study' }
  }

  const modelReference = { id: latestRun.modelID, version: latestRun.modelVersion }
  const importPath = latestRun.importPath
  if (!importPath) {
    log.warn(`No import path found for study ${id}`)
    return { success: false, message: 'No import path found for study' }
  }

  const options = latestRun.options || {}
  const country = options.country || null

  importers[id] = new Importer(id, importPath, modelReference, country)
  importers[id].start()
  return { success: true, message: 'Importer resumed successfully' }
})

app.on('will-quit', async () => {
  // Note: ML server cleanup is handled by the 'before-quit' handler via shutdownAllServers()
  // This handler only needs to abort in-flight requests and clear importer references

  if (Object.keys(importers).length === 0) {
    log.info('[Importer] No importers to clean up')
    return
  }

  for (const id in importers) {
    if (importers[id]) {
      // Only abort in-flight fetch requests; servers are cleaned up centrally
      if (importers[id].abortController) {
        log.info(`[Importer] Aborting in-flight requests for importer ${id}`)
        importers[id].abortController.abort()
        importers[id].abortController = null
      }
      delete importers[id]
    }
  }

  log.info('[Importer] All importers cleaned up')
})
