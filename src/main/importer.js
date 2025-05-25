import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import { spawn, exec } from 'child_process'
import kill from 'tree-kill'
import os from 'os'
import sqlite3 from 'sqlite3'
import { app } from 'electron'
import exifr from 'exifr'
import luxon, { DateTime } from 'luxon'
import geoTz from 'geo-tz'

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'])

function isWindows() {
  return os.platform() === 'win32'
}

function countImagesNative(dir) {
  if (isWindows()) {
    // Windows: use PowerShell
    const cmd = `powershell -Command "Get-ChildItem -Recurse -File '${dir}' | Where-Object { $_.Extension -match '\\.(jpg|jpeg|png|gif|bmp|webp)$' } | Measure-Object | Select-Object -ExpandProperty Count"`
    return new Promise((resolve, reject) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) return reject(err)
        resolve(parseInt(stdout.trim(), 10))
      })
    })
  } else {
    // Unix-based: use `find`
    const cmd = `find ${JSON.stringify(dir)} -type f \\( -iname "*.jpg" -o -iname "*.png" -o -iname "*.jpeg" -o -iname "*.gif" -o -iname "*.bmp" -o -iname "*.webp" \\) | wc -l`
    return new Promise((resolve, reject) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) return reject(err)
        resolve(parseInt(stdout.trim(), 10))
      })
    })
  }
}

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
    const fullPath = path.join(dir, dirent.name)
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

export async function importImagesFromDirectory(directoryPath) {
  const images = []
  try {
    for await (const imagePath of walkImages(directoryPath)) {
      images.push(imagePath)
    }
    console.log(`Found &&&&&&&&&& ${images.length} images in directory: ${directoryPath}`)
    return images
  } catch (error) {
    console.error('Error reading directory:', error)
    throw new Error('Failed to read images from directory')
  }
}

async function startServer() {
  const scriptPath = path.join(__dirname, '../../test-species/run_server.py')
  const pythonInterpreter = path.join(__dirname, '../../test-species/.venv/bin/python')

  // Start the Python server
  const pythonProcess = spawn(pythonInterpreter, [scriptPath, '--port', '8000'])

  log.info('Python process started:', pythonProcess.pid)

  // Set up error handlers
  pythonProcess.stderr.on('data', (err) => {
    log.error('Python error:', err.toString())
  })

  pythonProcess.on('error', (err) => {
    log.error('Python process error:', err)
  })

  // Wait for server to be ready by polling the endpoint
  const maxRetries = 30
  const retryInterval = 1000 // 1 second

  for (let i = 0; i < maxRetries; i++) {
    try {
      const healthCheck = await fetch('http://localhost:8000/health', {
        method: 'GET',
        timeout: 1000
      })

      if (healthCheck.ok) {
        log.info('Server is ready')
        return pythonProcess
      }
    } catch (error) {
      // Server not ready yet, will retry
    }

    // Wait before next retry
    await new Promise((resolve) => setTimeout(resolve, retryInterval))
    log.info(`Waiting for server to start (attempt ${i + 1}/${maxRetries})`)
  }

  // If we get here, the server failed to start
  kill(pythonProcess.pid)
  throw new Error('Server failed to start in the expected time')
}

