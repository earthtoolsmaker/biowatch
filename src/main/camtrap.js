import fs from 'fs'
import path from 'path'
import csv from 'csv-parser'
import { DateTime } from 'luxon'
import { getDrizzleDb, deployments, media, observations } from './db/index.js'

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
 * Import CamTrapDP dataset from a directory into a SQLite database
 * @param {string} directoryPath - Path to the CamTrapDP dataset directory
 * @param {string} id - Unique ID for the study
 * @returns {Promise<Object>} - Object containing dbPath and name
 */
export async function importCamTrapDataset(directoryPath, id) {
  await initializeElectronModules()
  const biowatchDataPath = path.join(app.getPath('userData'), 'biowatch-data')
  return await importCamTrapDatasetWithPath(directoryPath, biowatchDataPath, id)
}

/**
 * Import CamTrapDP dataset from a directory into a SQLite database (core function)
 * @param {string} directoryPath - Path to the CamTrapDP dataset directory
 * @param {string} biowatchDataPath - Path to the biowatch-data directory
 * @param {string} id - Unique ID for the study
 * @returns {Promise<Object>} - Object containing dbPath and data
 */
export async function importCamTrapDatasetWithPath(directoryPath, biowatchDataPath, id) {
  await initializeElectronModules()
  log.info('Starting CamTrap dataset import')
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

  // Get dataset name from datapackage.json
  let data
  try {
    const datapackagePath = path.join(directoryPath, 'datapackage.json')
    if (fs.existsSync(datapackagePath)) {
      const datapackage = JSON.parse(fs.readFileSync(datapackagePath, 'utf8'))
      data = datapackage
      log.info(`Found dataset name: ${data.name}`)
    } else {
      log.warn('datapackage.json not found in directory')
      return {
        error: 'datapackage.json not found in directory'
      }
    }
  } catch (error) {
    log.error('Error reading datapackage.json:', error)
  }

  log.info(`Using dataset directory: ${directoryPath}`)

  try {
    // Define processing order to respect foreign key dependencies
    const filesToProcess = [
      { file: 'deployments.csv', table: deployments, name: 'deployments' },
      { file: 'media.csv', table: media, name: 'media' },
      { file: 'observations.csv', table: observations, name: 'observations' }
    ]

    // Check which files exist
    const existingFiles = filesToProcess.filter(({ file }) => {
      const exists = fs.existsSync(path.join(directoryPath, file))
      if (exists) {
        log.info(`Found CamTrapDP file: ${file}`)
      } else {
        log.warn(`CamTrapDP file not found: ${file}`)
      }
      return exists
    })

    log.info(`Found ${existingFiles.length} CamTrapDP CSV files to import`)

    // Process each CSV file in dependency order
    for (const { file, table, name } of existingFiles) {
      const filePath = path.join(directoryPath, file)

      log.info(`Processing CamTrapDP file: ${file} into schema table: ${name}`)

      // Read the first row to get column names
      const columns = await getCSVColumns(filePath)
      log.debug(`Found ${columns.length} columns in ${file}`)

      // Insert data using Drizzle
      await insertCSVData(db, filePath, table, name, columns, directoryPath)

      log.info(`Successfully imported ${file} into ${name} table`)
    }

    log.info('CamTrap dataset import completed successfully')
    const studyJsonPath = path.join(biowatchDataPath, 'studies', id, 'study.json')
    fs.writeFileSync(
      studyJsonPath,
      JSON.stringify(
        {
          id,
          data,
          name: data.name,
          importerName: 'camtrap/datapackage',
          createdAt: new Date().toISOString()
        },
        null,
        2
      )
    )
    return {
      dbPath,
      data: {
        id,
        data,
        name: data.name,
        importerName: 'camtrap/datapackage',
        createdAt: new Date().toISOString()
      }
    }
  } catch (error) {
    log.error('Error importing dataset:', error)
    console.error('Error importing dataset:', error)
    throw error
  }
}

/**
 * Get column names from the first row of a CSV file
 * @param {string} filePath - Path to the CSV file
 * @returns {Promise<string[]>} - Array of column names
 */
