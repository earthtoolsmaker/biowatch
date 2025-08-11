import { app, dialog, ipcMain } from 'electron'
import log from 'electron-log'
import exifr from 'exifr'
import fs from 'fs'
import geoTz from 'geo-tz'
import luxon, { DateTime } from 'luxon'
import path from 'path'
import sqlite3 from 'sqlite3'
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

function insertInto(db, tableName, data) {
  const keys = Object.keys(data)
  const values = Object.values(data)

  const placeholders = keys.map(() => '?').join(', ')

  const query = `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`

  db.run(query, values, function (err) {
    if (err) {
      log.error(`Error inserting into ${tableName}:`, err)
    }
  })
}

async function insertMedia(db, fullPath, importFolder) {
  const folderName =
    importFolder === path.dirname(fullPath)
      ? path.basename(importFolder)
      : path.relative(importFolder, path.dirname(fullPath))
  const media = {
    mediaID: crypto.randomUUID(),
    deploymentID: null,
    timestamp: null,
    filePath: fullPath,
    fileName: path.basename(fullPath),
    importFolder: importFolder,
    folderName: folderName
  }

  insertInto(db, 'media', media)
  return media
}

function getMedia(db, filepath) {
  console.log('getMedia', filepath)
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM media WHERE filePath = ?', [filepath], (err, row) => {
      if (err) {
        reject(err)
        return
      }
      resolve(row)
    })
  })
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
  const media = await getMedia(db, prediction.filepath)
  if (!media) {
    log.warn(`No media found for prediction: ${prediction.filepath}`)
    return
  }

  // If media hasn't been processed yet (no timestamp/deploymentID), process EXIF data
  if (!media.timestamp || !media.deploymentID) {
    let exifData = {}
    try {
      exifData = await exifr.parse(prediction.filepath, {
        gps: true,
        exif: true,
        reviveValues: true
      })
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
      media.importFolder === path.dirname(prediction.filepath)
        ? path.basename(media.importFolder)
        : path.relative(media.importFolder, path.dirname(prediction.filepath))

    console.log('Parent folder:', media.importFolder, prediction.filepath, parentFolder)
    console.log('dir name:', path.dirname(prediction.filepath))

    let deployment
    try {
      deployment = await getDeployment(db, parentFolder)

      if (deployment) {
        // Update deployment date range if necessary
        db.run(
          'UPDATE deployments SET deploymentStart = ?, deploymentEnd = ? WHERE deploymentID = ?',
          [
            DateTime.min(date, DateTime.fromISO(deployment.deploymentStart)).toISO(),
            DateTime.max(date, DateTime.fromISO(deployment.deploymentEnd)).toISO(),
            deployment.deploymentID
          ]
        )
      } else {
        // Create new deployment
        const deploymentID = crypto.randomUUID()
        const locationID = parentFolder
        log.info('Creating new deployment at:', locationID, latitude, longitude)
        db.run(
          'INSERT INTO deployments (deploymentID, locationID, locationName, deploymentStart, deploymentEnd, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [deploymentID, locationID, locationID, date.toISO(), date.toISO(), latitude, longitude]
        )
        deployment = {
          deploymentID,
          latitude,
          longitude
        }
      }

      // Update media with timestamp and deploymentID
      db.run('UPDATE media SET timestamp = ?, deploymentID = ? WHERE mediaID = ?', [
        date.toISO(),
        deployment.deploymentID,
        media.mediaID
      ])

      // Update local media object for observation creation
      media.timestamp = date.toISO()
      media.deploymentID = deployment.deploymentID
    } catch (error) {
      log.error(`Error processing EXIF data for ${prediction.filepath}:`, error)
      return
    }
  }

  const isblank = ['blank', 'no cv result'].includes(prediction.prediction.split(';').at(-1))
  const scientificName =
    prediction.prediction.split(';').at(-3) + ' ' + prediction.prediction.split(';').at(-2)

  const observation = {
    observationID: crypto.randomUUID(),
    mediaID: media.mediaID,
    deploymentID: media.deploymentID,
    eventID: crypto.randomUUID(),
    eventStart: media.timestamp,
    eventEnd: media.timestamp,
    scientificName: isblank
      ? undefined
      : scientificName.trim() === ''
        ? prediction.prediction.split(';').at(-1)
        : scientificName,
    confidence: prediction.prediction_score,
    count: 1,
    prediction: prediction.prediction
  }

  insertInto(db, 'observations', observation)
}