export async function* getPredictions(imagesPath) {
  log.info('images', imagesPath)

  try {
    // Send request and handle streaming response
    const response = await fetch('http://localhost:8000/predict', {
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
  // Extract keys and values from the data object
  const keys = Object.keys(data)
  const values = Object.values(data)

  // Create placeholders for the SQL query (?, ?, ?)
  const placeholders = keys.map(() => '?').join(', ')

  // Construct the SQL query
  const query = `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`

  // Execute the query
  db.run(query, values, function (err) {
    if (err) {
      log.error(`Error inserting into ${tableName}:`, err)
    }
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
async function insertPrediction(db, folder, prediction) {
  const fullPath = prediction.filepath
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
    latitude = exifData.latitude
    longitude = exifData.longitude
  }

  const [timeZone] = geoTz.find(latitude, longitude)

  const date = luxon.DateTime.fromJSDate(exifData.DateTimeOriginal, {
    zone: timeZone
  })

  let deployment
  try {
    deployment = await getDeployment(db, latitude, longitude)
    console.log('deployment***', deployment)

    if (deployment) {
      // If a deployment exists, update the start or end time if necessary
      db.run(
        'UPDATE deployments SET deploymentStart = ?, deploymentEnd = ? WHERE deploymentID = ?',
        [
          DateTime.min(date, DateTime.fromISO(deployment.deploymentStart)).toISO(),
          DateTime.max(date, DateTime.fromISO(deployment.deploymentEnd)).toISO(),
          deployment.deploymentID
        ]
      )
    } else {
      // If no deployment exists, create a new one
      const deploymentID = crypto.randomUUID()
      const locationID = crypto.randomUUID()
      console.log('Creating new deployment with at: ', latitude, longitude)
      db.run(
        'INSERT INTO deployments (deploymentID, locationID, locationName, deploymentStart, deploymentEnd, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [deploymentID, locationID, null, date.toISO(), date.toISO(), latitude, longitude]
      )
      deployment = {
        deploymentID,
        latitude,
        longitude
      }
    }

    const media = {
      mediaID: crypto.randomUUID(),
      deploymentID: deployment.deploymentID,
      timestamp: date.toISO(),
      filePath: fullPath.replace(folder, ''),
      fileName: fullPath.split(path.sep).pop()
    }

    insertInto(db, 'media', media)

    const isblank = ['blank', 'no cv result'].includes(prediction.prediction.split(';').at(-1))
    const scientificName =
      prediction.prediction.split(';').at(-3) + ' ' + prediction.prediction.split(';').at(-2)

    const observation = {
      observationID: crypto.randomUUID(),
      mediaID: media.mediaID,
      deploymentID: deployment.deploymentID,
      eventID: crypto.randomUUID(),
      eventStart: date.toISO(),
      eventEnd: date.toISO(),
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
    log.info(`Inserted prediction for ${media.fileName} into database`)
  } catch (error) {
    log.error(`Error handling deployment for ${fullPath}:`, error)
  }
}

function getDeployment(db, latitude, longitude) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM deployments WHERE latitude = ? AND longitude = ?',
      [latitude, longitude],
      (err, row) => {
        if (err) {
          reject(err)
          return
        }
        resolve(row)
      }
    )
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
        confidence REAL,
        count INTEGER,
        prediction TEXT,
        FOREIGN KEY (mediaID) REFERENCES media(mediaID),
        FOREIGN KEY (deploymentID) REFERENCES deployments(deploymentID)
      )`
    )
  })
}

function getTemporalData(db) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT MIN(deploymentStart) as startDate, MAX(deploymentEnd) as endDate FROM deployments`,
      (err, row) => {
        if (err) {
          reject(err)
          return
        }
        resolve({
          start: DateTime.fromISO(row?.startDate).toFormat('dd LLL yyyy') || null,
          end: DateTime.fromISO(row?.endDate).toFormat('dd LLL yyyy') || null
        })
      }
    )
  })
}

export class Importer {
  constructor(folder) {
    this.id = crypto.randomUUID()
    this.folder = folder
    this.pythonProcess = null
    this.imageQueue = []
    this.totalImages = 0
    this.batchSize = 100
    this.processedImages = 0
    const dbPath = path.join(app.getPath('userData'), `${this.id}.db`)
    this.db = new sqlite3.Database(dbPath)
  }

  cleanup() {
    if (this.pythonProcess) {
      kill(this.pythonProcess.pid)
    }
  }

  async startServer() {
    try {
      this.pythonProcess = await startServer()
      log.info('Python server started successfully')
    } catch (error) {
      log.error('Error starting Python server:', error)
      throw error
    }
  }

  async start() {
    try {
      this.totalImages = await countImagesNative(this.folder)
      setupDatabase(this.db)
      // const deployments = await getDeployments(this.folder)
      // console.log('Deployments found:', deployments)
      // console.dir(deployments, { depth: null, colors: true })
      await this.startServer()

      for await (const imagePath of walkImages(this.folder)) {
        this.imageQueue.push(imagePath)
        if (this.imageQueue.length >= this.batchSize) {
          for await (const prediction of getPredictions(this.imageQueue)) {
            insertPrediction(this.db, this.folder, prediction)
            this.processedImages++
            log.info(
              'current progress percent: ',
              ((this.processedImages / this.totalImages) * 100).toFixed(2) + '%'
            )
          }
          log.info(`Processed batch of ${this.imageQueue.length} images`)
          this.imageQueue = []
        }
      }

      // Process any remaining images in the queue
      if (this.imageQueue.length > 0) {
        for await (const prediction of getPredictions(this.imageQueue)) {
          insertPrediction(this.db, this.folder, prediction)
          this.processedImages++
        }
        log.info(`Processed final batch of ${this.imageQueue.length} images`)
      }

      log.info(`Processed ${this.processedImages} out of ${this.totalImages} images`)
      this.cleanup()

      // Get temporal data from database
      const temporalData = await getTemporalData(this.db)

      return {
        path: this.folder,
        data: {
          name: 'imported study 1',
          title: 'Imported Study 1',
          temporal: temporalData
        },
        id: this.id
      }
    } catch (error) {
      console.error('Error starting importer:', error)
      this.cleanup()
    }
  }
}
