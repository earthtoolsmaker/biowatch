/**
 * Utilities for calculating sequence-aware species counts.
 *
 * The idea is that when counting species observations, instead of counting every
 * individual observation, we want to count "independent events" (sequences).
 *
 * For each sequence:
 * - Take the MAX count of each species across all media in that sequence
 * - This represents the minimum number of individuals observed in that event
 *
 * Example:
 * - Sequence 1: Photo A (2 deer), Photo B (3 deer), Photo C (1 deer) -> max deer = 3
 * - Sequence 2: Photo D (5 deer), Photo E (2 deer) -> max deer = 5
 * - Total deer = 3 + 5 = 8 (instead of 13 if we counted each observation)
 */

import { groupMediaIntoSequences, groupMediaByEventID } from './grouping.js'

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
 * @returns {Array} - Array of { scientificName, count } sorted by count descending
 */
export function calculateSequenceAwareSpeciesCounts(observationsByMedia, gapSeconds) {
  if (!observationsByMedia || observationsByMedia.length === 0) {
    return []
  }

  // Create a map of mediaID -> media info for grouping
  const mediaMap = new Map()
  // Create a map of (mediaID, scientificName) -> count
  const mediaSpeciesCounts = new Map()

  for (const obs of observationsByMedia) {
    const key = `${obs.mediaID}:${obs.scientificName}`
    mediaSpeciesCounts.set(key, obs.count)

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

  // Calculate max count per species per sequence
  const speciesCounts = new Map()

  // Process regular sequences
  for (const sequence of sequences) {
    const sequenceMaxCounts = new Map()

    // Find max count for each species in this sequence
    for (const media of sequence.items) {
      const mediaObs = observationsByMediaID.get(media.mediaID) || []
      for (const { scientificName, count } of mediaObs) {
        const current = sequenceMaxCounts.get(scientificName) || 0
        sequenceMaxCounts.set(scientificName, Math.max(current, count))
      }
    }

    // Add sequence max counts to total
    for (const [species, maxCount] of sequenceMaxCounts) {
      const current = speciesCounts.get(species) || 0
      speciesCounts.set(species, current + maxCount)
    }
  }

  // Process null-timestamp media (each is treated as its own single-item "sequence")
  // Since we can't determine temporal relationships without timestamps, each media
  // is considered an independent observation event. For consistency with sequence
  // logic, we apply the same max-per-sequence approach (which for a single-item
  // sequence simply uses that item's count).
  for (const media of nullTimestampMedia) {
    const mediaObs = observationsByMediaID.get(media.mediaID) || []
    // Create a mini-sequence with just this media and compute max counts
    const singleMediaMaxCounts = new Map()
    for (const { scientificName, count } of mediaObs) {
      const current = singleMediaMaxCounts.get(scientificName) || 0
      singleMediaMaxCounts.set(scientificName, Math.max(current, count))
    }
    // Add this "sequence's" max counts to total
    for (const [species, maxCount] of singleMediaMaxCounts) {
      const current = speciesCounts.get(species) || 0
      speciesCounts.set(species, current + maxCount)
    }
  }

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
export function calculateSequenceAwareTimeseries(observationsByMedia, gapSeconds) {
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
    const weeklyCounts = calculateSequenceAwareSpeciesCounts(weekObs, gapSeconds)
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
 * Calculates sequence-aware species counts grouped by location for heatmap pie charts.
 *
 * @param {Array} observationsByMedia - Array of { scientificName, mediaID, timestamp, deploymentID, eventID, fileMediatype, latitude, longitude, locationName, count }
 * @param {number} gapSeconds - Gap threshold in seconds (0 = use eventID grouping)
 * @returns {Object} - Map of scientificName -> Array of { lat, lng, count, locationName }
 */
export function calculateSequenceAwareHeatmap(observationsByMedia, gapSeconds) {
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
      gapSeconds
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

/**
 * Calculates sequence-aware species counts grouped by hour for daily activity radar.
 *
 * @param {Array} observationsByMedia - Array of { scientificName, mediaID, timestamp, deploymentID, eventID, fileMediatype, hour, count }
 * @param {number} gapSeconds - Gap threshold in seconds (0 = use eventID grouping)
 * @param {Array<string>} selectedSpecies - List of species to include
 * @returns {Array} - Array of 24 objects { hour, [species1]: count, [species2]: count, ... }
 */
export function calculateSequenceAwareDailyActivity(
  observationsByMedia,
  gapSeconds,
  selectedSpecies
) {
  // Initialize hourly data with zeros for all selected species
  const hourlyData = Array(24)
    .fill()
    .map((_, i) => ({
      hour: i,
      ...Object.fromEntries(selectedSpecies.map((s) => [s, 0]))
    }))

  if (!observationsByMedia || observationsByMedia.length === 0) {
    return hourlyData
  }

  // Group observations by hour
  const observationsByHour = new Map()
  for (const obs of observationsByMedia) {
    const hour = obs.hour
    if (hour == null || hour < 0 || hour > 23) continue
    if (!observationsByHour.has(hour)) {
      observationsByHour.set(hour, [])
    }
    observationsByHour.get(hour).push(obs)
  }

  // Calculate sequence-aware counts for each hour
  for (const [hour, hourObs] of observationsByHour) {
    const hourlyCounts = calculateSequenceAwareSpeciesCounts(hourObs, gapSeconds)

    for (const { scientificName, count } of hourlyCounts) {
      if (hourlyData[hour] && selectedSpecies.includes(scientificName)) {
        hourlyData[hour][scientificName] = count
      }
    }
  }

  return hourlyData
}
