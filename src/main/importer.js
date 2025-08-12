import { app, dialog, ipcMain } from 'electron'
import log from 'electron-log'
import exifr from 'exifr'
import fs from 'fs'
import geoTz from 'geo-tz'
import luxon, { DateTime } from 'luxon'
import path from 'path'
import crypto from 'crypto'
import { getDrizzleDb, deployments, media, observations, closeStudyDatabase } from './db/index.js'
import { eq, isNull, min, max, count } from 'drizzle-orm'
import models from './models.js'
import mlmodels from '../shared/mlmodels.js'

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'])

/**
 * Checks if a directory is a leaf directory containing images
 * @param {string} dir - The directory path
 * @returns {Promise<{isLeaf: boolean, imageCount: number}>}
 */
async function isLeafDirectoryWithImages(dir) {
  const dirents = await fs.promises.readdir(dir, { withFileTypes: true })

  let hasSubdirectories = false
  let imageCount = 0

  for (const dirent of dirents) {
    if (dirent.isDirectory()) {
      hasSubdirectories = true
      break
    } else if (dirent.isFile() && imageExtensions.has(path.extname(dirent.name).toLowerCase())) {
      imageCount++
    }
  }

  return {
    isLeaf: !hasSubdirectories,
    imageCount
  }
}

/**
 * Gets the most frequent location from a list of locations
 * @param {Array<{latitude: number, longitude: number, count: number}>} locations
 * @returns {{latitude: number, longitude: number}}
 */
function getMainLocation(locations) {
  if (locations.length === 0) return { latitude: null, longitude: null }

  // Sort by count in descending order
  const sorted = [...locations].sort((a, b) => b.count - a.count)
  return { latitude: sorted[0].latitude, longitude: sorted[0].longitude }
}

/**
 * Finds all deployments in a given directory by scanning for leaf directories with images
 * @param {string} rootDir - The root directory to scan
 * @returns {Promise<Array>} - List of deployments
 */
export async function getDeployments(rootDir) {
  const deployments = []

  async function* scanDirectories(dir, relativePath = '') {
    try {
      const dirents = await fs.promises.readdir(dir, { withFileTypes: true })

      const { isLeaf, imageCount } = await isLeafDirectoryWithImages(dir)
      if (isLeaf && imageCount > 0) {
        // This is a leaf directory with images - process as a deployment
        let startDate = null
        let endDate = null
        const locationMap = new Map() // Map to track unique locations and their frequency

        // Process images to extract dates and locations
        let processedCount = 0

        for await (const imagePath of walkImages(dir)) {
          let exifData = {}
          try {
            exifData = await exifr.parse(imagePath, {
              gps: true,
              exif: true,
              reviveValues: true
            })
          } catch (exifError) {
            log.warn(`Could not extract EXIF data from ${imagePath}: ${exifError.message}`)
            continue // Skip images with unreadable EXIF
          }

          // Update date range
          if (exifData && exifData.DateTimeOriginal) {
            const imageDate = DateTime.fromJSDate(exifData.DateTimeOriginal)
            if (!startDate || imageDate < startDate) startDate = imageDate
            if (!endDate || imageDate > endDate) endDate = imageDate
          }

          // Track location data
          if (exifData && exifData.latitude !== undefined && exifData.longitude !== undefined) {
            // Round to 6 decimal places for better grouping
            const lat = Math.round(exifData.latitude * 100000) / 100000
            const lng = Math.round(exifData.longitude * 100000) / 100000
            const locKey = `${lat},${lng}`

            if (!locationMap.has(locKey)) {
              locationMap.set(locKey, { latitude: lat, longitude: lng, count: 1 })
            } else {
              locationMap.get(locKey).count++
            }
          }

          // Log progress occasionally
          processedCount++
          if (processedCount % 100 === 0) {
            log.info(`Processed ${processedCount}/${imageCount} images in ${relativePath || dir}`)
          }
        }

        // Convert location map to array
        const locations = Array.from(locationMap.values())
        const mainLocation = getMainLocation(locations)

        deployments.push({
          path: dir,
          relativePath,
          imageCount,
          startDate: startDate ? startDate.toISO() : null,
          endDate: endDate ? endDate.toISO() : null,
          mainLocation,
          locations
        })

        log.info(`Found deployment in ${relativePath || dir} with ${imageCount} images`)
      } else if (!isLeaf) {
        // Continue scanning subdirectories
        for (const dirent of dirents) {
          if (dirent.isDirectory()) {
            const fullPath = path.join(dir, dirent.name)
            const newRelativePath = relativePath
              ? path.join(relativePath, dirent.name)
              : dirent.name
            yield* scanDirectories(fullPath, newRelativePath)
          }
        }
      }
    } catch (error) {
      log.error(`Error scanning directory ${dir}:`, error)
    }
  }

  // Start scanning from root directory
  for await (const _ of scanDirectories(rootDir)) {
    // The generator populates the deployments array
  }

  return deployments
}

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

