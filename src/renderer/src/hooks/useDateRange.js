import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const storageKey = (studyId) => `dateRange:${studyId}`

function readFromStorage(studyId) {
  try {
    const raw = localStorage.getItem(storageKey(studyId))
    if (raw === null) return [null, null]
    const [s, e] = JSON.parse(raw)
    return [s ? new Date(s) : null, e ? new Date(e) : null]
  } catch {
    return [null, null]
  }
}

/**
 * Per-study persistence for the timeline brush's date filter. Same shape
 * as {@link useShowFilterCharts}: backed by localStorage, broadcast
 * through the React Query cache so the Media and Activity tabs share the
 * same range and the value survives navigating away and back to the tab.
 *
 * Returns `[null, null]` when no filter is set (the cleared / full-extent
 * sentinel that downstream queries treat as "include everything").
 *
 * @param {string} studyId
 * @returns {{ dateRange: [Date|null, Date|null], setDateRange: (next: [Date|null, Date|null] | ((prev: [Date|null, Date|null]) => [Date|null, Date|null])) => void }}
 */
export function useDateRange(studyId) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['dateRange', studyId], [studyId])

  const { data } = useQuery({
    queryKey,
    queryFn: () => readFromStorage(studyId),
    enabled: !!studyId,
    staleTime: Infinity,
    initialData: () => readFromStorage(studyId)
  })

  const dateRange = data ?? [null, null]

  const setDateRange = useCallback(
    (next) => {
      const prev = queryClient.getQueryData(queryKey) ?? [null, null]
      const value = typeof next === 'function' ? next(prev) : next
      queryClient.setQueryData(queryKey, value)
      try {
        localStorage.setItem(
          storageKey(studyId),
          JSON.stringify([value[0]?.toISOString() ?? null, value[1]?.toISOString() ?? null])
        )
      } catch {
        // ignore quota / disabled storage
      }
    },
    [queryClient, queryKey, studyId]
  )

  return { dateRange, setDateRange }
}
