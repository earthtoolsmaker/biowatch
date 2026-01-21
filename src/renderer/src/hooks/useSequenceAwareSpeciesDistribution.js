/**
 * Custom hooks for fetching sequence-aware species data.
 *
 * These hooks fetch pre-computed sequence-aware data from the main thread,
 * where all sequence grouping and counting is performed. This avoids
 * transferring raw media-level data to the renderer and keeps computation
 * off the UI thread.
 */

import { useQuery } from '@tanstack/react-query'

/**
 * Hook for fetching sequence-aware species distribution.
 *
 * @param {string} studyId - The study ID
 * @param {number} gapSeconds - Gap threshold in seconds (0 = use eventID grouping)
 * @param {Object} options - Additional options
 * @param {boolean} options.enabled - Whether the query is enabled (default: true)
 * @param {number|false} options.refetchInterval - Refetch interval in ms (default: false)
 * @returns {Object} - { data: Array, isLoading: boolean, error: Error|null }
 */
export function useSequenceAwareSpeciesDistribution(studyId, gapSeconds, options = {}) {
  const { enabled = true, refetchInterval = false } = options

  const { data, isLoading, error } = useQuery({
    queryKey: ['sequenceAwareSpeciesDistribution', studyId, gapSeconds],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareSpeciesDistribution(studyId, gapSeconds)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: enabled && !!studyId,
    refetchInterval,
    placeholderData: (previousData) => previousData
  })

  return {
    data: data ?? null,
    isLoading,
    error: error ? new Error(error.message || 'Failed to fetch species distribution') : null
  }
}

/**
 * Hook for fetching sequence-aware species timeseries.
 *
 * @param {string} studyId - The study ID
 * @param {Array<string>} speciesNames - List of species scientific names to include
 * @param {number} gapSeconds - Gap threshold in seconds (0 = use eventID grouping)
 * @param {Object} options - Additional options
 * @returns {Object} - { timeseries: Array, allSpecies: Array, isLoading: boolean, error: Error|null }
 */
export function useSequenceAwareTimeseries(studyId, speciesNames, gapSeconds, options = {}) {
  const { enabled = true } = options

  const { data, isLoading, error } = useQuery({
    queryKey: ['sequenceAwareTimeseries', studyId, [...speciesNames].sort(), gapSeconds],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareTimeseries(
        studyId,
        speciesNames,
        gapSeconds
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: enabled && !!studyId && speciesNames.length > 0,
    placeholderData: (previousData) => previousData
  })

  return {
    timeseries: data?.timeseries ?? [],
    allSpecies: data?.allSpecies ?? [],
    isLoading,
    error: error ? new Error(error.message || 'Failed to fetch timeseries') : null
  }
}

/**
 * Hook for fetching sequence-aware species heatmap data.
 *
 * @param {string} studyId - The study ID
 * @param {Array<string>} speciesNames - List of species scientific names
 * @param {string} startDate - ISO date string for range start
 * @param {string} endDate - ISO date string for range end
 * @param {number} startHour - Starting hour of day (0-24)
 * @param {number} endHour - Ending hour of day (0-24)
 * @param {boolean} includeNullTimestamps - Whether to include null timestamps
 * @param {number} gapSeconds - Gap threshold in seconds
 * @param {Object} options - Additional options
 * @returns {Object} - { data: Object, isLoading: boolean, error: Error|null }
 */
export function useSequenceAwareHeatmap(
  studyId,
  speciesNames,
  startDate,
  endDate,
  startHour,
  endHour,
  includeNullTimestamps,
  gapSeconds,
  options = {}
) {
  const { enabled = true } = options

  const { data, isLoading, error } = useQuery({
    queryKey: [
      'sequenceAwareHeatmap',
      studyId,
      [...speciesNames].sort(),
      startDate,
      endDate,
      startHour,
      endHour,
      includeNullTimestamps,
      gapSeconds
    ],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareHeatmap(
        studyId,
        speciesNames,
        startDate,
        endDate,
        startHour,
        endHour,
        includeNullTimestamps,
        gapSeconds
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled:
      enabled &&
      !!studyId &&
      speciesNames.length > 0 &&
      (includeNullTimestamps || (!!startDate && !!endDate)),
    placeholderData: (previousData) => previousData
  })

  return {
    data: data ?? null,
    isLoading,
    error: error ? new Error(error.message || 'Failed to fetch heatmap data') : null
  }
}

/**
 * Hook for fetching sequence-aware species daily activity.
 *
 * @param {string} studyId - The study ID
 * @param {Array<string>} speciesNames - List of species scientific names
 * @param {string} startDate - ISO date string for range start
 * @param {string} endDate - ISO date string for range end
 * @param {number} gapSeconds - Gap threshold in seconds
 * @param {Object} options - Additional options
 * @returns {Object} - { data: Array, isLoading: boolean, error: Error|null }
 */
export function useSequenceAwareDailyActivity(
  studyId,
  speciesNames,
  startDate,
  endDate,
  gapSeconds,
  options = {}
) {
  const { enabled = true } = options

  const { data, isLoading, error } = useQuery({
    queryKey: [
      'sequenceAwareDailyActivity',
      studyId,
      [...speciesNames].sort(),
      startDate,
      endDate,
      gapSeconds
    ],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareDailyActivity(
        studyId,
        speciesNames,
        startDate,
        endDate,
        gapSeconds
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: enabled && !!studyId && speciesNames.length > 0 && !!startDate && !!endDate,
    placeholderData: (previousData) => previousData
  })

  return {
    data: data ?? null,
    isLoading,
    error: error ? new Error(error.message || 'Failed to fetch daily activity') : null
  }
}
