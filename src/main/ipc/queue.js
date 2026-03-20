/**
 * Queue IPC handlers.
 *
 * Replaces importer:get-status, importer:stop, and importer:resume
 * with queue-based implementations. Uses the same IPC channel names
 * so the renderer needs no changes.
 */

import path from 'path'
import fs from 'fs'
import { ipcMain, app } from 'electron'
import log from 'electron-log'
import { queueScheduler } from '../services/queue-scheduler.js'
import { getDrizzleDb, getLatestModelRun } from '../database/index.js'

export function registerQueueIPCHandlers() {
  // Drop-in replacement for the old importer:get-status
  ipcMain.handle('importer:get-status', async (_, studyId) => {
    return await queueScheduler.getStatusForStudy(studyId)
  })

  // Drop-in replacement for the old importer:stop (now just pauses — instant, no server kill)
  ipcMain.handle('importer:stop', async (_, studyId) => {
    try {
      queueScheduler.pause()
      log.info(`[Queue IPC] Paused processing for study ${studyId}`)
      return { success: true, message: 'Import paused' }
    } catch (error) {
      log.error(`[Queue IPC] Error pausing study ${studyId}:`, error)
      return { success: false, error: error.message }
    }
  })

  // Drop-in replacement for the old importer:resume
  ipcMain.handle('importer:resume', async (_, studyId) => {
    try {
      // If scheduler is paused for this study, just resume (instant)
      if (queueScheduler.activeStudyId === studyId && queueScheduler.isPaused) {
        queueScheduler.resume()
        log.info(`[Queue IPC] Resumed processing for study ${studyId}`)
        return { success: true, message: 'Import resumed' }
      }

      // Cold resume: read modelRuns to get topic/country, start scheduler
      const dbPath = path.join(
        app.getPath('userData'),
        'biowatch-data',
        'studies',
        studyId,
        'study.db'
      )

      if (!fs.existsSync(dbPath)) {
        log.warn(`[Queue IPC] No database found for study ${studyId}`)
        return { success: false, message: 'Study not found' }
      }

      const db = await getDrizzleDb(studyId, dbPath)
      const latestRun = await getLatestModelRun(db)
      if (!latestRun) {
        log.warn(`[Queue IPC] No model run found for study ${studyId}`)
        return { success: false, message: 'No model run found for study' }
      }

      const topic = `${latestRun.modelID}:${latestRun.modelVersion}`
      const country = latestRun.options?.country || null

      await queueScheduler.startStudy(studyId, { topic, country })
      log.info(`[Queue IPC] Cold-resumed processing for study ${studyId}`)
      return { success: true, message: 'Import resumed' }
    } catch (error) {
      log.error(`[Queue IPC] Error resuming study ${studyId}:`, error)
      return { success: false, error: error.message }
    }
  })

  log.info('Queue IPC handlers registered')
}
