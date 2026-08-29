/**
 * Utilities for calculating sequence-aware species counts.
 *
 * Media are grouped into sequences once, then each species contributes either:
 * - individuals: its MAX same-frame detection count in the sequence
 * - observations: 1 when it is present anywhere in the sequence
 *
 * Example:
 * - Sequence 1: Photo A (2 deer), Photo B (3 deer), Photo C (1 deer) -> max deer = 3
 * - Sequence 2: Photo D (5 deer), Photo E (2 deer) -> max deer = 5
 * - Total deer = 3 + 5 = 8 (instead of 13 if we counted each observation)
 */

import { groupMediaIntoSequences, groupMediaByEventID } from './grouping.js'
import {
  COUNT_METRIC_INDIVIDUALS,
  COUNT_METRIC_OBSERVATIONS,
  normalizeCountMetric
} from '../../../shared/countMetric.js'

/**
 * Check if a media item is a video based on fileMediatype
 * @param {Object} media - Media object with fileMediatype property
 * @returns {boolean} - True if media is a video
 */
function isVideoMedia(media) {
  return media.fileMediatype && media.fileMediatype.startsWith('video/')
}

/**
 * Groups media observations into sequences and calculates sequence-aware species counts.
 *
 * @param {Array} observationsByMedia - Array of { scientificName, mediaID, timestamp, deploymentID, eventID, fileMediatype, count }
 * @param {number} gapSeconds - Gap threshold in seconds (0 = use eventID grouping)
 * @param {'individuals'|'observations'} [countMetric='individuals']
 * @returns {Array} - Array of { scientificName, count } sorted by count descending
 */
export function calculateSequenceAwareSpeciesCounts(
  observationsByMedia,
  gapSeconds,
  countMetric = COUNT_METRIC_INDIVIDUALS
) {
  const metric = normalizeCountMetric(countMetric)
  if (!observationsByMedia || observationsByMedia.length === 0) {
    return []
  }

  // Create a map of mediaID -> media info for grouping
  const mediaMap = new Map()

  for (const obs of observationsByMedia) {
    if (!mediaMap.has(obs.mediaID)) {
      mediaMap.set(obs.mediaID, {
        mediaID: obs.mediaID,
        timestamp: obs.timestamp,
        deploymentID: obs.deploymentID,
        eventID: obs.eventID,
        fileMediatype: obs.fileMediatype
      })
    }
  }

  // Build index: mediaID -> array of {scientificName, count}
  const observationsByMediaID = new Map()
  for (const obs of observationsByMedia) {
    if (!observationsByMediaID.has(obs.mediaID)) {
      observationsByMediaID.set(obs.mediaID, [])
    }
    observationsByMediaID.get(obs.mediaID).push({
      scientificName: obs.scientificName,
      count: obs.count
    })
  }

  // Convert media map to array for grouping
  const mediaArray = Array.from(mediaMap.values())

  // Group media into sequences
  let sequences, nullTimestampMedia
  if (gapSeconds === 0) {
    // Use eventID-based grouping for CamtrapDP datasets
    const result = groupMediaByEventID(mediaArray)
    sequences = result.sequences
    nullTimestampMedia = result.nullTimestampMedia
  } else {
    // Use timestamp-based grouping
    const result = groupMediaIntoSequences(mediaArray, gapSeconds, isVideoMedia)
    sequences = result.sequences
    nullTimestampMedia = result.nullTimestampMedia
  }

  const speciesCounts = new Map()

  // Sequence formation is shared by both metrics. Only each species' contribution
  // changes: the existing metric contributes its largest same-frame count, while
  // independent observations contribute one for presence anywhere in the sequence.
  const addSequence = (items) => {
    const sequenceCounts = new Map()
    for (const media of items) {
      const mediaObs = observationsByMediaID.get(media.mediaID) || []
      for (const { scientificName, count } of mediaObs) {
        const contribution = metric === COUNT_METRIC_OBSERVATIONS ? 1 : count
        const current = sequenceCounts.get(scientificName) || 0
        sequenceCounts.set(scientificName, Math.max(current, contribution))
      }
    }
    for (const [species, contribution] of sequenceCounts) {
      speciesCounts.set(species, (speciesCounts.get(species) || 0) + contribution)
    }
  }

  for (const sequence of sequences) addSequence(sequence.items)

  // Null/invalid-timestamp media retain the existing single-media sequence rule.
  for (const media of nullTimestampMedia) addSequence([media])

  // Convert to array and sort by count descending
  const result = Array.from(speciesCounts.entries())
    .map(([scientificName, count]) => ({ scientificName, count }))
    .sort((a, b) => b.count - a.count)

  return result
}

