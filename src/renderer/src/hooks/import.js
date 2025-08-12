import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export function useImportStatus(id, interval = 1000) {
  const queryClient = useQueryClient()
  const [pausedCount, setPausedCount] = useState(0)
  const { data: importStatus = { isRunning: false, done: 0 } } = useQuery({
    queryKey: ['importStatus', id],
    queryFn: async () => {
      try {
        const status = await window.api.getImportStatus(id)
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
    queryClient.setQueryData(['importStatus'], (prev) => ({
      ...prev,
      isRunning: false
    }))
    window.api.stopImport(id)
    queryClient.invalidateQueries(['importStatus'])
  }

  console.log('Import status:', importStatus)

  return {
    importStatus: { ...importStatus, pausedCount },
    resumeImport,
    pauseImport
  }
}
