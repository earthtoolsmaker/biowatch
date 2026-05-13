import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const storageKey = (studyId) => `showFilterCharts:${studyId}`

function readFromStorage(studyId) {
  try {
    const raw = localStorage.getItem(storageKey(studyId))
    return raw === null ? false : JSON.parse(raw)
  } catch {
    return false
  }
}

/**
 * Per-study toggle for the bottom-row filter charts (Clock + Timeline) shown
 * on the Media and Activity tabs. When false, the bottom row is hidden and
 * the main content (Gallery / Map) reclaims that vertical space.
 *
 * Same shape as {@link useShowThumbnailBboxes}: persisted to localStorage
 * under `showFilterCharts:${studyId}` and broadcast through the React Query
 * cache so the Media and Activity tabs stay in sync without prop drilling.
 *
 * @param {string} studyId
 * @returns {{ showFilterCharts: boolean, setShowFilterCharts: (next: boolean | ((prev: boolean) => boolean)) => void }}
 */
export function useShowFilterCharts(studyId) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['showFilterCharts', studyId], [studyId])

  const { data } = useQuery({
    queryKey,
    queryFn: () => readFromStorage(studyId),
    enabled: !!studyId,
    staleTime: Infinity,
    initialData: () => (studyId ? readFromStorage(studyId) : false)
  })

  const showFilterCharts = data ?? false

  const setShowFilterCharts = useCallback(
    (next) => {
      const prev = queryClient.getQueryData(queryKey) ?? false
      const value = typeof next === 'function' ? next(prev) : next
      queryClient.setQueryData(queryKey, value)
      try {
        localStorage.setItem(storageKey(studyId), JSON.stringify(value))
      } catch {
        // ignore quota / disabled storage — cache update is authoritative for this session
      }
    },
    [queryClient, queryKey, studyId]
  )

  return { showFilterCharts, setShowFilterCharts }
}
