import { app, dialog, ipcMain } from 'electron'
import log from 'electron-log'
import exifr from 'exifr'
import fs from 'fs'
import geoTz from 'geo-tz'
import luxon, { DateTime } from 'luxon'
import path from 'path'
import crypto from 'crypto'
import Database from 'better-sqlite3'
import {
  getDrizzleDb,
  getReadonlyDrizzleDb,
  deployments,
  media,
  observations,
  modelRuns,
  modelOutputs,
  closeStudyDatabase,
  insertMetadata,
  getLatestModelRunRaw,
  updateMetadata,
  getMetadata
} from './db/index.js'
import { transformBboxToCamtrapDP } from './transformers/index.js'
import { eq, isNull, count, sql } from 'drizzle-orm'
import models from './models.js'
import mlmodels from '../shared/mlmodels.js'

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'])

async function* walkImages(dir) {
  const dirents = await fs.promises.opendir(dir)
  for await (const dirent of dirents) {
    const fullPath = path.join(dir, dirent.name)
    if (dirent.isDirectory()) {
      yield* walkImages(fullPath)
    } else if (dirent.isFile() && imageExtensions.has(path.extname(dirent.name).toLowerCase())) {
      yield fullPath
    }
  }
}

export async function* getPredictions(imagesPath, port, signal = null) {
  try {
    // Send request and handle streaming response
    const response = await fetch(`http://localhost:${port}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ instances: imagesPath.map((path) => ({ filepath: path })) }),
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
    folderName: folderName
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
 * @param {Object} db - Drizzle database instance
 * @param {Object} prediction - Model prediction output
 * @param {Object} modelInfo - Model information { modelOutputID, modelID, modelVersion }
 */
async function insertPrediction(db, prediction, modelInfo = {}) {
  const mediaRecord = await getMedia(db, prediction.filepath)
  if (!mediaRecord) {
    log.warn(`No media found for prediction: ${prediction.filepath}`)
    return
  }

  // If media hasn't been processed yet (no timestamp/deploymentID), process EXIF data
  if (!mediaRecord.timestamp || !mediaRecord.deploymentID) {
    let exifData = {}
    try {
      const parsedExif = await exifr.parse(prediction.filepath, {
        gps: true,
        exif: true,
        reviveValues: true
      })
      // exifr.parse() can return null for images without EXIF data
      exifData = parsedExif || {}
    } catch (exifError) {
      log.warn(`Could not extract EXIF data from ${prediction.filepath}: ${exifError.message}`)
    }

    let latitude = null
    let longitude = null
    if (exifData && exifData.latitude && exifData.longitude) {
      latitude = exifData.latitude.toFixed(6)
      longitude = exifData.longitude.toFixed(6)
    }

    const zones = latitude && longitude ? geoTz.find(latitude, longitude) : null
    const date = exifData.DateTimeOriginal
      ? luxon.DateTime.fromJSDate(exifData.DateTimeOriginal, { zone: zones?.[0] })
      : luxon.DateTime.now()

    const parentFolder =
      mediaRecord.importFolder === path.dirname(prediction.filepath)
        ? path.basename(mediaRecord.importFolder)
        : path.relative(mediaRecord.importFolder, path.dirname(prediction.filepath))

    console.log('Parent folder:', mediaRecord.importFolder, prediction.filepath, parentFolder)
    console.log('dir name:', path.dirname(prediction.filepath))

    let deployment
    try {
      deployment = await getDeployment(db, parentFolder)

      console.log('Found deployment:', deployment)

      if (deployment) {
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
      } else {
        // If no deployment exists, create a new one
        const deploymentID = crypto.randomUUID()
        const locationID = parentFolder
        log.info('Creating new deployment with at: ', locationID, latitude, longitude)

        await db.insert(deployments).values({
          deploymentID,
          locationID,
          locationName: locationID,
          deploymentStart: date.toISO(),
          deploymentEnd: date.toISO(),
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude)
        })

        deployment = {
          deploymentID,
          latitude,
          longitude
        }
      }

      // Update local media object for observation creation
      mediaRecord.timestamp = date.toISO()
      mediaRecord.deploymentID = deployment.deploymentID

      await db
        .update(media)
        .set({
          timestamp: date.toISO(),
          deploymentID: deployment.deploymentID
        })
        .where(eq(media.mediaID, mediaRecord.mediaID))
    } catch (error) {
      log.error(`Error processing EXIF data for ${prediction.filepath}:`, error)
      return
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

  // Create single observation per image with top-ranked detection bbox
  const detections = prediction.detections || []

  // Get top detection (highest confidence) if any exist
  const topDetection =
    detections.length > 0
      ? detections.reduce((best, d) => (d.conf > best.conf ? d : best), detections[0])
      : null

  const bbox = topDetection ? transformBboxToCamtrapDP(topDetection, modelType) : null

  const observationData = {
    observationID: crypto.randomUUID(),
    mediaID: mediaRecord.mediaID,
    deploymentID: mediaRecord.deploymentID,
    eventID: crypto.randomUUID(),
    eventStart: mediaRecord.timestamp,
    eventEnd: mediaRecord.timestamp,
    scientificName: resolvedScientificName,
    confidence: prediction.prediction_score,
    count: 1,
    bboxX: bbox?.bboxX ?? null,
    bboxY: bbox?.bboxY ?? null,
    bboxWidth: bbox?.bboxWidth ?? null,
    bboxHeight: bbox?.bboxHeight ?? null,
    // Model provenance fields
    modelOutputID: modelInfo.modelOutputID || null,
    classificationMethod: modelInfo.modelOutputID ? 'machine' : null,
    classifiedBy: classifiedBy,
    classificationTimestamp: classificationTimestamp
  }

  await db.insert(observations).values(observationData)
  // log.info(`Inserted prediction for ${mediaRecord.fileName} into database`)
}

async function nextMediaToPredict(db, batchSize = 100) {
  try {
    const results = await db
      .select({
        mediaID: media.mediaID,
        filePath: media.filePath,
        fileName: media.fileName,
        timestamp: media.timestamp,
        deploymentID: media.deploymentID
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
      fileName: row.fileName
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

let lastBatchDuration = null
const batchSize = 5

async function insertMediaBatch(sqlite, mediaDataArray) {
  if (mediaDataArray.length === 0) return

  // Create a direct better-sqlite3 connection for bulk insert

  try {
    // Prepare the insert statement
    const insertStmt = sqlite.prepare(`
      INSERT INTO media (mediaID, deploymentID, timestamp, filePath, fileName, importFolder, folderName)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    // Create a transaction for maximum performance
    const insertMany = sqlite.transaction((mediaArray) => {
      for (const mediaData of mediaArray) {
        insertStmt.run(
          mediaData.mediaID,
          mediaData.deploymentID,
          mediaData.timestamp,
          mediaData.filePath,
          mediaData.fileName,
          mediaData.importFolder,
          mediaData.folderName
        )
      }
    })

    insertMany(mediaDataArray)
    log.info(`Inserted ${mediaDataArray.length} media records using prepared statement transaction`)
  } catch (error) {
    log.error('Error inserting media batch:', error)
    throw error
  } finally {
    // sqlite.close()
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
        this.db = await getDrizzleDb(this.id, dbPath)

        log.info('scanning images in folder:', this.folder)
        console.time('Insert media')

        const mediaBatch = []
        const batchSize = 100000
        const sqlite = new Database(dbPath)
        // sqlite.pragma('journal_mode = WAL')

        for await (const imagePath of walkImages(this.folder)) {
          const folderName =
            this.folder === path.dirname(imagePath)
              ? path.basename(this.folder)
              : path.relative(this.folder, path.dirname(imagePath))

          const mediaData = {
            mediaID: crypto.randomUUID(),
            deploymentID: null,
            timestamp: null,
            filePath: imagePath,
            fileName: path.basename(imagePath),
            importFolder: this.folder,
            folderName: folderName
          }

          mediaBatch.push(mediaData)

          if (mediaBatch.length >= batchSize) {
            await insertMediaBatch(sqlite, mediaBatch)
            mediaBatch.length = 0 // Clear the array
          }
        }

        // Insert any remaining items
        if (mediaBatch.length > 0) {
          await insertMediaBatch(sqlite, mediaBatch)
        }

        sqlite.close()

        console.timeEnd('Insert media')
      } else {
        this.db = await getDrizzleDb(this.id, dbPath)
        if (addingMore) {
          log.info('scanning images in folder:', this.folder)

          for await (const imagePath of walkImages(this.folder)) {
            await insertMedia(this.db, imagePath, this.folder)
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

                const imageQueue = mediaBatch.map((m) => m.filePath)

                log.info(`Processing batch of ${imageQueue.length} images`)

                // Create a fresh AbortController for each batch to prevent listener accumulation
                const batchAbortController = new AbortController()

                // Link main abort to batch abort so external cancellation still works
                const abortHandler = () => batchAbortController.abort()
                this.abortController.signal.addEventListener('abort', abortHandler)

                try {
                  for await (const prediction of getPredictions(
                    imageQueue,
                    port,
                    batchAbortController.signal
                  )) {
                    // Get the media record to get its mediaID
                    const mediaRecord = await getMedia(this.db, prediction.filepath)
                    if (!mediaRecord) {
                      log.warn(`No media found for prediction: ${prediction.filepath}`)
                      continue
                    }

                    // Create model_output record for this media
                    const modelOutputID = crypto.randomUUID()
                    await this.db.insert(modelOutputs).values({
                      id: modelOutputID,
                      mediaID: mediaRecord.mediaID,
                      runID: runID,
                      rawOutput: prediction // Store full prediction as JSON
                    })

                    // Insert prediction with model provenance
                    await insertPrediction(this.db, prediction, {
                      modelOutputID,
                      modelID: modelReference.id,
                      modelVersion: modelReference.version
                    })
                  }
                } finally {
                  // Clean up listener to prevent memory leaks on the main abort controller
                  this.abortController.signal.removeEventListener('abort', abortHandler)
                }

                log.info(`Processed batch of ${imageQueue.length} images`)
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
  const latestRun = await getLatestModelRunRaw(id, dbPath)
  if (!latestRun) {
    log.warn(`No model run found for study ${id}`)
    return { success: false, message: 'No model run found for study' }
  }

  const modelReference = { id: latestRun.modelID, version: latestRun.modelVersion }
  const options = latestRun.options ? JSON.parse(latestRun.options) : {}
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
  const latestRun = await getLatestModelRunRaw(id, dbPath)
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

  const options = latestRun.options ? JSON.parse(latestRun.options) : {}
  const country = options.country || null

  importers[id] = new Importer(id, importPath, modelReference, country)
  importers[id].start()
  return { success: true, message: 'Importer resumed successfully' }
})

app.on('will-quit', async (e) => {
  if (Object.keys(importers).length === 0) {
    log.info('No importers to stop')
    return
  }
  e.preventDefault()

  for (const id in importers) {
    if (importers[id]) {
      await importers[id].cleanup()
      delete importers[id]
    }
  }

  log.info('All importers stopped')
  app.quit()
})
