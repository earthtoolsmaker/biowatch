import fs from 'fs'
import path from 'path'
import csv from 'csv-parser'
import { DateTime } from 'luxon'
import crypto from 'crypto'
import {
  getDrizzleDb,
  deployments,
  media,
  observations,
  closeStudyDatabase,
  insertMetadata
} from '../db/index.js'
import { eq } from 'drizzle-orm'

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
 * Import Deepfaune CSV dataset from a CSV file into a SQLite database
 * @param {string} csvPath - Path to the Deepfaune CSV file
 * @param {string} id - Unique ID for the study
 * @returns {Promise<Object>} - Object containing study data
 */
export async function importDeepfauneDataset(csvPath, id) {
  await initializeElectronModules()
  const biowatchDataPath = path.join(app.getPath('userData'), 'biowatch-data')
  return await importDeepfauneDatasetWithPath(csvPath, biowatchDataPath, id)
}

/**
 * Import Deepfaune CSV dataset from a CSV file into a SQLite database (core function)
 * @param {string} csvPath - Path to the Deepfaune CSV file
 * @param {string} biowatchDataPath - Path to the biowatch-data directory
 * @param {string} id - Unique ID for the study
 * @returns {Promise<Object>} - Object containing study data
 */
export async function importDeepfauneDatasetWithPath(csvPath, biowatchDataPath, id) {
  await initializeElectronModules()
  log.info('Starting Deepfaune CSV dataset import')

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

  // Extract study information from CSV file name and path
  const csvFileName = path.basename(csvPath, '.csv')

  // Insert metadata into the database
  const metadataRecord = {
    id,
    name: csvFileName,
    title: null,
    description: null,
    created: new Date().toISOString(),
    importerName: 'deepfaune/csv',
    contributors: null
  }
  await insertMetadata(db, metadataRecord)
  log.info('Inserted study metadata into database')

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
    await closeStudyDatabase(id, dbPath)
    throw error
  }

  await closeStudyDatabase(id, dbPath)
  return { data: metadataRecord }
}

/**
 * Insert deployments for Deepfaune CSV data using Drizzle ORM
 * @param {Object} db - Drizzle database instance
 * @param {Array<string>} deploymentFolders - Array of unique folder paths
 */
async function insertDeepfauneDeployments(db, deploymentFolders) {
  try {
    log.debug('Starting bulk insert of deployments using Drizzle')

    const rows = deploymentFolders.map((folderPath) => {
      const deploymentID = crypto.randomUUID()
      const locationName = path.basename(folderPath) || folderPath

      return {
        deploymentID,
        locationID: folderPath,
        locationName,
        deploymentStart: null, // Will be updated when processing media
        deploymentEnd: null, // Will be updated when processing media
        latitude: null, // No GPS data in CSV
        longitude: null // No GPS data in CSV
      }
    })

    if (rows.length > 0) {
      // Insert in batches for better performance
      const batchSize = 1000
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize)
        await db.insert(deployments).values(batch)
        log.debug(
          `Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(rows.length / batchSize)} into deployments`
        )
      }

      log.info(`Completed insertion of ${deploymentFolders.length} deployments`)
    } else {
      log.warn('No deployment folders to insert')
    }
  } catch (error) {
    log.error('Error during deployments bulk insert:', error)
    throw error
  }
}

/**
 * Insert media and observations data from Deepfaune CSV using Drizzle ORM
 * @param {Object} db - Drizzle database instance
 * @param {string} csvPath - Path to the CSV file
 */
