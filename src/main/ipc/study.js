/**
 * Study-related IPC handlers
 */

import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync, rmSync } from 'fs'
import { getStudyDatabasePath, getStudyPath } from '../services/paths.js'
import { listStudies, updateStudy } from '../services/study.js'
import {
  closeStudyDatabase,
  checkStudyHasEventIDs,
  getMetadata,
  updateMetadata,
  getDrizzleDb
} from '../database/index.js'

/**
 * Register all study-related IPC handlers
 */
export function registerStudyIPCHandlers() {
  ipcMain.handle('studies:list', async () => {
    return await listStudies()
  })

  ipcMain.handle('studies:update', async (_, id, update) => {
    return await updateStudy(id, update)
  })

  ipcMain.handle('study:delete-database', async (event, studyId) => {
    try {
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
}
