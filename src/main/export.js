import { app, dialog, ipcMain } from 'electron'
import { existsSync } from 'fs'
import fs from 'fs/promises'
import { join, extname } from 'path'
import log from 'electron-log'
import { getDrizzleDb, media, observations, deployments, closeStudyDatabase } from './db/index.js'
import { eq, and, isNotNull, ne, or, isNull, asc, inArray } from 'drizzle-orm'

function getStudyDatabasePath(userDataPath, studyId) {
  return join(getStudyPath(userDataPath, studyId), 'study.db')
}

function getStudyPath(userDataPath, studyId) {
  return join(userDataPath, 'biowatch-data', 'studies', studyId)
}

/**
 * Export images organized by species into separate directories
 */
export async function exportImageDirectories(studyId, options = {}) {
  const { selectedSpecies = null, includeBlank = false } = options

  try {
    // Get study information to use in folder name
    const studyJsonPath = join(
      app.getPath('userData'),
      'biowatch-data',
      'studies',
      studyId,
      'study.json'
    )
    let studyName = 'Unknown'
    if (existsSync(studyJsonPath)) {
      try {
        const studyData = JSON.parse(await fs.readFile(studyJsonPath, 'utf8'))
        studyName = studyData.name || 'Unknown'
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

    const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
    if (!dbPath || !existsSync(dbPath)) {
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

    log.info(
      `Organizing ${mediaFiles.length} files into ${Object.keys(speciesGroups).length} species directories`
    )

    // Copy files to species directories
    let copiedCount = 0
    let errorCount = 0

    for (const [scientificName, files] of Object.entries(speciesGroups)) {
      // Create directory for this species (sanitize name for filesystem)
      const sanitizedName = scientificName.replace(/[/\\?%*:|"<>]/g, '_')
      const speciesDir = join(exportPath, sanitizedName)

      try {
        await fs.mkdir(speciesDir, { recursive: true })
        log.info(`Created directory: ${speciesDir}`)
      } catch (error) {
        log.error(`Failed to create directory ${speciesDir}: ${error.message}`)
        errorCount += files.length
        continue
      }

      // Copy each file to the species directory
      for (const file of files) {
        try {
          const sourcePath = file.filePath
          const destPath = join(speciesDir, file.fileName)

          // Check if source file exists
          if (!existsSync(sourcePath)) {
            log.warn(`Source file not found: ${sourcePath}`)
            errorCount++
            continue
          }

          await fs.copyFile(sourcePath, destPath)
          copiedCount++

          if (copiedCount % 100 === 0) {
            log.info(`Copied ${copiedCount}/${mediaFiles.length} files...`)
          }
        } catch (error) {
          log.error(`Failed to copy ${file.filePath}: ${error.message}`)
          errorCount++
        }
      }
    }

    await closeStudyDatabase(studyIdFromPath, dbPath)

    log.info(`Export complete: ${copiedCount} files copied, ${errorCount} errors`)

    return {
      success: true,
      exportPath,
      exportFolderName: parentDirName,
      copiedCount,
      errorCount,
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
  if (dbType === 'machine' || dbType === 'human') return 'animal'
  if (dbType === 'animal') return 'animal'
  if (dbType === 'vehicle') return 'vehicle'
  return 'unknown'
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
 * Uses study metadata for title, description, contributors, and temporal coverage
 */
function generateDataPackage(studyId, studyName, studyData = {}) {
  const now = new Date().toISOString()
  const nameToSlugify = studyName || studyId
  const slugifiedName = nameToSlugify.replace(/[^a-z0-9-]/gi, '-').toLowerCase()

  // Use study metadata if available, otherwise use defaults
  const description =
    studyData.description ||
    'Camera trap dataset exported from Biowatch. This dataset contains camera trap deployment information, media files metadata, and species observations collected during wildlife monitoring.'

  const contributors =
    studyData.contributors && studyData.contributors.length > 0
      ? studyData.contributors
      : [{ title: 'Biowatch User', role: 'author' }]

  // Build temporal coverage if available
  const temporal = studyData.temporal
    ? { start: studyData.temporal.start, end: studyData.temporal.end }
    : undefined

  // Build the datapackage object
  const dataPackage = {
    name: slugifiedName,
    title: studyName || 'Biowatch Camera Trap Dataset',
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
            { name: 'fileName', type: 'string' }
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
  const { includeMedia = false, selectedSpecies = null, includeBlank = false } = options

  try {
    // Get study information including metadata
    const studyJsonPath = join(
      app.getPath('userData'),
      'biowatch-data',
      'studies',
      studyId,
      'study.json'
    )
    let studyName = 'Unknown'
    let studyMetadata = {}
    if (existsSync(studyJsonPath)) {
      try {
        const studyData = JSON.parse(await fs.readFile(studyJsonPath, 'utf8'))
        studyName = studyData.name || 'Unknown'
        // Extract metadata for export (description, contributors, temporal)
        studyMetadata = studyData.data || {}
      } catch (error) {
        log.warn(`Failed to read study data: ${error.message}`)
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

    const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
    if (!dbPath || !existsSync(dbPath)) {
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
        confidence: observations.confidence
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
          confidence: observations.confidence
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
          fileName: media.fileName
        })
        .from(media)
        .where(inArray(media.mediaID, filteredMediaIDs))
        .orderBy(asc(media.mediaID))
    }

    log.info(`Found ${mediaData.length} media files for filtered observations`)

    // Transform media data for Camtrap DP
    const mediaRows = mediaData.map((m) => ({
      mediaID: m.mediaID,
      deploymentID: m.deploymentID,
      timestamp: m.timestamp,
      filePath: includeMedia ? `media/${m.fileName}` : m.filePath,
      filePublic: false,
      fileMediatype: inferMimeType(m.filePath),
      fileName: m.fileName
    }))

    // Transform observations data for Camtrap DP
    const observationsRows = observationsData.map((o) => ({
      observationID: o.observationID,
      deploymentID: o.deploymentID,
      mediaID: o.mediaID,
      eventID: o.eventID,
      eventStart: o.eventStart,
      eventEnd: o.eventEnd,
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
      classificationProbability: o.confidence
    }))

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
      'fileName'
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

    // Generate datapackage.json with study metadata
    const dataPackage = generateDataPackage(studyId, studyName, studyMetadata)

    // Write all files
    await Promise.all([
      fs.writeFile(join(exportPath, 'datapackage.json'), JSON.stringify(dataPackage, null, 2)),
      fs.writeFile(join(exportPath, 'deployments.csv'), deploymentsCSV),
      fs.writeFile(join(exportPath, 'media.csv'), mediaCSV),
      fs.writeFile(join(exportPath, 'observations.csv'), observationsCSV)
    ])

    // Copy media files if requested
    let copiedMediaCount = 0
    let mediaErrorCount = 0

    if (includeMedia && mediaData.length > 0) {
      const mediaDir = join(exportPath, 'media')
      await fs.mkdir(mediaDir, { recursive: true })

      log.info(`Copying ${mediaData.length} media files to: ${mediaDir}`)

      for (const mediaFile of mediaData) {
        try {
          const sourcePath = mediaFile.filePath

          if (!existsSync(sourcePath)) {
            log.warn(`Source file not found: ${sourcePath}`)
            mediaErrorCount++
            continue
          }

          const destPath = join(mediaDir, mediaFile.fileName)
          await fs.copyFile(sourcePath, destPath)
          copiedMediaCount++

          if (copiedMediaCount % 100 === 0) {
            log.info(`Copied ${copiedMediaCount}/${mediaData.length} media files...`)
          }
        } catch (error) {
          log.error(`Failed to copy ${mediaFile.filePath}: ${error.message}`)
          mediaErrorCount++
        }
      }

      log.info(`Media copy complete: ${copiedMediaCount} files copied, ${mediaErrorCount} errors`)
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
      })
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
}
