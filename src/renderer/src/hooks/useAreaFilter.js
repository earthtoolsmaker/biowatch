import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const storageKey = (studyId) => `areaFilter:${studyId}`

function readFromStorage(studyId) {
  try {
    const raw = localStorage.getItem(storageKey(studyId))
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed.north !== 'number' ||
      typeof parsed.south !== 'number' ||
      typeof parsed.east !== 'number' ||
      typeof parsed.west !== 'number'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * Per-study persistence for the Explore map's bounding-box area filter.
 * Mirrors {@link useDateRange}: backed by localStorage, broadcast through
 * the React Query cache so the value survives tab navigation.
 *
 * Returns `null` when no area filter is set (the "no filter" sentinel that
 * downstream queries treat as "include everything").
 *
 * @param {string} studyId
 * @returns {{ areaFilter: {north:number,south:number,east:number,west:number}|null, setAreaFilter: (next: object|null) => void }}
 */
export function useAreaFilter(studyId) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['areaFilter', studyId], [studyId])

  const { data } = useQuery({
    queryKey,
    queryFn: () => readFromStorage(studyId),
    enabled: !!studyId,
    staleTime: Infinity,
    initialData: () => readFromStorage(studyId)
  })

  const areaFilter = data ?? null

  const setAreaFilter = useCallback(
    (next) => {
      queryClient.setQueryData(queryKey, next)
      try {
        if (next === null) {
          localStorage.removeItem(storageKey(studyId))
        } else {
          localStorage.setItem(storageKey(studyId), JSON.stringify(next))
        }
      } catch {
        // ignore quota / disabled storage
      }
    },
    [queryClient, queryKey, studyId]
  )

  return { areaFilter, setAreaFilter }
}
