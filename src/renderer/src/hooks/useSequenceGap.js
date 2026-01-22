import { useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Custom hook for managing sequence gap state with React Query caching.
 *
 * This hook uses IPC to persist sequenceGap in the SQLite database
 * and React Query's cache for instant synchronization across components.
 *
 * Sequence gap semantics:
 * - null = use eventID-based grouping (Off) - used by CamtrapDP datasets
 * - number > 0 = use timestamp-based grouping with that gap in seconds
 *
 * @param {string} studyId - The study ID
 * @returns {Object} - { sequenceGap: number | null, setSequenceGap: (value: number | null) => void, isLoading: boolean }
 */
export function useSequenceGap(studyId) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['sequenceGap', studyId], [studyId])

  // useQuery fetches from database via IPC
  const { data: rawSequenceGap, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await window.api.getSequenceGap(studyId)
      // Return null if no value saved (allows consumer to set default)
      return response.data
    },
    staleTime: Infinity, // Don't refetch automatically
    enabled: !!studyId
  })

  // Mutation to persist to database
  const mutation = useMutation({
    mutationFn: async (value) => {
      const response = await window.api.setSequenceGap(studyId, value)
      if (response.error) {
        throw new Error(response.error)
      }
      return value
    }
  })

  // setSequenceGap updates database AND React Query cache
  const setSequenceGap = useCallback(
    (value) => {
      // Save previous value for rollback on error
      const previousValue = queryClient.getQueryData(queryKey)
      // Optimistic update for instant UI feedback
      queryClient.setQueryData(queryKey, value)
      // Persist to database with rollback on error
      mutation.mutate(value, {
        onError: () => {
          // Rollback to previous value if mutation fails
          queryClient.setQueryData(queryKey, previousValue)
        }
      })
    },
    [queryClient, queryKey, mutation]
  )

  return {
    // null = eventID-based grouping (Off), number > 0 = timestamp-based grouping
    sequenceGap: rawSequenceGap,
    setSequenceGap,
    isLoading
  }
}
