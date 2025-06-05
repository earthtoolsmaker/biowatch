import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import sqlite3 from 'sqlite3'
import csv from 'csv-parser'
import log from 'electron-log'
import { DateTime } from 'luxon'

/**
 * Import CamTrapDP dataset from a directory into a SQLite database
 * @param {string} directoryPath - Path to the CamTrapDP dataset directory
 * @returns {Promise<Object>} - Object containing dbPath and name
 */
export async function importWildlifeDataset(directoryPath, id) {
  log.info('Starting Wildlife dataset import')
  // Create database in app's user data directory
  const dbPath = path.join(app.getPath('userData'), `${id}.db`)
  log.info(`Creating database at: ${dbPath}`)

  // Create database connection
  const db = await openDatabase(dbPath)
  setupDatabase(db)

  // Get dataset name from datapackage.json
  // {
  //   title, description, name, contributors{title, role, organization, email}, temporal.start, temporal.end
  // }
  const projectCSV = path.join(directoryPath, 'projects.csv')
  let data = {}
  fs.createReadStream(projectCSV)
    .pipe(csv())
    .on('data', (project) => {
      data = {
        name: project.project_short_name,
        title: project.project_name,
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
      console.log('Project data:', project, data)
    })
  // .on('end', () => {})

  // Create and populate deployments table
  try {
    log.info('Created deployments table')

    // Import deployments data
    const deploymentsCSV = path.join(directoryPath, 'deployments.csv')
    if (fs.existsSync(deploymentsCSV)) {
      log.info('Importing deployments data')

      const columns = [
        'deploymentID',
        'locationID',
        'locationName',
        'deploymentStart',
        'deploymentEnd',
        'latitude',
        'longitude'
      ]
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

  console.log('returning Data:', data)

  return {
    data
  }

  // try {
  //   const datapackagePath = path.join(directoryPath, 'datapackage.json')
  //   if (fs.existsSync(datapackagePath)) {
  //     const datapackage = JSON.parse(fs.readFileSync(datapackagePath, 'utf8'))
  //     data = datapackage
  //   } else {
  //     log.warn('datapackage.json not found in directory')
  //     return {
  //       error: 'datapackage.json not found in directory'
  //     }
  //   }
  // } catch (error) {
  //   log.error('Error reading datapackage.json:', error)
  // }

  // log.info(`Using dataset directory: ${directoryPath}`)

  // try {
  //   // Get all CSV files in the directory
  //   const files = fs.readdirSync(directoryPath).filter((file) => file.endsWith('.csv'))
  //   log.info(`Found ${files.length} CSV files to import`)

  //   // Process each CSV file
  //   for (const file of files) {
  //     const filePath = path.join(directoryPath, file)
  //     const tableName = path.basename(file, '.csv')
  //     log.info(`Processing file: ${file} into table: ${tableName}`)

  //     // Read the first row to get column names
  //     const columns = await getCSVColumns(filePath)
  //     log.debug(`Found ${columns.length} columns in ${file}`)

  //     // Create table
  //     const columnDefs = columns.map((col) => `"${col}" TEXT`).join(', ')
  //     await runQuery(db, `CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefs})`)
  //     log.debug(`Created table: ${tableName}`)

  //     // Insert data
  //     log.debug(`Beginning data insertion for ${tableName}`)
  //     await insertCSVData(db, filePath, tableName, columns)

  //     log.info(`Successfully imported ${file} into table ${tableName}`)
  //   }

  //   log.info('CamTrap dataset import completed successfully')
  //   return {
  //     dbPath,
  //     data
  //   }
  // } catch (error) {
  //   log.error('Error importing dataset:', error)
  //   console.error('Error importing dataset:', error)
  //   throw error
  // } finally {
  //   log.debug('Closing database connection')
  //   await closeDatabase(db)
  // }
}

function insertDeployments(db, deploymentsCSV) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(deploymentsCSV).pipe(csv())
    let rowCount = 0

    // Begin transaction for better performance
    db.run('BEGIN TRANSACTION', async (err) => {
      if (err) {
        log.error(`Error starting transaction: ${err.message}`)
        return reject(err)
      }

      log.debug('Started transaction for bulk insert')

      // Update to use explicit column names
      const insertSql = `INSERT INTO deployments (deploymentID, locationID, locationName,
                         deploymentStart, deploymentEnd, latitude, longitude)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`

      //csvCols = project_id	deployment_id	longitude	latitude	start_date	end_date	bait_type	bait_description	feature_type	feature_type_methodology	camera_id	camera_name	quiet_period	camera_functioning	sensor_height	height_other	sensor_orientation	orientation_other	plot_treatment	plot_treatment_description	detection_distance	subproject_name	subproject_design	event_name	event_description	event_type	recorded_by	fuzzed	deployment_fuzzed
      const columns = [
        'deploymentID',
        'locationID',
        'locationName',
        'deploymentStart',
        'deploymentEnd',
        'latitude',
        'longitude'
      ]

      try {
        stream.on('data', async (row) => {
          // Convert space-separated datetime to ISO format or use fromSQL
          const startDate = DateTime.fromSQL(row.start_date) // or DateTime.fromFormat(row.start_date, 'yyyy-MM-dd HH:mm:ss')
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

/**
 * Get column names from the first row of a CSV file
 * @param {string} filePath - Path to the CSV file
 * @returns {Promise<string[]>} - Array of column names
 */
function getCSVColumns(filePath) {
  log.debug(`Reading columns from: ${filePath}`)
  return new Promise((resolve, reject) => {
    let columns = []
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('headers', (headers) => {
        columns = headers
        resolve(columns)
      })
      .on('error', (error) => {
        log.error(`Error reading CSV headers: ${error.message}`)
        reject(error)
      })
      .on('data', () => {
        // We only need the headers, so end the stream after getting the first row
        resolve(columns)
      })
  })
}

/**
 * Insert CSV data into a SQLite table
 * @param {sqlite3.Database} db - SQLite database instance
 * @param {string} filePath - Path to the CSV file
 * @param {string} tableName - Name of the table
 * @param {string[]} columns - Array of column names
 * @returns {Promise<void>}
 */
function insertCSVData(db, filePath, tableName, columns) {
  return new Promise((resolve, reject) => {
    log.debug(`Beginning data insertion from ${filePath} to table ${tableName}`)
    const stream = fs.createReadStream(filePath).pipe(csv())
    let rowCount = 0

    // Begin transaction for better performance
    db.run('BEGIN TRANSACTION', async (err) => {
      if (err) {
        log.error(`Error starting transaction: ${err.message}`)
        return reject(err)
      }

      log.debug('Started transaction for bulk insert')

      const placeholders = columns.map(() => '?').join(', ')
      const insertSql = `INSERT INTO "${tableName}" VALUES (${placeholders})`

      try {
        stream.on('data', async (row) => {
          const values = columns.map((col) => {
            if (
              ['eventStart', 'eventEnd', 'timestamp', 'deploymentStart', 'deploymentEnd'].includes(
                col
              )
            ) {
              const date = DateTime.fromISO(row[col])
              return date.isValid ? date.toISO() : null
            }
            return row[col]
          })
          try {
            await runQuery(db, insertSql, values)
            rowCount++
            if (rowCount % 1000 === 0) {
              log.debug(`Inserted ${rowCount} rows into ${tableName}`)
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
            log.info(`Completed insertion of ${rowCount} rows into ${tableName}`)
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
