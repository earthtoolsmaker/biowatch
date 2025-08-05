import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import csv from 'csv-parser'
import log from 'electron-log'
import { DateTime } from 'luxon'
import { getDrizzleDb, deployments, media, observations } from './db/index.js'

/**
 * Import CamTrapDP dataset from a directory into a SQLite database
 * @param {string} directoryPath - Path to the CamTrapDP dataset directory
 * @returns {Promise<Object>} - Object containing dbPath and name
 */
export async function importCamTrapDataset(directoryPath, id) {
  log.info('Starting CamTrap dataset import')
  // Create database in app's user data directory using new structure
  const dbPath = path.join(app.getPath('userData'), 'biowatch-data', 'studies', id, 'study.db')
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
    // Get all CSV files in the directory
    const files = fs.readdirSync(directoryPath).filter((file) => file.endsWith('.csv'))
    log.info(`Found ${files.length} CSV files to import`)

    // Map CamTrapDP CSV files to schema tables
    const csvToTableMap = {
      'deployments.csv': { table: deployments, name: 'deployments' },
      'media.csv': { table: media, name: 'media' },
      'observations.csv': { table: observations, name: 'observations' }
    }

    // Process each CSV file
    for (const file of files) {
      const filePath = path.join(directoryPath, file)
      const mapping = csvToTableMap[file]
      
      if (mapping) {
        log.info(`Processing CamTrapDP file: ${file} into schema table: ${mapping.name}`)
        
        // Read the first row to get column names
        const columns = await getCSVColumns(filePath)
        log.debug(`Found ${columns.length} columns in ${file}`)

        // Insert data using Drizzle
        await insertCSVData(db, filePath, mapping.table, mapping.name, columns, directoryPath)
        
        log.info(`Successfully imported ${file} into ${mapping.name} table`)
      } else {
        log.warn(`Unknown CamTrapDP CSV file: ${file} - skipping (not part of standard schema)`)
      }
    }

    log.info('CamTrap dataset import completed successfully')
    fs.writeFileSync(
      path.join(app.getPath('userData'), 'biowatch-data', 'studies', id, 'study.json'),
      JSON.stringify({ id, data, name: data.name }, null, 2)
    )
    return {
      dbPath,
      data
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
            log.debug(`Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(rows.length / batchSize)} into ${tableName}`)
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
        return transformDeploymentRow(row, directoryPath)
      case 'media':
        return transformMediaRow(row, directoryPath)
      case 'observations':
        return transformObservationRow(row, directoryPath)
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
function transformDeploymentRow(row, directoryPath) {
  return {
    deploymentID: row.deploymentID || row.deployment_id || null,
    locationID: row.locationID || row.location_id || null,
    locationName: row.locationName || row.location_name || null,
    deploymentStart: transformDateField(row.deploymentStart || row.deployment_start),
    deploymentEnd: transformDateField(row.deploymentEnd || row.deployment_end),
    latitude: parseFloat(row.latitude) || null,
    longitude: parseFloat(row.longitude) || null
  }
}

/**
 * Transform media CSV row to media schema
 */
function transformMediaRow(row, directoryPath) {
  return {
    mediaID: row.mediaID || row.media_id || null,
    deploymentID: row.deploymentID || row.deployment_id || null,
    timestamp: transformDateField(row.timestamp),
    filePath: transformFilePathField(row.filePath || row.file_path, directoryPath),
    fileName: row.fileName || row.file_name || path.basename(row.filePath || row.file_path || '')
  }
}

/**
 * Transform observation CSV row to observations schema
 */
function transformObservationRow(row, directoryPath) {
  return {
    observationID: row.observationID || row.observation_id || null,
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
  return date.isValid ? date.toISO() : null
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
