import { useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

const DEFAULT_SEQUENCE_GAP = 120

/**
 * Custom hook for managing sequence gap state with React Query caching.
 *
 * This hook uses IPC to persist sequenceGap in the SQLite database
 * and React Query's cache for instant synchronization across components.
 *
 * @param {string} studyId - The study ID
 * @returns {Object} - { sequenceGap: number, rawSequenceGap: number | null, setSequenceGap: (value: number) => void, isLoading: boolean }
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
    },
    onSuccess: (value) => {
      // Update cache immediately after successful mutation
      queryClient.setQueryData(queryKey, value)
    }
  })

  // setSequenceGap updates database AND React Query cache
  const setSequenceGap = useCallback(
    (value) => {
      // Optimistic update for instant UI feedback
      queryClient.setQueryData(queryKey, value)
      // Persist to database
      mutation.mutate(value)
    },
    [queryClient, queryKey, mutation]
  )

  return {
    // Return effective value (never null for consumers)
    sequenceGap: rawSequenceGap ?? DEFAULT_SEQUENCE_GAP,
    // Expose raw value for checking if default needs to be set
    rawSequenceGap,
    setSequenceGap,
    isLoading
  }
}

export { DEFAULT_SEQUENCE_GAP }
