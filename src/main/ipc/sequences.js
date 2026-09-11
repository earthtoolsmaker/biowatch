/**
 * Sequence-related IPC handlers.
 *
 * Heavy computations (DB query + sequence grouping + effort normalization)
 * run in worker threads so the main thread stays responsive for UI events and
 * tile rendering.
 */

import { app, ipcMain } from 'electron'
import log from '../services/logger.js'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import { runInWorker } from '../services/sequences/runInWorker.js'
import { VEHICLE_SENTINEL } from '../../shared/constants.js'
import { normalizeAnalysisMetric } from '../../shared/analysisMetric.js'

/**
 * Drop VEHICLE_SENTINEL from a species filter list before passing to the
 * sequence-aware activity queries (timeseries, heatmap, daily-activity).
 *
 * Those queries operate over `WHERE scientificName IN (...)`; vehicle
 * observations have no `scientificName`, so the sentinel would silently
 * match nothing and produce an empty chart even on studies with thousands
 * of vehicle media. The Library/Deployments species filter exposes
 * Vehicle as a clickable bucket, so the sentinel can legitimately reach
 * these IPCs.
 *
 * Returns { stripped, vehicleOnly } — `vehicleOnly` is true when the
 * caller passed a non-empty filter that contained only the sentinel
 * (and/or other ignored values), so the handler can short-circuit with
 * an appropriate empty result instead of treating the request as
 * "no filter → return everything".
 */
function stripVehicleSentinel(speciesNames) {
  const input = speciesNames || []
  const stripped = input.filter((species) => species !== VEHICLE_SENTINEL)
  return { stripped, vehicleOnly: input.length > 0 && stripped.length === 0 }
}

function validateRequest(request, allowedKeys) {
  if (!request || Array.isArray(request) || typeof request !== 'object') {
    throw new Error('Invalid sequence analysis request')
  }
  const unknown = Object.keys(request).filter((key) => !allowedKeys.includes(key))
  if (unknown.length) throw new Error(`Unknown sequence analysis option: ${unknown[0]}`)
  if (typeof request.studyId !== 'string' || request.studyId.length === 0) {
    throw new Error('Invalid studyId')
  }
  if (
    request.gapSeconds !== undefined &&
    request.gapSeconds !== null &&
    !Number.isFinite(request.gapSeconds)
  ) {
    throw new Error('Invalid gapSeconds')
  }
  if (
    request.speciesNames !== undefined &&
    (!Array.isArray(request.speciesNames) ||
      request.speciesNames.some((species) => typeof species !== 'string'))
  ) {
    throw new Error('Invalid speciesNames')
  }
  for (const key of ['startDate', 'endDate']) {
    if (request[key] !== undefined && request[key] !== null && typeof request[key] !== 'string') {
      throw new Error(`Invalid ${key}`)
    }
  }
  if (
    request.includeNullTimestamps !== undefined &&
    typeof request.includeNullTimestamps !== 'boolean'
  ) {
    throw new Error('Invalid includeNullTimestamps')
  }
  if (request.timeRange !== undefined) {
    if (
      !request.timeRange ||
      Array.isArray(request.timeRange) ||
      typeof request.timeRange !== 'object'
    ) {
      throw new Error('Invalid timeRange')
    }
    const ranges = Array.isArray(request.timeRange.ranges)
      ? request.timeRange.ranges
      : request.timeRange.start !== undefined || request.timeRange.end !== undefined
        ? [request.timeRange]
        : []
    if (
      ranges.some(
        (range) =>
          !range ||
          !Number.isFinite(range.start) ||
          !Number.isFinite(range.end) ||
          range.start < 0 ||
          range.start > 24 ||
          range.end < 0 ||
          range.end > 24
      )
    ) {
      throw new Error('Invalid timeRange')
    }
  }
  if (request.bbox != null) {
    const { north, south, east, west } = request.bbox
    if ([north, south, east, west].some((value) => !Number.isFinite(value))) {
      throw new Error('Invalid bbox')
    }
  }
  return { ...request, metric: normalizeAnalysisMetric(request.metric) }
}

function resolveDatabase(studyId) {
  const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
  if (!dbPath || !existsSync(dbPath)) {
    log.warn(`Database not found for study ID: ${studyId}`)
    return null
  }
  return dbPath
}

