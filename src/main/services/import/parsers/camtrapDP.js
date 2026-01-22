import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import csv from 'csv-parser'
import { DateTime } from 'luxon'
import { and, eq, gte, lte, sql, isNull, inArray } from 'drizzle-orm'
import {
  getDrizzleDb,
  deployments,
  media,
  observations,
  insertMetadata
} from '../../../database/index.js'
import log from '../../logger.js'
import { getBiowatchDataPath } from '../../paths.js'

/**
 * Import CamTrapDP dataset from a directory into a SQLite database
 * @param {string} directoryPath - Path to the CamTrapDP dataset directory
 * @param {string} id - Unique ID for the study
 * @param {function} onProgress - Optional callback for progress updates
 * @param {Object} options - Optional import options
 * @param {string} [options.nameOverride] - Override the dataset name (instead of using name from datapackage.json)
 * @returns {Promise<Object>} - Object containing dbPath and name
 */
export async function importCamTrapDataset(directoryPath, id, onProgress = null, options = {}) {
  const biowatchDataPath = getBiowatchDataPath()
  return await importCamTrapDatasetWithPath(
    directoryPath,
    biowatchDataPath,
    id,
    onProgress,
    options
  )
}

/**
 * Import CamTrapDP dataset from a directory into a SQLite database (core function)
 * @param {string} directoryPath - Path to the CamTrapDP dataset directory
 * @param {string} biowatchDataPath - Path to the biowatch-data directory
 * @param {string} id - Unique ID for the study
 * @param {function} onProgress - Optional callback for progress updates
 * @param {Object} options - Optional import options
 * @param {string} [options.nameOverride] - Override the dataset name (instead of using name from datapackage.json)
 * @returns {Promise<Object>} - Object containing dbPath and data
 */
