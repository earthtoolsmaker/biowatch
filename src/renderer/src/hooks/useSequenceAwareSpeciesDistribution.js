/**
 * Custom hook for fetching and computing sequence-aware species distribution.
 *
 * This hook:
 * 1. Fetches raw species distribution data by media from the backend
 * 2. Computes sequence-aware counts using the sequenceAwareSpeciesCount utility
 * 3. Recalculates when gapSeconds changes (no backend refetch needed)
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  calculateSequenceAwareSpeciesCounts,
  calculateSequenceAwareTimeseries,
  calculateSequenceAwareHeatmap,
  calculateSequenceAwareDailyActivity
} from '../utils/sequenceAwareSpeciesCount'

/**
 * Hook for fetching sequence-aware species distribution.
 *
 * @param {string} studyId - The study ID
 * @param {number} gapSeconds - Gap threshold in seconds (0 = use eventID grouping)
 * @param {Object} options - Additional options
 * @param {boolean} options.enabled - Whether the query is enabled (default: true)
 * @param {number|false} options.refetchInterval - Refetch interval in ms (default: false)
 * @returns {Object} - { data: Array, rawData: Array, isLoading: boolean, error: Error|null }
 */
export function useSequenceAwareSpeciesDistribution(studyId, gapSeconds, options = {}) {
  const { enabled = true, refetchInterval = false } = options

  // Fetch raw data from backend (only refetch when studyId changes or during import)
  const {
    data: rawData,
    isLoading,
    error
  } = useQuery({
    queryKey: ['speciesDistributionByMedia', studyId],
    queryFn: async () => {
      const response = await window.api.getSpeciesDistributionByMedia(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: enabled && !!studyId,
    refetchInterval
  })

  // Compute sequence-aware counts whenever rawData or gapSeconds changes
  const data = useMemo(() => {
    if (!rawData) return null
    return calculateSequenceAwareSpeciesCounts(rawData, gapSeconds)
  }, [rawData, gapSeconds])

  return {
    data,
    rawData,
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

  const {
    data: rawData,
    isLoading,
    error
  } = useQuery({
    queryKey: ['speciesTimeseriesByMedia', studyId, speciesNames],
    queryFn: async () => {
      const response = await window.api.getSpeciesTimeseriesByMedia(studyId, speciesNames)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: enabled && !!studyId && speciesNames.length > 0
  })

  const { timeseries, allSpecies } = useMemo(() => {
    if (!rawData) return { timeseries: [], allSpecies: [] }
    return calculateSequenceAwareTimeseries(rawData, gapSeconds)
  }, [rawData, gapSeconds])

  return {
    timeseries,
    allSpecies,
    rawData,
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

  const {
    data: rawData,
    isLoading,
    error
  } = useQuery({
    queryKey: [
      'speciesHeatmapByMedia',
      studyId,
      speciesNames,
      startDate,
      endDate,
      startHour,
      endHour,
      includeNullTimestamps
    ],
    queryFn: async () => {
      const response = await window.api.getSpeciesHeatmapDataByMedia(
        studyId,
        speciesNames,
        startDate,
        endDate,
        startHour,
        endHour,
        includeNullTimestamps
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: enabled && !!studyId && speciesNames.length > 0 && !!startDate && !!endDate,
    placeholderData: (previousData) => previousData
  })

  const data = useMemo(() => {
    if (!rawData) return null
    return calculateSequenceAwareHeatmap(rawData, gapSeconds)
  }, [rawData, gapSeconds])

  return {
    data,
    rawData,
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

  const {
    data: rawData,
    isLoading,
    error
  } = useQuery({
    queryKey: ['speciesDailyActivityByMedia', studyId, speciesNames, startDate, endDate],
    queryFn: async () => {
      const response = await window.api.getSpeciesDailyActivityByMedia(
        studyId,
        speciesNames,
        startDate,
        endDate
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: enabled && !!studyId && speciesNames.length > 0 && !!startDate && !!endDate
  })

  const data = useMemo(() => {
    if (!rawData) return null
    return calculateSequenceAwareDailyActivity(rawData, gapSeconds, speciesNames)
  }, [rawData, gapSeconds, speciesNames])

  return {
    data,
    rawData,
    isLoading,
    error: error ? new Error(error.message || 'Failed to fetch daily activity') : null
  }
}
