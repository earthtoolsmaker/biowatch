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

  // Create database connection
  const db = await openDatabase(dbPath)

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

    // Process each CSV file
    for (const file of files) {
      const filePath = path.join(directoryPath, file)
      const tableName = path.basename(file, '.csv')
      log.info(`Processing file: ${file} into table: ${tableName}`)

      // Read the first row to get column names
      const columns = await getCSVColumns(filePath)
      log.debug(`Found ${columns.length} columns in ${file}`)

      // Create table
      const columnDefs = columns.map((col) => `"${col}" TEXT`).join(', ')
      await runQuery(db, `CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefs})`)
      log.debug(`Created table: ${tableName}`)

      // Insert data
      log.debug(`Beginning data insertion for ${tableName}`)
      await insertCSVData(db, filePath, tableName, columns, directoryPath)

      log.info(`Successfully imported ${file} into table ${tableName}`)
    }

    log.info('CamTrap dataset import completed successfully')
    return {
      dbPath,
      data
    }
  } catch (error) {
    log.error('Error importing dataset:', error)
    console.error('Error importing dataset:', error)
    throw error
  } finally {
    log.debug('Closing database connection')
    await closeDatabase(db)
  }
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
function insertCSVData(db, filePath, tableName, columns, directoryPath) {
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

      log.debug(`directoryPath: ${directoryPath}`)

      try {
        stream.on('data', async (row) => {
          const values = columns.map((col) => {
            if (col === 'filePath' && !row[col].startsWith('http')) {
              return path.join(directoryPath.split(path.sep).slice(0, -1).join(path.sep), row[col])
            }
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
