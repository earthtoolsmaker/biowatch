import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export function useImportStatus(id, interval = 1000) {
  const queryClient = useQueryClient()
  const [pausedCount, setPausedCount] = useState(0)
  const wasRunningRef = useRef(false)
  const { data: importStatus = { isRunning: false, done: 0 } } = useQuery({
    queryKey: ['importStatus', id],
    queryFn: async () => {
      try {
        const status = await window.api.getImportStatus(id)

        // Detect transition from running to completed and invalidate study query
        if (
          wasRunningRef.current &&
          !status.isRunning &&
          status.done > 0 &&
          status.done === status.total
        ) {
          console.log(
            'Import completed, invalidating study, deployments, and count/distribution queries'
          )
          queryClient.invalidateQueries({ queryKey: ['study'] })
          queryClient.invalidateQueries({ queryKey: ['deploymentLocations', id] })
          queryClient.invalidateQueries({ queryKey: ['deploymentsAll', id] })
          queryClient.invalidateQueries({ queryKey: ['bestMedia', id] })
          // Counts and distributions are now cached with staleTime: Infinity,
          // so we must explicitly invalidate them when import adds new data.
          queryClient.invalidateQueries({ queryKey: ['sequenceAwareSpeciesDistribution', id] })
          queryClient.invalidateQueries({ queryKey: ['sequenceAwareTimeseries', id] })
          queryClient.invalidateQueries({ queryKey: ['sequenceAwareDailyActivity', id] })
          queryClient.invalidateQueries({ queryKey: ['sequenceAwareHeatmap', id] })
          queryClient.invalidateQueries({ queryKey: ['blankMediaCount', id] })
          queryClient.invalidateQueries({ queryKey: ['distinctSpecies', id] })
          queryClient.invalidateQueries({ queryKey: ['sequences', id] })
        }
        wasRunningRef.current = status.isRunning

        return status
      } catch (err) {
        console.error('Failed to get import status:', err)
        throw err
      }
    },
    refetchInterval: (query) => {
      // Only poll while an import is running. Callers that kick off a new
      // import (e.g. AddSourceModal.handleImport) are responsible for
      // invalidating ['importStatus', studyId] so the next fetch picks up
      // the running state.
      return query?.state?.data?.isRunning ? interval : false
    },
    refetchIntervalInBackground: false,
    enabled: !!id
  })

  function resumeImport() {
    setPausedCount(importStatus.done)
    window.api.resumeImport(id)
    queryClient.invalidateQueries(['importStatus'])
  }

  function pauseImport() {
    queryClient.setQueryData(['importStatus', id], (prev) => ({
      ...prev,
      isRunning: false
    }))
    window.api.stopImport(id)
    // queryClient.invalidateQueries(['importStatus'])
  }

  console.log('Import status:', importStatus)

  return {
    importStatus: { ...importStatus, pausedCount },
    resumeImport,
    pauseImport
  }
}
