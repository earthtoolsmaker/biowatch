/**
 * Diagnostics-related IPC handlers
 */

import { app, dialog, ipcMain } from 'electron'
import path from 'path'
import log from 'electron-log'
import { exportDiagnostics } from '../services/diagnostics.js'

/**
 * Generate a filename for the diagnostics export
 * @returns {string} Filename in format biowatch-diagnostics-YYYY-MM-DD-HHMMSS.zip
 */
function generateFilename() {
  const now = new Date()
  const date = now.toISOString().split('T')[0]
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '')
  return `biowatch-diagnostics-${date}-${time}.zip`
}

/**
 * Register all diagnostics-related IPC handlers
 */
export function registerDiagnosticsIPCHandlers() {
  ipcMain.handle('diagnostics:export', async () => {
    try {
      // Get Downloads folder as default location
      const downloadsPath = app.getPath('downloads')
      const defaultPath = path.join(downloadsPath, generateFilename())

      // Show save dialog
      const result = await dialog.showSaveDialog({
        title: 'Export Diagnostics',
        defaultPath: defaultPath,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
      })

      // User cancelled
      if (result.canceled || !result.filePath) {
        log.info('Diagnostics export cancelled by user')
        return { cancelled: true }
      }

      // Export diagnostics
      const exportResult = await exportDiagnostics(result.filePath)
      return exportResult
    } catch (error) {
      log.error('Error in diagnostics export handler:', error)
      return { success: false, error: error.message }
    }
  })
}
