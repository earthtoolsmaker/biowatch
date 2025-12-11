import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import fs from 'fs/promises'
import { join, extname, basename } from 'path'
import log from 'electron-log'
import {
  getDrizzleDb,
  getReadonlyDrizzleDb,
  media,
  observations,
  deployments,
  closeStudyDatabase,
  getMetadata
} from './db/index.js'
import { eq, and, isNotNull, ne, or, isNull, asc, inArray } from 'drizzle-orm'
import { downloadFileWithRetry } from './download.js'
import crypto from 'crypto'
import { observationSchema } from './export/camtrapDPSchemas.js'
import { sanitizeObservation } from './export/sanitizers.js'

function getStudyDatabasePath(userDataPath, studyId) {
  return join(getStudyPath(userDataPath, studyId), 'study.db')
}

function getStudyPath(userDataPath, studyId) {
  return join(userDataPath, 'biowatch-data', 'studies', studyId)
}

// Module-level state for tracking active exports (for cancellation)
let activeExport = {
  isCancelled: false,
  isActive: false
}

// Concurrency limit for parallel downloads
const DOWNLOAD_CONCURRENCY = 5

/**
 * Cancel the currently active export
 */
function cancelActiveExport() {
  if (activeExport.isActive) {
    activeExport.isCancelled = true
    log.info('Export cancellation requested')
    return true
  }
  return false
}

/**
 * Check if a file path is a remote HTTP/HTTPS URL
 */
function isRemoteUrl(filePath) {
  return filePath && (filePath.startsWith('http://') || filePath.startsWith('https://'))
}

/**
 * Extract a safe filename from a URL, with fallback to original filename or generated name
 */
function getFileNameFromUrl(url, originalFileName) {
  try {
    const urlObj = new URL(url)
    const pathName = urlObj.pathname
    const urlFileName = basename(pathName)

    // If URL has a valid filename with extension, use it
    if (urlFileName && extname(urlFileName)) {
      return urlFileName
    }

    // Fall back to original filename from DB
    if (originalFileName) {
      return originalFileName
    }

    // Generate a unique filename if nothing else works
    return `image_${crypto.randomUUID().slice(0, 8)}${extname(pathName) || '.jpg'}`
  } catch {
    return originalFileName || `image_${crypto.randomUUID().slice(0, 8)}.jpg`
  }
}

/**
 * Deduplicate filename if it already exists in the set
 */
function deduplicateFileName(fileName, existingNames) {
  if (!existingNames.has(fileName)) {
    existingNames.add(fileName)
    return fileName
  }

  const ext = extname(fileName)
  const base = basename(fileName, ext)
  let counter = 1
  let newName = `${base}_${counter}${ext}`

  while (existingNames.has(newName)) {
    counter++
    newName = `${base}_${counter}${ext}`
  }

  existingNames.add(newName)
  return newName
}

/**
 * Send export progress to the focused window
 */
function sendExportProgress(progressData) {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  if (focusedWindow && !focusedWindow.isDestroyed()) {
    focusedWindow.webContents.send('export:progress', progressData)
  }
}

/**
 * Track progress state for parallel processing
 */
class ExportProgressTracker {
  constructor(totalFiles) {
    this.totalFiles = totalFiles
    this.processedCount = 0
    this.errorCount = 0
    this.startTime = Date.now()
    this.activeDownloads = new Map() // Track progress of concurrent downloads
  }

  incrementProcessed() {
    this.processedCount++
  }

  incrementError() {
    this.errorCount++
  }

  setDownloadProgress(fileId, percent) {
    this.activeDownloads.set(fileId, percent)
  }

  removeDownload(fileId) {
    this.activeDownloads.delete(fileId)
  }

  getEstimatedTimeRemaining() {
    if (this.processedCount === 0) return null

    const elapsedMs = Date.now() - this.startTime
    const avgTimePerFile = elapsedMs / this.processedCount
    const remainingFiles = this.totalFiles - this.processedCount
    const estimatedRemainingMs = avgTimePerFile * remainingFiles

    return Math.round(estimatedRemainingMs / 1000) // Return seconds
  }

  getOverallPercent() {
    if (this.totalFiles === 0) return 0

    // Calculate base progress from completed files
    const completedProgress = (this.processedCount / this.totalFiles) * 100

    // Add partial progress from active downloads
    let activeProgress = 0
    if (this.activeDownloads.size > 0) {
      const avgActivePercent =
        Array.from(this.activeDownloads.values()).reduce((a, b) => a + b, 0) /
        this.activeDownloads.size
      activeProgress = (avgActivePercent / 100 / this.totalFiles) * 100
    }

    return Math.min(Math.round(completedProgress + activeProgress), 100)
  }
}

