/**
 * Activity-related IPC handlers
 */

import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import {
  getSpeciesTimeseries,
  getSpeciesHeatmapData,
  getLocationsActivity,
  getSpeciesDailyActivity
} from '../database/index.js'

/**
 * Register all activity-related IPC handlers
 */
export function registerActivityIPCHandlers() {
  ipcMain.handle('activity:get-timeseries', async (_, studyId, species) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const timeseriesData = await getSpeciesTimeseries(dbPath, species)
      return { data: timeseriesData }
    } catch (error) {
      log.error('Error getting species timeseries:', error)
      return { error: error.message }
    }
  })

  ipcMain.handle(
    'activity:get-heatmap-data',
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

        const heatmapData = await getSpeciesHeatmapData(
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
        log.error('Error getting species heatmap data:', error)
        return { error: error.message }
      }
    }
  )

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

  ipcMain.handle('activity:get-daily', async (_, studyId, species, startDate, endDate) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const dailyActivity = await getSpeciesDailyActivity(dbPath, species, startDate, endDate)
      return { data: dailyActivity }
    } catch (error) {
      log.error('Error getting species daily activity data:', error)
      return { error: error.message }
    }
  })
}
