import { useState, useEffect } from 'react'
import { ScanText, CheckCircle } from 'lucide-react'

function OCRProgressModal({ isOpen, onCancel, progress }) {
  const [isCancelling, setIsCancelling] = useState(false)

  // Reset cancelling state when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsCancelling(false)
    }
  }, [isOpen])

  const handleCancel = async () => {
    setIsCancelling(true)
    await onCancel()
  }

  if (!isOpen) return null

  const {
    stage = 'initializing',
    current = 0,
    total = 0,
    currentFileName = '',
    extractedTimestamp = null
  } = progress || {}

  const percent = total > 0 ? Math.round((current / total) * 100) : 0
  const isComplete = stage === 'complete'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isComplete ? 'OCR Complete' : 'Extracting Timestamps'}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {isCancelling
              ? 'Cancelling OCR...'
              : isComplete
                ? 'Timestamp extraction finished'
                : 'Using OCR to extract timestamps from images'}
          </p>
        </div>

        <div className="px-6 py-6">
          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span className="flex items-center gap-1">
                <ScanText size={14} className={isComplete ? '' : 'animate-pulse'} />
                {stage === 'initializing' ? 'Initializing...' : 'Processing'}
              </span>
              <span>{percent}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className={`h-3 rounded-full transition-all duration-300 ${
                  isComplete ? 'bg-green-600' : 'bg-blue-600 animate-pulse'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {/* File counter */}
          <div className="text-center mb-4">
            <p className="text-2xl font-semibold text-gray-900">
              {current} <span className="text-gray-400">of</span> {total}
            </p>
            <p className="text-sm text-gray-500">images processed</p>
          </div>

          {/* Current file name */}
          {currentFileName && !isComplete && (
            <div className="bg-gray-50 rounded-lg p-3 mb-4 overflow-hidden">
              <p className="text-xs text-gray-500 mb-1">Current file:</p>
              <p className="text-sm text-gray-700 truncate font-mono">{currentFileName}</p>
              {extractedTimestamp && (
                <div className="mt-2 flex items-center gap-1 text-green-600">
                  <CheckCircle size={14} />
                  <span className="text-sm">{extractedTimestamp}</span>
                </div>
              )}
            </div>
          )}

          {/* Completion message */}
          {isComplete && (
            <div className="flex items-center gap-2 text-green-600 bg-green-50 rounded-lg p-3">
              <CheckCircle size={16} />
              <span className="text-sm">Successfully processed {current} images</span>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200">
          {isComplete ? (
            <button
              onClick={onCancel}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Close
            </button>
          ) : (
            <button
              onClick={handleCancel}
              disabled={isCancelling}
              className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCancelling ? 'Cancelling...' : 'Cancel'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default OCRProgressModal
