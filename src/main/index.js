import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { spawn } from 'child_process'
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, rmSync } from 'fs'
import { extname, join } from 'path'
import icon from '../../resources/icon.png?asset'
import { importCamTrapDataset } from './camtrap'
import { registerMLModelManagementIPCHandlers, garbageCollect, shutdownAllServers } from './models'
import { getDrizzleDb, deployments, closeStudyDatabase } from './db/index.js'
import { eq } from 'drizzle-orm'
import {
  getDeployments,
  getLocationsActivity,
  getDeploymentsActivity,
  getMedia,
  getMediaBboxes,
  getMediaBboxesBatch,
  checkMediaHaveBboxes,
  getSpeciesDailyActivity,
  getSpeciesDistribution,
  getSpeciesHeatmapData,
  getSpeciesTimeseries,
  getFilesData,
  updateMediaTimestamp,
  updateObservationClassification,
  updateObservationBbox,
  deleteObservation,
  createObservation,
  getDistinctSpecies,
  checkStudyHasEventIDs
} from './queries'
import './importer.js' // Side-effect: registers IPC handlers
import './studies.js' // Side-effect: registers IPC handlers
import { importWildlifeDataset } from './wildlife'
import { importDeepfauneDataset } from './deepfaune'
import { extractZip, downloadFile } from './download'
import migrations from './migrations/index.js'
import { registerExportIPCHandlers } from './export.js'
import { registerTranscodeIPCHandlers, cleanExpiredTranscodeCache } from './transcoder.js'

// Configure electron-log
log.transports.file.level = 'info'
log.transports.console.level = 'info'

// Track shutdown state to prevent multiple shutdown attempts
let isShuttingDown = false

autoUpdater.logger = log
autoUpdater.checkForUpdatesAndNotify()

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1300,
    height: 800,
    // show: false,
    // frame: false,
    // titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    // mainWindow.webContents.openDevTools()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Setup drag and drop event handlers
  mainWindow.webContents.on('will-navigate', (event) => {
    // Prevent navigation when dropping files
    event.preventDefault()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function getStudyDatabasePath(userDataPath, studyId) {
  return join(getStudyPath(userDataPath, studyId), 'study.db')
}

function getStudyPath(userDataPath, studyId) {
  return join(userDataPath, 'biowatch-data', 'studies', studyId)
}

log.info('Starting Electron app...')

/**
 * Initialize and run database migrations before starting the app
 * This ensures that user data is properly migrated to new formats
 * before any UI or database operations begin.
 */
async function initializeMigrations() {
  try {
    const userDataPath = app.getPath('userData')

    log.info('Migration status', await migrations.getMigrationStatus(userDataPath))

    await migrations.runMigrations(userDataPath, log)

    // log.info('Checking for pending migrations...')
    // const migrationStatus = await getMigrationStatus(userDataPath)
    // log.info('Migration status:', migrationStatus)

    // if (migrationStatus.needsMigration) {
    //   log.info('Running pending migrations...')
    //   await runMigrations(userDataPath, log)
    //   log.info('Migrations completed successfully')
    // } else {
    //   log.info('No migrations needed')
    // }
  } catch (error) {
    log.error('Migration failed:', error)
    // Show error dialog to user
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Migration Failed',
      message: 'The application failed to migrate your data. Please contact support.',
      detail: error.message,
      buttons: ['Quit', 'Continue Anyway'],
      defaultId: 0
    })

    if (response === 0) {
      app.quit()
      return false
    }
  }
  return true
}

// Add this before app.whenReady()
function registerLocalFileProtocol() {
  protocol.handle('local-file', (request) => {
    const url = new URL(request.url)
    const filePath = url.searchParams.get('path')

    log.info('=== local-file protocol request ===')
    log.info('File path:', filePath)

    // Check if file exists
    if (!filePath || !existsSync(filePath)) {
      log.error('File not found:', filePath)
      return new Response('File not found', { status: 404 })
    }

    try {
      const stats = statSync(filePath)
      const fileSize = stats.size
      const rangeHeader = request.headers.get('range')

      // Determine content type
      const ext = extname(filePath).toLowerCase()
      const mimeTypes = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
      }
      const contentType = mimeTypes[ext] || 'application/octet-stream'

      // Read entire file into buffer (simpler approach for now)
      const buffer = readFileSync(filePath)

      // Handle Range requests for video streaming
      if (rangeHeader) {
        const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/)
        if (rangeMatch) {
          const start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0
          const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1
          const chunkSize = end - start + 1

          log.info(`Range request: bytes=${start}-${end}/${fileSize}`)

          // Slice the buffer to get the requested range
          const chunk = buffer.slice(start, end + 1)

          return new Response(chunk, {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(chunkSize),
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes'
            }
          })
        }
      }

      // Non-range request: return full file
      log.info(`Full file request: ${fileSize} bytes`)

      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes'
        }
      })
    } catch (error) {
      log.error('Error serving file:', error)
      return new Response('Error serving file', { status: 500 })
    }
  })
}

