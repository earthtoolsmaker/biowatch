/**
 * Files-related IPC handlers
 */

import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import { getSourcesData } from '../database/index.js'

/**
 * Register all files-related IPC handlers
 */
export function registerFilesIPCHandlers() {
  ipcMain.handle('sources:get-data', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const sourcesData = await getSourcesData(dbPath)
      return { data: sourcesData }
    } catch (error) {
      log.error('Error getting sources data:', error)
      return { error: error.message }
    }
  })
}
