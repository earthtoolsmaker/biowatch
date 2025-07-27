import fs from 'fs'
import path from 'path'
import csv from 'csv-parser'
import { DateTime } from 'luxon'
import { openDatabase, closeDatabase, setupDatabase } from './db.js'

// Conditionally import electron modules for production, use fallback for testing
let app, log

// Initialize electron modules with proper async handling
async function initializeElectronModules() {
  if (app && log) return // Already initialized

  try {
    const electron = await import('electron')
    app = electron.app
    const electronLog = await import('electron-log')
    log = electronLog.default
  } catch {
    // Fallback for testing environment
    app = {
      getPath: () => '/tmp'
    }
    log = {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {}
    }
  }
}

/**
 * Import Wildlife Insights dataset from a directory into a SQLite database
 * @param {string} directoryPath - Path to the Wildlife Insights dataset directory
 * @param {string} id - Unique ID for the study
 * @returns {Promise<Object>} - Object containing study data
 */
export async function importWildlifeDataset(directoryPath, id) {
  await initializeElectronModules()
  const biowatchDataPath = path.join(app.getPath('userData'), 'biowatch-data')
  return await importWildlifeDatasetWithPath(directoryPath, biowatchDataPath, id)
}

/**
 * Import Wildlife Insights dataset from a directory into a SQLite database (core function)
 * @param {string} directoryPath - Path to the Wildlife Insights dataset directory
 * @param {string} biowatchDataPath - Path to the biowatch-data directory
 * @param {string} id - Unique ID for the study
 * @returns {Promise<Object>} - Object containing study data
 */
export async function importWildlifeDatasetWithPath(directoryPath, biowatchDataPath, id) {
  await initializeElectronModules()
  log.info('Starting Wildlife dataset import')

  // Create database in the specified biowatch-data directory
  const dbPath = path.join(biowatchDataPath, 'studies', id, 'study.db')
  log.info(`Creating database at: ${dbPath}`)

  // Ensure the directory exists
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const db = await openDatabase(dbPath)
  setupDatabase(db)

  // Get dataset name from projects.csv
  const projectCSV = path.join(directoryPath, 'projects.csv')
  let data = {}

  if (fs.existsSync(projectCSV)) {
    try {
      await new Promise((resolve, reject) => {
        fs.createReadStream(projectCSV)
          .pipe(csv())
          .on('data', (project) => {
            data = {
              name: project.project_short_name || path.basename(directoryPath),
              importerName: 'wildlife/folder',
              data: {
                name: project.project_short_name || path.basename(directoryPath),
                description: project.project_objectives,
                contributors: [
                  {
                    title: project.project_admin,
                    role: 'Administrator',
                    organization: project.project_admin_organization,
                    email: project.project_admin_email
                  }
                ]
              }
            }
          })
          .on('end', resolve)
          .on('error', reject)
      })
    } catch (error) {
      log.warn('Error reading projects.csv, using fallback data:', error)
    }
  } else {
    log.warn('projects.csv not found, using directory name as study name')
  }

  // Create and populate deployments table
  try {
    log.info('Created deployments table')

    // Import deployments data
    const deploymentsCSV = path.join(directoryPath, 'deployments.csv')
    if (fs.existsSync(deploymentsCSV)) {
      log.info('Importing deployments data')

      await insertDeployments(db, deploymentsCSV)

      log.info('Deployments data imported successfully in', dbPath)
    } else {
      log.warn('deployments.csv not found in directory')
    }
  } catch (error) {
    log.error('Error creating deployments table:', error)
  }

  // Create and populate media table
  try {
    log.info('Creating and populating media table')

    // Import media data from images.csv
    const imagesCSV = path.join(directoryPath, 'images.csv')
    if (fs.existsSync(imagesCSV)) {
      log.info('Importing media data from images.csv')
      await insertMedia(db, imagesCSV)
      log.info('Media data imported successfully in', dbPath)

      // Import observations data from the same images.csv
      log.info('Importing observations data from images.csv')
      await insertObservations(db, imagesCSV)
      log.info('Observations data imported successfully in', dbPath)
    } else {
      log.warn('images.csv not found in directory')
    }
  } catch (error) {
    log.error('Error importing media data:', error)
  }

  // Create study.json file with the data
  fs.writeFileSync(
    path.join(biowatchDataPath, 'studies', id, 'study.json'),
    JSON.stringify(data, null, 2)
  )

  console.log('returning Data:', data)

  closeDatabase(db)

  return {
    data
  }
}