export async function* getPredictions(imagesPath, port) {
  try {
    // Send request and handle streaming response
    const response = await fetch(`http://localhost:${port}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ instances: imagesPath.map((path) => ({ filepath: path })) })
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
    log.error('Error in prediction process:', error)
    throw error
  }
}

async function insertIntoTable(db, table, data) {
  try {
    await db.insert(table).values(data)
  } catch (err) {
    log.error(`Error inserting into table:`, err)
  }
}

async function insertMedia(db, fullPath, importFolder) {
  let exifData = {}
  try {
    exifData = await exifr.parse(fullPath, {
      gps: true,
      exif: true,
      reviveValues: true
    })
  } catch (exifError) {
    log.warn(`Could not extract EXIF data from ${fullPath}: ${exifError.message}`)
  }
  let latitude = null
  let longitude = null
  if (exifData && exifData.latitude && exifData.longitude) {
    latitude = exifData.latitude.toFixed(6) // Round to 6 decimal places
    longitude = exifData.longitude.toFixed(6) // Round to 6 decimal places
  }

  const zones = latitude && longitude ? geoTz.find(latitude, longitude) : null

  const date = luxon.DateTime.fromJSDate(exifData.DateTimeOriginal, {
    zone: zones?.[0]
  })

  const parentFolder = path.relative(importFolder, path.dirname(fullPath))

  let deployment
  try {
    deployment = await getDeployment(db, parentFolder)

    if (deployment) {
      // If a deployment exists, update the start or end time if necessary
      await db
        .update(deployments)
        .set({
          deploymentStart: DateTime.min(date, DateTime.fromISO(deployment.deploymentStart)).toISO(),
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

    const mediaData = {
      mediaID: crypto.randomUUID(),
      deploymentID: deployment.deploymentID,
      timestamp: date.toISO(),
      filePath: fullPath,
      fileName: path.basename(fullPath)
    }

    await insertIntoTable(db, media, mediaData)
    return mediaData
  } catch (error) {
    log.error(`Error inserting media for ${fullPath}:`, error)
    return
  }
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
async function insertPrediction(db, prediction) {
  const mediaRecord = await getMedia(db, prediction.filepath)
  if (!mediaRecord) {
    log.warn(`No media found for prediction: ${prediction.filepath}`)
    return
  }
  const isblank = ['blank', 'no cv result'].includes(prediction.prediction.split(';').at(-1))
  const scientificName =
    prediction.prediction.split(';').at(-3) + ' ' + prediction.prediction.split(';').at(-2)

  const observationData = {
    observationID: crypto.randomUUID(),
    mediaID: mediaRecord.mediaID,
    deploymentID: mediaRecord.deploymentID,
    eventID: crypto.randomUUID(),
    eventStart: mediaRecord.timestamp,
    eventEnd: mediaRecord.timestamp,
    scientificName: isblank
      ? null
      : scientificName.trim() === ''
        ? prediction.prediction.split(';').at(-1)
        : scientificName,
    confidence: prediction.prediction_score,
    count: 1,
    prediction: prediction.prediction
  }

  await insertIntoTable(db, observations, observationData)
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

async function getTemporalData(db) {
  try {
    const result = await db
      .select({
        startDate: min(deployments.deploymentStart).as('startDate'),
        endDate: max(deployments.deploymentEnd).as('endDate')
      })
      .from(deployments)
      .get()

    return {
      start: result?.startDate ? DateTime.fromISO(result.startDate).toFormat('dd LLL yyyy') : null,
      end: result?.endDate ? DateTime.fromISO(result.endDate).toFormat('dd LLL yyyy') : null
    }
  } catch (error) {
    log.error('Error getting temporal data:', error)
    return { start: null, end: null }
  }
}

let lastBatchDuration = null
const batchSize = 5

export class Importer {
  constructor(id, folder) {
    this.id = id
    this.folder = folder
    this.pythonProcess = null
    this.batchSize = batchSize
    this.dbPath = null
  }

  async cleanup() {
    log.info(`Cleaning up importer with ID ${this.id}`, this.pythonProcess)
    if (this.pythonProcess) {
      return await models.stopMLModelHTTPServer({ pid: this.pythonProcess.pid })
    }
    return Promise.resolve() // Return resolved promise if no process to kill
  }

  async start() {
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

        for await (const imagePath of walkImages(this.folder)) {
          await insertMedia(this.db, imagePath, this.folder)
        }
      } else {
        this.db = await getDrizzleDb(this.id, dbPath)
      }

      // const temporalData = await getTemporalData(this.db)

      try {
        models
          .startMLModelHTTPServer({
            pythonEnvironment: mlmodels.pythonEnvironments[2],
            modelReference: mlmodels.modelZoo[0].reference
          })
          .then(async ({ port, process }) => {
            log.info('New python process', port, process.pid)
            this.pythonProcess = process
            while (true) {
              const batchStart = DateTime.now()
              const mediaBatch = await nextMediaToPredict(this.db, this.batchSize)
              if (mediaBatch.length === 0) {
                log.info('No more media to process')
                break
              }

              const imageQueue = mediaBatch.map((m) => m.filePath)

              log.info(`Processing batch of ${imageQueue.length} images`)

              for await (const prediction of getPredictions(imageQueue, port)) {
                await insertPrediction(this.db, prediction)
              }

              log.info(`Processed batch of ${imageQueue.length} images`)
              const batchEnd = DateTime.now()
              lastBatchDuration = batchEnd.diff(batchStart, 'seconds').seconds
            }

            this.cleanup()
          })
        //it's important to return after the db is created. Other parts of the app depend on this
        return this.id
      } catch (error) {
        log.error('Error during background processing:', error)
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
    const db = await getDrizzleDb(id, dbPath)

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

ipcMain.handle('importer:select-images-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Images Directory'
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: 'Selection canceled' }
  }

  const directoryPath = result.filePaths[0]

  try {
    const id = crypto.randomUUID()
    if (importers[id]) {
      log.warn(`Importer with ID ${id} already exists, skipping creation`)
      return { success: false, message: 'Importer already exists' }
    }
    log.info(`Creating new importer with ID ${id} for directory: ${directoryPath}`)
    const importer = new Importer(id, directoryPath)
    importers[id] = importer
    await importer.start()
    const data = {
      path: directoryPath,
      importerName: 'local/speciesnet',
      name: path.basename(directoryPath),
      data: {
        name: path.basename(directoryPath)
      },
      id: id
    }
    fs.writeFileSync(
      path.join(app.getPath('userData'), 'biowatch-data', 'studies', id, 'study.json'),
      JSON.stringify(data, null, 2)
    )
    return data
  } catch (error) {
    log.error('Error processing images directory:', error)
    return {
      success: false,
      error: error.message
    }
  }
})

ipcMain.handle('importer:stop', async (event, id) => {
  if (!importers[id]) {
    log.warn(`No importer found with ID ${id}`)
    return { success: false, message: 'Importer not found' }
  }

  try {
    await importers[id].cleanup()
    delete importers[id]
    log.info(`Importer with ID ${id} stopped successfully`)
    return { success: true, message: 'Importer stopped successfully' }
  } catch (error) {
    log.error(`Error stopping importer with ID ${id}:`, error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('importer:resume', async (event, id) => {
  const dbPath = path.join(app.getPath('userData'), 'biowatch-data', 'studies', id, 'study.db')

  //check if the database exists
  if (!fs.existsSync(dbPath)) {
    log.warn(`No database found for importer with ID ${id}`)
    return { success: false, message: 'Importer not found' }
  }

  importers[id] = new Importer(id)
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