// Add a shared function to process datasets (used by both select-dataset and import-dropped-dataset)
async function processDataset(inputPath, id) {
  let pathToImport = inputPath

  try {
    // Check if selected path is a file (potential zip) or directory
    const stats = statSync(inputPath)
    const isZip = stats.isFile() && inputPath.toLowerCase().endsWith('.zip')

    if (isZip) {
      log.info(`Processing zip file: ${inputPath}`)

      // Create a directory for extraction in app data
      const extractPath = join(app.getPath('userData'), id)
      if (!existsSync(extractPath)) {
        mkdirSync(extractPath, { recursive: true })
      }

      // Extract the zip file
      log.info(`Extracting ${inputPath} to ${extractPath}`)
      await new Promise((resolve, reject) => {
        const tarProcess = spawn('tar', ['-xf', inputPath, '-C', extractPath])

        tarProcess.stdout.on('data', (data) => {
          log.info(`tar output: ${data}`)
        })

        tarProcess.stderr.on('data', (data) => {
          log.info(`tar progress: ${data}`)
        })

        tarProcess.on('error', (err) => {
          log.error(`Error executing tar command:`, err)
          reject(err)
        })

        tarProcess.on('close', (code) => {
          if (code === 0) {
            log.info(`Extraction complete to ${extractPath}`)
            resolve()
          } else {
            const err = new Error(`tar process exited with code ${code}`)
            log.error(err)
            reject(err)
          }
        })
      })

      // Find the directory containing a datapackage.json file
      let camtrapDpDirPath = null

      const findCamtrapDpDir = (dir) => {
        if (camtrapDpDirPath) return // Already found, exit recursion

        try {
          const files = readdirSync(dir)

          // First check if this directory has datapackage.json
          if (files.includes('datapackage.json')) {
            camtrapDpDirPath = dir
            return
          }

          // Then check subdirectories
          for (const file of files) {
            const fullPath = join(dir, file)
            if (statSync(fullPath).isDirectory()) {
              findCamtrapDpDir(fullPath)
            }
          }
        } catch (error) {
          log.warn(`Error reading directory ${dir}: ${error.message}`)
        }
      }

      findCamtrapDpDir(extractPath)

      if (!camtrapDpDirPath) {
        throw new Error('CamTrap DP directory with datapackage.json not found in extracted archive')
      }

      log.info(`Found CamTrap DP directory at ${camtrapDpDirPath}`)
      pathToImport = camtrapDpDirPath
    } else if (!stats.isDirectory()) {
      throw new Error('The selected path is neither a directory nor a zip file')
    }

    // Import the dataset
    const { data } = await importCamTrapDataset(pathToImport, id)

    if (!data) {
      return
    }

    // Clean up CSV files and datapackage.json after successful import if it was a zip
    if (pathToImport !== inputPath) {
      log.info('Cleaning up CSV files and datapackage.json...')

      const cleanupDirectory = (dir) => {
        try {
          const files = readdirSync(dir)

          for (const file of files) {
            const fullPath = join(dir, file)

            if (statSync(fullPath).isDirectory()) {
              cleanupDirectory(fullPath)
            } else if (
              file.toLowerCase().endsWith('.csv') ||
              file.toLowerCase() === 'datapackage.json'
            ) {
              log.info(`Removing file: ${fullPath}`)
              unlinkSync(fullPath)
            }
          }
        } catch (error) {
          log.warn(`Error cleaning up directory ${dir}: ${error.message}`)
        }
      }

      cleanupDirectory(pathToImport)
    }

    return {
      path: pathToImport,
      data,
      id
    }
  } catch (error) {
    log.error('Error processing dataset:', error)
    // Clean up extracted directory if there was an error
    if (pathToImport !== inputPath) {
      try {
        await new Promise((resolve) => {
          const rmProcess = spawn('rm', ['-rf', join(app.getPath('userData'), id)])
          rmProcess.on('close', () => resolve())
          rmProcess.on('error', () => resolve())
        })
      } catch (cleanupError) {
        log.warn(`Failed to clean up after error: ${cleanupError.message}`)
      }
    }
    throw error
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Initialize migrations first, before creating any windows
  const migrationSuccess = await initializeMigrations()
  if (!migrationSuccess) {
    return // App will quit if migrations failed and user chose to quit
  }

  // Set app user model id for windows
  electronApp.setAppUserModelId('org.biowatch')

  // Register local-file:// protocol
  registerLocalFileProtocol()

  // Garbage collect stale ML Models and environments
  garbageCollect()

  // Clean expired transcode cache in background (fire-and-forget, don't await)
  cleanExpiredTranscodeCache()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ipc:ping', () => log.info('pong'))

  // Add image selection handler
  ipcMain.handle('dialog:select-image', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif'] }]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0]
      // Convert Windows backslashes to forward slashes for URLs
      const urlPath = filePath.replace(/\\/g, '/')
      return {
        path: filePath,
        url: `local-file://get?path=${urlPath}`
      }
    }
    return null
  })

  // Add dataset selection handler (supports both directories and zip files)
  // Note: On Linux, GTK file chooser cannot handle ['openFile', 'openDirectory'] together,
  // so we use directory-only mode on Linux
  ipcMain.handle('import:select-camtrap-dp', async () => {
    const isLinux = process.platform === 'linux'

    const result = await dialog.showOpenDialog({
      title: 'Select CamTrap DP Dataset',
      defaultPath: app.getPath('home'),
      properties: isLinux ? ['openDirectory'] : ['openFile', 'openDirectory'],
      filters: isLinux
        ? undefined
        : [
            { name: 'Datasets', extensions: ['zip'] },
            { name: 'All Files', extensions: ['*'] }
          ]
    })

    if (!result || result.canceled || result.filePaths.length === 0) return null

    const selectedPath = result.filePaths[0]
    const id = crypto.randomUUID()

    return await processDataset(selectedPath, id)
  })

  // Add Wildlife Insights dataset selection handler
  // Note: On Linux, GTK file chooser cannot handle ['openFile', 'openDirectory'] together
  ipcMain.handle('import:select-wildlife', async () => {
    const isLinux = process.platform === 'linux'

    const result = await dialog.showOpenDialog({
      title: 'Select Wildlife Insights Dataset',
      defaultPath: app.getPath('home'),
      properties: isLinux ? ['openDirectory'] : ['openFile', 'openDirectory'],
      filters: isLinux
        ? undefined
        : [
            { name: 'Wildlife Datasets', extensions: ['zip'] },
            { name: 'All Files', extensions: ['*'] }
          ]
    })

    if (!result || result.canceled || result.filePaths.length === 0) return null

    const selectedPath = result.filePaths[0]
    const id = crypto.randomUUID()
    let pathToImport = selectedPath

    // Use Wildlife Insights importer
    try {
      // Check if selected path is a file (potential zip) or directory
      const stats = statSync(selectedPath)
      const isZip = stats.isFile() && selectedPath.toLowerCase().endsWith('.zip')

      if (isZip) {
        log.info(`Processing Wildlife Insights zip file: ${selectedPath}`)

        // Create a directory for extraction in app data
        const extractPath = join(app.getPath('userData'), id)
        if (!existsSync(extractPath)) {
          mkdirSync(extractPath, { recursive: true })
        }

        // Extract the zip file
        await extractZip(selectedPath, extractPath)

        // Find the directory containing a projects.csv file
        let wildlifeInsightsDirPath = null

        const findWildlifeInsightsDir = (dir) => {
          if (wildlifeInsightsDirPath) return // Already found, exit recursion

          try {
            const files = readdirSync(dir)

            // First check if this directory has projects.csv
            if (files.includes('projects.csv')) {
              wildlifeInsightsDirPath = dir
              return
            }

            // Then check subdirectories
            for (const file of files) {
              const fullPath = join(dir, file)
              if (statSync(fullPath).isDirectory()) {
                findWildlifeInsightsDir(fullPath)
              }
            }
          } catch (error) {
            log.warn(`Error reading directory ${dir}: ${error.message}`)
          }
        }

        findWildlifeInsightsDir(extractPath)

        if (!wildlifeInsightsDirPath) {
          throw new Error(
            'Wildlife Insights directory with projects.csv not found in extracted archive'
          )
        }

        log.info(`Found Wildlife Insights directory at ${wildlifeInsightsDirPath}`)
        pathToImport = wildlifeInsightsDirPath
      } else if (!stats.isDirectory()) {
        throw new Error('The selected path is neither a directory nor a zip file')
      }

      // Import using Wildlife Insights importer
      const { data } = await importWildlifeDataset(pathToImport, id)

      if (!data) {
        return null
      }

      // Clean up CSV files after successful import if it was a zip
      if (pathToImport !== selectedPath) {
        log.info('Cleaning up CSV files...')

        const cleanupDirectory = (dir) => {
          try {
            const files = readdirSync(dir)

            for (const file of files) {
              const fullPath = join(dir, file)

              if (statSync(fullPath).isDirectory()) {
                cleanupDirectory(fullPath)
              } else if (file.toLowerCase().endsWith('.csv')) {
                log.info(`Removing file: ${fullPath}`)
                unlinkSync(fullPath)
              }
            }
          } catch (error) {
            log.warn(`Error cleaning up directory ${dir}: ${error.message}`)
          }
        }

        cleanupDirectory(pathToImport)
      }

      return {
        path: pathToImport,
        data,
        id
      }
    } catch (error) {
      log.error('Error processing Wildlife Insights dataset:', error)
      // Clean up extracted directory if there was an error
      if (pathToImport !== selectedPath) {
        try {
          await new Promise((resolve) => {
            const rmProcess = spawn('rm', ['-rf', join(app.getPath('userData'), id)])
            rmProcess.on('close', () => resolve())
            rmProcess.on('error', () => resolve())
          })
        } catch (cleanupError) {
          log.warn(`Failed to clean up after error: ${cleanupError.message}`)
        }
      }
      throw error
    }
  })

  ipcMain.handle('import:select-deepfaune', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Deepfaune CSV', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (!result || result.canceled || result.filePaths.length === 0) return null

    const selectedPath = result.filePaths[0]
    const id = crypto.randomUUID()

    try {
      log.info(`Processing Deepfaune CSV file: ${selectedPath}`)

      // Import using Deepfaune importer
      const { data } = await importDeepfauneDataset(selectedPath, id)

      if (!data) {
        return null
      }

      return {
        path: selectedPath,
        data,
        id
      }
    } catch (error) {
      log.error('Error processing Deepfaune CSV dataset:', error)
      throw error
    }
  })

  // Add species distribution handler
  ipcMain.handle('species:get-distribution', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      log.info('Dd path for study:', dbPath)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const distribution = await getSpeciesDistribution(dbPath)
      return { data: distribution }
    } catch (error) {
      log.error('Error getting species distribution:', error)
      return { error: error.message }
    }
  })

  // Add deployments handler
  ipcMain.handle('deployments:get', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const deployments = await getDeployments(dbPath)
      return { data: deployments }
    } catch (error) {
      log.error('Error getting deployments:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('activity:get-timeseries', async (_, studyId, species) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const timeseriesData = await getSpeciesTimeseries(dbPath, species)
      return { data: timeseriesData }
    } catch (error) {
      log.error('Error getting species timeseries:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle(
    'activity:get-heatmap-data',
    async (_, studyId, species, startDate, endDate, startTime, endTime) => {
      try {
        const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
        if (!dbPath || !existsSync(dbPath)) {
          log.warn(`Database not found for study ID: ${studyId}`)
          return { error: 'Database not found for this study' }
        }

        const heatmapData = await getSpeciesHeatmapData(
          dbPath,
          species,
          startDate,
          endDate,
          startTime,
          endTime
        )
        return { data: heatmapData }
      } catch (error) {
        log.error('Error getting species heatmap data:', error)
        return { error: error.message }
      }
    }
  )

  ipcMain.handle('locations:get-activity', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const activity = await getLocationsActivity(dbPath)
      return { data: activity }
    } catch (error) {
      log.error('Error getting locations activity:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('deployments:get-activity', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const activity = await getDeploymentsActivity(dbPath)
      return { data: activity }
    } catch (error) {
      log.error('Error getting deployments activity:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('activity:get-daily', async (_, studyId, species, startDate, endDate) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const dailyActivity = await getSpeciesDailyActivity(dbPath, species, startDate, endDate)
      return { data: dailyActivity }
    } catch (error) {
      log.error('Error getting species daily activity data:', error)
      return { error: error.message }
    }
  })

  // Add handler for deleting study
  ipcMain.handle('study:delete-database', async (event, studyId) => {
    try {
      log.info(`Deleting study: ${studyId}`)
      const studyPath = getStudyPath(app.getPath('userData'), studyId)

      // Notify renderer to update UI before deletion
      event.sender.send('study:delete', studyId)

      if (studyPath && existsSync(studyPath)) {
        rmSync(studyPath, { recursive: true, force: true })
        log.info(`Successfully deleted study: ${studyPath}`)
        return { success: true }
      } else {
        log.warn(`Study not found for deletion: ${studyPath}`)
        return { success: true, message: 'Study already deleted or not found' }
      }
    } catch (error) {
      log.error('Error deleting study:', error)
      return { error: error.message, success: false }
    }
  })

  // Check if study has observations with eventIDs (for sequence grouping default)
  ipcMain.handle('study:has-event-ids', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { data: false }
      }

      const hasEventIDs = await checkStudyHasEventIDs(dbPath)
      return { data: hasEventIDs }
    } catch (error) {
      log.error('Error checking study eventIDs:', error)
      return { error: error.message, data: false }
    }
  })

  // Update media handler to use the new getMedia function with options
  ipcMain.handle('media:get', async (_, studyId, options = {}) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const media = await getMedia(dbPath, options)
      return { data: media }
    } catch (error) {
      log.error('Error getting media:', error)
      return { error: error.message }
    }
  })

  // Get bounding boxes for a specific media file
  // includeWithoutBbox: true to include observations without bbox (for videos)
  ipcMain.handle('media:get-bboxes', async (_, studyId, mediaID, includeWithoutBbox = false) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const bboxes = await getMediaBboxes(dbPath, mediaID, includeWithoutBbox)
      return { data: bboxes }
    } catch (error) {
      log.error('Error getting media bboxes:', error)
      return { error: error.message }
    }
  })

  // Get bounding boxes for multiple media files in a single batch
  ipcMain.handle('media:get-bboxes-batch', async (_, studyId, mediaIDs) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const bboxesByMedia = await getMediaBboxesBatch(dbPath, mediaIDs)
      return { data: bboxesByMedia }
    } catch (error) {
      log.error('Error getting media bboxes batch:', error)
      return { error: error.message }
    }
  })

  // Check if any media have bboxes (lightweight boolean check)
  ipcMain.handle('media:have-bboxes', async (_, studyId, mediaIDs) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const hasBboxes = await checkMediaHaveBboxes(dbPath, mediaIDs)
      return { data: hasBboxes }
    } catch (error) {
      log.error('Error checking media bboxes existence:', error)
      return { error: error.message }
    }
  })

  // Update observation classification (species) - CamTrap DP compliant
  ipcMain.handle(
    'observations:update-classification',
    async (_, studyId, observationID, updates) => {
      try {
        const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
        if (!dbPath || !existsSync(dbPath)) {
          log.warn(`Database not found for study ID: ${studyId}`)
          return { error: 'Database not found for this study' }
        }

        const updatedObservation = await updateObservationClassification(
          dbPath,
          observationID,
          updates
        )
        return { data: updatedObservation }
      } catch (error) {
        log.error('Error updating observation classification:', error)
        return { error: error.message }
      }
    }
  )

  // Update observation bounding box coordinates
  ipcMain.handle('observations:update-bbox', async (_, studyId, observationID, bboxUpdates) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const updatedObservation = await updateObservationBbox(dbPath, observationID, bboxUpdates)
      return { data: updatedObservation }
    } catch (error) {
      log.error('Error updating observation bbox:', error)
      return { error: error.message }
    }
  })

  // Delete observation
  ipcMain.handle('observations:delete', async (_, studyId, observationID) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const result = await deleteObservation(dbPath, observationID)
      return { data: result }
    } catch (error) {
      log.error('Error deleting observation:', error)
      return { error: error.message }
    }
  })

  // Create new observation with bbox
  ipcMain.handle('observations:create', async (_, studyId, observationData) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const newObservation = await createObservation(dbPath, observationData)
      return { data: newObservation }
    } catch (error) {
      log.error('Error creating observation:', error)
      return { error: error.message }
    }
  })

  // Get distinct species for dropdown
  ipcMain.handle('species:get-distinct', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const species = await getDistinctSpecies(dbPath)
      return { data: species }
    } catch (error) {
      log.error('Error getting distinct species:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('import:download-demo', async () => {
    try {
      log.info('Downloading and importing demo dataset')

      // Create a temp directory for the downloaded file
      const downloadDir = join(app.getPath('temp'), 'camtrap-demo')
      if (!existsSync(downloadDir)) {
        mkdirSync(downloadDir, { recursive: true })
      }

      const demoDatasetUrl = 'https://gbif.mnhn.lu/ipt/archive.do?r=luxvalmoni20223025'
      const zipPath = join(downloadDir, 'demo-dataset.zip')
      const extractPath = join(downloadDir, 'extracted')

      log.info(`Downloading demo dataset from ${demoDatasetUrl} to ${zipPath}`)
      await downloadFile(demoDatasetUrl, zipPath, () => {})
      log.info('Download complete')

      // Create extraction directory if it doesn't exist
      if (!existsSync(extractPath)) {
        mkdirSync(extractPath, { recursive: true })
      } else {
        // Clean the extraction directory first to avoid conflicts
        const files = readdirSync(extractPath)
        for (const file of files) {
          const filePath = join(extractPath, file)
          if (statSync(filePath).isDirectory()) {
            // Use rimraf or a similar recursive delete function for directories
            await new Promise((resolve, reject) => {
              const rmProcess = spawn('rm', ['-rf', filePath])
              rmProcess.on('close', (code) => {
                if (code === 0) resolve()
                else reject(new Error(`Failed to delete directory: ${filePath}`))
              })
              rmProcess.on('error', reject)
            })
          } else {
            unlinkSync(filePath)
          }
        }
      }

      // Extract the zip file using tar
      await extractZip(zipPath, extractPath)

      // Find the directory containing a datapackage.json file
      let camtrapDpDirPath = null

      const findCamtrapDpDir = (dir) => {
        if (camtrapDpDirPath) return // Already found, exit recursion

        try {
          const files = readdirSync(dir)

          // First check if this directory has datapackage.json
          if (files.includes('datapackage.json')) {
            camtrapDpDirPath = dir
            return
          }

          // Then check subdirectories
          for (const file of files) {
            const fullPath = join(dir, file)
            if (statSync(fullPath).isDirectory()) {
              findCamtrapDpDir(fullPath)
            }
          }
        } catch (error) {
          log.warn(`Error reading directory ${dir}: ${error.message}`)
        }
      }

      findCamtrapDpDir(extractPath)

      if (!camtrapDpDirPath) {
        throw new Error('CamTrap DP directory with datapackage.json not found in extracted archive')
      }

      log.info(`Found CamTrap DP directory at ${camtrapDpDirPath}`)

      const id = crypto.randomUUID()
      const { data } = await importCamTrapDataset(camtrapDpDirPath, id)

      const result = {
        path: camtrapDpDirPath,
        data,
        id
      }

      log.info('Cleaning up temporary files after successful import...')

      try {
        if (existsSync(zipPath)) {
          unlinkSync(zipPath)
          log.info(`Deleted zip file: ${zipPath}`)
        }
      } catch (error) {
        log.warn(`Failed to delete zip file: ${error.message}`)
      }

      try {
        await new Promise((resolve) => {
          const rmProcess = spawn('rm', ['-rf', extractPath])
          rmProcess.on('close', (code) => {
            if (code === 0) {
              log.info(`Deleted extraction directory: ${extractPath}`)
              resolve()
            } else {
              log.warn(`Failed to delete extraction directory, exit code: ${code}`)
              resolve() // Still resolve to avoid blocking the import process
            }
          })
          rmProcess.on('error', (err) => {
            log.warn(`Error during extraction directory cleanup: ${err.message}`)
            resolve() // Still resolve to avoid blocking the import process
          })
        })
      } catch (error) {
        log.warn(`Failed to cleanup extraction directory: ${error.message}`)
      }

      return result
    } catch (error) {
      log.error('Error downloading or importing demo dataset:', error)
      throw error
    }
  })

  ipcMain.handle('import:gbif-dataset', async (_, datasetKey) => {
    try {
      log.info(`Downloading and importing GBIF dataset: ${datasetKey}`)

      // First, fetch the dataset metadata to get the download URL
      const datasetResponse = await fetch(`https://api.gbif.org/v1/dataset/${datasetKey}`)
      if (!datasetResponse.ok) {
        throw new Error(`Failed to fetch dataset metadata: ${datasetResponse.statusText}`)
      }

      const datasetMetadata = await datasetResponse.json()
      log.info(`Dataset title: ${datasetMetadata.title}`)

      // Find the CAMTRAP_DP endpoint
      const camtrapEndpoint = datasetMetadata.endpoints?.find(
        (endpoint) => endpoint.type === 'CAMTRAP_DP'
      )
      if (!camtrapEndpoint) {
        throw new Error('No CAMTRAP_DP endpoint found for this dataset')
      }

      const downloadUrl = camtrapEndpoint.url
      log.info(`Found download URL: ${downloadUrl}`)

      // Create a temp directory for the downloaded file
      const downloadDir = join(app.getPath('temp'), `gbif-${datasetKey}`)
      if (!existsSync(downloadDir)) {
        mkdirSync(downloadDir, { recursive: true })
      }

      const zipPath = join(downloadDir, 'gbif-dataset.zip')
      const extractPath = join(downloadDir, 'extracted')

      log.info(`Downloading GBIF dataset from ${downloadUrl} to ${zipPath}`)
      await downloadFile(downloadUrl, zipPath, () => {})
      log.info('Download complete')

      // Create extraction directory if it doesn't exist
      if (!existsSync(extractPath)) {
        mkdirSync(extractPath, { recursive: true })
      } else {
        // Clean the extraction directory first to avoid conflicts
        const files = readdirSync(extractPath)
        for (const file of files) {
          const filePath = join(extractPath, file)
          if (statSync(filePath).isDirectory()) {
            await new Promise((resolve, reject) => {
              const rmProcess = spawn('rm', ['-rf', filePath])
              rmProcess.on('close', (code) => {
                if (code === 0) resolve()
                else reject(new Error(`Failed to delete directory: ${filePath}`))
              })
              rmProcess.on('error', reject)
            })
          } else {
            unlinkSync(filePath)
          }
        }
      }

      // Extract the zip file
      await extractZip(zipPath, extractPath)

      // //wait for 2s
      // await new Promise((resolve) => setTimeout(resolve, 2000))

      // Find the directory containing a datapackage.json file
      let camtrapDpDirPath = null

      const findCamtrapDpDir = (dir) => {
        if (camtrapDpDirPath) return // Already found, exit recursion

        try {
          const files = readdirSync(dir)

          console.log(`Checking directory: ${dir}`)
          log.info(`Files in directory: ${files.join(', ')}`)

          // First check if this directory has datapackage.json
          if (files.includes('datapackage.json')) {
            camtrapDpDirPath = dir
            return
          }

          // Then check subdirectories
          for (const file of files) {
            const fullPath = join(dir, file)
            if (statSync(fullPath).isDirectory()) {
              findCamtrapDpDir(fullPath)
            }
          }
        } catch (error) {
          log.warn(`Error reading directory ${dir}: ${error.message}`)
        }
      }

      findCamtrapDpDir(extractPath)

      if (!camtrapDpDirPath) {
        throw new Error('CamTrap DP directory with datapackage.json not found in extracted archive')
      }

      log.info(`Found CamTrap DP directory at ${camtrapDpDirPath}`)

      const id = crypto.randomUUID()
      const { data } = await importCamTrapDataset(camtrapDpDirPath, id)

      const result = {
        path: camtrapDpDirPath,
        data: {
          ...data,
          name: datasetMetadata.title || data.name
        },
        id
      }

      log.info('Cleaning up temporary files after successful import...')

      try {
        if (existsSync(zipPath)) {
          unlinkSync(zipPath)
          log.info(`Deleted zip file: ${zipPath}`)
        }
      } catch (error) {
        log.warn(`Failed to delete zip file: ${error.message}`)
      }

      try {
        await new Promise((resolve) => {
          const rmProcess = spawn('rm', ['-rf', extractPath])
          rmProcess.on('close', (code) => {
            if (code === 0) {
              log.info(`Deleted extraction directory: ${extractPath}`)
              resolve()
            } else {
              log.warn(`Failed to delete extraction directory, exit code: ${code}`)
              resolve() // Still resolve to avoid blocking the import process
            }
          })
          rmProcess.on('error', (err) => {
            log.warn(`Error during extraction directory cleanup: ${err.message}`)
            resolve() // Still resolve to avoid blocking the import process
          })
        })
      } catch (error) {
        log.warn(`Failed to cleanup extraction directory: ${error.message}`)
      }

      return result
    } catch (error) {
      log.error('Error downloading or importing GBIF dataset:', error)
      throw error
    }
  })

  // Add handler for getting files data for local/speciesnet studies
  ipcMain.handle('files:get-data', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const filesData = await getFilesData(dbPath)
      return { data: filesData }
    } catch (error) {
      log.error('Error getting files data:', error)
      return { error: error.message }
    }
  })

  try {
    createWindow()
  } catch (error) {
    log.error('Failed to start Python server:', error)
    app.quit()
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  registerMLModelManagementIPCHandlers()
  registerExportIPCHandlers()
  registerTranscodeIPCHandlers()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Graceful shutdown handler - intercepts quit to clean up ML servers
app.on('before-quit', async (event) => {
  if (isShuttingDown) {
    // Already shutting down, allow quit to proceed
    return
  }

  // Prevent immediate quit
  event.preventDefault()
  isShuttingDown = true

  log.info('[Shutdown] Graceful shutdown initiated')

  try {
    await shutdownAllServers()
    log.info('[Shutdown] All ML servers stopped successfully')
  } catch (error) {
    log.error('[Shutdown] Error during graceful shutdown:', error)
  }

  // Now actually quit
  app.quit()
})

// Handle Unix/macOS termination signals for graceful shutdown
if (process.platform !== 'win32') {
  const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGHUP']

  signals.forEach((signal) => {
    process.on(signal, async () => {
      log.info(`[Signal] Received ${signal}, initiating graceful shutdown`)

      if (!isShuttingDown) {
        isShuttingDown = true
        try {
          await shutdownAllServers()
          log.info('[Signal] All ML servers stopped successfully')
        } catch (error) {
          log.error('[Signal] Error during shutdown:', error)
        }
      }

      process.exit(0)
    })
  })
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

ipcMain.handle('deployments:set-latitude', async (_, studyId, deploymentID, latitude) => {
  try {
    const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
    if (!dbPath || !existsSync(dbPath)) {
      log.warn(`Database not found for study ID: ${studyId}`)
      return { error: 'Database not found for this study' }
    }

    const db = await getDrizzleDb(studyId, dbPath)

    await db
      .update(deployments)
      .set({ latitude: parseFloat(latitude) })
      .where(eq(deployments.deploymentID, deploymentID))

    await closeStudyDatabase(studyId, dbPath)
    log.info(`Updated latitude for deployment ${deploymentID} to ${latitude}`)
    return { success: true }
  } catch (error) {
    log.error('Error updating deployment latitude:', error)
    return { error: error.message }
  }
})

ipcMain.handle('deployments:set-longitude', async (_, studyId, deploymentID, longitude) => {
  try {
    const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
    if (!dbPath || !existsSync(dbPath)) {
      log.warn(`Database not found for study ID: ${studyId}`)
      return { error: 'Database not found for this study' }
    }

    const db = await getDrizzleDb(studyId, dbPath)

    await db
      .update(deployments)
      .set({ longitude: parseFloat(longitude) })
      .where(eq(deployments.deploymentID, deploymentID))

    await closeStudyDatabase(studyId, dbPath)
    log.info(`Updated longitude for deployment ${deploymentID} to ${longitude}`)
    return { success: true }
  } catch (error) {
    log.error('Error updating deployment longitude:', error)
    return { error: error.message }
  }
})

ipcMain.handle('media:set-timestamp', async (_, studyId, mediaID, newTimestamp) => {
  try {
    const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
    if (!dbPath || !existsSync(dbPath)) {
      log.warn(`Database not found for study ID: ${studyId}`)
      return { error: 'Database not found for this study' }
    }

    const result = await updateMediaTimestamp(dbPath, mediaID, newTimestamp)
    await closeStudyDatabase(studyId, dbPath)
    return result
  } catch (error) {
    log.error('Error updating media timestamp:', error)
    return { error: error.message }
  }
})

ipcMain.handle('shell:open-path', async (_, path) => {
  try {
    await shell.openPath(path)
    log.info(`Opened path: ${path}`)
    return { success: true }
  } catch (error) {
    log.error('Error opening path:', error)
    return { error: error.message }
  }
})
