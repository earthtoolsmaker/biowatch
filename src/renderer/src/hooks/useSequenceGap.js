import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const DEFAULT_SEQUENCE_GAP = 120

/**
 * Custom hook for managing sequence gap state with React Query caching.
 *
 * This hook replaces the localStorage polling pattern with React Query's
 * cache as the synchronization mechanism. When setSequenceGap is called,
 * it updates both localStorage (for persistence) and the React Query cache
 * (for instant synchronization across all components using this hook).
 *
 * @param {string} studyId - The study ID
 * @returns {Object} - { sequenceGap: number, setSequenceGap: (value: number) => void }
 */
export function useSequenceGap(studyId) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['sequenceGap', studyId], [studyId])

  // useQuery reads from localStorage (sync operation)
  const { data: sequenceGap } = useQuery({
    queryKey,
    queryFn: () => {
      const saved = localStorage.getItem(`sequenceGap:${studyId}`)
      return saved !== null ? Number(saved) : DEFAULT_SEQUENCE_GAP
    },
    staleTime: Infinity, // Don't refetch automatically
    enabled: !!studyId
  })

  // setSequenceGap updates both localStorage AND React Query cache
  const setSequenceGap = useCallback(
    (value) => {
      localStorage.setItem(`sequenceGap:${studyId}`, value.toString())
      queryClient.setQueryData(queryKey, value) // Instant cache update
    },
    [studyId, queryClient, queryKey]
  )

  return { sequenceGap: sequenceGap ?? DEFAULT_SEQUENCE_GAP, setSequenceGap }
}
