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
  getDistinctSpecies,
  getSpeciesDistributionByMedia,
  getSpeciesTimeseriesByMedia,
  getSpeciesHeatmapDataByMedia,
  getSequenceAwareSpeciesCountsSQL,
  getSequenceAwareTimeseriesSQL,
  getSequenceAwareHeatmapSQL,
  getSequenceAwareDailyActivitySQL,
  getDeploymentEffortRows,
  getBestMedia,
  getBestImagePerSpecies,
  getDeploymentsActivity,
  getSourcesData,
  getOverviewStats
} from '../../database/index.js'
import { getPaginatedSequences } from './pagination.js'
import { getDeploymentComposition } from './deploymentComposition.js'
import {
  DEFAULT_ANALYSIS_METRIC,
  NORMALIZATION_RAI_100,
  normalizeAnalysisMetric
} from '../../../shared/analysisMetric.js'
import {
  calculateSequenceAwareSpeciesCounts,
  calculateSequenceAwareTimeseries,
  calculateSequenceAwareHeatmap,
  pivotPreAggregatedTimeseries,
  pivotPreAggregatedDailyActivity
} from './speciesCounts.js'
import {
  groupEffortByHour,
  groupEffortByLocation,
  groupEffortByWeek,
  sumTotalEffort,
  validateDeploymentIntervals
} from './effort.js'

const deriveRate = (rawCount, effortDays) =>
  effortDays > 0 ? (100 * Number(rawCount || 0)) / effortDays : null

function effortAvailability(validated, effortDays) {
  return {
    effortDays,
    validDeploymentCount: validated.validDeploymentCount,
    excludedDeploymentCount: validated.excludedDeploymentCount
  }
}

function normalizeRaiDistribution(rows, validated) {
  const effortDays = sumTotalEffort(validated.intervals)
  return (rows || [])
    .map((row) => ({
      scientificName: row.scientificName,
      count: deriveRate(row.count, effortDays),
      rawCount: Number(row.count),
      effortDays,
      availability: effortAvailability(validated, effortDays)
    }))
    .sort((left, right) => {
      if (left.count == null) return right.count == null ? right.rawCount - left.rawCount : 1
      if (right.count == null) return -1
      return right.count - left.count || right.rawCount - left.rawCount
    })
}

function normalizeRaiTimeseries(result, validated, selectedSpecies) {
  const effortByWeek = groupEffortByWeek(validated.intervals)
  const rawByWeek = new Map((result.timeseries || []).map((row) => [row.date, row]))
  const weeks = [...new Set([...effortByWeek.keys(), ...rawByWeek.keys()])].sort()
  const timeseries = weeks.map((date) => {
    const effortDays = effortByWeek.get(date) || 0
    const raw = rawByWeek.get(date) || {}
    return {
      date,
      effortDays,
      rawCounts: Object.fromEntries(
        selectedSpecies.map((scientificName) => [scientificName, Number(raw[scientificName]) || 0])
      ),
      ...Object.fromEntries(
        selectedSpecies.map((scientificName) => [
          scientificName,
          deriveRate(raw[scientificName], effortDays)
        ])
      )
    }
  })
  return {
    timeseries,
    allSpecies: result.allSpecies || [],
    availability: effortAvailability(
      validated,
      [...effortByWeek.values()].reduce((sum, effortDays) => sum + effortDays, 0)
    )
  }
}

function normalizeRaiActivity(rows, validated, selectedSpecies, startDate, endDate) {
  const effortByHour = groupEffortByHour(validated.intervals, { start: startDate, end: endDate })
  const raw = pivotPreAggregatedDailyActivity(rows || [], selectedSpecies)
  return raw.map((row, hour) => ({
    hour,
    effortDays: effortByHour[hour],
    validDeploymentCount: validated.validDeploymentCount,
    excludedDeploymentCount: validated.excludedDeploymentCount,
    rawCounts: Object.fromEntries(
      selectedSpecies.map((scientificName) => [scientificName, Number(row[scientificName]) || 0])
    ),
    ...Object.fromEntries(
      selectedSpecies.map((scientificName) => [
        scientificName,
        deriveRate(row[scientificName], effortByHour[hour])
      ])
    )
  }))
}

