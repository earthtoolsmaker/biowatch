/**
 * Sequence-related IPC handlers
 *
 * These handlers compute sequence-aware species counts in the main thread,
 * avoiding the need to transfer raw media-level data to the renderer.
 */

import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import {
  getSpeciesDistributionByMedia,
  getSpeciesTimeseriesByMedia,
  getSpeciesHeatmapDataByMedia,
  getSpeciesDailyActivityByMedia
} from '../database/index.js'
import {
  calculateSequenceAwareSpeciesCounts,
  calculateSequenceAwareTimeseries,
  calculateSequenceAwareHeatmap,
  calculateSequenceAwareDailyActivity
} from '../services/sequences/index.js'

/**
 * Register all sequence-related IPC handlers
 */
export function registerSequencesIPCHandlers() {
  /**
   * Get sequence-aware species distribution
   * Fetches raw media data and computes sequence-aware counts in main thread
   */
  ipcMain.handle('sequences:get-species-distribution', async (_, studyId, gapSeconds) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const rawData = await getSpeciesDistributionByMedia(dbPath)
      const data = calculateSequenceAwareSpeciesCounts(rawData, gapSeconds)
      return { data }
    } catch (error) {
      log.error('Error getting sequence-aware species distribution:', error)
      return { error: error.message }
    }
  })

  /**
   * Get sequence-aware species timeseries
   * Fetches raw media data and computes sequence-aware timeseries in main thread
   */
  ipcMain.handle('sequences:get-timeseries', async (_, studyId, speciesNames, gapSeconds) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const rawData = await getSpeciesTimeseriesByMedia(dbPath, speciesNames)
      const data = calculateSequenceAwareTimeseries(rawData, gapSeconds)
      return { data }
    } catch (error) {
      log.error('Error getting sequence-aware timeseries:', error)
      return { error: error.message }
    }
  })

  /**
   * Get sequence-aware species heatmap
   * Fetches raw media data and computes sequence-aware heatmap in main thread
   */
  ipcMain.handle(
    'sequences:get-heatmap',
    async (
      _,
      studyId,
      speciesNames,
      startDate,
      endDate,
      startHour,
      endHour,
      includeNullTimestamps,
      gapSeconds
    ) => {
      try {
        const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
        if (!dbPath || !existsSync(dbPath)) {
          log.warn(`Database not found for study ID: ${studyId}`)
          return { error: 'Database not found for this study' }
        }

        const rawData = await getSpeciesHeatmapDataByMedia(
          dbPath,
          speciesNames,
          startDate,
          endDate,
          startHour,
          endHour,
          includeNullTimestamps
        )
        const data = calculateSequenceAwareHeatmap(rawData, gapSeconds)
        return { data }
      } catch (error) {
        log.error('Error getting sequence-aware heatmap:', error)
        return { error: error.message }
      }
    }
  )

  /**
   * Get sequence-aware daily activity
   * Fetches raw media data and computes sequence-aware daily activity in main thread
   */
  ipcMain.handle(
    'sequences:get-daily-activity',
    async (_, studyId, speciesNames, startDate, endDate, gapSeconds) => {
      try {
        const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
        if (!dbPath || !existsSync(dbPath)) {
          log.warn(`Database not found for study ID: ${studyId}`)
          return { error: 'Database not found for this study' }
        }

        const rawData = await getSpeciesDailyActivityByMedia(
          dbPath,
          speciesNames,
          startDate,
          endDate
        )
        const data = calculateSequenceAwareDailyActivity(rawData, gapSeconds, speciesNames)
        return { data }
      } catch (error) {
        log.error('Error getting sequence-aware daily activity:', error)
        return { error: error.message }
      }
    }
  )
}
