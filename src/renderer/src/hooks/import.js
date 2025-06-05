import { useState, useEffect } from 'react'

export function useImportStatus(id, interval = 1000) {
  const [importStatus, setImportStatus] = useState({ isRunning: false, pausedCount: 0, done: 0 })

  useEffect(() => {
    let intervalId

    const checkImportStatus = async () => {
      try {
        const status = await window.api.getImportStatus(id)
        setImportStatus((prev) => ({ ...prev, ...status }))
      } catch (err) {
        console.error('Failed to get import status:', err)
      }
    }

    if (!importStatus.isRunning) {
      // If import is not running, no need to check status
      clearInterval(intervalId)
      return
    }

    intervalId = setInterval(checkImportStatus, interval)

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [importStatus.isRunning, id, interval])

  useEffect(() => {
    const fetchImportStatus = async () => {
      const status = await window.api.getImportStatus(id)
      setImportStatus((prev) => ({ ...prev, ...status }))
    }

    fetchImportStatus()
  }, [id])

  function resumeImport() {
    setImportStatus((prev) => ({
      ...prev,
      isRunning: true,
      pausedCount: prev.done
    }))
    window.api.resumeImport(id)
  }

  function pauseImport() {
    setImportStatus((prev) => ({
      ...prev,
      isRunning: false
    }))
    window.api.stopImport(id)
  }

  return {
    importStatus,
    resumeImport,
    pauseImport
  }
}