export async function importCamTrapDatasetWithPath(
  directoryPath,
  biowatchDataPath,
  id,
  onProgress = null,
  options = {}
) {
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
    for (let fileIndex = 0; fileIndex < existingFiles.length; fileIndex++) {
      const { file, table, name } = existingFiles[fileIndex]
      const filePath = path.join(directoryPath, file)

      log.info(`Processing CamTrapDP file: ${file} into schema table: ${name}`)

      // Report progress: starting to read file
      if (onProgress) {
        onProgress({
          currentFile: file,
          fileIndex,
          totalFiles: existingFiles.length,
          phase: 'reading',
          insertedRows: 0,
          totalRows: 0
        })
      }

      // Read the first row to get column names
      const columns = await getCSVColumns(filePath)
      log.debug(`Found ${columns.length} columns in ${file}`)

      // Insert data using Drizzle with progress callback
      await insertCSVData(db, filePath, table, name, columns, directoryPath, (batchProgress) => {
        if (onProgress) {
          onProgress({
            currentFile: file,
            fileIndex,
            totalFiles: existingFiles.length,
            phase: 'inserting',
            ...batchProgress
          })
        }
      })

      log.info(`Successfully imported ${file} into ${name} table`)
    }

    // Post-process: expand event-based observations to individual media
    // This ensures every media file has a linked observation for simple queries
    if (onProgress) {
      onProgress({
        currentFile: 'Linking observations to media...',
        fileIndex: existingFiles.length - 1,
        totalFiles: existingFiles.length,
        totalRows: 0,
        insertedRows: 0,
        phase: 'expanding'
      })
    }

    const expansionResult = await expandObservationsToMedia(db, onProgress)
    if (expansionResult.created > 0) {
      log.info(
        `Observation expansion: ${expansionResult.expanded} event-based observations expanded into ${expansionResult.created} media-linked observations`
      )
    }

    log.info('CamTrap dataset import completed successfully')

    // Insert metadata into the database
    // CamtrapDP datasets have eventIDs, so sequenceGap is null (use eventID-based grouping)
    const metadataRecord = {
      id,
      name: options.nameOverride || data.name || null,
      title: data.title || null,
      description: data.description || null,
      created: new Date().toISOString(),
      importerName: 'camtrap/datapackage',
      contributors: data.contributors || null,
      startDate: data.temporal?.start || null,
      endDate: data.temporal?.end || null,
      sequenceGap: null
    }
    await insertMetadata(db, metadataRecord)
    log.info('Inserted study metadata into database')

    return {
      dbPath,
      data: metadataRecord
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
 * @param {function} onProgress - Optional callback for progress updates
 * @returns {Promise<void>}
 */
async function insertCSVData(
  db,
  filePath,
  table,
  tableName,
  columns,
  directoryPath,
  onProgress = null
) {
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
          const totalBatches = Math.ceil(rows.length / batchSize)

          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize)
            await db.insert(table).values(batch)

            const insertedRows = Math.min(i + batchSize, rows.length)
            const batchNumber = Math.floor(i / batchSize) + 1

            log.debug(`Inserted batch ${batchNumber}/${totalBatches} into ${tableName}`)

            // Report progress after each batch
            if (onProgress) {
              onProgress({
                insertedRows,
                totalRows: rows.length,
                batchNumber,
                totalBatches
              })
            }
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

  // Parse coordinateUncertainty as integer if present
  let coordinateUncertainty = null
  const rawUncertainty = row.coordinateUncertainty || row.coordinate_uncertainty
  if (rawUncertainty != null && rawUncertainty !== '') {
    const parsed = parseInt(rawUncertainty, 10)
    if (!isNaN(parsed) && parsed >= 1) {
      coordinateUncertainty = parsed
    }
  }

  const transformed = {
    deploymentID,
    locationID: row.locationID || row.location_id || null,
    locationName: row.locationName || row.location_name || null,
    deploymentStart: transformDateField(row.deploymentStart || row.deployment_start),
    deploymentEnd: transformDateField(row.deploymentEnd || row.deployment_end),
    latitude: parseFloat(row.latitude) || null,
    longitude: parseFloat(row.longitude) || null,
    // CamtrapDP EXIF fields
    cameraModel: row.cameraModel || row.camera_model || null,
    cameraID: row.cameraID || row.camera_id || null,
    coordinateUncertainty
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

  // Parse exifData if present (can be JSON string in CSV)
  let exifData = null
  const rawExifData = row.exifData || row.exif_data
  if (rawExifData) {
    try {
      exifData = typeof rawExifData === 'string' ? JSON.parse(rawExifData) : rawExifData
    } catch {
      log.warn(`Failed to parse exifData for mediaID ${mediaID}`)
    }
  }

  // Parse favorite field (can be boolean, string, or integer in CSV)
  const rawFavorite = row.favorite ?? row.is_favorite
  const favorite =
    rawFavorite === true || rawFavorite === 'true' || rawFavorite === 1 || rawFavorite === '1'

  return {
    mediaID,
    deploymentID: row.deploymentID || row.deployment_id || null,
    timestamp: transformDateField(row.timestamp),
    filePath: transformFilePathField(row.filePath || row.file_path, directoryPath),
    fileName: row.fileName || row.file_name || path.basename(row.filePath || row.file_path || ''),
    fileMediatype: row.fileMediatype || row.file_mediatype || null,
    exifData,
    favorite
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
    classificationProbability: parseFloat(row.classificationProbability) || null,
    count: parseInt(row.count) || null,
    prediction: row.prediction || null,
    lifeStage: row.lifeStage || row.life_stage || null,
    age: row.age || null,
    sex: row.sex || null,
    behavior: row.behavior || null,
    // Bounding box fields (Camtrap DP format)
    // Use ?? (nullish coalescing) to prefer the first column name, falling back to snake_case
    // Use parseFloatOrNull to properly handle 0 values (which are falsy but valid coordinates)
    bboxX: parseFloatOrNull(row.bboxX ?? row.bbox_x),
    bboxY: parseFloatOrNull(row.bboxY ?? row.bbox_y),
    bboxWidth: parseFloatOrNull(row.bboxWidth ?? row.bbox_width),
    bboxHeight: parseFloatOrNull(row.bboxHeight ?? row.bbox_height)
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
 * Safely parse a float value, preserving 0 as a valid value
 * @param {*} value - The value to parse
 * @returns {number|null} - Parsed float or null if invalid/missing
 */
function parseFloatOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const parsed = parseFloat(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Transform file path field to absolute path
 * Handles cross-platform path separators and smart detection for file location
 */
function transformFilePathField(filePath, directoryPath) {
  if (!filePath) return null

  // If it's already an absolute path or URL, return as is
  if (filePath.startsWith('http') || path.isAbsolute(filePath)) {
    return filePath
  }

  // Normalize path separators for cross-platform compatibility
  // Handle both forward and backward slashes from different OS exports
  const normalizedPath = filePath.split(/[\\/]/).join(path.sep)

  // Smart detection: try camtrap directory first, then fall back to parent
  // This handles both:
  // 1. Re-imported exports where media is in media/ subfolder (new behavior)
  // 2. External datasets where media is in sibling directory (backward compat)
  const directPath = path.join(directoryPath, normalizedPath)
  if (fs.existsSync(directPath)) {
    return directPath
  }

  // Fall back to parent directory (original behavior for backward compatibility)
  const parentDir = path.dirname(directoryPath)
  return path.join(parentDir, normalizedPath)
}

/**
 * Expand event-based observations to create one record per matching media.
 * For observations without mediaID (event-based CamTrap DP datasets):
 * 1. Find all media matching deploymentID + timestamp within eventStart/eventEnd
 * 2. Create one observation per matching media (duplicating the original observation data)
 * 3. Delete the original observation without mediaID
 *
 * This ensures every media file has a linked observation for simple queries.
 *
 * OPTIMIZED: Uses single JOIN query + batch inserts/deletes instead of N+1 queries.
 * For demo dataset: ~245,000 operations → ~250 batch operations (~1000x faster)
 *
 * @param {Object} db - Drizzle database instance
 * @param {function} onProgress - Optional callback for progress updates
 * @returns {Promise<{expanded: number, created: number}>} - Count of observations expanded and created
 */
export async function expandObservationsToMedia(db, onProgress = null) {
  const BATCH_SIZE = 1000
  const DELETE_BATCH_SIZE = 500 // SQLite has 999 parameter limit

  // 1. Single JOIN query to get ALL observation-media pairs at once
  // This replaces N individual SELECT queries with 1 query
  log.info('Finding observation-media pairs with single JOIN query...')

  const pairs = await db
    .select({
      // Observation fields
      observationID: observations.observationID,
      deploymentID: observations.deploymentID,
      eventID: observations.eventID,
      eventStart: observations.eventStart,
      eventEnd: observations.eventEnd,
      scientificName: observations.scientificName,
      observationType: observations.observationType,
      commonName: observations.commonName,
      classificationProbability: observations.classificationProbability,
      count: observations.count,
      lifeStage: observations.lifeStage,
      age: observations.age,
      sex: observations.sex,
      behavior: observations.behavior,
      bboxX: observations.bboxX,
      bboxY: observations.bboxY,
      bboxWidth: observations.bboxWidth,
      bboxHeight: observations.bboxHeight,
      detectionConfidence: observations.detectionConfidence,
      modelOutputID: observations.modelOutputID,
      classificationMethod: observations.classificationMethod,
      classifiedBy: observations.classifiedBy,
      classificationTimestamp: observations.classificationTimestamp,
      // New mediaID from JOIN
      newMediaID: media.mediaID
    })
    .from(observations)
    .innerJoin(
      media,
      and(
        eq(observations.deploymentID, media.deploymentID),
        gte(media.timestamp, observations.eventStart),
        lte(media.timestamp, sql`COALESCE(${observations.eventEnd}, ${observations.eventStart})`)
      )
    )
    .where(isNull(observations.mediaID))

  if (pairs.length === 0) {
    log.info('No observation-media pairs found - skipping expansion step')
    return { expanded: 0, created: 0 }
  }

  // Get unique original observation IDs for deletion
  const originalObsIDs = [...new Set(pairs.map((p) => p.observationID))]

  log.info(
    `Found ${pairs.length} observation-media pairs from ${originalObsIDs.length} original observations`
  )

  // 2. Build new observations array in memory
  const newObservations = pairs.map((pair) => ({
    observationID: crypto.randomUUID(),
    mediaID: pair.newMediaID,
    deploymentID: pair.deploymentID,
    eventID: pair.eventID,
    eventStart: pair.eventStart,
    eventEnd: pair.eventEnd,
    scientificName: pair.scientificName,
    observationType: pair.observationType,
    commonName: pair.commonName,
    classificationProbability: pair.classificationProbability,
    count: pair.count,
    lifeStage: pair.lifeStage,
    age: pair.age,
    sex: pair.sex,
    behavior: pair.behavior,
    bboxX: pair.bboxX,
    bboxY: pair.bboxY,
    bboxWidth: pair.bboxWidth,
    bboxHeight: pair.bboxHeight,
    detectionConfidence: pair.detectionConfidence,
    modelOutputID: pair.modelOutputID,
    classificationMethod: pair.classificationMethod,
    classifiedBy: pair.classifiedBy,
    classificationTimestamp: pair.classificationTimestamp
  }))

  // 3. Batch insert new observations
  log.info(`Inserting ${newObservations.length} new observations in batches of ${BATCH_SIZE}...`)

  for (let i = 0; i < newObservations.length; i += BATCH_SIZE) {
    const batch = newObservations.slice(i, i + BATCH_SIZE)
    await db.insert(observations).values(batch)

    // Report progress after each batch
    if (onProgress) {
      onProgress({
        currentFile: 'Linking observations to media...',
        fileIndex: 0,
        totalFiles: 1,
        totalRows: newObservations.length,
        insertedRows: Math.min(i + BATCH_SIZE, newObservations.length),
        phase: 'expanding'
      })
    }
  }

  // 4. Batch delete original observations (SQLite has 999 parameter limit)
  log.info(
    `Deleting ${originalObsIDs.length} original observations in batches of ${DELETE_BATCH_SIZE}...`
  )

  for (let i = 0; i < originalObsIDs.length; i += DELETE_BATCH_SIZE) {
    const batch = originalObsIDs.slice(i, i + DELETE_BATCH_SIZE)
    await db.delete(observations).where(inArray(observations.observationID, batch))
  }

  log.info(
    `Expanded ${originalObsIDs.length} event-based observations into ${newObservations.length} media-linked observations`
  )

  return { expanded: originalObsIDs.length, created: newObservations.length }
}
