import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  defaultTimeFilter,
  emptyHourSelection,
  switchTimeMode
} from '../../../shared/timeFilter.js'
import { chipsToRanges, DAY_PERIOD_ORDER } from '../utils/dayPeriods.js'

export function readTimeFilter(studyId, storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(`timeFilter:${studyId}`))
    const selection = value?.selection
    const validSelection =
      selection?.kind === 'chips'
        ? Array.isArray(selection.keys) &&
          new Set(selection.keys).size === selection.keys.length &&
          selection.keys.every((key) => DAY_PERIOD_ORDER.includes(key))
        : selection?.kind === 'ranges' &&
          Array.isArray(selection.ranges) &&
          selection.ranges.every(
            (range) =>
              range &&
              [range.start, range.end].every((h) => Number.isFinite(h) && h >= 0 && h <= 24)
          )
    if (['clock', 'solar'].includes(value?.mode) && validSelection) return value
  } catch {
    /* Disabled storage or invalid saved value. */
  }
  return defaultTimeFilter()
}

/** Shared, atomically persisted mode + hour selection for Explore and Media. */
export function useTimeFilter(studyId) {
  const client = useQueryClient()
  const queryKey = useMemo(() => ['timeFilter', studyId], [studyId])
  const { data: state } = useQuery({
    queryKey,
    queryFn: () => readTimeFilter(studyId),
    initialData: () => readTimeFilter(studyId),
    staleTime: Infinity
  })
  const update = useCallback(
    (fn) => {
      const next = fn(client.getQueryData(queryKey) ?? defaultTimeFilter())
      client.setQueryData(queryKey, next)
      try {
        localStorage.setItem(`timeFilter:${studyId}`, JSON.stringify(next))
      } catch {
        /* Disabled storage. */
      }
    },
    [client, queryKey, studyId]
  )
  const timeRange = useMemo(
    () => ({
      mode: state.mode,
      ranges:
        state.selection.kind === 'ranges'
          ? state.selection.ranges
          : state.selection.keys.length === DAY_PERIOD_ORDER.length
            ? []
            : chipsToRanges(new Set(state.selection.keys), state.mode)
    }),
    [state]
  )
  const setMode = useCallback((mode) => update((prev) => switchTimeMode(prev, mode)), [update])
  const setSelection = useCallback(
    (selection) => update((prev) => ({ ...prev, selection })),
    [update]
  )
  const setTimeRange = useCallback(
    (range) =>
      update((prev) => {
        if (range.mode && range.mode !== prev.mode) return switchTimeMode(prev, range.mode)
        return {
          ...prev,
          selection: range.ranges.length
            ? { kind: 'ranges', ranges: range.ranges }
            : emptyHourSelection()
        }
      }),
    [update]
  )
  return {
    mode: state.mode,
    selection: state.selection,
    timeRange,
    setMode,
    setSelection,
    setTimeRange
  }
}