async function nextMediaToPredict(db, batchSize = 100) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT m.mediaID, m.filePath, m.fileName, m.timestamp, m.deploymentID
       FROM media m
       LEFT JOIN observations o ON m.mediaID = o.mediaID
       WHERE o.observationID IS NULL
       AND m.mediaID IS NOT NULL
       LIMIT ?`,
      [batchSize],
      (err, rows) => {
        if (err) {
          reject(err)
          return
        }
        resolve(
          rows.map((row) => ({
            mediaID: row.mediaID,
            deploymentID: row.deploymentID,
            timestamp: row.timestamp,
            filePath: row.filePath,
            fileName: row.fileName
          }))
        )
      }
    )
  })
}

function getDeployment(db, locationID) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM deployments WHERE locationID = ?', [locationID], (err, row) => {
      if (err) {
        reject(err)
        return
      }
      resolve(row)
    })
  })
}

function setupDatabase(db) {
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS deployments (
        deploymentID TEXT PRIMARY KEY,
        locationID TEXT,
        locationName TEXT,
        deploymentStart TEXT,
        deploymentEnd TEXT,
        latitude REAL,
        longitude REAL
      )`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS media (
        mediaID TEXT PRIMARY KEY,
        deploymentID TEXT,
        timestamp TEXT,
        filePath TEXT,
        fileName TEXT,
        importFolder TEXT,
        folderName TEXT,
        FOREIGN KEY (deploymentID) REFERENCES deployments(deploymentID)
      )`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS observations (
        observationID TEXT PRIMARY KEY,
        mediaID TEXT,
        deploymentID TEXT,
        eventID TEXT,
        eventStart TEXT,
        eventEnd TEXT,
        scientificName TEXT,
        observationType TEXT,
        confidence REAL,
        count INTEGER,
        prediction TEXT,
        FOREIGN KEY (mediaID) REFERENCES media(mediaID),
        FOREIGN KEY (deploymentID) REFERENCES deployments(deploymentID)
      )`
    )
  })
}

let lastBatchDuration = null
const batchSize = 5

export class Importer {
  constructor(id, folder) {
    this.id = id
    this.folder = folder
    this.pythonProcess = null
    this.batchSize = batchSize
  }

  async cleanup() {
    log.info(`Cleaning up importer with ID ${this.id}`)
    if (this.pythonProcess) {
      return await models.stopMLModelHTTPServer({ pid: this.pythonProcess.pid })
    }
    return Promise.resolve() // Return resolved promise if no process to kill
  }

  async start(addingMore = false) {
    try {
      const dbPath = path.join(
        app.getPath('userData'),
        'biowatch-data',
        'studies',
        this.id,
        'study.db'
      )
      if (!fs.existsSync(dbPath)) {
        log.info(`Database not found at ${dbPath}, creating new one`)
        // Ensure the directory exists
        const dbDir = path.dirname(dbPath)
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true })
        }
        this.db = new sqlite3.Database(dbPath)
        setupDatabase(this.db)

        log.info('scanning images in folder:', this.folder)

        for await (const imagePath of walkImages(this.folder)) {
          await insertMedia(this.db, imagePath, this.folder)
        }
      } else {
        this.db = new sqlite3.Database(dbPath)
        if (addingMore) {
          log.info('scanning images in folder:', this.folder)

          for await (const imagePath of walkImages(this.folder)) {
            await insertMedia(this.db, imagePath, this.folder)
          }
        }
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
        this.cleanup()
      }
    } catch (error) {
      console.error('Error starting importer:', error)
      this.cleanup()
    }
  }
}

let importers = {}

async function status(id) {
  const dbPath = path.join(app.getPath('userData'), 'biowatch-data', 'studies', id, 'study.db')
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err)
        return
      }

      // Get total count of media
      db.get(
        `SELECT COUNT(*) as mediaCount FROM media WHERE mediaID IS NOT NULL`,
        (err, mediaRow) => {
          if (err) {
            db.close()
            reject(err)
            return
          }

          // Get count of observations
          db.get(
            `SELECT COUNT(*) as obsCount FROM observations WHERE observationID IS NOT NULL`,
            (err, obsRow) => {
              if (err) {
                db.close()
                reject(err)
                return
              }

              const remain = mediaRow.mediaCount - obsRow.obsCount
              const estimatedMinutesRemaining = lastBatchDuration
                ? (remain * lastBatchDuration) / batchSize / 60
                : null

              const speed = lastBatchDuration ? (batchSize / lastBatchDuration) * 60 : null

              // Resolve with both counts
              resolve({
                total: mediaRow.mediaCount,
                done: obsRow.obsCount,
                isRunning: !!importers[id],
                estimatedMinutesRemaining: estimatedMinutesRemaining,
                speed: Math.round(speed)
              })

              db.close()
            }
          )
        }
      )
    })
  })
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

ipcMain.handle('importer:select-more-images-directory', async (event, id) => {
  if (importers[id]) {
    log.warn(`No importer found with ID ${id}`)
    return { success: false, message: 'Importer already running' }
  }

  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Images Directory'
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: 'Selection canceled' }
  }

  const directoryPath = result.filePaths[0]
  const importer = new Importer(id, directoryPath)
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
