/**
 * Overview tab — IPC handlers
 *
 * Heavy SQLite scans (count over observations + deployments + media) run
 * in the sequences worker thread so the main process stays responsive.
 */

import { app, ipcMain } from 'electron'
import log from '../services/logger.js'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import { runInWorker } from '../services/sequences/runInWorker.js'

export function registerOverviewIPCHandlers() {
  ipcMain.handle('overview:get-stats', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }
      const data = await runInWorker({ type: 'overview-stats', dbPath, studyId })
      return { data }
    } catch (error) {
      log.error('Error getting overview stats:', error)
      return { error: error.message }
    }
  })
}