function insertDeployments(db, deploymentsCSV) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(deploymentsCSV).pipe(csv())
    let rowCount = 0

    db.run('BEGIN TRANSACTION', async (err) => {
      if (err) {
        log.error(`Error starting transaction: ${err.message}`)
        return reject(err)
      }

      log.debug('Started transaction for bulk insert')

      const insertSql = `INSERT INTO deployments (deploymentID, locationID, locationName,
                         deploymentStart, deploymentEnd, latitude, longitude)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`

      try {
        stream.on('data', async (row) => {
          const startDate = DateTime.fromSQL(row.start_date)
          const endDate = DateTime.fromSQL(row.end_date)

          const values = [
            row.deployment_id,
            row.latitude + ' ' + row.longitude,
            row.deployment_id,
            startDate.isValid ? startDate.toISO() : null,
            endDate.isValid ? endDate.toISO() : null,
            row.latitude,
            row.longitude
          ]
          try {
            await runQuery(db, insertSql, values)
            rowCount++
            if (rowCount % 1000 === 0) {
              log.debug(`Inserted ${rowCount} rows into deployments`)
            }
          } catch (error) {
            log.error(`Error inserting row: ${error.message}`)
            throw error
          }
        })

        stream.on('end', () => {
          db.run('COMMIT', (err) => {
            if (err) {
              log.error(`Error committing transaction: ${err.message}`)
              db.run('ROLLBACK')
              return reject(err)
            }
            log.info(`Completed insertion of ${rowCount} rows into deployments`)
            resolve()
          })
        })

        stream.on('error', (error) => {
          log.error(`Error during CSV data insertion: ${error.message}`)
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

/**
 * Insert media data from images.csv into the media table
 * @param {Object} db - Database connection
 * @param {string} csvPath - Path to the CSV file
 */
async function insertMedia(db, csvPath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(csvPath).pipe(csv())
    let rowCount = 0

    // Begin transaction for better performance
    db.run('BEGIN TRANSACTION', async (err) => {
      if (err) {
        log.error(`Error starting transaction: ${err.message}`)
        return reject(err)
      }

      log.debug('Started transaction for media bulk insert')

      const insertSql = `INSERT OR IGNORE INTO media (mediaID, deploymentID, timestamp, filePath, fileName)
                        VALUES (?, ?, ?, ?, ?)`

      try {
        stream.on('data', async (row) => {
          const timestamp = DateTime.fromSQL(row.timestamp)
          const values = [
            row.image_id || null,
            row.deployment_id || null,
            timestamp.isValid ? timestamp.toISO() : null,
            row.location || null,
            row.filename || null
          ]

          if (!row.image_id) {
            return
          }

          try {
            await runQuery(db, insertSql, values)
            rowCount++
            if (rowCount % 1000 === 0) {
              log.debug(`Inserted ${rowCount} rows into media`)
            }
          } catch (error) {
            log.error(`Error inserting media row: ${error.message}`, row)
            throw error
          }
        })

        stream.on('end', () => {
          db.run('COMMIT', (commitErr) => {
            if (commitErr) {
              log.error(`Error committing transaction: ${commitErr.message}`)
              db.run('ROLLBACK')
              return reject(commitErr)
            }
            log.info(`Completed insertion of ${rowCount} rows into media`)
            resolve()
          })
        })

        stream.on('error', (error) => {
          log.error(`Error during media CSV data insertion: ${error.message}`)
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

/**
 * Insert observations data from images.csv into the observations table
 * @param {Object} db - Database connection
 * @param {string} csvPath - Path to the CSV file
 */
async function insertObservations(db, csvPath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(csvPath).pipe(csv())
    let rowCount = 0

    // Begin transaction for better performance
    db.run('BEGIN TRANSACTION', async (err) => {
      if (err) {
        log.error(`Error starting transaction: ${err.message}`)
        return reject(err)
      }

      log.debug('Started transaction for observations bulk insert')

      const insertSql = `INSERT OR IGNORE INTO observations (observationID, mediaID, deploymentID, eventID,
                         eventStart, eventEnd, scientificName, commonName, confidence, count, prediction,
                         lifeStage, age, sex, behavior)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

      try {
        stream.on('data', async (row) => {
          // Only insert rows that have taxonomic information or are identified as blank/vehicle etc
          if (!row.image_id || (!row.genus && !row.species && !row.common_name)) {
            return
          }

          // Create scientific name from genus and species
          let scientificName = null
          if (row.genus && row.species) {
            scientificName = `${row.genus} ${row.species}`
          } else if (row.common_name && row.common_name !== 'Blank') {
            scientificName = row.common_name
          }

          // Parse timestamp to ISO format
          const timestamp = DateTime.fromSQL(row.timestamp)

          const values = [
            `${row.image_id}_obs`, // Create unique observation ID
            row.image_id || null,
            row.deployment_id || null,
            row.sequence_id || null,
            timestamp.isValid ? timestamp.toISO() : null, // eventStart as ISO
            timestamp.isValid ? timestamp.toISO() : null, // eventEnd as ISO
            scientificName,
            row.common_name || null,
            row.cv_confidence ? parseFloat(row.cv_confidence) : null,
            row.number_of_objects ? parseInt(row.number_of_objects) : 1,
            row.common_name || null,
            row.age || null, // lifeStage - using age column from CSV
            row.age || null, // age
            row.sex || null, // sex
            row.behavior || null // behavior
          ]

          try {
            await runQuery(db, insertSql, values)
            rowCount++
            if (rowCount % 1000 === 0) {
              log.debug(`Inserted ${rowCount} rows into observations`)
            }
          } catch (error) {
            log.error(`Error inserting observation row: ${error.message}`, row)
            throw error
          }
        })

        stream.on('end', () => {
          db.run('COMMIT', (commitErr) => {
            if (commitErr) {
              log.error(`Error committing transaction: ${commitErr.message}`)
              db.run('ROLLBACK')
              return reject(commitErr)
            }
            log.info(`Completed insertion of ${rowCount} rows into observations`)
            resolve()
          })
        })

        stream.on('error', (error) => {
          log.error(`Error during observations CSV data insertion: ${error.message}`)
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
