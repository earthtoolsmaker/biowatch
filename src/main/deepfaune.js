import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import sqlite3 from 'sqlite3'
import csv from 'csv-parser'
import log from 'electron-log'
import { DateTime } from 'luxon'
import crypto from 'crypto'

/**
 * Import Deepfaune CSV dataset from a CSV file into a SQLite database
 * @param {string} csvPath - Path to the Deepfaune CSV file
 * @param {string} id - Unique ID for the study
 * @returns {Promise<Object>} - Object containing study data
 */
export async function importDeepfauneDataset(csvPath, id) {
  log.info('Starting Deepfaune CSV dataset import')

  // Create database in app's user data directory
  const dbPath = path.join(app.getPath('userData'), 'biowatch-data', 'studies', id, 'study.db')
  log.info(`Creating database at: ${dbPath}`)

  // Ensure the directory exists
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const db = await openDatabase(dbPath)
  setupDatabase(db)

  // Extract study information from CSV file name and path
  const csvFileName = path.basename(csvPath, '.csv')
  const data = {
    name: csvFileName,
    importerName: 'deepfaune/csv',
    data: {
      name: csvFileName
    }
  }

  fs.writeFileSync(
    path.join(app.getPath('userData'), 'biowatch-data', 'studies', id, 'study.json'),
    JSON.stringify(data, null, 2)
  )

  try {
    log.info('Processing Deepfaune CSV data')

    // First pass: collect unique deployment folders
    const deploymentFolders = new Set()
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(csvPath).pipe(csv())

      stream.on('data', (row) => {
        if (row.filename && row.date && row.date !== 'NA' && row.date !== '') {
          // Handle cross-platform paths - convert to current platform format
          // First normalize separators, then resolve to current platform
          const normalizedPath = row.filename.replace(/\\/g, '/')
          const platformPath = path.normalize(normalizedPath)
          // Extract folder path from normalized filename
          const folderPath = path.dirname(platformPath)
          console.log(`Found deployment folder: ${folderPath} - ${row.filename}`)
          deploymentFolders.add(folderPath)
        }
      })

      stream.on('end', resolve)
      stream.on('error', reject)
    })

    log.info(`Found ${deploymentFolders.size} unique deployment locations`)

    // Create deployments
    await insertDeepfauneDeployments(db, Array.from(deploymentFolders))

    // Import media and observations data
    await insertDeepfauneData(db, csvPath)

    log.info('Deepfaune dataset imported successfully')
  } catch (error) {
    log.error('Error importing Deepfaune dataset:', error)
    await closeDatabase(db)
    throw error
  }

  await closeDatabase(db)
  return { data }
}

/**
 * Insert deployments for Deepfaune CSV data
 * @param {Object} db - Database connection
 * @param {Array<string>} deploymentFolders - Array of unique folder paths
 */
async function insertDeepfauneDeployments(db, deploymentFolders) {
  return new Promise((resolve, reject) => {
    db.run('BEGIN TRANSACTION', async (err) => {
      if (err) {
        log.error(`Error starting transaction: ${err.message}`)
        return reject(err)
      }

      log.debug('Started transaction for deployments bulk insert')

      const insertSql = `INSERT INTO deployments (deploymentID, locationID, locationName,
                         deploymentStart, deploymentEnd, latitude, longitude)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`

      try {
        for (const folderPath of deploymentFolders) {
          const deploymentID = crypto.randomUUID()
          const locationName = path.basename(folderPath) || folderPath

          const values = [
            deploymentID,
            folderPath,
            locationName,
            null, // Will be updated when processing media
            null, // Will be updated when processing media
            null, // No GPS data in CSV
            null // No GPS data in CSV
          ]

          await runQuery(db, insertSql, values)
        }

        db.run('COMMIT', (commitErr) => {
          if (commitErr) {
            log.error(`Error committing transaction: ${commitErr.message}`)
            db.run('ROLLBACK')
            return reject(commitErr)
          }
          log.info(`Completed insertion of ${deploymentFolders.length} deployments`)
          resolve()
        })
      } catch (error) {
        db.run('ROLLBACK')
        reject(error)
      }
    })
  })
}

/**
 * Insert media and observations data from Deepfaune CSV
 * @param {Object} db - Database connection
 * @param {string} csvPath - Path to the CSV file
 */
