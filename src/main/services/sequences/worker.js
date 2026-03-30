/**
 * Worker thread for sequence-aware computations.
 *
 * Runs DB queries and sequence grouping off the main thread so the UI stays
 * responsive. Each worker instance handles a single task then exits.
 */

import { parentPort, workerData } from 'worker_threads'
import {
  getDrizzleDb,
  getMetadata,
  getSpeciesDistributionByMedia,
  getSpeciesTimeseriesByMedia,
  getSpeciesHeatmapDataByMedia,
  getSpeciesDailyActivityByMedia
} from '../../database/index.js'
import {
  calculateSequenceAwareSpeciesCounts,
  calculateSequenceAwareTimeseries,
  calculateSequenceAwareHeatmap,
  calculateSequenceAwareDailyActivity
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
      const rawData = await getSpeciesDistributionByMedia(dbPath)
      return calculateSequenceAwareSpeciesCounts(rawData, effectiveGapSeconds)
    }
    case 'timeseries': {
      const rawData = await getSpeciesTimeseriesByMedia(dbPath, speciesNames)
      return calculateSequenceAwareTimeseries(rawData, effectiveGapSeconds)
    }
    case 'heatmap': {
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
      const rawData = await getSpeciesDailyActivityByMedia(dbPath, speciesNames, startDate, endDate)
      return calculateSequenceAwareDailyActivity(rawData, effectiveGapSeconds, speciesNames)
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
