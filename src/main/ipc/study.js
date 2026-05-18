/**
 * Study-related IPC handlers
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { getStudyDatabasePath, getStudyPath } from '../services/paths.js'
import { listStudies, updateStudy } from '../services/study.js'
import { getStudyCacheStats, clearStudyCache } from '../services/cache/study.js'
import {
  closeStudyDatabase,
  checkStudyHasEventIDs,
  getMetadata,
  updateMetadata,
  getDrizzleDb
} from '../database/index.js'
import { mergePreflight } from '../services/merge/preflight.js'
import { getAtRiskMergeBreaks } from '../services/merge/bDeletion.js'
import { listMergedSourceIds } from '../services/merge/mergedSources.js'
import { createMergeRegistry } from '../services/merge/registry.js'

function getBiowatchDataPath() {
  return join(app.getPath('userData'), 'biowatch-data')
}

/**
 * Register all study-related IPC handlers
 */
export function registerStudyIPCHandlers() {
  // In-flight merge worker registry — scoped to this registration call so
  // state stays inside the closure (no module-level mutability).
  const mergeRegistry = createMergeRegistry()

  ipcMain.handle('studies:list', async () => {
    return await listStudies()
  })

  ipcMain.handle('studies:update', async (_, id, update) => {
    return await updateStudy(id, update)
  })

  ipcMain.handle('study:delete-database', async (event, studyId, options = {}) => {
    try {
      const force = options && options.force === true
      if (!force) {
        const dependentBreaks = getAtRiskMergeBreaks({
          biowatchDataPath: getBiowatchDataPath(),
          sourceStudyId: studyId
        })
        if (dependentBreaks.length > 0) {
          return { needsConfirm: true, dependentBreaks }
        }
      }

      log.info(`Deleting study: ${studyId}`)
      const studyPath = getStudyPath(app.getPath('userData'), studyId)

      if (studyPath && existsSync(studyPath)) {
        await closeStudyDatabase(studyId)
        rmSync(studyPath, { recursive: true, force: true })
        log.info(`Successfully deleted study: ${studyPath}`)
        // Notify renderer after successful deletion to avoid race condition
        event.sender.send('study:delete', studyId)
        return { success: true }
      } else {
        log.warn(`Study not found for deletion: ${studyPath}`)
        event.sender.send('study:delete', studyId)
        return { success: true, message: 'Study already deleted or not found' }
      }
    } catch (error) {
      log.error('Error deleting study:', error)
      return { error: error.message, success: false }
    }
  })

  ipcMain.handle('study:list-merged-source-ids', async (_event, targetStudyId) => {
    try {
      return {
        data: listMergedSourceIds({
          biowatchDataPath: getBiowatchDataPath(),
          targetStudyId
        })
      }
    } catch (error) {
      log.error('Error in study:list-merged-source-ids:', error)
      return { error: error.message, data: [] }
    }
  })

  ipcMain.handle('study:merge-preflight', async (_event, targetStudyId, sourceStudyId) => {
    try {
      return mergePreflight({
        biowatchDataPath: getBiowatchDataPath(),
        targetStudyId,
        sourceStudyId
      })
    } catch (error) {
      log.error('Error in study:merge-preflight:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('study:merge', async (event, targetStudyId, sourceStudyId, reviewed) => {
    if (mergeRegistry.has(targetStudyId)) {
      return { success: false, error: 'A merge is already in progress for this study' }
    }
    try {
      // Close any open handle on the target so the worker's connection has
      // exclusive write access. SQLite WAL would let the worker proceed
      // either way, but closing first keeps things tidy.
      await closeStudyDatabase(targetStudyId)
    } catch (error) {
      log.warn('closeStudyDatabase before merge worker spawn failed:', error.message)
    }

    return new Promise((resolve) => {
      // The merge worker is registered as a separate rollup input in
      // electron.vite.config.mjs and lands beside the main bundle.
      const workerPath = join(__dirname, 'merge-worker.js')
      const worker = new Worker(workerPath, {
        workerData: {
          biowatchDataPath: getBiowatchDataPath(),
          targetStudyId,
          sourceStudyId,
          reviewed: reviewed || { description: '', contributorEmails: [] }
        }
      })
      const release = mergeRegistry.register(targetStudyId, worker)

      let settled = false
      const finish = (result) => {
        if (settled) return
        settled = true
        release()
        resolve(result)
      }

      worker.on('message', (msg) => {
        if (msg.type === 'progress') {
          if (!event.sender.isDestroyed()) event.sender.send('merge:progress', msg.payload)
        } else if (msg.type === 'result') {
          if (msg.result?.success && !msg.result?.alreadyMerged) {
            BrowserWindow.getAllWindows().forEach((w) =>
              w.webContents.send('merge:complete', { studyId: targetStudyId })
            )
          }
          finish(msg.result)
        } else if (msg.type === 'error') {
          log.error('Merge worker reported error:', msg.error)
          finish({ success: false, error: msg.error })
        }
      })
      worker.on('error', (err) => {
        log.error('Merge worker error event:', err)
        finish({ success: false, error: err.message })
      })
      worker.on('exit', (code) => {
        // Non-zero exit usually means terminate() — the cancel handler hit it,
        // or the worker crashed before posting a message.
        if (!settled) finish({ success: true, cancelled: true, exitCode: code })
      })
    })
  })

  ipcMain.handle('study:merge-cancel', async (_event, targetStudyId) => {
    try {
      return await mergeRegistry.cancel(targetStudyId)
    } catch (error) {
      log.error('Error cancelling merge:', error)
      return { cancelled: false, error: error.message }
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

  // Get sequenceGap from study metadata
  ipcMain.handle('study:get-sequence-gap', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { data: null }
      }

      const db = await getDrizzleDb(studyId, dbPath, { readonly: true })
      const meta = await getMetadata(db)
      return { data: meta?.sequenceGap ?? null }
    } catch (error) {
      log.error('Error getting study sequenceGap:', error)
      return { error: error.message, data: null }
    }
  })

  // Set sequenceGap in study metadata
  ipcMain.handle('study:set-sequence-gap', async (_, studyId, sequenceGap) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found' }
      }

      const db = await getDrizzleDb(studyId, dbPath)
      await updateMetadata(db, studyId, { sequenceGap })
      return { data: sequenceGap }
    } catch (error) {
      log.error('Error setting study sequenceGap:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('study:get-metadata', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { data: null }
      }
      const db = await getDrizzleDb(studyId, dbPath, { readonly: true })
      const meta = await getMetadata(db)
      return { data: meta || null }
    } catch (error) {
      log.error('Error getting study metadata:', error)
      return { error: error.message, data: null }
    }
  })

  ipcMain.handle('study:get-cache-stats', async (_, studyId) => {
    try {
      const data = await getStudyCacheStats(studyId)
      return { data }
    } catch (error) {
      log.error('Error getting study cache stats:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('study:clear-cache', async (_, studyId) => {
    try {
      const data = await clearStudyCache(studyId)
      return { data }
    } catch (error) {
      log.error('Error clearing study cache:', error)
      return { error: error.message }
    }
  })
}
