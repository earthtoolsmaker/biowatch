import fs from 'fs'
import path from 'path'
import csv from 'csv-parser'
import { DateTime } from 'luxon'
import { and, eq, sql } from 'drizzle-orm'
import {
  getStudyDatabase,
  deployments,
  media,
  observations,
  insertMetadata
} from '../../../database/index.js'
import log from '../../logger.js'
import { getBiowatchDataPath } from '../../paths.js'
import { normalizeScientificName } from '../../../../shared/commonNames/normalize.js'
import { sanitizeDescription } from '../sanitizeDescription.js'
import { collectOrphanDeployments } from './orphanDeployments.js'

// Prefix used on locationIDs that biowatch synthesized from (lat, lon) at
// import time, when the curator left locationID empty. The CamTrap-DP
// exporter strips this prefix back to empty so the synthesized values do
// not leak into round-tripped packages.
export const SYNTH_LOCATION_ID_PREFIX = 'biowatch-geo:'

/**
 * Strip the synth-locationID marker so an exported CamTrap-DP package
 * matches the curator's original (empty-locationID) shape. Pass-through for
 * any locationID a curator actually provided.
 * @param {string|null|undefined} locationID
 * @returns {string|null}
 */
export function stripSynthLocationID(locationID) {
  if (!locationID) return null
  if (locationID.startsWith(SYNTH_LOCATION_ID_PREFIX)) return null
  return locationID
}

/**
 * Import CamTrapDP dataset from a directory into a SQLite database
 * @param {string} directoryPath - Path to the CamTrapDP dataset directory
 * @param {string} id - Unique ID for the study
 * @param {function} onProgress - Optional callback for progress updates
 * @param {Object} options - Optional import options
 * @param {string} [options.nameOverride] - Override the dataset name (instead of using name from datapackage.json)
 * @param {string|null} [options.importFolderOverride] - Override the importFolder stamped on media rows. Pass null to leave it empty (e.g. for GBIF/demo imports whose package directory is a temp path that gets cleaned up post-import). Omit to default to directoryPath (spec D3 for local picks).
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
 * @param {string|null} [options.importFolderOverride] - See importCamTrapDataset.
 * @returns {Promise<Object>} - Object containing dbPath and data
 */
