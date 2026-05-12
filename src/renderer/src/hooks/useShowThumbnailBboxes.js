import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const storageKey = (studyId) => `showBboxes:${studyId}`

function readFromStorage(studyId) {
  try {
    const raw = localStorage.getItem(storageKey(studyId))
    return raw === null ? false : JSON.parse(raw)
  } catch {
    return false
  }
}

/**
 * Per-study "show bboxes on thumbnails" toggle.
 *
 * Backed by localStorage (UI-only preference) and broadcast via the React
 * Query cache so multiple consumers (Gallery, GalleryDisplayStrip) stay in
 * sync without prop drilling.
 *
 * @param {string} studyId
 * @returns {{ showThumbnailBboxes: boolean, setShowThumbnailBboxes: (next: boolean | ((prev: boolean) => boolean)) => void }}
 */
export function useShowThumbnailBboxes(studyId) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['showThumbnailBboxes', studyId], [studyId])

  const { data } = useQuery({
    queryKey,
    queryFn: () => readFromStorage(studyId),
    enabled: !!studyId,
    staleTime: Infinity,
    placeholderData: false
  })

  const showThumbnailBboxes = data ?? false

  const setShowThumbnailBboxes = useCallback(
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

  return { showThumbnailBboxes, setShowThumbnailBboxes }
}