/**
 * Process files in parallel with concurrency limit
 * @param {Array} files - Array of file objects to process
 * @param {Function} processFile - Async function to process each file, receives (file, index, tracker)
 * @param {ExportProgressTracker} tracker - Progress tracker instance
 * @param {number} concurrency - Maximum concurrent operations
 * @returns {Promise<{successes: number, errors: number}>}
 */
async function processFilesInParallel(
  files,
  processFile,
  tracker,
  concurrency = DOWNLOAD_CONCURRENCY
) {
  let successes = 0
  let errors = 0
  let currentIndex = 0

  const workers = Array(Math.min(concurrency, files.length))
    .fill(null)
    .map(async () => {
      while (currentIndex < files.length) {
        if (activeExport.isCancelled) {
          break
        }

        const index = currentIndex++
        const file = files[index]

        try {
          await processFile(file, index, tracker)
          successes++
          tracker.incrementProcessed()
        } catch (error) {
          log.error(`Failed to process file at index ${index}: ${error.message}`)
          errors++
          tracker.incrementError()
          tracker.incrementProcessed()
        }
      }
    })

  await Promise.all(workers)
  return { successes, errors }
}

/**
 * Export images organized by species into separate directories
 */
export async function exportImageDirectories(studyId, options = {}) {
  const { selectedSpecies = null, includeBlank = false } = options

  try {
    // Get study information from database
    const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
    let studyName = 'Unknown'
    if (existsSync(dbPath)) {
      try {
        const db = await getReadonlyDrizzleDb(studyId, dbPath)
        const metadata = await getMetadata(db)
        studyName = metadata?.name || 'Unknown'
      } catch (error) {
        log.warn(`Failed to read study name: ${error.message}`)
      }
    }

    // Let user select destination directory
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Export Destination',
      buttonLabel: 'Export Here'
    })

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { success: false, cancelled: true }
    }

    const baseExportPath = result.filePaths[0]

    // Create unique parent directory with study name and date
    const now = new Date()
    const dateStr = now.toISOString().split('T')[0] // YYYY-MM-DD
    const sanitizedStudyName = studyName.replace(/[/\\?%*:|"<>]/g, '_')
    const parentDirName = `Biowatch export ${sanitizedStudyName} ${dateStr}`
    const exportPath = join(baseExportPath, parentDirName)

    log.info(`Exporting images to: ${exportPath}`)

    if (!existsSync(dbPath)) {
      log.warn(`Database not found for study ID: ${studyId}`)
      return { success: false, error: 'Database not found for this study' }
    }

    // Get all media with species information from database using Drizzle
    const pathParts = dbPath.split('/')
    const studyIdFromPath = pathParts[pathParts.length - 2] || 'unknown'
    const db = await getDrizzleDb(studyIdFromPath, dbPath)

    // Build query conditions for species media
    const conditions = []

    if (selectedSpecies && selectedSpecies.length > 0) {
      // Filter to selected species only
      conditions.push(inArray(observations.scientificName, selectedSpecies))
    } else {
      // Default: all species with valid names
      conditions.push(isNotNull(observations.scientificName))
      conditions.push(ne(observations.scientificName, ''))
    }

    // Always exclude blanks from species query (handled separately)
    conditions.push(
      or(isNull(observations.observationType), ne(observations.observationType, 'blank'))
    )

    // Query to get media files with their species using Drizzle
    const mediaFiles = await db
      .selectDistinct({
        filePath: media.filePath,
        fileName: media.fileName,
        scientificName: observations.scientificName
      })
      .from(media)
      .innerJoin(observations, eq(media.timestamp, observations.eventStart))
      .where(and(...conditions))
      .orderBy(asc(observations.scientificName), asc(media.fileName))

    log.info(`Found ${mediaFiles.length} media files with species identifications`)

    // Group files by species
    const speciesGroups = {}
    for (const file of mediaFiles) {
      if (!speciesGroups[file.scientificName]) {
        speciesGroups[file.scientificName] = []
      }
      speciesGroups[file.scientificName].push(file)
    }

    // Query blank media separately if requested
    // Blank observations are stored with scientificName = NULL (not observationType = 'blank')
    if (includeBlank) {
      const blankMedia = await db
        .selectDistinct({
          filePath: media.filePath,
          fileName: media.fileName
        })
        .from(media)
        .innerJoin(observations, eq(media.timestamp, observations.eventStart))
        .where(isNull(observations.scientificName))
        .orderBy(asc(media.fileName))

      if (blankMedia.length > 0) {
        speciesGroups['blank'] = blankMedia
        log.info(`Found ${blankMedia.length} blank media files`)
      }
    }

    // Check if there's anything to export
    const totalGroups = Object.keys(speciesGroups).length
    if (totalGroups === 0) {
      return {
        success: false,
        error: 'No media files found matching the selected criteria'
      }
    }

    // Calculate total files across all species groups
    const allFiles = Object.values(speciesGroups).flat()
    const totalFiles = allFiles.length

    log.info(
      `Organizing ${totalFiles} files into ${Object.keys(speciesGroups).length} species directories`
    )

    // Initialize export state
    activeExport.isActive = true
    activeExport.isCancelled = false

    // Pre-process: Create directories and prepare file list with deduplicated names
    const preparedFiles = []
    const usedFileNames = new Map() // Per-species filename tracking for deduplication

    for (const [scientificName, files] of Object.entries(speciesGroups)) {
      // Create directory for this species (sanitize name for filesystem)
      const sanitizedName = scientificName.replace(/[/\\?%*:|"<>]/g, '_')
      const speciesDir = join(exportPath, sanitizedName)

      try {
        await fs.mkdir(speciesDir, { recursive: true })
        log.info(`Created directory: ${speciesDir}`)
      } catch (error) {
        log.error(`Failed to create directory ${speciesDir}: ${error.message}`)
        continue
      }

      // Initialize filename set for this species (for deduplication)
      if (!usedFileNames.has(scientificName)) {
        usedFileNames.set(scientificName, new Set())
      }
      const speciesFileNames = usedFileNames.get(scientificName)

      // Prepare each file with its destination
      for (const file of files) {
        const sourcePath = file.filePath
        const isRemote = isRemoteUrl(sourcePath)

        // Determine and deduplicate filename
        let fileName = isRemote ? getFileNameFromUrl(sourcePath, file.fileName) : file.fileName
        fileName = deduplicateFileName(fileName, speciesFileNames)

        preparedFiles.push({
          sourcePath,
          destPath: join(speciesDir, fileName),
          fileName,
          isRemote,
          id: `${scientificName}:${fileName}`,
          speciesName: scientificName
        })
      }
    }

    // Create progress tracker
    const tracker = new ExportProgressTracker(preparedFiles.length)

    // Process files in parallel
    const processFile = async (file, index, tracker) => {
      const { sourcePath, destPath, fileName, isRemote, id, speciesName } = file

      // Send progress update
      sendExportProgress({
        type: 'file',
        currentFile: tracker.processedCount + 1,
        totalFiles: tracker.totalFiles,
        fileName,
        speciesName,
        isDownloading: isRemote,
        downloadPercent: 0,
        errorCount: tracker.errorCount,
        estimatedTimeRemaining: tracker.getEstimatedTimeRemaining(),
        overallPercent: tracker.getOverallPercent()
      })

      if (isRemote) {
        tracker.setDownloadProgress(id, 0)
        // Download remote file with progress callback
        await downloadFileWithRetry(sourcePath, destPath, (progress) => {
          tracker.setDownloadProgress(id, progress.percent || 0)
          sendExportProgress({
            type: 'download',
            currentFile: tracker.processedCount + 1,
            totalFiles: tracker.totalFiles,
            fileName,
            speciesName,
            isDownloading: true,
            downloadPercent: progress.percent || 0,
            errorCount: tracker.errorCount,
            estimatedTimeRemaining: tracker.getEstimatedTimeRemaining(),
            overallPercent: tracker.getOverallPercent()
          })
        })
        tracker.removeDownload(id)
      } else {
        // Check if local source file exists
        if (!existsSync(sourcePath)) {
          throw new Error(`Source file not found: ${sourcePath}`)
        }
        // Copy local file
        await fs.copyFile(sourcePath, destPath)
      }

      // Log progress every 100 files
      if ((tracker.processedCount + 1) % 100 === 0) {
        log.info(`Processed ${tracker.processedCount + 1}/${tracker.totalFiles} files...`)
      }
    }

    const { successes, errors } = await processFilesInParallel(
      preparedFiles,
      processFile,
      tracker,
      DOWNLOAD_CONCURRENCY
    )

    activeExport.isActive = false
    await closeStudyDatabase(studyIdFromPath, dbPath)

    log.info(`Export complete: ${successes} files copied, ${errors} errors`)

    return {
      success: true,
      exportPath,
      exportFolderName: parentDirName,
      copiedCount: successes,
      errorCount: errors,
      speciesCount: Object.keys(speciesGroups).length
    }
  } catch (error) {
    log.error('Error exporting image directories:', error)
    return { success: false, error: error.message }
  }
}

/**
 * MIME type mapping for common media file extensions
 */
const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.wmv': 'video/x-ms-wmv',
  '.webm': 'video/webm'
}

/**
 * Infer MIME type from file path
 */
function inferMimeType(filePath) {
  if (!filePath) return 'application/octet-stream'
  const ext = extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

/**
 * Map internal observationType to Camtrap DP vocabulary
 * Valid values: animal, human, vehicle, blank, unknown, unclassified
 */
function mapObservationType(dbType, scientificName) {
  // If scientificName is present, it's an animal observation
  if (scientificName) return 'animal'
  if (!dbType || dbType === 'blank') return 'blank'
  if (dbType === 'machine') return 'animal'
  if (dbType === 'animal') return 'animal'
  if (dbType === 'human') return 'human'
  if (dbType === 'vehicle') return 'vehicle'
  if (dbType === 'unclassified') return 'unclassified'
  return 'unknown'
}

/**
 * Group observations into sequences based on deployment and timestamp gap.
 * When gapThresholdSeconds <= 0, returns null to signal that existing eventIDs should be preserved.
 *
 * @param {Array} observations - Observations with eventStart/timestamp and deploymentID
 * @param {number} gapThresholdSeconds - Maximum gap in seconds for grouping (0 = preserve existing)
 * @returns {Map|null} Map of observationID -> {eventID, eventStart, eventEnd}, or null to preserve existing
 */
function groupObservationsIntoSequences(observations, gapThresholdSeconds) {
  if (gapThresholdSeconds <= 0) {
    // No grouping - preserve existing eventID/eventStart/eventEnd from database
    return null
  }

  // Group observations by deployment first
  const byDeployment = {}
  for (const obs of observations) {
    const depId = obs.deploymentID || '__none__'
    if (!byDeployment[depId]) byDeployment[depId] = []
    byDeployment[depId].push(obs)
  }

  // Build mapping of observationID -> sequence data
  const eventMapping = new Map()

  for (const [depId, depObs] of Object.entries(byDeployment)) {
    // Sort by timestamp (using eventStart or fallback to timestamp field)
    depObs.sort((a, b) => {
      const timeA = new Date(a.eventStart || a.timestamp || 0).getTime()
      const timeB = new Date(b.eventStart || b.timestamp || 0).getTime()
      return timeA - timeB
    })

    let currentSeq = null
    let seqCounter = 0
    const gapMs = gapThresholdSeconds * 1000

    for (const obs of depObs) {
      const obsTime = new Date(obs.eventStart || obs.timestamp || 0).getTime()

      // Check if we should start a new sequence
      const shouldStartNew = !currentSeq || isNaN(obsTime) || obsTime - currentSeq.maxTime > gapMs

      if (shouldStartNew) {
        // Save previous sequence
        if (currentSeq) {
          finalizeSequence(currentSeq, eventMapping)
        }

        seqCounter++
        const sanitizedDepId = depId === '__none__' ? 'unknown' : depId
        currentSeq = {
          eventID: `${sanitizedDepId}_seq_${String(seqCounter).padStart(4, '0')}`,
          minTime: isNaN(obsTime) ? null : obsTime,
          maxTime: isNaN(obsTime) ? null : obsTime,
          observations: [obs]
        }
      } else {
        // Add to current sequence
        currentSeq.observations.push(obs)
        if (!isNaN(obsTime)) {
          if (currentSeq.minTime === null || obsTime < currentSeq.minTime) {
            currentSeq.minTime = obsTime
          }
          if (currentSeq.maxTime === null || obsTime > currentSeq.maxTime) {
            currentSeq.maxTime = obsTime
          }
        }
      }
    }

    // Don't forget the last sequence
    if (currentSeq) {
      finalizeSequence(currentSeq, eventMapping)
    }
  }

  return eventMapping
}

/**
 * Helper to finalize a sequence and add all its observations to the mapping
 */
function finalizeSequence(seq, eventMapping) {
  const eventStart = seq.minTime ? new Date(seq.minTime).toISOString() : null
  const eventEnd = seq.maxTime ? new Date(seq.maxTime).toISOString() : null

  for (const obs of seq.observations) {
    eventMapping.set(obs.observationID, {
      eventID: seq.eventID,
      eventStart,
      eventEnd
    })
  }
}

/**
 * Escape a value for CSV output
 */
function escapeCSV(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  // If the value contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

/**
 * Convert an array of objects to CSV string
 */
function toCSV(rows, columns) {
  const header = columns.join(',')
  const lines = rows.map((row) => columns.map((col) => escapeCSV(row[col])).join(','))
  return header + '\n' + lines.join('\n')
}

/**
 * Generate the datapackage.json content for Camtrap DP
 * @param {string} studyId - Study ID
 * @param {string} studyName - Study name
 * @param {Object} metadata - Study metadata from database
 */
function generateDataPackage(studyId, studyName, metadata = null) {
  const now = new Date().toISOString()
  const nameToSlugify = studyName || studyId
  const slugifiedName = nameToSlugify.replace(/[^a-z0-9-]/gi, '-').toLowerCase()

  // Use metadata from DB if available, otherwise defaults
  const contributors = metadata?.contributors || [
    {
      title: 'Biowatch User',
      role: 'author'
    }
  ]
  const title = metadata?.title || studyName || 'Biowatch Camera Trap Dataset'
  const description =
    metadata?.description ||
    'Camera trap dataset exported from Biowatch. This dataset contains camera trap deployment information, media files metadata, and species observations collected during wildlife monitoring.'

  // Build temporal coverage if available
  const temporal =
    metadata?.startDate && metadata?.endDate
      ? { start: metadata.startDate, end: metadata.endDate }
      : undefined

  const dataPackage = {
    name: slugifiedName,
    title,
    description,
    version: '1.0.0',
    created: now,
    contributors,
    licenses: [
      {
        name: 'CC-BY-4.0',
        title: 'Creative Commons Attribution 4.0',
        path: 'https://creativecommons.org/licenses/by/4.0/'
      }
    ],
    profile: 'tabular-data-package',
    resources: [
      {
        name: 'deployments',
        path: 'deployments.csv',
        profile: 'tabular-data-resource',
        schema: {
          fields: [
            { name: 'deploymentID', type: 'string' },
            { name: 'locationID', type: 'string' },
            { name: 'locationName', type: 'string' },
            { name: 'latitude', type: 'number' },
            { name: 'longitude', type: 'number' },
            { name: 'deploymentStart', type: 'datetime' },
            { name: 'deploymentEnd', type: 'datetime' }
          ]
        }
      },
      {
        name: 'media',
        path: 'media.csv',
        profile: 'tabular-data-resource',
        schema: {
          fields: [
            { name: 'mediaID', type: 'string' },
            { name: 'deploymentID', type: 'string' },
            { name: 'timestamp', type: 'datetime' },
            { name: 'filePath', type: 'string' },
            { name: 'filePublic', type: 'boolean' },
            { name: 'fileMediatype', type: 'string' },
            { name: 'fileName', type: 'string' },
            { name: 'exifData', type: 'object' }
          ]
        }
      },
      {
        name: 'observations',
        path: 'observations.csv',
        profile: 'tabular-data-resource',
        schema: {
          fields: [
            { name: 'observationID', type: 'string' },
            { name: 'deploymentID', type: 'string' },
            { name: 'mediaID', type: 'string' },
            { name: 'eventID', type: 'string' },
            { name: 'eventStart', type: 'datetime' },
            { name: 'eventEnd', type: 'datetime' },
            { name: 'observationLevel', type: 'string' },
            { name: 'observationType', type: 'string' },
            { name: 'scientificName', type: 'string' },
            { name: 'count', type: 'integer' },
            { name: 'lifeStage', type: 'string' },
            { name: 'sex', type: 'string' },
            { name: 'behavior', type: 'string' },
            { name: 'bboxX', type: 'number' },
            { name: 'bboxY', type: 'number' },
            { name: 'bboxWidth', type: 'number' },
            { name: 'bboxHeight', type: 'number' },
            { name: 'classificationMethod', type: 'string' },
            { name: 'classifiedBy', type: 'string' },
            { name: 'classificationTimestamp', type: 'datetime' },
            { name: 'classificationProbability', type: 'number' }
          ]
        }
      }
    ]
  }

  // Add temporal coverage if available
  if (temporal) {
    dataPackage.temporal = temporal
  }

  return dataPackage
}

/**
 * Export study data to Camtrap DP format
 */
export async function exportCamtrapDP(studyId, options = {}) {
  const {
    includeMedia = false,
    selectedSpecies = null,
    includeBlank = false,
    sequenceGap = 0
  } = options

  try {
    // Get study information from database
    const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
    let studyName = 'Unknown'
    let studyMetadata = null
    if (existsSync(dbPath)) {
      try {
        const db = await getReadonlyDrizzleDb(studyId, dbPath)
        studyMetadata = await getMetadata(db)
        studyName = studyMetadata?.name || 'Unknown'
      } catch (error) {
        log.warn(`Failed to read study name: ${error.message}`)
      }
    }

    // Let user select destination directory
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Camtrap DP Export Destination',
      buttonLabel: 'Export Here'
    })

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { success: false, cancelled: true }
    }

    const baseExportPath = result.filePaths[0]

    // Create unique parent directory with study name and date
    const now = new Date()
    const dateStr = now.toISOString().split('T')[0] // YYYY-MM-DD
    const sanitizedStudyName = studyName.replace(/[/\\?%*:|"<>]/g, '_')
    const parentDirName = `Biowatch export ${sanitizedStudyName} ${dateStr}`
    const exportPath = join(baseExportPath, parentDirName)

    log.info(`Exporting Camtrap DP to: ${exportPath}`)

    // Create export directory
    await fs.mkdir(exportPath, { recursive: true })

    if (!existsSync(dbPath)) {
      log.warn(`Database not found for study ID: ${studyId}`)
      return { success: false, error: 'Database not found for this study' }
    }

    const pathParts = dbPath.split('/')
    const studyIdFromPath = pathParts[pathParts.length - 2] || 'unknown'
    const db = await getDrizzleDb(studyIdFromPath, dbPath)

    // Query all deployments
    const deploymentsData = await db
      .select({
        deploymentID: deployments.deploymentID,
        locationID: deployments.locationID,
        locationName: deployments.locationName,
        latitude: deployments.latitude,
        longitude: deployments.longitude,
        deploymentStart: deployments.deploymentStart,
        deploymentEnd: deployments.deploymentEnd
      })
      .from(deployments)
      .orderBy(asc(deployments.deploymentID))

    log.info(`Found ${deploymentsData.length} deployments`)

    // Build observation filter conditions
    const obsConditions = []

    if (selectedSpecies && selectedSpecies.length > 0) {
      // Filter to selected species only
      obsConditions.push(inArray(observations.scientificName, selectedSpecies))
    } else {
      // Default: all species with valid names (non-blank)
      obsConditions.push(isNotNull(observations.scientificName))
      obsConditions.push(ne(observations.scientificName, ''))
    }

    // Exclude blanks from species query (blanks have NULL scientificName)
    obsConditions.push(
      or(isNull(observations.observationType), ne(observations.observationType, 'blank'))
    )

    // Query filtered observations (non-blank species)
    let observationsData = await db
      .select({
        observationID: observations.observationID,
        deploymentID: observations.deploymentID,
        mediaID: observations.mediaID,
        eventID: observations.eventID,
        eventStart: observations.eventStart,
        eventEnd: observations.eventEnd,
        observationType: observations.observationType,
        scientificName: observations.scientificName,
        count: observations.count,
        lifeStage: observations.lifeStage,
        sex: observations.sex,
        behavior: observations.behavior,
        bboxX: observations.bboxX,
        bboxY: observations.bboxY,
        bboxWidth: observations.bboxWidth,
        bboxHeight: observations.bboxHeight,
        classificationMethod: observations.classificationMethod,
        classifiedBy: observations.classifiedBy,
        classificationTimestamp: observations.classificationTimestamp,
        classificationProbability: observations.classificationProbability
      })
      .from(observations)
      .where(and(...obsConditions))
      .orderBy(asc(observations.observationID))

    // Add blank observations if requested
    if (includeBlank) {
      const blankObservations = await db
        .select({
          observationID: observations.observationID,
          deploymentID: observations.deploymentID,
          mediaID: observations.mediaID,
          eventID: observations.eventID,
          eventStart: observations.eventStart,
          eventEnd: observations.eventEnd,
          observationType: observations.observationType,
          scientificName: observations.scientificName,
          count: observations.count,
          lifeStage: observations.lifeStage,
          sex: observations.sex,
          behavior: observations.behavior,
          bboxX: observations.bboxX,
          bboxY: observations.bboxY,
          bboxWidth: observations.bboxWidth,
          bboxHeight: observations.bboxHeight,
          classificationMethod: observations.classificationMethod,
          classifiedBy: observations.classifiedBy,
          classificationTimestamp: observations.classificationTimestamp,
          classificationProbability: observations.classificationProbability
        })
        .from(observations)
        .where(isNull(observations.scientificName))
        .orderBy(asc(observations.observationID))

      observationsData = [...observationsData, ...blankObservations]
      log.info(`Added ${blankObservations.length} blank observations`)
    }

    log.info(`Found ${observationsData.length} observations after filtering`)

    // Check if there's anything to export
    if (observationsData.length === 0) {
      await closeStudyDatabase(studyIdFromPath, dbPath)
      return {
        success: false,
        error: 'No observations found matching the selected criteria'
      }
    }

    // Get unique mediaIDs from filtered observations
    const filteredMediaIDs = [...new Set(observationsData.map((o) => o.mediaID).filter(Boolean))]

    // Query only media that has matching observations
    let mediaData = []
    if (filteredMediaIDs.length > 0) {
      mediaData = await db
        .select({
          mediaID: media.mediaID,
          deploymentID: media.deploymentID,
          timestamp: media.timestamp,
          filePath: media.filePath,
          fileName: media.fileName,
          exifData: media.exifData
        })
        .from(media)
        .where(inArray(media.mediaID, filteredMediaIDs))
        .orderBy(asc(media.mediaID))
    }

    log.info(`Found ${mediaData.length} media files for filtered observations`)

    // Build filename mapping for deduplication when includeMedia is true
    const usedFileNames = new Set()
    const mediaFileNameMap = new Map() // mediaID -> deduplicated fileName

    if (includeMedia) {
      for (const m of mediaData) {
        const isRemote = isRemoteUrl(m.filePath)
        let fileName = isRemote ? getFileNameFromUrl(m.filePath, m.fileName) : m.fileName
        fileName = deduplicateFileName(fileName, usedFileNames)
        mediaFileNameMap.set(m.mediaID, fileName)
      }
    }

    // Transform media data for Camtrap DP
    const mediaRows = mediaData.map((m) => {
      // When includeMedia is true, use the deduplicated filename
      // When includeMedia is false, keep the original filePath (which may be HTTP URL)
      const exportFileName = includeMedia ? mediaFileNameMap.get(m.mediaID) : m.fileName
      const exportFilePath = includeMedia ? `media/${exportFileName}` : m.filePath

      return {
        mediaID: m.mediaID,
        deploymentID: m.deploymentID,
        timestamp: m.timestamp,
        filePath: exportFilePath,
        filePublic: false,
        fileMediatype: inferMimeType(m.filePath),
        fileName: exportFileName,
        exifData: m.exifData ? JSON.stringify(m.exifData) : ''
      }
    })

    // Generate sequence grouping if sequenceGap > 0
    // Returns null when sequenceGap <= 0, signaling to preserve existing eventIDs
    const eventMapping = groupObservationsIntoSequences(observationsData, sequenceGap)

    log.info(
      eventMapping
        ? `Generated ${new Set([...eventMapping.values()].map((v) => v.eventID)).size} sequences with gap ${sequenceGap}s`
        : `Preserving existing eventIDs (sequenceGap=0)`
    )

    // Transform and validate observations data for Camtrap DP
    const validationErrors = []
    const observationsRows = observationsData.map((o, index) => {
      // Use generated event data if available, otherwise preserve existing
      const eventData = eventMapping?.get(o.observationID)

      // Build raw observation row
      const rawRow = {
        observationID: o.observationID,
        deploymentID: o.deploymentID,
        mediaID: o.mediaID,
        eventID: eventData ? eventData.eventID : o.eventID,
        eventStart: eventData ? eventData.eventStart : o.eventStart,
        eventEnd: eventData ? eventData.eventEnd : o.eventEnd,
        observationLevel: 'media',
        observationType: mapObservationType(o.observationType, o.scientificName),
        scientificName: o.scientificName,
        count: o.count,
        lifeStage: o.lifeStage,
        sex: o.sex,
        behavior: o.behavior,
        bboxX: o.bboxX,
        bboxY: o.bboxY,
        bboxWidth: o.bboxWidth,
        bboxHeight: o.bboxHeight,
        classificationMethod: o.classificationMethod,
        classifiedBy: o.classifiedBy,
        classificationTimestamp: o.classificationTimestamp,
        classificationProbability: o.classificationProbability
      }

      // Sanitize values to comply with CamtrapDP spec
      const sanitizedRow = sanitizeObservation(rawRow)

      // Validate against schema (non-blocking - collect errors)
      const result = observationSchema.safeParse(sanitizedRow)
      if (!result.success) {
        validationErrors.push({
          rowIndex: index,
          observationID: o.observationID,
          errors: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        })
      }

      return sanitizedRow
    })

    // Log validation warnings (non-blocking)
    if (validationErrors.length > 0) {
      log.warn(
        `CamtrapDP validation: ${validationErrors.length} of ${observationsRows.length} observations have issues`
      )
      validationErrors.slice(0, 5).forEach((e) => {
        log.warn(`  Observation ${e.observationID}: ${JSON.stringify(e.errors)}`)
      })
      if (validationErrors.length > 5) {
        log.warn(`  ... and ${validationErrors.length - 5} more`)
      }
    } else {
      log.info(`CamtrapDP validation: All ${observationsRows.length} observations are valid`)
    }

    // Generate CSV files
    const deploymentsCSV = toCSV(deploymentsData, [
      'deploymentID',
      'locationID',
      'locationName',
      'latitude',
      'longitude',
      'deploymentStart',
      'deploymentEnd'
    ])

    const mediaCSV = toCSV(mediaRows, [
      'mediaID',
      'deploymentID',
      'timestamp',
      'filePath',
      'filePublic',
      'fileMediatype',
      'fileName',
      'exifData'
    ])

    const observationsCSV = toCSV(observationsRows, [
      'observationID',
      'deploymentID',
      'mediaID',
      'eventID',
      'eventStart',
      'eventEnd',
      'observationLevel',
      'observationType',
      'scientificName',
      'count',
      'lifeStage',
      'sex',
      'behavior',
      'bboxX',
      'bboxY',
      'bboxWidth',
      'bboxHeight',
      'classificationMethod',
      'classifiedBy',
      'classificationTimestamp',
      'classificationProbability'
    ])

    // Generate datapackage.json
    const dataPackage = generateDataPackage(studyId, studyName, studyMetadata)

    // Write all files
    await Promise.all([
      fs.writeFile(join(exportPath, 'datapackage.json'), JSON.stringify(dataPackage, null, 2)),
      fs.writeFile(join(exportPath, 'deployments.csv'), deploymentsCSV),
      fs.writeFile(join(exportPath, 'media.csv'), mediaCSV),
      fs.writeFile(join(exportPath, 'observations.csv'), observationsCSV)
    ])

    // Copy/download media files if requested
    let copiedMediaCount = 0
    let mediaErrorCount = 0

    if (includeMedia && mediaData.length > 0) {
      const mediaDir = join(exportPath, 'media')
      await fs.mkdir(mediaDir, { recursive: true })

      log.info(`Processing ${mediaData.length} media files to: ${mediaDir}`)

      // Initialize export state
      activeExport.isActive = true
      activeExport.isCancelled = false

      // Prepare files for parallel processing
      const preparedMediaFiles = mediaData.map((mediaFile) => {
        const sourcePath = mediaFile.filePath
        const isRemote = isRemoteUrl(sourcePath)
        const destFileName = mediaFileNameMap.get(mediaFile.mediaID)

        return {
          sourcePath,
          destPath: join(mediaDir, destFileName),
          fileName: destFileName,
          isRemote,
          id: mediaFile.mediaID
        }
      })

      // Create progress tracker
      const tracker = new ExportProgressTracker(preparedMediaFiles.length)

      // Process files in parallel
      const processMediaFile = async (file, index, tracker) => {
        const { sourcePath, destPath, fileName, isRemote, id } = file

        // Send progress update (no species grouping in CamtrapDP export)
        sendExportProgress({
          type: 'file',
          currentFile: tracker.processedCount + 1,
          totalFiles: tracker.totalFiles,
          fileName,
          speciesName: null,
          isDownloading: isRemote,
          downloadPercent: 0,
          errorCount: tracker.errorCount,
          estimatedTimeRemaining: tracker.getEstimatedTimeRemaining(),
          overallPercent: tracker.getOverallPercent()
        })

        if (isRemote) {
          tracker.setDownloadProgress(id, 0)
          // Download remote file with progress callback
          await downloadFileWithRetry(sourcePath, destPath, (progress) => {
            tracker.setDownloadProgress(id, progress.percent || 0)
            sendExportProgress({
              type: 'download',
              currentFile: tracker.processedCount + 1,
              totalFiles: tracker.totalFiles,
              fileName,
              speciesName: null,
              isDownloading: true,
              downloadPercent: progress.percent || 0,
              errorCount: tracker.errorCount,
              estimatedTimeRemaining: tracker.getEstimatedTimeRemaining(),
              overallPercent: tracker.getOverallPercent()
            })
          })
          tracker.removeDownload(id)
        } else {
          // Check if local source file exists
          if (!existsSync(sourcePath)) {
            throw new Error(`Source file not found: ${sourcePath}`)
          }
          // Copy local file
          await fs.copyFile(sourcePath, destPath)
        }

        // Log progress every 100 files
        if ((tracker.processedCount + 1) % 100 === 0) {
          log.info(`Processed ${tracker.processedCount + 1}/${tracker.totalFiles} media files...`)
        }
      }

      const { successes, errors } = await processFilesInParallel(
        preparedMediaFiles,
        processMediaFile,
        tracker,
        DOWNLOAD_CONCURRENCY
      )

      copiedMediaCount = successes
      mediaErrorCount = errors

      activeExport.isActive = false
      log.info(
        `Media processing complete: ${copiedMediaCount} files copied, ${mediaErrorCount} errors`
      )
    }

    await closeStudyDatabase(studyIdFromPath, dbPath)

    log.info(
      `Camtrap DP export complete: ${deploymentsData.length} deployments, ${mediaData.length} media, ${observationsData.length} observations`
    )

    return {
      success: true,
      exportPath,
      exportFolderName: parentDirName,
      deploymentsCount: deploymentsData.length,
      mediaCount: mediaData.length,
      observationsCount: observationsData.length,
      ...(includeMedia && {
        copiedMediaCount,
        mediaErrorCount
      }),
      // CamtrapDP validation summary
      validation: {
        observationsValidated: observationsRows.length,
        observationsWithIssues: validationErrors.length,
        isValid: validationErrors.length === 0,
        sampleErrors: validationErrors.slice(0, 5)
      }
    }
  } catch (error) {
    log.error('Error exporting Camtrap DP:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Register all export-related IPC handlers
 */
export function registerExportIPCHandlers() {
  ipcMain.handle('export:image-directories', async (_, studyId, options) => {
    return await exportImageDirectories(studyId, options)
  })

  ipcMain.handle('export:camtrap-dp', async (_, studyId, options) => {
    return await exportCamtrapDP(studyId, options)
  })

  ipcMain.handle('export:cancel', async () => {
    return cancelActiveExport()
  })
}
