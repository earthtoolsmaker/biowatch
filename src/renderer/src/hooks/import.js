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
          console.log('Import completed, invalidating study, deployments, and bestMedia queries')
          queryClient.invalidateQueries({ queryKey: ['study'] })
          queryClient.invalidateQueries({ queryKey: ['deployments', id] })
          queryClient.invalidateQueries({ queryKey: ['bestMedia', id] })
        }
        wasRunningRef.current = status.isRunning

        return status
      } catch (err) {
        console.error('Failed to get import status:', err)
        throw err
      }
    },
    refetchInterval: (query) => {
      // Only poll if import is running
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
