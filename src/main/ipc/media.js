/**
 * Media-related IPC handlers
 */

import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import {
  getMedia,
  getMediaBboxes,
  getMediaBboxesBatch,
  checkMediaHaveBboxes,
  getBestMedia,
  updateMediaTimestamp,
  updateMediaFavorite,
  countMediaWithNullTimestamps,
  closeStudyDatabase
} from '../database/index.js'

/**
 * Register all media-related IPC handlers
 */
export function registerMediaIPCHandlers() {
  ipcMain.handle('media:get', async (_, studyId, options = {}) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const media = await getMedia(dbPath, options)
      return { data: media }
    } catch (error) {
      log.error('Error getting media:', error)
      return { error: error.message }
    }
  })

  // Get bounding boxes for a specific media file
  // includeWithoutBbox: true to include observations without bbox (for videos)
  ipcMain.handle('media:get-bboxes', async (_, studyId, mediaID, includeWithoutBbox = false) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const bboxes = await getMediaBboxes(dbPath, mediaID, includeWithoutBbox)
      return { data: bboxes }
    } catch (error) {
      log.error('Error getting media bboxes:', error)
      return { error: error.message }
    }
  })

  // Get bounding boxes for multiple media files in a single batch
  ipcMain.handle('media:get-bboxes-batch', async (_, studyId, mediaIDs) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const bboxesByMedia = await getMediaBboxesBatch(dbPath, mediaIDs)
      return { data: bboxesByMedia }
    } catch (error) {
      log.error('Error getting media bboxes batch:', error)
      return { error: error.message }
    }
  })

  // Check if any media have bboxes (lightweight boolean check)
  ipcMain.handle('media:have-bboxes', async (_, studyId, mediaIDs) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const hasBboxes = await checkMediaHaveBboxes(dbPath, mediaIDs)
      return { data: hasBboxes }
    } catch (error) {
      log.error('Error checking media bboxes existence:', error)
      return { error: error.message }
    }
  })

  // Get best media files scored by bbox quality heuristic
  ipcMain.handle('media:get-best', async (_, studyId, options = {}) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const bestMedia = await getBestMedia(dbPath, options)
      return { data: bestMedia }
    } catch (error) {
      log.error('Error getting best media:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('media:set-timestamp', async (_, studyId, mediaID, newTimestamp) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const result = await updateMediaTimestamp(dbPath, mediaID, newTimestamp)
      await closeStudyDatabase(studyId, dbPath)
      return result
    } catch (error) {
      log.error('Error updating media timestamp:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('media:set-favorite', async (_, studyId, mediaID, favorite) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const result = await updateMediaFavorite(dbPath, mediaID, favorite)
      await closeStudyDatabase(studyId, dbPath)
      return result
    } catch (error) {
      log.error('Error updating media favorite:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle('media:count-null-timestamps', async (_, studyId) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const count = await countMediaWithNullTimestamps(dbPath)
      return { data: count }
    } catch (error) {
      log.error('Error counting media with null timestamps:', error)
      return { error: error.message }
    }
  })
}
