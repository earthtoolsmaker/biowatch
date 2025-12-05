import { useState, useEffect, useRef } from 'react'
import { Download, Copy, AlertCircle, Clock } from 'lucide-react'

/**
 * Format seconds into a human-readable time string
 */
function formatTimeRemaining(seconds) {
  if (seconds === null || seconds === undefined || seconds < 0) return null

  if (seconds < 60) {
    return `${seconds}s`
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  } else {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }
}

function ExportProgressModal({ isOpen, onCancel, progress }) {
  const [isCancelling, setIsCancelling] = useState(false)
  const [throttledTimeRemaining, setThrottledTimeRemaining] = useState(null)
  const latestTimeRef = useRef(null)

  // Reset cancelling state when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsCancelling(false)
    }
  }, [isOpen])

  // Store latest time estimate in ref (no re-render)
  useEffect(() => {
    latestTimeRef.current = progress?.estimatedTimeRemaining ?? null
  }, [progress?.estimatedTimeRemaining])

  // Update displayed time estimate once per second from ref
  useEffect(() => {
    setThrottledTimeRemaining(latestTimeRef.current)

    const interval = setInterval(() => {
      setThrottledTimeRemaining(latestTimeRef.current)
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const handleCancel = async () => {
    setIsCancelling(true)
    await onCancel()
  }

  if (!isOpen) return null

  const {
    currentFile = 0,
    totalFiles = 0,
    fileName = '',
    speciesName = null,
    isDownloading = false,
    downloadPercent = 0,
    errorCount = 0,
    overallPercent: serverOverallPercent = null
  } = progress || {}

  // Use server-provided overall percent if available (more accurate with parallel downloads)
  // Otherwise fall back to local calculation
  const localOverallPercent = totalFiles > 0 ? Math.round((currentFile / totalFiles) * 100) : 0
  const displayPercent = serverOverallPercent !== null ? serverOverallPercent : localOverallPercent

  const timeRemainingStr = formatTimeRemaining(throttledTimeRemaining)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Exporting Images</h2>
          <p className="text-sm text-gray-500 mt-1">
            {isCancelling ? 'Cancelling export...' : 'Please wait while images are being exported'}
          </p>
        </div>

        <div className="px-6 py-6">
          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>
                {isDownloading ? (
                  <span className="flex items-center gap-1">
                    <Download size={14} className="animate-pulse" />
                    Downloading
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Copy size={14} />
                    Copying
                  </span>
                )}
              </span>
              <span>{displayPercent}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all duration-300 animate-pulse"
                style={{ width: `${displayPercent}%` }}
              />
            </div>
          </div>

          {/* Time estimate */}
          {timeRemainingStr && (
            <div className="flex items-center justify-center gap-1.5 text-sm text-gray-500 mb-4">
              <Clock size={14} />
              <span>~{timeRemainingStr} remaining</span>
            </div>
          )}

          {/* File counter */}
          <div className="text-center mb-4">
            <p className="text-2xl font-semibold text-gray-900">
              {currentFile} <span className="text-gray-400">of</span> {totalFiles}
            </p>
            <p className="text-sm text-gray-500">images processed</p>
          </div>

          {/* Current file name */}
          {fileName && (
            <div className="bg-gray-50 rounded-lg p-3 mb-4 overflow-hidden">
              <p className="text-xs text-gray-500 mb-1">Current file:</p>
              {speciesName && (
                <p className="text-sm text-gray-900 font-medium italic mb-1">{speciesName}</p>
              )}
              <p className="text-sm text-gray-700 truncate font-mono">{fileName}</p>
              {isDownloading && downloadPercent > 0 && (
                <div className="mt-2">
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-blue-600 h-1.5 rounded-full transition-all duration-150"
                      style={{ width: `${downloadPercent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error count */}
          {errorCount > 0 && (
            <div className="flex items-center gap-2 text-amber-600 bg-amber-50 rounded-lg p-3">
              <AlertCircle size={16} />
              <span className="text-sm">
                {errorCount} {errorCount === 1 ? 'file' : 'files'} failed to export
              </span>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200">
          <button
            onClick={handleCancel}
            disabled={isCancelling}
            className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCancelling ? 'Cancelling...' : 'Cancel Export'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ExportProgressModal