function normalizeRawLocations(rawRows, selectedSpecies) {
  const locations = new Map()
  for (const row of rawRows || []) {
    if (row.latitude == null || row.longitude == null) continue
    const lat = Number(row.latitude)
    const lng = Number(row.longitude)
    const key = `${lat},${lng}`
    const location = locations.get(key) || {
      lat,
      lng,
      locationName: row.locationName || null,
      effortDays: null,
      rawCounts: Object.fromEntries(selectedSpecies.map((name) => [name, 0]))
    }
    location.rawCounts[row.scientificName] = Number(row.count) || 0
    locations.set(key, location)
  }
  return {
    locations: [...locations.values()].map((location) => ({
      ...location,
      values: { ...location.rawCounts }
    }))
  }
}

function normalizeRaiLocations(rawRows, validated, selectedSpecies, options) {
  const effortLocations = groupEffortByLocation(validated.intervals, options)
  const locations = new Map()
  for (const effortLocation of effortLocations.values()) {
    const key = `${effortLocation.lat},${effortLocation.lng}`
    locations.set(key, {
      ...effortLocation,
      rawCounts: Object.fromEntries(selectedSpecies.map((name) => [name, 0]))
    })
  }
  for (const row of rawRows || []) {
    if (row.latitude == null || row.longitude == null) continue
    const lat = Number(row.latitude)
    const lng = Number(row.longitude)
    const key = `${lat},${lng}`
    const location = locations.get(key)
    if (!location) continue
    location.rawCounts[row.scientificName] = Number(row.count) || 0
    if (!location.locationName && row.locationName) location.locationName = row.locationName
  }
  return {
    locations: [...locations.values()].map((location) => ({
      ...location,
      values: Object.fromEntries(
        selectedSpecies.map((name) => [
          name,
          deriveRate(location.rawCounts[name], location.effortDays)
        ])
      )
    })),
    availability: effortAvailability(
      validated,
      [...effortLocations.values()].reduce((sum, location) => sum + location.effortDays, 0)
    )
  }
}

