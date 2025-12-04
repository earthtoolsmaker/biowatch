import { app, dialog, ipcMain } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'
import { getDrizzleDb, media, observations, closeStudyDatabase } from './db/index.js'
import { eq, and, isNotNull, ne, or, isNull, asc } from 'drizzle-orm'

function getStudyDatabasePath(userDataPath, studyId) {
  return join(getStudyPath(userDataPath, studyId), 'study.db')
}

function getStudyPath(userDataPath, studyId) {
  return join(userDataPath, 'biowatch-data', 'studies', studyId)
}

/**
 * Export images organized by species into separate directories
 */
export async function exportImageDirectories(studyId) {
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
        const fs = await import('fs/promises')
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

    // Query to get all media files with their species using Drizzle
    const mediaFiles = await db
      .selectDistinct({
        filePath: media.filePath,
        fileName: media.fileName,
        scientificName: observations.scientificName
      })
      .from(media)
      .innerJoin(observations, eq(media.timestamp, observations.eventStart))
      .where(
        and(
          isNotNull(observations.scientificName),
          ne(observations.scientificName, ''),
          or(isNull(observations.observationType), ne(observations.observationType, 'blank'))
        )
      )
      .orderBy(asc(observations.scientificName), asc(media.fileName))

    log.info(`Found ${mediaFiles.length} media files with species identifications`)

    if (mediaFiles.length === 0) {
      return {
        success: false,
        error: 'No media files with species identifications found in this study'
      }
    }

    // Group files by species
    const speciesGroups = {}
    for (const file of mediaFiles) {
      if (!speciesGroups[file.scientificName]) {
        speciesGroups[file.scientificName] = []
      }
      speciesGroups[file.scientificName].push(file)
    }

    log.info(
      `Organizing ${mediaFiles.length} files into ${Object.keys(speciesGroups).length} species directories`
    )

    // Copy files to species directories
    const fs = await import('fs/promises')
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
 * Register all export-related IPC handlers
 */
export function registerExportIPCHandlers() {
  ipcMain.handle('export:image-directories', async (_, studyId) => {
    return await exportImageDirectories(studyId)
  })
}
