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
import { getHeapStatistics } from 'v8'
import log from '../logger.js'
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
  getBestImagePerSpecies,
  getDeploymentsActivity,
  getSourcesData,
  getOverviewStats
} from '../../database/index.js'
import { getPaginatedSequences } from './pagination.js'
import { getDeploymentComposition } from './deploymentComposition.js'
import {
  calculateSequenceAwareSpeciesCounts,
  calculateSequenceAwareTimeseries,
  calculateSequenceAwareHeatmap,
  pivotPreAggregatedTimeseries,
  pivotPreAggregatedDailyActivity,
  pivotPreAggregatedHeatmap
} from './speciesCounts.js'

// Live heap usage in MB — cheap to call, used to trace memory growth across
// the row-dump + JS aggregation fallbacks that can OOM the worker.
function heapMb() {
  return Math.round(process.memoryUsage().heapUsed / 1048576)
}

async function run() {
  const {
    type,
    dbPath,
    studyId,
    gapSeconds,
    speciesNames,
    startDate,
    endDate,
    timeRange,
    includeNullTimestamps,
    bbox
  } = workerData

  // Fetch gapSeconds from metadata if not provided
  let effectiveGapSeconds = gapSeconds
  if (effectiveGapSeconds === undefined) {
    const db = await getDrizzleDb(studyId, dbPath, { readonly: true })
    const meta = await getMetadata(db)
    effectiveGapSeconds = meta?.sequenceGap ?? null
  }

  const tag = `[seq-worker:${type}]`
  const heapLimitMb = Math.round(getHeapStatistics().heap_size_limit / 1048576)
  log.info(
    `${tag} start gap=${effectiveGapSeconds} bbox=${bbox ? 'yes' : 'no'} ` +
      `species=${speciesNames?.length ?? 0} heap=${heapMb()}/${heapLimitMb}MB`
  )

  switch (type) {
    case 'species-distribution': {
      // Fast path: SQL aggregate handles gapSeconds === null and === 0, returns
      // the final [{scientificName, count}] directly (83 rows, not 1.65M).
      // Returns null for positive gapSeconds, in which case we fall back to the
      // row-dump + JS sequence grouping below.
      const fast = await getSequenceAwareSpeciesCountsSQL(dbPath, effectiveGapSeconds, bbox)
      if (fast !== null) return fast
      log.warn(
        `${tag} SLOW PATH (gap=${effectiveGapSeconds}): SQL fast-path returned null, dumping rows`
      )
      const rawData = await getSpeciesDistributionByMedia(dbPath, bbox)
      log.info(`${tag} loaded ${rawData.length} rows, heap=${heapMb()}MB — starting JS aggregation`)
      const result = calculateSequenceAwareSpeciesCounts(rawData, effectiveGapSeconds)
      log.info(`${tag} aggregation done: ${result.length} species, heap=${heapMb()}MB`)
      return result
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
        effectiveGapSeconds,
        bbox
      )
      if (fastRows !== null) return pivotPreAggregatedTimeseries(fastRows)
      log.warn(
        `${tag} SLOW PATH (gap=${effectiveGapSeconds}): SQL fast-path returned null, dumping rows`
      )
      const rawData = await getSpeciesTimeseriesByMedia(dbPath, speciesNames, bbox)
      log.info(`${tag} loaded ${rawData.length} rows, heap=${heapMb()}MB — starting JS aggregation`)
      const result = calculateSequenceAwareTimeseries(rawData, effectiveGapSeconds)
      log.info(`${tag} aggregation done, heap=${heapMb()}MB`)
      return result
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
        timeRange,
        includeNullTimestamps,
        effectiveGapSeconds
      )
      if (fastRows !== null) return pivotPreAggregatedHeatmap(fastRows)
      log.warn(
        `${tag} SLOW PATH (gap=${effectiveGapSeconds}): SQL fast-path returned null, dumping rows`
      )
      const rawData = await getSpeciesHeatmapDataByMedia(
        dbPath,
        speciesNames,
        startDate,
        endDate,
        timeRange,
        includeNullTimestamps
      )
      log.info(`${tag} loaded ${rawData.length} rows, heap=${heapMb()}MB — starting JS aggregation`)
      const result = calculateSequenceAwareHeatmap(rawData, effectiveGapSeconds)
      log.info(`${tag} aggregation done, heap=${heapMb()}MB`)
      return result
    }
    case 'daily-activity': {
      const rows = await getSequenceAwareDailyActivitySQL(
        dbPath,
        speciesNames,
        startDate,
        endDate,
        effectiveGapSeconds,
        bbox
      )
      return pivotPreAggregatedDailyActivity(rows || [], speciesNames)
    }
    case 'best-media': {
      // Off-main-thread path for the best-captures carousel. Covers both the
      // favorites CTE and the (potentially heavy) auto-scored CTE. See
      // src/main/database/queries/best-media.js for the query pipeline.
      return getBestMedia(dbPath, workerData.options || {})
    }
    case 'best-images-per-species': {
      // Overview tab's species-distribution hover tooltips. Two SQLite paths,
      // both expensive on large studies: the full multi-CTE scoring CTE
      // (~440-840ms on 209k obs / 49k bbox), and — counter-intuitively — the
      // no-bbox short-circuit probe, which has to scan the entire observations
      // table looking for a non-null bboxX (~1.3-1.7s cold on 2.7-4M obs
      // studies that turn out to have no bboxes at all). Off-thread so the
      // main process keeps responding to other IPC during that window.
      return getBestImagePerSpecies(dbPath)
    }
    case 'pagination': {
      // Gallery paginated sequences. Studies with long event-grouped sequences
      // can require scanning hundreds of media to form one page of 15 — running
      // on main was causing multi-second input freezes on large studies.
      return getPaginatedSequences(dbPath, workerData.options || {})
    }
    case 'deployments-activity': {
      // Deployments tab's per-deployment period-bucket aggregation. The
      // SUM(CASE) × N scan over observations was locking the renderer for
      // multiple seconds on first open of large studies.
      return getDeploymentsActivity(dbPath, workerData.periodCount)
    }
    case 'deployment-composition': {
      // Media tab's per-deployment blank/detection composition. Fetches ALL
      // media (synchronous better-sqlite3) and groups it into sequences in JS
      // — O(media) work that froze the main process for seconds on large
      // studies. Off-thread keeps the renderer responsive while it loads.
      return getDeploymentComposition(dbPath, effectiveGapSeconds)
    }
    case 'sources-data': {
      // Sources tab rollup. Runs four queries (per-source, per-deployment,
      // last-model-used, active-run) over media/observations/model_outputs and
      // would otherwise block the renderer on large studies.
      return getSourcesData(dbPath)
    }
    case 'overview-stats': {
      // Overview tab's KPI band — counts + derived range in two SQLite
      // round-trips. Off the main thread because the underlying scans on
      // observations / deployments / media are O(table size) and large
      // studies show multi-hundred-ms latency.
      return getOverviewStats(dbPath)
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
