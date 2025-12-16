import { useState, useEffect } from 'react'
import { Trash2, ScanText, CheckCircle, AlertTriangle, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import DeleteStudyModal from './DeleteStudyModal'
import Export from './export'

function OCRActionRow({ studyId }) {
  const [isOCRRunning, setIsOCRRunning] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(null)
  const queryClient = useQueryClient()

  // Query for timestamp statistics (fixableCount, failedOCRCount, totalCount)
  const { data: timestampStats } = useQuery({
    queryKey: ['timestampStats', studyId],
    queryFn: () => window.api.ocr.getTimestampStats(studyId),
    enabled: !!studyId
  })
  const fixableCount = timestampStats?.fixableCount || 0
  const failedOCRCount = timestampStats?.failedOCRCount || 0
  const totalCount = timestampStats?.totalCount || 0

  // Check OCR status on mount (restore state when navigating back)
  useEffect(() => {
    const checkOCRStatus = async () => {
      const status = await window.api.ocr.getStatus(studyId)
      if (status.isRunning) {
        setIsOCRRunning(true)
        setOcrProgress(status.progress)
      }
    }
    checkOCRStatus()
  }, [studyId])

  // Listen for OCR progress updates
  useEffect(() => {
    const unsubscribe = window.api.ocr.onProgress((progress) => {
      setOcrProgress(progress)
      if (progress.stage === 'complete') {
        setIsOCRRunning(false)
        queryClient.invalidateQueries({ queryKey: ['timestampStats', studyId] })
        queryClient.invalidateQueries({ queryKey: ['media', studyId] })
      }
    })
    return () => unsubscribe()
  }, [studyId, queryClient])

  const handleStartOCR = async () => {
    setIsOCRRunning(true)
    setOcrProgress({ stage: 'initializing', current: 0, total: 0 })
    try {
      await window.api.ocr.extractTimestamps(studyId, [])
    } catch (err) {
      console.error('OCR failed:', err)
      setIsOCRRunning(false)
    }
  }

  const handleCancelOCR = async () => {
    await window.api.ocr.cancel()
    setIsOCRRunning(false)
    setOcrProgress(null)
  }

  const handleClose = () => {
    setIsOCRRunning(false)
    setOcrProgress(null)
  }

  const percent =
    ocrProgress?.total > 0 ? Math.round((ocrProgress.current / ocrProgress.total) * 100) : 0
  const isComplete = ocrProgress?.stage === 'complete'

  // Don't show the row if there are no issues and OCR is not running
  if (fixableCount === 0 && failedOCRCount === 0 && !isOCRRunning) {
    return null
  }

  return (
    <tr className="border-b border-gray-200 hover:bg-gray-50">
      <td className="p-4">
        <div className="flex items-center gap-3">
          <ScanText size={20} className="text-gray-600 flex-shrink-0" />
          <div className="font-medium text-sm">Fix Missing Timestamps</div>
        </div>
      </td>
      <td className="p-4 text-sm text-gray-700 max-w-md">
        Extract timestamps from images using OCR (Optical Character Recognition).
      </td>
      <td className="p-4 text-sm">
        {isComplete ? (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            Complete
          </span>
        ) : isOCRRunning ? (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            Processing
          </span>
        ) : fixableCount > 0 ? (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            {fixableCount} of {totalCount} image{totalCount !== 1 ? 's' : ''} to fix
          </span>
        ) : failedOCRCount > 0 ? (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            {failedOCRCount} image{failedOCRCount !== 1 ? 's' : ''} could not be fixed
          </span>
        ) : null}
      </td>
      <td className="p-4">
        {isOCRRunning ? (
          <div className="min-w-[240px]">
            {isComplete ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-green-600 text-sm">
                  <CheckCircle size={14} />
                  <span>Processed {ocrProgress.current} images</span>
                </div>
                <button
                  onClick={handleClose}
                  className="cursor-pointer transition-colors flex flex-row gap-2 items-center border border-gray-200 px-3 h-8 text-sm shadow-sm rounded-md hover:bg-gray-100"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all duration-500 ease-in-out animate-pulse"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <div className="text-xs text-center pt-1 text-gray-600">
                    {ocrProgress?.stage === 'initializing'
                      ? 'Initializing...'
                      : `${ocrProgress?.current || 0} / ${ocrProgress?.total || 0} (${percent}%)`}
                  </div>
                </div>
                <button
                  onClick={handleCancelOCR}
                  className="cursor-pointer transition-colors flex items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-100"
                  title="Cancel"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        ) : fixableCount > 0 ? (
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleStartOCR}
              className="cursor-pointer transition-colors flex flex-row gap-2 items-center border border-gray-200 px-3 h-8 text-sm shadow-sm rounded-md hover:bg-gray-100"
            >
              <ScanText size={14} />
              Fix Timestamps
            </button>
          </div>
        ) : failedOCRCount > 0 ? (
          <div className="flex gap-2 justify-end">
            <span className="text-sm text-gray-500 italic">No automatic fix available</span>
          </div>
        ) : null}
      </td>
    </tr>
  )
}

function StudyActionsTable({ studyId }) {
  const [isOCRRunning, setIsOCRRunning] = useState(false)

  // Query for timestamp statistics to determine if we should show the section
  const { data: timestampStats } = useQuery({
    queryKey: ['timestampStats', studyId],
    queryFn: () => window.api.ocr.getTimestampStats(studyId),
    enabled: !!studyId
  })
  const fixableCount = timestampStats?.fixableCount || 0
  const failedOCRCount = timestampStats?.failedOCRCount || 0

  // Check OCR status on mount
  useEffect(() => {
    const checkOCRStatus = async () => {
      const status = await window.api.ocr.getStatus(studyId)
      setIsOCRRunning(status.isRunning)
    }
    checkOCRStatus()
  }, [studyId])

  // Listen for OCR progress to update running state
  useEffect(() => {
    const unsubscribe = window.api.ocr.onProgress((progress) => {
      if (progress.stage === 'complete') {
        setIsOCRRunning(false)
      } else {
        setIsOCRRunning(true)
      }
    })
    return () => unsubscribe()
  }, [])

  // Don't render the section if there are no actions needed and OCR is not running
  if (fixableCount === 0 && failedOCRCount === 0 && !isOCRRunning) {
    return null
  }

  return (
    <div className="border border-yellow-300 rounded-lg mb-6 shadow-sm">
      <div className="px-4 py-3 bg-yellow-50 border-b border-yellow-300 rounded-t-lg flex items-center gap-2">
        <AlertTriangle size={18} className="text-yellow-600" />
        <h2 className="text-lg font-medium text-yellow-800">Study Actions</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 bg-white">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Action
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Description
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            <OCRActionRow studyId={studyId} />
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function StudySettings({ studyId, studyName }) {
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  const handleDeleteStudy = async () => {
    try {
      await window.api.deleteStudyDatabase(studyId)
      // The existing listener in base.jsx will handle navigation and query invalidation
      // after receiving the 'study:delete' event
    } catch (error) {
      console.error('Failed to delete study:', error)
    }
  }

  return (
    <div className="px-4">
      <StudyActionsTable studyId={studyId} />

      <div className="border border-blue-200 rounded-lg mb-6">
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-200 rounded-t-lg">
          <h2 className="text-lg font-medium text-blue-800">Export</h2>
        </div>
        <div className="p-4">
          <Export studyId={studyId} />
        </div>
      </div>

      <div className="border border-red-200 rounded-lg">
        <div className="px-4 py-3 bg-red-50 border-b border-red-200 rounded-t-lg">
          <h2 className="text-lg font-medium text-red-800">Danger Zone</h2>
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Delete this study</h3>
              <p className="text-sm text-gray-500 mt-1">
                Once deleted, all data associated with this study will be permanently removed.
              </p>
            </div>
            <button
              onClick={() => setIsDeleteModalOpen(true)}
              className="cursor-pointer flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-300 rounded-md hover:bg-red-50 transition-colors"
            >
              <Trash2 size={16} />
              Delete Study
            </button>
          </div>
        </div>
      </div>

      <DeleteStudyModal
        isOpen={isDeleteModalOpen}
        onConfirm={handleDeleteStudy}
        onCancel={() => setIsDeleteModalOpen(false)}
        studyName={studyName}
      />
    </div>
  )
}
