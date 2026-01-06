/**
 * Electron app lifecycle management
 *
 * Handles:
 * - Window creation
 * - Migration initialization
 * - Graceful shutdown
 * - Signal handlers
 */

import { app, BrowserWindow, dialog, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import icon from '../../../resources/icon.png?asset'
import migrations from '../migrations/index.js'
import { shutdownAllServers, garbageCollect } from '../services/ml/index.js'
import { cleanExpiredTranscodeCache, cleanExpiredImageCache } from '../services/cache/index.js'
import { registerLocalFileProtocol, registerCachedImageProtocol } from './protocols.js'
import { setupRemoteMediaCORS } from './session.js'

// Track shutdown state to prevent multiple shutdown attempts
let isShuttingDown = false

/**
 * Configure logging
 */
export function configureLogging() {
  log.transports.file.level = 'info'
  log.transports.console.level = 'info'
  autoUpdater.logger = log
}

/**
 * Create the main browser window
 */
export function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1300,
    height: 800,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
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

  // HMR for renderer based on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

/**
 * Initialize and run database migrations before starting the app
 * This ensures that user data is properly migrated to new formats
 * before any UI or database operations begin.
 * @returns {Promise<boolean>} True if migrations succeeded
 */
export async function initializeMigrations() {
  try {
    const userDataPath = app.getPath('userData')

    log.info('Migration status', await migrations.getMigrationStatus(userDataPath))

    await migrations.runMigrations(userDataPath, log)
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

/**
 * Initialize the application
 * Called after app.whenReady()
 */
export async function initializeApp() {
  // Initialize migrations first, before creating any windows
  const migrationSuccess = await initializeMigrations()
  if (!migrationSuccess) {
    return false // App will quit if migrations failed and user chose to quit
  }

  // Set app user model id for windows
  electronApp.setAppUserModelId('org.biowatch')

  // Register custom protocols
  registerLocalFileProtocol()
  registerCachedImageProtocol()

  // Setup CORS headers for remote media (works with browser cache)
  setupRemoteMediaCORS()

  // Garbage collect stale ML Models and environments
  garbageCollect()

  // Clean expired caches in background (fire-and-forget, don't await)
  cleanExpiredTranscodeCache()
  cleanExpiredImageCache()

  // Check for updates
  autoUpdater.checkForUpdatesAndNotify()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  return true
}

/**
 * Setup shutdown handlers for graceful cleanup
 */
export function setupShutdownHandlers() {
  // Quit when all windows are closed, except on macOS
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

    // Now actually quit, we call exit so we don't re-enter this handler
    app.exit()
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
}