async function insertDeepfauneData(db, csvPath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(csvPath).pipe(csv())
    let rowCount = 0
    const mediaRows = []
    const observationRows = []
    const deploymentTimestamps = new Map() // Track timestamps per deployment

    log.debug('Started Deepfaune data bulk insert using Drizzle')

    // Helper function to get deployment by folder path using Drizzle
    const getDeploymentByFolder = async (folderPath) => {
      try {
        const result = await db
          .select()
          .from(deployments)
          .where(eq(deployments.locationID, folderPath))
          .limit(1)
        return result[0] || null
      } catch (error) {
        log.error(`Error getting deployment for folder ${folderPath}:`, error)
        return null
      }
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

        // Track timestamps for this deployment
        if (!deploymentTimestamps.has(deployment.deploymentID)) {
          deploymentTimestamps.set(deployment.deploymentID, [])
        }
        deploymentTimestamps.get(deployment.deploymentID).push(timestamp)

        // Prepare media record
        const mediaID = crypto.randomUUID()
        mediaRows.push({
          mediaID,
          deploymentID: deployment.deploymentID,
          timestamp: timestamp.toISO(),
          filePath: row.filename,
          fileName
        })

        // Prepare observation record if there's a prediction
        if (row.prediction && row.prediction !== '') {
          const observationID = `${mediaID}_obs`
          const classificationProbability = row.score ? parseFloat(row.score) : null
          const count = row.humancount ? parseInt(row.humancount) : 1

          observationRows.push({
            observationID,
            mediaID,
            deploymentID: deployment.deploymentID,
            eventID: row.seqnum || null, // Use sequence number as eventID
            eventStart: timestamp.toISO(),
            eventEnd: timestamp.toISO(),
            scientificName: row.prediction, // Use prediction as scientificName
            observationType: null,
            commonName: row.prediction, // Use prediction as commonName too
            classificationProbability,
            count,
            prediction: row.prediction,
            lifeStage: null,
            age: null,
            sex: null,
            behavior: null
          })
        }

        rowCount++
        if (rowCount % 1000 === 0) {
          log.debug(`Processed ${rowCount} rows from Deepfaune CSV`)
        }
      })

      stream.on('end', async () => {
        try {
          // Update deployment date ranges based on collected timestamps
          log.debug('Updating deployment date ranges')
          for (const [deploymentID, timestamps] of deploymentTimestamps.entries()) {
            if (timestamps.length === 0) continue

            // Find min and max timestamps
            const sortedTimestamps = timestamps.sort((a, b) => a.toMillis() - b.toMillis())
            const minTimestamp = sortedTimestamps[0].toISO()
            const maxTimestamp = sortedTimestamps[sortedTimestamps.length - 1].toISO()

            await db
              .update(deployments)
              .set({
                deploymentStart: minTimestamp,
                deploymentEnd: maxTimestamp
              })
              .where(eq(deployments.deploymentID, deploymentID))

            log.debug(
              `Updated deployment ${deploymentID} date range: ${minTimestamp} - ${maxTimestamp}`
            )
          }

          // Insert media records in batches
          if (mediaRows.length > 0) {
            log.debug(`Starting bulk insert of ${mediaRows.length} media records`)
            const batchSize = 1000
            for (let i = 0; i < mediaRows.length; i += batchSize) {
              const batch = mediaRows.slice(i, i + batchSize)
              await db.insert(media).values(batch).onConflictDoNothing()
              log.debug(
                `Inserted media batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(mediaRows.length / batchSize)}`
              )
            }
          }

          // Insert observation records in batches
          if (observationRows.length > 0) {
            log.debug(`Starting bulk insert of ${observationRows.length} observation records`)
            const batchSize = 1000
            for (let i = 0; i < observationRows.length; i += batchSize) {
              const batch = observationRows.slice(i, i + batchSize)
              await db.insert(observations).values(batch).onConflictDoNothing()
              log.debug(
                `Inserted observations batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(observationRows.length / batchSize)}`
              )
            }
          }

          log.info(`Completed processing of ${rowCount} rows from Deepfaune CSV`)
          resolve()
        } catch (error) {
          log.error(`Error during bulk insert:`, error)
          reject(error)
        }
      })

      stream.on('error', (error) => {
        log.error(`Error during Deepfaune CSV data insertion: ${error.message}`)
        reject(error)
      })
    } catch (error) {
      log.error(`Error processing Deepfaune CSV:`, error)
      reject(error)
    }
  })
}
