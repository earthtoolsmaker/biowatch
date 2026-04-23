/**
 * Sequence-related IPC handlers
 *
 * Heavy computations (DB query + sequence grouping) run in worker threads
 * so the main thread stays responsive for UI events and tile rendering.
 * The paginated sequences handler remains on the main thread since it
 * handles interactive pagination with smaller payloads.
 */

import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import { getPaginatedSequences } from '../services/sequences/index.js'
import { runInWorker } from '../services/sequences/runInWorker.js'

/**
 * Register all sequence-related IPC handlers
 */
export function registerSequencesIPCHandlers() {
  /**
   * Get sequence-aware species distribution
   * @param {string} studyId - Study identifier
   * @param {number|null} [gapSeconds] - Optional gap threshold; fetched from metadata if not provided
   */
  ipcMain.handle('sequences:get-species-distribution', async (_, studyId, gapSeconds) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      // Always dispatch through the Worker. The Worker tries the SQL aggregate
      // first (null/0 gap) and falls back to row-dump + JS grouping on null
      // return (positive gap). Running off-thread is required because the SQL
      // scan itself can take ~8s on cold FS cache on large studies, which
      // would freeze the renderer's UI if it ran on main.
      const data = await runInWorker({
        type: 'species-distribution',
        dbPath,
        studyId,
        gapSeconds
      })
      return { data }
    } catch (error) {
      log.error('Error getting sequence-aware species distribution:', error)
      return { error: error.message }
    }
  })

  /**
   * Get sequence-aware species timeseries
   * @param {string} studyId - Study identifier
   * @param {Array<string>} speciesNames - Species to include in timeseries
   * @param {number|null} [gapSeconds] - Optional gap threshold; fetched from metadata if not provided
   */
  ipcMain.handle('sequences:get-timeseries', async (_, studyId, speciesNames, gapSeconds) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const data = await runInWorker({
        type: 'timeseries',
        dbPath,
        studyId,
        gapSeconds,
        speciesNames
      })
      return { data }
    } catch (error) {
      log.error('Error getting sequence-aware timeseries:', error)
      return { error: error.message }
    }
  })

  /**
   * Get sequence-aware species heatmap
   * @param {string} studyId - Study identifier
   * @param {Array<string>} speciesNames - Species to include in heatmap
   * @param {string|null} startDate - Start date filter (ISO string)
   * @param {string|null} endDate - End date filter (ISO string)
   * @param {number} startHour - Start hour filter (0-24)
   * @param {number} endHour - End hour filter (0-24)
   * @param {boolean} includeNullTimestamps - Whether to include media without timestamps
   * @param {number|null} [gapSeconds] - Optional gap threshold; fetched from metadata if not provided
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

        const data = await runInWorker({
          type: 'heatmap',
          dbPath,
          studyId,
          gapSeconds,
          speciesNames,
          startDate,
          endDate,
          startHour,
          endHour,
          includeNullTimestamps
        })
        return { data }
      } catch (error) {
        log.error('Error getting sequence-aware heatmap:', error)
        return { error: error.message }
      }
    }
  )

  /**
   * Get sequence-aware daily activity
   * @param {string} studyId - Study identifier
   * @param {Array<string>} speciesNames - Species to include in daily activity
   * @param {string|null} startDate - Start date filter (ISO string)
   * @param {string|null} endDate - End date filter (ISO string)
   * @param {number|null} [gapSeconds] - Optional gap threshold; fetched from metadata if not provided
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

        const data = await runInWorker({
          type: 'daily-activity',
          dbPath,
          studyId,
          gapSeconds,
          speciesNames,
          startDate,
          endDate
        })
        return { data }
      } catch (error) {
        log.error('Error getting sequence-aware daily activity:', error)
        return { error: error.message }
      }
    }
  )

  /**
   * Get paginated sequences (stays on main thread - interactive pagination with small payloads)
   */
  ipcMain.handle('sequences:get-paginated', async (_, studyId, options = {}) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const { gapSeconds = 60, limit = 20, cursor = null, filters = {} } = options

      const result = await getPaginatedSequences(dbPath, {
        gapSeconds,
        limit,
        cursor,
        filters
      })

      return { data: result }
    } catch (error) {
      log.error('Error getting paginated sequences:', error)
      return { error: error.message }
    }
  })
}
