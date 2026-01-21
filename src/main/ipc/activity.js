/**
 * Activity-related IPC handlers
 */

import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import {
  getLocationsActivity,
  getSpeciesHeatmapDataByMedia,
  getSpeciesDailyActivityByMedia
} from '../database/index.js'

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

  // Get heatmap data by media for sequence-aware counting
  ipcMain.handle(
    'activity:get-heatmap-data-by-media',
    async (
      _,
      studyId,
      species,
      startDate,
      endDate,
      startTime,
      endTime,
      includeNullTimestamps = false
    ) => {
      try {
        const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
        if (!dbPath || !existsSync(dbPath)) {
          log.warn(`Database not found for study ID: ${studyId}`)
          return { error: 'Database not found for this study' }
        }

        const heatmapData = await getSpeciesHeatmapDataByMedia(
          dbPath,
          species,
          startDate,
          endDate,
          startTime,
          endTime,
          includeNullTimestamps
        )
        return { data: heatmapData }
      } catch (error) {
        log.error('Error getting species heatmap data by media:', error)
        return { error: error.message }
      }
    }
  )

  // Get daily activity data by media for sequence-aware counting
  ipcMain.handle('activity:get-daily-by-media', async (_, studyId, species, startDate, endDate) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const dailyActivity = await getSpeciesDailyActivityByMedia(
        dbPath,
        species,
        startDate,
        endDate
      )
      return { data: dailyActivity }
    } catch (error) {
      log.error('Error getting species daily activity by media:', error)
      return { error: error.message }
    }
  })
}