function rawRowsFromHeatmap(result) {
  const rows = []
  for (const [scientificName, points] of Object.entries(result || {})) {
    for (const point of points) {
      rows.push({
        scientificName,
        latitude: point.lat,
        longitude: point.lng,
        locationName: point.locationName,
        count: point.count
      })
    }
  }
  return rows
}

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
    bbox,
    metric: requestedMetric = DEFAULT_ANALYSIS_METRIC
  } = workerData
  const metric = normalizeAnalysisMetric(requestedMetric)
  const needsEffort = metric.normalization === NORMALIZATION_RAI_100

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
    `${tag} start gap=${effectiveGapSeconds} counting=${metric.counting} normalization=${metric.normalization} bbox=${bbox ? 'yes' : 'no'} ` +
      `species=${speciesNames?.length ?? 0} heap=${heapMb()}/${heapLimitMb}MB`
  )

  switch (type) {
    case 'species-distribution': {
      // SQL returns final [{scientificName, count}] rows directly. Positive-gap
      // N ind. retains the established JS path; N obs. stays in SQL for every
      // grouping mode because each species/sequence contributes exactly one.
      // RAI reuses the selected raw-count path after excluding media that
      // cannot be attributed to valid deployment effort.
      const fast = await getSequenceAwareSpeciesCountsSQL(
        dbPath,
        effectiveGapSeconds,
        bbox,
        metric.counting,
        needsEffort
      )
      let result = fast
      if (fast === null) {
        log.warn(
          `${tag} SLOW PATH (gap=${effectiveGapSeconds}): SQL fast-path returned null, dumping rows`
        )
        const rawData = await getSpeciesDistributionByMedia(dbPath, bbox, needsEffort)
        log.info(
          `${tag} loaded ${rawData.length} rows, heap=${heapMb()}MB — starting JS aggregation`
        )
        result = calculateSequenceAwareSpeciesCounts(rawData, effectiveGapSeconds, metric.counting)
        log.info(`${tag} aggregation done: ${result.length} species, heap=${heapMb()}MB`)
      }
      if (!needsEffort) return result
      const validated = validateDeploymentIntervals(await getDeploymentEffortRows(dbPath), { bbox })
      if (result.length === 0 && validated.intervals.length === 0) {
        const species = await getDistinctSpecies(dbPath)
        result = species.map((row) => ({ scientificName: row.scientificName, count: 0 }))
      }
      return normalizeRaiDistribution(result, validated)
    }
    case 'timeseries': {
      // SQL returns pre-grouped (species, week, count) rows. Positive-gap
      // N ind. retains the established JS fallback; N obs. has an SQL path for
      // every grouping mode. Effort normalization is applied after this raw
      // weekly aggregation.
      const fastRows = await getSequenceAwareTimeseriesSQL(
        dbPath,
        speciesNames,
        effectiveGapSeconds,
        bbox,
        metric.counting,
        needsEffort
      )
      let result
      if (fastRows !== null) {
        result = pivotPreAggregatedTimeseries(fastRows)
      } else {
        log.warn(
          `${tag} SLOW PATH (gap=${effectiveGapSeconds}): SQL fast-path returned null, dumping rows`
        )
        const rawData = await getSpeciesTimeseriesByMedia(dbPath, speciesNames, bbox, needsEffort)
        result = calculateSequenceAwareTimeseries(rawData, effectiveGapSeconds, metric.counting)
        log.info(`${tag} aggregation done, heap=${heapMb()}MB`)
      }
      if (!needsEffort) return result
      const validated = validateDeploymentIntervals(await getDeploymentEffortRows(dbPath), { bbox })
      return normalizeRaiTimeseries(result, validated, speciesNames)
    }
    case 'heatmap': {
      // Fast path: SQL handles per-media, eventID, and time-gap grouping and
      // returns pre-grouped (species, lat, lng, count) rows. On gmu8_leuven
      // this keeps the IPC payload below 100KB instead of shipping ~400MB of
      // raw observation rows. A sentinel request may still return null and use
      // the JS fallback. The worker then pivots rows into location-oriented
      // raw-count/value payloads and adds effort-only locations for RAI.
      const fastRows = await getSequenceAwareHeatmapSQL(
        dbPath,
        speciesNames,
        startDate,
        endDate,
        timeRange,
        includeNullTimestamps,
        effectiveGapSeconds,
        metric.counting,
        needsEffort
      )
      let rows = fastRows
      if (fastRows === null) {
        log.warn(
          `${tag} SLOW PATH (gap=${effectiveGapSeconds}): SQL fast-path returned null, dumping rows`
        )
        const rawData = await getSpeciesHeatmapDataByMedia(
          dbPath,
          speciesNames,
          startDate,
          endDate,
          timeRange,
          includeNullTimestamps,
          needsEffort
        )
        rows = rawRowsFromHeatmap(
          calculateSequenceAwareHeatmap(rawData, effectiveGapSeconds, metric.counting)
        )
        log.info(`${tag} aggregation done, heap=${heapMb()}MB`)
      }
      if (!needsEffort) return normalizeRawLocations(rows, speciesNames)
      const validated = validateDeploymentIntervals(await getDeploymentEffortRows(dbPath), {
        requireCoordinates: true
      })
      return normalizeRaiLocations(rows, validated, speciesNames, {
        start: startDate,
        end: endDate,
        timeRange
      })
    }
    case 'daily-activity': {
      const rows = await getSequenceAwareDailyActivitySQL(
        dbPath,
        speciesNames,
        startDate,
        endDate,
        effectiveGapSeconds,
        bbox,
        metric.counting,
        needsEffort
      )
      if (!needsEffort) return pivotPreAggregatedDailyActivity(rows || [], speciesNames)
      const validated = validateDeploymentIntervals(await getDeploymentEffortRows(dbPath), { bbox })
      return normalizeRaiActivity(rows, validated, speciesNames, startDate, endDate)
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
