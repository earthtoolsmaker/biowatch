/**
 * Electron Main Process Entry Point
 *
 * This is the minimal entry point that orchestrates:
 * - App lifecycle (window creation, shutdown)
 * - IPC handler registration
 * - Service initialization
 */

import { app, BrowserWindow } from 'electron'
import log from 'electron-log'

import {
  configureLogging,
  createWindow,
  initializeApp,
  setupShutdownHandlers
} from './app/index.js'
import { registerAllIPCHandlers } from './ipc/index.js'
import { registerExportIPCHandlers } from './services/export/exporter.js'
import { registerTranscodeIPCHandlers } from './services/cache/video.js'
import { registerImageCacheIPCHandlers } from './services/cache/image.js'

// Configure logging
configureLogging()

log.info('Starting Electron app...')

// Setup shutdown handlers
setupShutdownHandlers()

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async () => {
  // Initialize app (migrations, protocols, caches)
  const success = await initializeApp()
  if (!success) {
    return // App will quit if initialization failed
  }

  // Create the main window
  try {
    createWindow()
  } catch (error) {
    log.error('Failed to create window:', error)
    app.quit()
    return
  }

  // Handle macOS dock click behavior
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // Register all IPC handlers
  registerAllIPCHandlers()
  registerExportIPCHandlers()
  registerTranscodeIPCHandlers()
  registerImageCacheIPCHandlers()

  log.info('App initialization complete')
})