/**
 * Calculates sequence-aware species counts grouped by week for timeline charts.
 *
 * @param {Array} observationsByMedia - Array of { scientificName, mediaID, timestamp, deploymentID, eventID, fileMediatype, weekStart, count }
 * @param {number} gapSeconds - Gap threshold in seconds (0 = use eventID grouping)
 * @returns {Object} - { timeseries: Array, allSpecies: Array }
 */
export function calculateSequenceAwareTimeseries(
  observationsByMedia,
  gapSeconds,
  countMetric = COUNT_METRIC_INDIVIDUALS
) {
  if (!observationsByMedia || observationsByMedia.length === 0) {
    return { timeseries: [], allSpecies: [] }
  }

  // Group observations by week
  const observationsByWeek = new Map()
  for (const obs of observationsByMedia) {
    let week = obs.weekStart

    // Fallback: compute weekStart from timestamp if weekStart is null
    if (!week && obs.timestamp) {
      try {
        const date = new Date(obs.timestamp)
        if (!isNaN(date.getTime())) {
          // Get Monday of the week (ISO week)
          const day = date.getUTCDay()
          const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1)
          date.setUTCDate(diff)
          week = date.toISOString().slice(0, 10)
        }
      } catch {
        // Invalid date, skip
      }
    }

    if (!week) continue
    if (!observationsByWeek.has(week)) {
      observationsByWeek.set(week, [])
    }
    observationsByWeek.get(week).push(obs)
  }

  // Calculate sequence-aware counts for each week
  const weeklySpeciesCounts = new Map()
  const allSpeciesSet = new Set()

  for (const [week, weekObs] of observationsByWeek) {
    const weeklyCounts = calculateSequenceAwareSpeciesCounts(weekObs, gapSeconds, countMetric)
    const weekData = {}
    for (const { scientificName, count } of weeklyCounts) {
      weekData[scientificName] = count
      allSpeciesSet.add(scientificName)
    }
    weeklySpeciesCounts.set(week, weekData)
  }

  // Build timeseries array with all weeks
  const sortedWeeks = Array.from(weeklySpeciesCounts.keys()).sort()
  const timeseries = sortedWeeks.map((week) => ({
    date: week,
    ...weeklySpeciesCounts.get(week)
  }))

  // Build all species with total counts
  const totalSpeciesCounts = new Map()
  for (const weekData of weeklySpeciesCounts.values()) {
    for (const [species, count] of Object.entries(weekData)) {
      const current = totalSpeciesCounts.get(species) || 0
      totalSpeciesCounts.set(species, current + count)
    }
  }

  const allSpecies = Array.from(totalSpeciesCounts.entries())
    .map(([scientificName, count]) => ({ scientificName, count }))
    .sort((a, b) => b.count - a.count)

  return { timeseries, allSpecies }
}

/**
 * Pivot pre-aggregated `[{ scientificName, weekStart, count }]` rows (as
 * returned by getSequenceAwareTimeseriesSQL) into the `{ timeseries,
 * allSpecies }` shape the UI expects. Lets the SQL fast path bypass the
 * full calculateSequenceAwareTimeseries pipeline entirely.
 *
 * @param {Array<{scientificName: string, weekStart: string, count: number}>} rows
 * @returns {{ timeseries: Array, allSpecies: Array }}
 */
export function pivotPreAggregatedTimeseries(rows) {
  if (!rows || rows.length === 0) return { timeseries: [], allSpecies: [] }

  const byWeek = new Map()
  const totalBySpecies = new Map()
  for (const { scientificName, weekStart, count } of rows) {
    if (!weekStart) continue
    if (!byWeek.has(weekStart)) byWeek.set(weekStart, {})
    byWeek.get(weekStart)[scientificName] = count
    totalBySpecies.set(scientificName, (totalBySpecies.get(scientificName) || 0) + count)
  }

  const timeseries = Array.from(byWeek.keys())
    .sort()
    .map((week) => ({ date: week, ...byWeek.get(week) }))

  const allSpecies = Array.from(totalBySpecies.entries())
    .map(([scientificName, count]) => ({ scientificName, count }))
    .sort((a, b) => b.count - a.count)

  return { timeseries, allSpecies }
}

