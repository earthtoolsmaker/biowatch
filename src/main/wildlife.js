import fs from 'fs'
import path from 'path'
import csv from 'csv-parser'
import { DateTime } from 'luxon'
import { getDrizzleDb, deployments, media, observations, closeStudyDatabase } from './db/index.js'

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

  // Get Drizzle database connection
  const db = await getDrizzleDb(id, dbPath)

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
  data.createdAt = new Date().toISOString()
  fs.writeFileSync(
    path.join(biowatchDataPath, 'studies', id, 'study.json'),
    JSON.stringify(data, null, 2)
  )

  console.log('returning Data:', data)

  await closeStudyDatabase(id, dbPath)

  return {
    data
  }
}

async function insertDeployments(db, deploymentsCSV) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(deploymentsCSV).pipe(csv())
    const rows = []
    let rowCount = 0

    stream.on('data', (row) => {
      const startDate = DateTime.fromSQL(row.start_date)
      const endDate = DateTime.fromSQL(row.end_date)

      const transformedRow = {
        deploymentID: row.deployment_id,
        locationID: row.latitude + ' ' + row.longitude,
        locationName: row.deployment_id,
        deploymentStart: startDate.isValid ? startDate.toISO() : null,
        deploymentEnd: endDate.isValid ? endDate.toISO() : null,
        latitude: parseFloat(row.latitude) || null,
        longitude: parseFloat(row.longitude) || null
      }

      rows.push(transformedRow)
      rowCount++
    })

    stream.on('end', async () => {
      try {
        if (rows.length > 0) {
          log.debug(`Starting bulk insert of ${rows.length} deployments`)

          // Insert in batches for better performance
          const batchSize = 1000
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize)
            await db.insert(deployments).values(batch)
            log.debug(
              `Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(rows.length / batchSize)} into deployments`
            )
          }

          log.info(`Completed insertion of ${rowCount} rows into deployments`)
        } else {
          log.warn(`No valid rows found in ${deploymentsCSV}`)
        }
        resolve()
      } catch (error) {
        log.error(`Error during bulk insert for deployments:`, error)
        reject(error)
      }
    })

    stream.on('error', (error) => {
      log.error(`Error reading CSV file ${deploymentsCSV}:`, error)
      reject(error)
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
    const rows = []
    let rowCount = 0

    stream.on('data', (row) => {
      // Skip rows without image_id
      if (!row.image_id) {
        return
      }

      const timestamp = DateTime.fromSQL(row.timestamp)
      const transformedRow = {
        mediaID: row.image_id,
        deploymentID: row.deployment_id || null,
        timestamp: timestamp.isValid ? timestamp.toISO() : null,
        filePath: row.location || null,
        fileName: row.filename || null
      }

      rows.push(transformedRow)
      rowCount++
    })

    stream.on('end', async () => {
      try {
        if (rows.length > 0) {
          log.debug(`Starting bulk insert of ${rows.length} media items`)

          // Insert in batches for better performance
          const batchSize = 1000
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize)
            await db.insert(media).values(batch).onConflictDoNothing()
            log.debug(
              `Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(rows.length / batchSize)} into media`
            )
          }

          log.info(`Completed insertion of ${rowCount} rows into media`)
        } else {
          log.warn(`No valid rows found in ${csvPath}`)
        }
        resolve()
      } catch (error) {
        log.error(`Error during bulk insert for media:`, error)
        reject(error)
      }
    })

    stream.on('error', (error) => {
      log.error(`Error reading CSV file ${csvPath}:`, error)
      reject(error)
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
    const rows = []
    let rowCount = 0

    stream.on('data', (row) => {
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

      const transformedRow = {
        observationID: `${row.image_id}_obs`, // Create unique observation ID
        mediaID: row.image_id || null,
        deploymentID: row.deployment_id || null,
        eventID: row.sequence_id || null,
        eventStart: timestamp.isValid ? timestamp.toISO() : null,
        eventEnd: timestamp.isValid ? timestamp.toISO() : null,
        scientificName: scientificName,
        observationType: null, // Not available in Wildlife Insights format
        commonName: row.common_name || null,
        confidence: row.cv_confidence ? parseFloat(row.cv_confidence) : null,
        count: row.number_of_objects ? parseInt(row.number_of_objects) : 1,
        prediction: row.common_name || null,
        lifeStage: row.age || null,
        age: row.age || null,
        sex: row.sex || null,
        behavior: row.behavior || null
      }

      rows.push(transformedRow)
      rowCount++
    })

    stream.on('end', async () => {
      try {
        if (rows.length > 0) {
          log.debug(`Starting bulk insert of ${rows.length} observations`)

          // Insert in batches for better performance
          const batchSize = 1000
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize)
            await db.insert(observations).values(batch).onConflictDoNothing()
            log.debug(
              `Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(rows.length / batchSize)} into observations`
            )
          }

          log.info(`Completed insertion of ${rowCount} rows into observations`)
        } else {
          log.warn(`No valid rows found in ${csvPath}`)
        }
        resolve()
      } catch (error) {
        log.error(`Error during bulk insert for observations:`, error)
        reject(error)
      }
    })

    stream.on('error', (error) => {
      log.error(`Error reading CSV file ${csvPath}:`, error)
      reject(error)
    })
  })
}
