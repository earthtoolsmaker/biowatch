/**
 * Activity-related IPC handlers
 */

import { app, dialog, ipcMain } from 'electron'
import log from '../services/logger.js'
import { existsSync, promises as fsp } from 'fs'
import path from 'path'
import { getStudyDatabasePath } from '../services/paths.js'
import { getLocationsActivity } from '../database/index.js'

/**
 * Register all activity-related IPC handlers
 */
export function registerActivityIPCHandlers() {
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

  ipcMain.handle('explore:export-map-png', async (_, { dataUrl, defaultFilename }) => {
    try {
      const downloadsPath = app.getPath('downloads')
      const safeName = defaultFilename || `explore-map-${Date.now()}.png`
      const result = await dialog.showSaveDialog({
        title: 'Save Map',
        defaultPath: path.join(downloadsPath, safeName),
        filters: [{ name: 'PNG Image', extensions: ['png'] }]
      })

      if (result.canceled || !result.filePath) {
        return { cancelled: true }
      }

      const base64 = (dataUrl || '').replace(/^data:image\/png;base64,/, '')
      if (!base64) {
        return { success: false, error: 'Empty image payload' }
      }

      await fsp.writeFile(result.filePath, Buffer.from(base64, 'base64'))
      return { success: true, filePath: result.filePath }
    } catch (error) {
      log.error('Error exporting explore map PNG:', error)
      return { success: false, error: error.message }
    }
  })
}
