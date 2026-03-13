/**
 * Files-related IPC handlers
 */

import { app, dialog, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import { getFilesData, updateImportFolder } from '../database/index.js'

/**
 * Register all files-related IPC handlers
 */
export function registerFilesIPCHandlers() {
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

  ipcMain.handle('files:update-import-folder', async (_, studyId, oldImportFolder) => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select new folder path',
        defaultPath: oldImportFolder,
        properties: ['openDirectory']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true }
      }

      const newImportFolder = result.filePaths[0]

      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const rowsUpdated = await updateImportFolder(dbPath, oldImportFolder, newImportFolder)
      return { data: { newImportFolder, rowsUpdated } }
    } catch (error) {
      log.error('Error updating import folder:', error)
      return { error: error.message }
    }
  })
}