/**
 * Pivot pre-aggregated `[{ scientificName, hour, count }]` rows (as returned
 * by getSequenceAwareDailyActivitySQL) into the `[{ hour, [sp]: N, ... }]`
 * shape the radar expects. Zero-fills hours that the SQL didn't emit a row
 * for, so the chart has 24 entries regardless of sparse data.
 *
 * @param {Array<{scientificName: string, hour: number, count: number}>} rows
 * @param {Array<string>} selectedSpecies
 * @returns {Array<{hour: number, [species: string]: number}>}
 */
export function pivotPreAggregatedDailyActivity(rows, selectedSpecies) {
  const hourly = Array(24)
    .fill()
    .map((_, i) => ({
      hour: i,
      ...Object.fromEntries(selectedSpecies.map((s) => [s, 0]))
    }))
  if (!rows || rows.length === 0) return hourly
  for (const { scientificName, hour, count } of rows) {
    if (hour == null || hour < 0 || hour > 23) continue
    if (!selectedSpecies.includes(scientificName)) continue
    hourly[hour][scientificName] = count
  }
  return hourly
}

/**
 * Pivot pre-aggregated `[{ scientificName, latitude, longitude, locationName,
 * count }]` rows (as returned by getSequenceAwareHeatmapSQL) into the
 * `{ [scientificName]: [{ lat, lng, count, locationName }] }` shape the
 * heatmap consumer expects. Lets the SQL fast path skip the
 * calculateSequenceAwareHeatmap pipeline entirely.
 *
 * @param {Array<{scientificName: string, latitude: number, longitude: number, locationName: string, count: number}>} rows
 * @returns {Object<string, Array<{lat: number, lng: number, count: number, locationName: string}>>}
 */
export function pivotPreAggregatedHeatmap(rows) {
  if (!rows || rows.length === 0) return {}
  const out = {}
  for (const { scientificName, latitude, longitude, locationName, count } of rows) {
    if (latitude == null || longitude == null) continue
    if (!out[scientificName]) out[scientificName] = []
    out[scientificName].push({
      lat: parseFloat(latitude),
      lng: parseFloat(longitude),
      count,
      locationName
    })
  }
  return out
}

/**
 * Calculates sequence-aware species counts grouped by location for heatmap pie charts.
 *
 * @param {Array} observationsByMedia - Array of { scientificName, mediaID, timestamp, deploymentID, eventID, fileMediatype, latitude, longitude, locationName, count }
 * @param {number} gapSeconds - Gap threshold in seconds (0 = use eventID grouping)
 * @returns {Object} - Map of scientificName -> Array of { lat, lng, count, locationName }
 */
export function calculateSequenceAwareHeatmap(
  observationsByMedia,
  gapSeconds,
  countMetric = COUNT_METRIC_INDIVIDUALS
) {
  if (!observationsByMedia || observationsByMedia.length === 0) {
    return {}
  }

  // Group observations by location (lat, lng)
  const observationsByLocation = new Map()
  for (const obs of observationsByMedia) {
    if (obs.latitude == null || obs.longitude == null) continue
    const locationKey = `${obs.latitude},${obs.longitude}`
    if (!observationsByLocation.has(locationKey)) {
      observationsByLocation.set(locationKey, {
        lat: parseFloat(obs.latitude),
        lng: parseFloat(obs.longitude),
        locationName: obs.locationName,
        observations: []
      })
    }
    observationsByLocation.get(locationKey).observations.push(obs)
  }

  // Calculate sequence-aware counts for each location
  const speciesData = {}

  for (const [, locationInfo] of observationsByLocation) {
    const locationCounts = calculateSequenceAwareSpeciesCounts(
      locationInfo.observations,
      gapSeconds,
      countMetric
    )

    for (const { scientificName, count } of locationCounts) {
      if (!speciesData[scientificName]) {
        speciesData[scientificName] = []
      }
      speciesData[scientificName].push({
        lat: locationInfo.lat,
        lng: locationInfo.lng,
        count,
        locationName: locationInfo.locationName
      })
    }
  }

  return speciesData
}