export async function importCamTrapDatasetWithPath(
  directoryPath,
  biowatchDataPath,
  id,
  onProgress = null,
  options = {}
) {
  const importFolderForMedia =
    'importFolderOverride' in options ? options.importFolderOverride : directoryPath
  log.info('Starting CamTrap dataset import')
  // Create database in the specified biowatch-data directory
  const dbPath = path.join(biowatchDataPath, 'studies', id, 'study.db')
  log.info(`Creating database at: ${dbPath}`)

  // Ensure the directory exists
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  // Get database manager and enable import mode PRAGMAs
  const manager = await getStudyDatabase(id, dbPath)
  const db = manager.getDb()
  manager.setImportMode()

  // Get dataset name from datapackage.json
  let data
  const datapackagePath = path.join(directoryPath, 'datapackage.json')
  if (!fs.existsSync(datapackagePath)) {
    const errorMessage = 'datapackage.json not found in directory'
    log.error(errorMessage)
    return { error: errorMessage }
  }
  try {
    const datapackage = JSON.parse(fs.readFileSync(datapackagePath, 'utf8'))
    data = datapackage
    log.info(`Found dataset name: ${data.name}`)
  } catch (error) {
    log.error('Error reading datapackage.json:', error)
    throw error
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

    const signal = options.signal || null
    const sqlite = manager.getSqlite()

    const synthesized = {
      deployments: 0,
      orphanMediaRows: 0,
      orphanObservationRows: 0,
      droppedObservationRows: 0
    }

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

      if (signal?.aborted) {
        throw new DOMException('Import cancelled', 'AbortError')
      }

      // Build a per-row drop filter for observations: drop rows whose mediaID
      // is non-empty but missing from the media table we just inserted.
      let rowFilter = null
      if (name === 'observations') {
        const insertedMediaIDs = new Set(
          sqlite
            .prepare('SELECT mediaID FROM media')
            .all()
            .map((r) => r.mediaID)
        )
        rowFilter = (row) => {
          if (row.mediaID && !insertedMediaIDs.has(row.mediaID)) {
            synthesized.droppedObservationRows += 1
            return false
          }
          return true
        }
      }

      // Insert data using Drizzle with progress callback
      await insertCSVData(
        db,
        manager,
        filePath,
        table,
        name,
        columns,
        directoryPath,
        importFolderForMedia,
        (batchProgress) => {
          if (onProgress) {
            onProgress({
              currentFile: file,
              fileIndex,
              totalFiles: existingFiles.length,
              phase: 'inserting',
              ...batchProgress
            })
          }
        },
        signal,
        rowFilter
      )

      log.info(`Successfully imported ${file} into ${name} table`)

      // After deployments are loaded, pre-scan media + observations for
      // deploymentIDs that reference rows missing from deployments.csv and
      // synthesize stub deployments so the FK insert below succeeds.
      if (name === 'deployments') {
        const knownDeploymentIDs = new Set(
          sqlite
            .prepare('SELECT deploymentID FROM deployments')
            .all()
            .map((r) => r.deploymentID)
        )
        const orphans = await collectOrphanDeployments({
          directoryPath,
          knownDeploymentIDs,
          signal
        })
        if (orphans.size > 0) {
          const stubRows = []
          let logged = 0
          const LOG_CAP = 50
          for (const [orphanID, info] of orphans) {
            stubRows.push({
              deploymentID: orphanID,
              // Stubs bypass transformDeploymentRow's synthesis rule on
              // purpose — they have no coords to derive from. Reusing the
              // orphan deploymentID as locationID gives the inline-rename
              // IPC a target and keeps the row from displaying as
              // "Unnamed Location". See spec § Synthesized row shape.
              locationID: orphanID,
              locationName: null,
              deploymentStart: info.start,
              deploymentEnd: info.end,
              latitude: null,
              longitude: null,
              cameraModel: null,
              cameraID: null,
              coordinateUncertainty: null
            })
            synthesized.orphanMediaRows += info.mediaCount
            synthesized.orphanObservationRows += info.obsCount
            if (logged < LOG_CAP) {
              log.warn(
                `Synthesized stub deployment ${orphanID} from ${info.mediaCount} media rows / ${info.obsCount} obs rows; window ${info.start || 'null'}..${info.end || 'null'}`
              )
              logged += 1
            }
          }
          if (orphans.size > LOG_CAP) {
            log.warn(`...and ${orphans.size - LOG_CAP} more synthesized deployments (capped)`)
          }
          const stubInserter = createBulkInserter(sqlite, 'deployments', Object.keys(stubRows[0]))
          stubInserter(stubRows)
          synthesized.deployments = stubRows.length
          log.info(`Inserted ${stubRows.length} synthesized stub deployments`)
        }
      }
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
      description: sanitizeDescription(data.description),
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
      data: metadataRecord,
      synthesized
    }
  } catch (error) {
    log.error('Error importing dataset:', error)
    console.error('Error importing dataset:', error)
    throw error
  } finally {
    manager.resetImportMode()
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
 * Convert a JavaScript value to a SQLite-compatible value.
 * SQLite only accepts: numbers, strings, bigints, buffers, and null.
 * @param {any} value - JavaScript value to convert
 * @returns {number|string|bigint|Buffer|null} SQLite-compatible value
 */
function toSqliteValue(value) {
  if (value === undefined) return null
  if (value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/**
 * Create a transaction-wrapped bulk inserter for high-performance batch inserts.
 * Uses raw prepared statements instead of Drizzle ORM for maximum speed.
 * @param {import('better-sqlite3').Database} sqlite - Raw better-sqlite3 connection
 * @param {string} tableName - Name of the table to insert into
 * @param {string[]} columns - Array of column names
 * @returns {Function} Transaction-wrapped inserter function
 */
function createBulkInserter(sqlite, tableName, columns) {
  const placeholders = columns.map(() => '?').join(', ')
  const insertSql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`
  const stmt = sqlite.prepare(insertSql)

  return sqlite.transaction((rows) => {
    for (const row of rows) {
      stmt.run(...columns.map((col) => toSqliteValue(row[col])))
    }
  })
}

/**
 * Count rows in a CSV file via a fast newline-only scan (no parsing).
 * Subtracts 1 for the header line.
 * @param {string} filePath - Path to the CSV file
 * @param {AbortSignal} signal - Optional abort signal for cancellation
 * @returns {Promise<number>}
 */
async function countCsvRows(filePath, signal = null) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    let count = 0
    if (signal) {
      signal.addEventListener(
        'abort',
        () => stream.destroy(new DOMException('Import cancelled', 'AbortError')),
        { once: true }
      )
    }
    stream.on('data', (chunk) => {
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0x0a) count++
      }
    })
    stream.on('end', () => resolve(Math.max(0, count - 1)))
    stream.on('error', reject)
  })
}

/**
 * Insert CSV data into a Drizzle schema table.
 * Streams rows and inserts batches as they fill (O(batchSize) memory).
 * Uses raw prepared statements with transaction wrapping for maximum speed.
 * @param {Object} db - Drizzle database instance
 * @param {Object} manager - StudyDatabaseManager instance (for raw SQLite access)
 * @param {string} filePath - Path to the CSV file
 * @param {Object} table - Drizzle table schema
 * @param {string} tableName - Name of the table
 * @param {string[]} columns - Array of column names from CSV
 * @param {string} directoryPath - Path to the CamTrapDP directory
 * @param {function} onProgress - Optional callback for progress updates
 * @param {AbortSignal} signal - Optional abort signal for cancellation
 * @returns {Promise<void>}
 */
async function insertCSVData(
  db,
  manager,
  filePath,
  table,
  tableName,
  columns,
  directoryPath,
  importFolderForMedia,
  onProgress = null,
  signal = null,
  rowFilter = null
) {
  log.debug(`Beginning data insertion from ${filePath} to table ${tableName}`)
  log.debug(`directoryPath: ${directoryPath}`)

  const sqlite = manager.getSqlite()
  const totalRows = await countCsvRows(filePath, signal)
  log.debug(`Pre-scanned ${totalRows} rows in ${filePath}`)

  if (onProgress) {
    onProgress({ insertedRows: 0, totalRows, batchNumber: 0 })
  }

  const stream = fs.createReadStream(filePath).pipe(csv())
  const pathCache = {} // caches file path resolution strategy (probed on first media row)
  const batchSize = 2000
  let batch = []
  let inserter = null
  let insertedRows = 0
  let batchNumber = 0

  try {
    for await (const row of stream) {
      if (signal?.aborted) {
        throw new DOMException('Import cancelled', 'AbortError')
      }

      const transformedRow = transformRowToSchema(
        row,
        tableName,
        columns,
        directoryPath,
        pathCache,
        importFolderForMedia
      )
      if (transformedRow && (!rowFilter || rowFilter(transformedRow))) {
        // Create bulk inserter on first row (need column names from transformed data)
        if (!inserter) {
          inserter = createBulkInserter(sqlite, tableName, Object.keys(transformedRow))
        }
        batch.push(transformedRow)
      }

      if (batch.length >= batchSize) {
        inserter(batch)
        insertedRows += batch.length
        batchNumber++
        batch = []

        log.debug(`Inserted batch ${batchNumber} into ${tableName} (${insertedRows} rows so far)`)

        if (onProgress) {
          onProgress({ insertedRows, totalRows, batchNumber })
        }
      }
    }

    // Insert remaining rows
    if (batch.length > 0) {
      inserter(batch)
      insertedRows += batch.length
      batchNumber++
    }

    // Final emission: snap totalRows to insertedRows so the bar reaches 100%
    // even if some CSV rows were filtered by transformRowToSchema or the
    // newline pre-count was slightly off.
    if (onProgress) {
      onProgress({ insertedRows, totalRows: insertedRows, batchNumber })
    }

    if (insertedRows > 0) {
      log.info(`Completed insertion of ${insertedRows} rows into ${tableName}`)
    } else {
      log.warn(`No valid rows found in ${filePath} for table ${tableName}`)
    }
  } catch (error) {
    log.error(`Error during insert for ${tableName}:`, error)
    throw error
  }
}

/**
 * Transform CSV row data to match schema fields
 * @param {Object} row - CSV row data
 * @param {string} tableName - Target table name
 * @param {string[]} columns - CSV column names
 * @param {string} directoryPath - Path to the CamTrapDP directory
 * @returns {Object|null} - Transformed row data or null if invalid
 */
function transformRowToSchema(
  row,
  tableName,
  columns,
  directoryPath,
  pathCache,
  importFolderForMedia
) {
  try {
    switch (tableName) {
      case 'deployments':
        return transformDeploymentRow(row)
      case 'media':
        return transformMediaRow(row, directoryPath, pathCache, importFolderForMedia)
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

  // parseFloatOrNull preserves 0 (the equator / prime meridian); plain
  // `parseFloat(x) || null` would discard it.
  const latitude = parseFloatOrNull(row.latitude)
  const longitude = parseFloatOrNull(row.longitude)
  let locationID = row.locationID || row.location_id || null
  // Synthesize a deterministic locationID when the curator left it blank but
  // gave us coords. ~11 m precision (4 decimals) absorbs GPS jitter so
  // re-deployments at the same physical spot share an ID. Self-identifying
  // prefix lets the exporter strip these back to empty on round-trip.
  if (!locationID && latitude != null && longitude != null) {
    locationID = `${SYNTH_LOCATION_ID_PREFIX}${latitude.toFixed(4)},${longitude.toFixed(4)}`
  }

  const transformed = {
    deploymentID,
    locationID,
    locationName: row.locationName || row.location_name || null,
    deploymentStart: transformDateField(row.deploymentStart || row.deployment_start),
    deploymentEnd: transformDateField(row.deploymentEnd || row.deployment_end),
    latitude,
    longitude,
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
function transformMediaRow(row, directoryPath, pathCache, importFolderForMedia) {
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
    filePath: transformFilePathField(row.filePath || row.file_path, directoryPath, pathCache),
    fileName: row.fileName || row.file_name || path.basename(row.filePath || row.file_path || ''),
    fileMediatype: row.fileMediatype || row.file_mediatype || null,
    exifData,
    favorite,
    // Stamp the absolute package directory so the Sources tab can group by it.
    // Per spec D3: importFolder = "absolute package directory path" for CamtrapDP imports.
    // Callers (GBIF, demo) that extract into an ephemeral temp dir override this
    // with null so the Sources tab falls back to the study name instead of
    // showing a soon-to-be-deleted /tmp path.
    importFolder: importFolderForMedia
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
    scientificName: normalizeScientificName(row.scientificName || row.scientific_name),
    // Convention: observationType='blank' rows MUST have null/empty
    // scientificName. The Overview-tab species DISTINCT query (queries/
    // overview.js) drops the observationType filter for index-coverage perf
    // and relies on this — if a future importer produces blank-type rows
    // with a populated scientificName, threatenedCount/speciesCount will
    // double-count those rows.
    observationType: row.observationType || row.observation_type || null,
    commonName: row.commonName || row.common_name || null,
    classificationProbability: parseFloat(row.classificationProbability) || null,
    count: parseInt(row.count) || null,
    lifeStage: row.lifeStage || row.life_stage || null,
    age: row.age || null,
    sex: row.sex || null,
    behavior: transformBehaviorField(row.behavior),
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
 * Transform Camtrap DP behavior field from pipe-separated string to JSON array
 * Camtrap DP spec uses pipe-separated values (e.g., "running|alert")
 * We store as JSON array (e.g., ["running", "alert"])
 * @param {string|null} behavior - Pipe-separated behavior string
 * @returns {string[]|null} - Array of behavior strings or null
 */
function transformBehaviorField(behavior) {
  if (!behavior || behavior.trim() === '') {
    return null
  }
  // Split by pipe and trim whitespace from each value
  const behaviors = behavior
    .split('|')
    .map((b) => b.trim())
    .filter((b) => b !== '')
  return behaviors.length > 0 ? behaviors : null
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
function transformFilePathField(filePath, directoryPath, pathCache) {
  if (!filePath) return null

  // If it's already an absolute path or URL, return as is
  if (filePath.startsWith('http') || path.isAbsolute(filePath)) {
    return filePath
  }

  // Normalize path separators for cross-platform compatibility
  // Handle both forward and backward slashes from different OS exports
  const normalizedPath = filePath.split(/[\\/]/).join(path.sep)

  // Use cached strategy if available (probed on first media row)
  if (pathCache && pathCache.strategy !== undefined) {
    if (pathCache.strategy === 'direct') {
      return path.join(directoryPath, normalizedPath)
    }
    return path.join(path.dirname(directoryPath), normalizedPath)
  }

  // Probe: try camtrap directory first, then fall back to parent
  // This handles both:
  // 1. Re-imported exports where media is in media/ subfolder (new behavior)
  // 2. External datasets where media is in sibling directory (backward compat)
  const directPath = path.join(directoryPath, normalizedPath)
  if (fs.existsSync(directPath)) {
    if (pathCache) pathCache.strategy = 'direct'
    return directPath
  }

  // Fall back to parent directory (original behavior for backward compatibility)
  if (pathCache) pathCache.strategy = 'parent'
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
 * @param {function|null} onProgress - Optional callback for progress updates
 * @param {number} batchSize - Source observations processed per batch (default 5000)
 * @returns {Promise<{expanded: number, created: number}>} - Count of observations expanded and created
 */
export async function expandObservationsToMedia(db, onProgress = null, batchSize = 5000) {
  // Pre-flight: count source observations (event-based, no mediaID). This is
  // a small, fast scan — there are typically thousands to hundreds of
  // thousands of source observations even on very large datasets.
  const sourceCountRows = await db.all(sql`
    SELECT COUNT(*) AS c FROM observations WHERE mediaID IS NULL
  `)
  const totalSourceCount = Number(sourceCountRows[0].c)

  if (totalSourceCount === 0) {
    log.info('No event-based observations to expand - skipping expansion step')
    return { expanded: 0, created: 0 }
  }

  log.info(`Expanding up to ${totalSourceCount} event-based observations...`)

  if (onProgress) {
    onProgress({
      currentFile: 'Linking observations to media...',
      fileIndex: 0,
      totalFiles: 1,
      totalRows: totalSourceCount,
      insertedRows: 0,
      phase: 'expanding'
    })
  }

  // Paginate source observations by rowid (stable cursor, no OFFSET cost).
  // For each batch, run INSERT INTO ... SELECT joining that rowid window
  // against media — work and total time roughly match the previous single-
  // statement approach, but we emit a progress event after each batch.
  // Log once per batch — matches the precedent of the CSV inserter
  // ("Inserted batch X into observations (Y rows so far)").
  let cursor = 0
  let processed = 0
  let created = 0
  let batchNumber = 0
  while (processed < totalSourceCount) {
    const rows = await db.all(sql`
      SELECT rowid AS rid FROM observations
      WHERE mediaID IS NULL AND rowid > ${cursor}
      ORDER BY rowid LIMIT ${batchSize}
    `)
    if (rows.length === 0) break
    const lastRowid = Number(rows[rows.length - 1].rid)

    const insertResult = await db.run(sql`
      INSERT INTO observations (
        observationID, mediaID, deploymentID, eventID, eventStart, eventEnd,
        scientificName, observationType, commonName, classificationProbability,
        count, lifeStage, age, sex, behavior,
        bboxX, bboxY, bboxWidth, bboxHeight,
        detectionConfidence, modelOutputID,
        classificationMethod, classifiedBy, classificationTimestamp
      )
      SELECT
        lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
          substr(hex(randomblob(2)),2) || '-' ||
          substr('89ab', abs(random()) % 4 + 1, 1) ||
          substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
        m.mediaID, o.deploymentID, o.eventID, o.eventStart, o.eventEnd,
        o.scientificName, o.observationType, o.commonName, o.classificationProbability,
        o.count, o.lifeStage, o.age, o.sex, o.behavior,
        o.bboxX, o.bboxY, o.bboxWidth, o.bboxHeight,
        o.detectionConfidence, o.modelOutputID,
        o.classificationMethod, o.classifiedBy, o.classificationTimestamp
      FROM observations o
      INNER JOIN media m
        ON o.deploymentID = m.deploymentID
       AND m.timestamp >= o.eventStart
       AND m.timestamp <= COALESCE(o.eventEnd, o.eventStart)
      WHERE o.mediaID IS NULL
        AND o.rowid > ${cursor}
        AND o.rowid <= ${lastRowid}
    `)
    created += Number(insertResult.changes ?? 0)
    processed += rows.length
    cursor = lastRowid
    batchNumber += 1

    log.info(
      `Linking batch ${batchNumber}: ${processed.toLocaleString()}/${totalSourceCount.toLocaleString()} source observations processed (${created.toLocaleString()} new rows so far)`
    )

    if (onProgress) {
      onProgress({
        currentFile: 'Linking observations to media...',
        fileIndex: 0,
        totalFiles: 1,
        totalRows: totalSourceCount,
        insertedRows: processed,
        phase: 'expanding'
      })
    }
  }

  // DELETE original event-based observations that were expanded (had ≥1 match).
  // Source obs with no matching media (orphans) are intentionally preserved.
  const deleteResult = await db.run(sql`
    DELETE FROM observations
    WHERE mediaID IS NULL
      AND EXISTS (
        SELECT 1 FROM media m
        WHERE m.deploymentID = observations.deploymentID
          AND m.timestamp >= observations.eventStart
          AND m.timestamp <= COALESCE(observations.eventEnd, observations.eventStart)
      )
  `)
  const expanded = Number(deleteResult.changes ?? 0)

  log.info(
    `Expanded ${expanded} event-based observations into ${created} media-linked observations`
  )
  return { expanded, created }
}