async function insertDeepfauneData(db, csvPath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(csvPath).pipe(csv())
    let rowCount = 0

    // Begin transaction for better performance
    db.run('BEGIN TRANSACTION', async (err) => {
      if (err) {
        log.error(`Error starting transaction: ${err.message}`)
        return reject(err)
      }

      log.debug('Started transaction for Deepfaune data bulk insert')

      const mediaInsertSql = `INSERT OR IGNORE INTO media (mediaID, deploymentID, timestamp, filePath, fileName)
                              VALUES (?, ?, ?, ?, ?)`

      const observationInsertSql = `INSERT OR IGNORE INTO observations (observationID, mediaID, deploymentID, eventID,
                                     eventStart, eventEnd, scientificName, commonName, confidence, count, prediction,
                                     lifeStage, age, sex, behavior)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

      // Helper function to get deployment by folder path
      const getDeploymentByFolder = (folderPath) => {
        return new Promise((resolve, reject) => {
          db.get('SELECT * FROM deployments WHERE locationID = ?', [folderPath], (err, row) => {
            if (err) reject(err)
            else resolve(row)
          })
        })
      }

      // Helper function to update deployment date range
      const updateDeploymentDateRange = (deploymentID, timestamp) => {
        return new Promise((resolve, reject) => {
          // Get current deployment dates
          db.get(
            'SELECT deploymentStart, deploymentEnd FROM deployments WHERE deploymentID = ?',
            [deploymentID],
            (err, row) => {
              if (err) return reject(err)

              const currentStart = row.deploymentStart
                ? DateTime.fromISO(row.deploymentStart)
                : null
              const currentEnd = row.deploymentEnd ? DateTime.fromISO(row.deploymentEnd) : null
              const newDate = timestamp

              const newStart = !currentStart || newDate < currentStart ? newDate : currentStart
              const newEnd = !currentEnd || newDate > currentEnd ? newDate : currentEnd

              db.run(
                'UPDATE deployments SET deploymentStart = ?, deploymentEnd = ? WHERE deploymentID = ?',
                [newStart.toISO(), newEnd.toISO(), deploymentID],
                (updateErr) => {
                  if (updateErr) reject(updateErr)
                  else resolve()
                }
              )
            }
          )
        })
      }

      try {
        stream.on('data', async (row) => {
          if (!row.filename || !row.date || row.date === 'NA' || row.date === '') {
            return // Skip rows without required data or missing dates
          }

          // Parse timestamp from the date field (format: "2019:05:14 17:14:52")
          const timestamp = DateTime.fromFormat(row.date, 'yyyy:MM:dd HH:mm:ss')
          if (!timestamp.isValid) {
            log.warn(`Invalid timestamp format: ${row.date}`)
            return
          }

          // Handle cross-platform paths - convert to current platform format
          const normalizedPath = row.filename.replace(/\\/g, '/')
          const platformPath = path.normalize(normalizedPath)
          const folderPath = path.dirname(platformPath)
          const fileName = path.basename(platformPath)

          // Get deployment for this folder
          const deployment = await getDeploymentByFolder(folderPath)
          if (!deployment) {
            log.warn(`No deployment found for folder: ${folderPath}`)
            return
          }

          // Update deployment date range
          await updateDeploymentDateRange(deployment.deploymentID, timestamp)

          // Insert media record
          const mediaID = crypto.randomUUID()
          const mediaValues = [
            mediaID,
            deployment.deploymentID,
            timestamp.toISO(),
            row.filename,
            fileName
          ]

          await runQuery(db, mediaInsertSql, mediaValues)

          // Insert observation record if there's a prediction
          if (row.prediction && row.prediction !== '') {
            const observationID = `${mediaID}_obs`
            const confidence = row.score ? parseFloat(row.score) : null
            const count = row.humancount ? parseInt(row.humancount) : 1

            const observationValues = [
              observationID,
              mediaID,
              deployment.deploymentID,
              row.seqnum || null, // Use sequence number as eventID
              timestamp.toISO(), // eventStart
              timestamp.toISO(), // eventEnd
              row.prediction, // Use prediction as scientificName
              row.prediction, // Use prediction as commonName too
              confidence,
              count,
              row.prediction, // prediction field
              null, // lifeStage
              null, // age
              null, // sex
              null // behavior
            ]

            await runQuery(db, observationInsertSql, observationValues)
          }

          rowCount++
          if (rowCount % 1000 === 0) {
            log.debug(`Processed ${rowCount} rows from Deepfaune CSV`)
          }
        })

        stream.on('end', () => {
          db.run('COMMIT', (commitErr) => {
            if (commitErr) {
              log.error(`Error committing transaction: ${commitErr.message}`)
              db.run('ROLLBACK')
              return reject(commitErr)
            }
            log.info(`Completed processing of ${rowCount} rows from Deepfaune CSV`)
            resolve()
          })
        })

        stream.on('error', (error) => {
          log.error(`Error during Deepfaune CSV data insertion: ${error.message}`)
          db.run('ROLLBACK')
          reject(error)
        })
      } catch (error) {
        db.run('ROLLBACK')
        reject(error)
      }
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
        commonName TEXT,
        confidence REAL,
        count INTEGER,
        prediction TEXT,
        lifeStage TEXT,
        age TEXT,
        sex TEXT,
        behavior TEXT,
        FOREIGN KEY (mediaID) REFERENCES media(mediaID),
        FOREIGN KEY (deploymentID) REFERENCES deployments(deploymentID)
      )`
    )
  })
}

/**
 * Open a SQLite database
 * @param {string} dbPath - Path to the database file
 * @returns {Promise<sqlite3.Database>} - Database instance
 */
function openDatabase(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        log.error(`Error opening database: ${err.message}`)
        reject(err)
      } else {
        resolve(db)
      }
    })
  })
}

/**
 * Close a SQLite database
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<void>}
 */
function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        log.error(`Error closing database: ${err.message}`)
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

/**
 * Run a SQLite query
 * @param {sqlite3.Database} db - Database instance
 * @param {string} query - SQL query
 * @param {Array} params - Parameters for the query
 * @returns {Promise<void>}
 */
function runQuery(db, query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) {
        log.error(`Error executing query: ${err.message}`)
        reject(err)
      } else {
        resolve(this)
      }
    })
  })
}
