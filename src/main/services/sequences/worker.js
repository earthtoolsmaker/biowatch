/**
 * Worker thread for heavy DB computations.
 *
 * Dispatches on `workerData.type`: sequence-aware species-distribution,
 * timeseries, heatmap, daily-activity, pagination, and the best-media
 * scoring pipeline. Runs off the main thread so the renderer UI stays
 * responsive during multi-second SQLite scans. Each worker instance handles
 * a single task then exits.
 */

import { parentPort, workerData } from 'worker_threads'
import {
  getDrizzleDb,
  getMetadata,
  getSpeciesDistributionByMedia,
  getSpeciesTimeseriesByMedia,
  getSpeciesHeatmapDataByMedia,
  getSequenceAwareSpeciesCountsSQL,
  getSequenceAwareTimeseriesSQL,
  getSequenceAwareHeatmapSQL,
  getSequenceAwareDailyActivitySQL,
  getBestMedia,
  getDeploymentsActivity
} from '../../database/index.js'
import { getPaginatedSequences } from './pagination.js'
import {
  calculateSequenceAwareSpeciesCounts,
  calculateSequenceAwareTimeseries,
  calculateSequenceAwareHeatmap,
  pivotPreAggregatedTimeseries,
  pivotPreAggregatedDailyActivity,
  pivotPreAggregatedHeatmap
} from './speciesCounts.js'

async function run() {
  const {
    type,
    dbPath,
    studyId,
    gapSeconds,
    speciesNames,
    startDate,
    endDate,
    startHour,
    endHour,
    includeNullTimestamps
  } = workerData

  // Fetch gapSeconds from metadata if not provided
  let effectiveGapSeconds = gapSeconds
  if (effectiveGapSeconds === undefined) {
    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })
    const meta = await getMetadata(db)
    effectiveGapSeconds = meta?.sequenceGap ?? null
  }

  switch (type) {
    case 'species-distribution': {
      // Fast path: SQL aggregate handles gapSeconds === null and === 0, returns
      // the final [{scientificName, count}] directly (83 rows, not 1.65M).
      // Returns null for positive gapSeconds, in which case we fall back to the
      // row-dump + JS sequence grouping below.
      const fast = await getSequenceAwareSpeciesCountsSQL(dbPath, effectiveGapSeconds)
      if (fast !== null) return fast
      const rawData = await getSpeciesDistributionByMedia(dbPath)
      return calculateSequenceAwareSpeciesCounts(rawData, effectiveGapSeconds)
    }
    case 'timeseries': {
      // Fast path: SQL aggregate handles gapSeconds === null and === 0,
      // returns pre-grouped (species, week, count) rows — orders of magnitude
      // smaller than the raw observation-per-media dump the JS path needs.
      // Returns null for positive gapSeconds → fall back to the JS path for
      // time-gap-based sequence grouping.
      const fastRows = await getSequenceAwareTimeseriesSQL(
        dbPath,
        speciesNames,
        effectiveGapSeconds
      )
      if (fastRows !== null) return pivotPreAggregatedTimeseries(fastRows)
      const rawData = await getSpeciesTimeseriesByMedia(dbPath, speciesNames)
      return calculateSequenceAwareTimeseries(rawData, effectiveGapSeconds)
    }
    case 'heatmap': {
      // Fast path: SQL aggregate handles all three gap cases (per-media,
      // eventID, time-gap) and returns pre-grouped (species, lat, lng, count)
      // rows — on gmu8_leuven the IPC payload goes from ~400MB of raw
      // observation rows to <100KB, with no JS-side aggregation.
      // Returns null only when BLANK_SENTINEL is in speciesNames, in which
      // case we fall back to the JS path (which doesn't handle blanks either
      // — the fallback is future-proofing).
      const fastRows = await getSequenceAwareHeatmapSQL(
        dbPath,
        speciesNames,
        startDate,
        endDate,
        startHour,
        endHour,
        includeNullTimestamps,
        effectiveGapSeconds
      )
      if (fastRows !== null) return pivotPreAggregatedHeatmap(fastRows)
      const rawData = await getSpeciesHeatmapDataByMedia(
        dbPath,
        speciesNames,
        startDate,
        endDate,
        startHour,
        endHour,
        includeNullTimestamps
      )
      return calculateSequenceAwareHeatmap(rawData, effectiveGapSeconds)
    }
    case 'daily-activity': {
      const rows = await getSequenceAwareDailyActivitySQL(
        dbPath,
        speciesNames,
        startDate,
        endDate,
        effectiveGapSeconds
      )
      return pivotPreAggregatedDailyActivity(rows || [], speciesNames)
    }
    case 'best-media': {
      // Off-main-thread path for the best-captures carousel. Covers both the
      // favorites CTE and the (potentially heavy) auto-scored CTE. See
      // src/main/database/queries/best-media.js for the query pipeline.
      return getBestMedia(dbPath, workerData.options || {})
    }
    case 'pagination': {
      // Gallery paginated sequences. Studies with long event-grouped sequences
      // can require scanning hundreds of media to form one page of 15 — running
      // on main was causing multi-second input freezes on large studies.
      return getPaginatedSequences(dbPath, workerData.options || {})
    }
    case 'deployments-activity': {
      // Deployments tab's per-deployment period-bucket aggregation. The
      // SUM(CASE) × 20 scan over observations was locking the renderer for
      // multiple seconds on first open of large studies.
      return getDeploymentsActivity(dbPath)
    }
    default:
      throw new Error(`Unknown worker task type: ${type}`)
  }
}

run()
  .then((data) => {
    parentPort.postMessage({ data })
  })
  .catch((error) => {
    parentPort.postMessage({ error: error.message })
  })
