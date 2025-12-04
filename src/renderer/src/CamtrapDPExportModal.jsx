import { useState, useEffect } from 'react'

function CamtrapDPExportModal({ isOpen, onConfirm, onCancel }) {
  const [includeMedia, setIncludeMedia] = useState(true)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onCancel])

  const handleConfirm = () => {
    onConfirm({ includeMedia })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Export Camtrap DP</h2>
          <p className="text-sm text-gray-500 mt-1">
            Configure export options for your Camera Trap Data Package
          </p>
        </div>

        <div className="px-6 py-4">
          <label className="flex items-start space-x-3 cursor-pointer hover:bg-gray-50 p-2 rounded">
            <input
              type="checkbox"
              checked={includeMedia}
              onChange={(e) => setIncludeMedia(e.target.checked)}
              className="w-4 h-4 mt-0.5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-900">Include media files</span>
              <p className="text-xs text-gray-500 mt-0.5">
                Copy all images and videos to the export folder. This may take longer for large
                datasets.
              </p>
            </div>
          </label>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  )
}

export default CamtrapDPExportModal