async function getCSVColumns(filePath) {
  await initializeElectronModules()
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
 * Insert CSV data into a Drizzle schema table
 * @param {Object} db - Drizzle database instance
 * @param {string} filePath - Path to the CSV file
 * @param {Object} table - Drizzle table schema
 * @param {string} tableName - Name of the table
 * @param {string[]} columns - Array of column names from CSV
 * @param {string} directoryPath - Path to the CamTrapDP directory
 * @returns {Promise<void>}
 */
async function insertCSVData(db, filePath, table, tableName, columns, directoryPath) {
  await initializeElectronModules()
  log.debug(`Beginning data insertion from ${filePath} to table ${tableName}`)

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath).pipe(csv())
    const rows = []
    let rowCount = 0

    log.debug(`directoryPath: ${directoryPath}`)

    stream.on('data', (row) => {
      // Transform CSV row data to match schema fields
      const transformedRow = transformRowToSchema(row, tableName, columns, directoryPath)
      if (transformedRow) {
        rows.push(transformedRow)
        rowCount++
      }
    })

    stream.on('end', async () => {
      try {
        if (rows.length > 0) {
          // Use Drizzle batch inserts (transactions temporarily disabled for compatibility)
          log.debug(`Starting bulk insert of ${rows.length} rows`)

          // Insert in batches for better performance
          const batchSize = 1000
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize)
            await db.insert(table).values(batch)
            log.debug(
              `Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(rows.length / batchSize)} into ${tableName}`
            )
          }

          log.info(`Completed insertion of ${rowCount} rows into ${tableName}`)
        } else {
          log.warn(`No valid rows found in ${filePath} for table ${tableName}`)
        }
        resolve()
      } catch (error) {
        log.error(`Error during bulk insert for ${tableName}:`, error)
        reject(error)
      }
    })

    stream.on('error', (error) => {
      log.error(`Error reading CSV file ${filePath}:`, error)
      reject(error)
    })
  })
}

/**
 * Transform CSV row data to match schema fields
 * @param {Object} row - CSV row data
 * @param {string} tableName - Target table name
 * @param {string[]} columns - CSV column names
 * @param {string} directoryPath - Path to the CamTrapDP directory
 * @returns {Object|null} - Transformed row data or null if invalid
 */
function transformRowToSchema(row, tableName, columns, directoryPath) {
  try {
    switch (tableName) {
      case 'deployments':
        return transformDeploymentRow(row)
      case 'media':
        return transformMediaRow(row, directoryPath)
      case 'observations':
        return transformObservationRow(row)
      default:
        log.warn(`Unknown table name: ${tableName}`)
        return null
    }
  } catch (error) {
    log.error(`Error transforming row for table ${tableName}:`, error)
    return null
  }
}

/**
 * Transform deployment CSV row to deployments schema
 */
function transformDeploymentRow(row) {
  const deploymentID = row.deploymentID || row.deployment_id

  // Skip deployments without required primary key
  if (!deploymentID) {
    log.warn('Skipping deployment row without deploymentID:', row)
    return null
  }

  const transformed = {
    deploymentID,
    locationID: row.locationID || row.location_id || null,
    locationName: row.locationName || row.location_name || null,
    deploymentStart: transformDateField(row.deploymentStart || row.deployment_start),
    deploymentEnd: transformDateField(row.deploymentEnd || row.deployment_end),
    latitude: parseFloat(row.latitude) || null,
    longitude: parseFloat(row.longitude) || null
  }

  log.debug('Transformed deployment row:', transformed)
  return transformed
}

/**
 * Transform media CSV row to media schema
 */
function transformMediaRow(row, directoryPath) {
  const mediaID = row.mediaID || row.media_id

  // Skip rows without required primary key
  if (!mediaID) {
    log.warn('Skipping media row without mediaID:', row)
    return null
  }

  return {
    mediaID,
    deploymentID: row.deploymentID || row.deployment_id || null,
    timestamp: transformDateField(row.timestamp),
    filePath: transformFilePathField(row.filePath || row.file_path, directoryPath),
    fileName: row.fileName || row.file_name || path.basename(row.filePath || row.file_path || '')
  }
}

/**
 * Transform observation CSV row to observations schema
 */
function transformObservationRow(row) {
  const observationID = row.observationID || row.observation_id

  // Skip observations without required primary key
  if (!observationID) {
    log.warn('Skipping observation row without observationID:', row)
    return null
  }

  return {
    observationID,
    mediaID: row.mediaID || row.media_id || null,
    deploymentID: row.deploymentID || row.deployment_id || null,
    eventID: row.eventID || row.event_id || null,
    eventStart: transformDateField(row.eventStart || row.event_start),
    eventEnd: transformDateField(row.eventEnd || row.event_end),
    scientificName: row.scientificName || row.scientific_name || null,
    observationType: row.observationType || row.observation_type || null,
    commonName: row.commonName || row.common_name || null,
    confidence: parseFloat(row.confidence) || null,
    count: parseInt(row.count) || null,
    prediction: row.prediction || null,
    lifeStage: row.lifeStage || row.life_stage || null,
    age: row.age || null,
    sex: row.sex || null,
    behavior: row.behavior || null
  }
}

/**
 * Transform date field from CSV to ISO format
 */
function transformDateField(dateValue) {
  if (!dateValue) return null

  const date = DateTime.fromISO(dateValue)
  return date.isValid ? date.toUTC().toISO() : null
}

/**
 * Transform file path field to absolute path
 */
function transformFilePathField(filePath, directoryPath) {
  if (!filePath) return null

  // If it's already an absolute path or URL, return as is
  if (filePath.startsWith('http') || path.isAbsolute(filePath)) {
    return filePath
  }

  // Convert relative path to absolute path relative to the parent of the CamTrapDP directory
  const parentDir = path.dirname(directoryPath)
  return path.join(parentDir, filePath)
}
