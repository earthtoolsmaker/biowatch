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
  getDrizzleDb,
  getMetadata,
  getSpeciesDistributionByMedia,
  getSpeciesTimeseriesByMedia,
  getSpeciesHeatmapDataByMedia,
  getSpeciesDailyActivityByMedia
} from '../database/index.js'
import {
  calculateSequenceAwareSpeciesCounts,
  calculateSequenceAwareTimeseries,
  calculateSequenceAwareHeatmap,
  calculateSequenceAwareDailyActivity,
  getPaginatedSequences
} from '../services/sequences/index.js'

/**
 * Helper to fetch sequenceGap from study metadata
 * @param {string} studyId - Study identifier
 * @param {string} dbPath - Path to database file
 * @returns {Promise<number|null>} sequenceGap value or null for eventID-based grouping
 */
async function getSequenceGapFromMetadata(studyId, dbPath) {
  const db = await getDrizzleDb(studyId, dbPath, { readonly: true })
  const meta = await getMetadata(db)
  return meta?.sequenceGap ?? null
}

/**
 * Register all sequence-related IPC handlers
 */
export function registerSequencesIPCHandlers() {
  /**
   * Get sequence-aware species distribution
   * Fetches raw media data and computes sequence-aware counts in main thread
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

      // If gapSeconds not provided, fetch from metadata
      const effectiveGapSeconds =
        gapSeconds !== undefined ? gapSeconds : await getSequenceGapFromMetadata(studyId, dbPath)

      const rawData = await getSpeciesDistributionByMedia(dbPath)
      const data = calculateSequenceAwareSpeciesCounts(rawData, effectiveGapSeconds)
      return { data }
    } catch (error) {
      log.error('Error getting sequence-aware species distribution:', error)
      return { error: error.message }
    }
  })

  /**
   * Get sequence-aware species timeseries
   * Fetches raw media data and computes sequence-aware timeseries in main thread
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

      // If gapSeconds not provided, fetch from metadata
      const effectiveGapSeconds =
        gapSeconds !== undefined ? gapSeconds : await getSequenceGapFromMetadata(studyId, dbPath)

      const rawData = await getSpeciesTimeseriesByMedia(dbPath, speciesNames)
      const data = calculateSequenceAwareTimeseries(rawData, effectiveGapSeconds)
      return { data }
    } catch (error) {
      log.error('Error getting sequence-aware timeseries:', error)
      return { error: error.message }
    }
  })

  /**
   * Get sequence-aware species heatmap
   * Fetches raw media data and computes sequence-aware heatmap in main thread
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

        // If gapSeconds not provided, fetch from metadata
        const effectiveGapSeconds =
          gapSeconds !== undefined ? gapSeconds : await getSequenceGapFromMetadata(studyId, dbPath)

        const rawData = await getSpeciesHeatmapDataByMedia(
          dbPath,
          speciesNames,
          startDate,
          endDate,
          startHour,
          endHour,
          includeNullTimestamps
        )
        const data = calculateSequenceAwareHeatmap(rawData, effectiveGapSeconds)
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

        // If gapSeconds not provided, fetch from metadata
        const effectiveGapSeconds =
          gapSeconds !== undefined ? gapSeconds : await getSequenceGapFromMetadata(studyId, dbPath)

        const rawData = await getSpeciesDailyActivityByMedia(
          dbPath,
          speciesNames,
          startDate,
          endDate
        )
        const data = calculateSequenceAwareDailyActivity(rawData, effectiveGapSeconds, speciesNames)
        return { data }
      } catch (error) {
        log.error('Error getting sequence-aware daily activity:', error)
        return { error: error.message }
      }
    }
  )

  /**
   * Get paginated sequences
   * Returns pre-grouped sequences with cursor-based pagination
   *
   * @param {string} studyId - Study identifier
   * @param {Object} options - Pagination options
   * @param {number|null} options.gapSeconds - Gap threshold for grouping (null = eventID grouping)
   * @param {number} options.limit - Maximum sequences per page (default: 20)
   * @param {string|null} options.cursor - Opaque cursor from previous response
   * @param {Object} options.filters - Filter options
   * @param {Array<string>} options.filters.species - Species filter
   * @param {Object} options.filters.dateRange - Date range { start, end }
   * @param {Object} options.filters.timeRange - Time range { start, end } (hours)
   * @returns {{ data: { sequences, nextCursor, hasMore } } | { error: string }}
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