async function handleAnalysis(type, request, allowedKeys, transform = (value) => value) {
  const validated = validateRequest(request, allowedKeys)
  const dbPath = resolveDatabase(validated.studyId)
  if (!dbPath) return { error: 'Database not found for this study' }
  return transform(validated, dbPath, type)
}

/** Register all sequence-related IPC handlers. */
export function registerSequencesIPCHandlers() {
  /**
   * Get the sequence-aware species distribution. Every metric uses the worker:
   * SQL handles the fast paths while positive-gap N ind. retains the existing
   * JavaScript grouping fallback. Both stay off the main thread because
   * large-study scans can take several seconds.
   */
  ipcMain.handle('sequences:get-species-distribution', async (_, request) => {
    try {
      return await handleAnalysis(
        'species-distribution',
        request,
        ['studyId', 'gapSeconds', 'bbox', 'metric'],
        async (validated, dbPath) => ({
          data: await runInWorker({ type: 'species-distribution', dbPath, ...validated })
        })
      )
    } catch (error) {
      log.error('Error getting sequence-aware species distribution:', error)
      return { error: error.message }
    }
  })

  /** Get the sequence-aware weekly species timeseries. */
  ipcMain.handle('sequences:get-timeseries', async (_, request) => {
    try {
      return await handleAnalysis(
        'timeseries',
        request,
        ['studyId', 'speciesNames', 'gapSeconds', 'bbox', 'metric'],
        async (validated, dbPath) => {
          const { stripped, vehicleOnly } = stripVehicleSentinel(validated.speciesNames)
          if (vehicleOnly) return { data: { timeseries: [], allSpecies: [] } }
          return {
            data: await runInWorker({
              type: 'timeseries',
              dbPath,
              ...validated,
              speciesNames: stripped
            })
          }
        }
      )
    } catch (error) {
      log.error('Error getting sequence-aware timeseries:', error)
      return { error: error.message }
    }
  })

  /** Get sequence-aware location data for the Explore map. */
  ipcMain.handle('sequences:get-heatmap', async (_, request) => {
    try {
      return await handleAnalysis(
        'heatmap',
        request,
        [
          'studyId',
          'speciesNames',
          'startDate',
          'endDate',
          'timeRange',
          'includeNullTimestamps',
          'gapSeconds',
          'metric'
        ],
        async (validated, dbPath) => {
          const { stripped, vehicleOnly } = stripVehicleSentinel(validated.speciesNames)
          if (vehicleOnly) return { data: { locations: [] } }
          return {
            data: await runInWorker({
              type: 'heatmap',
              dbPath,
              ...validated,
              speciesNames: stripped
            })
          }
        }
      )
    } catch (error) {
      log.error('Error getting sequence-aware heatmap:', error)
      return { error: error.message }
    }
  })

  /** Get sequence-aware hourly activity data. */
  ipcMain.handle('sequences:get-daily-activity', async (_, request) => {
    try {
      return await handleAnalysis(
        'daily-activity',
        request,
        ['studyId', 'speciesNames', 'startDate', 'endDate', 'gapSeconds', 'bbox', 'metric'],
        async (validated, dbPath) => {
          const { stripped, vehicleOnly } = stripVehicleSentinel(validated.speciesNames)
          if (vehicleOnly) return { data: [] }
          return {
            data: await runInWorker({
              type: 'daily-activity',
              dbPath,
              ...validated,
              speciesNames: stripped
            })
          }
        }
      )
    } catch (error) {
      log.error('Error getting sequence-aware daily activity:', error)
      return { error: error.message }
    }
  })

  /**
   * Get paginated sequences. Dispatched to the sequences worker because
   * studies with long event-grouped sequences can require scanning hundreds
   * of underlying media to form a single page, which previously blocked
   * renderer input for multiple seconds on main.
   */
  ipcMain.handle('sequences:get-paginated', async (_, studyId, options = {}) => {
    try {
      const dbPath = resolveDatabase(studyId)
      if (!dbPath) return { error: 'Database not found for this study' }
      const { gapSeconds = 60, limit = 20, cursor = null, filters = {}, sort = 'newest' } = options
      return {
        data: await runInWorker({
          type: 'pagination',
          dbPath,
          options: { gapSeconds, limit, cursor, filters, sort }
        })
      }
    } catch (error) {
      log.error('Error getting paginated sequences:', error)
      return { error: error.message }
    }
  })
}
