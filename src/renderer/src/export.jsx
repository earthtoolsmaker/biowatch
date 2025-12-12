import { useState, useEffect } from 'react'
import { FolderTree, Package } from 'lucide-react'
import CamtrapDPExportModal from './CamtrapDPExportModal'
import ImageDirectoriesExportModal from './ImageDirectoriesExportModal'
import ExportProgressModal from './ExportProgressModal'

function ExportButton({ onClick, children, className = '', disabled = false }) {
  const [isExporting, setIsExporting] = useState(false)

  const handleClick = async () => {
    setIsExporting(true)
    try {
      await onClick()
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={isExporting || disabled}
      className={`cursor-pointer transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-4 h-10 text-sm shadow-sm rounded-md hover:bg-gray-50 ${
        isExporting || disabled ? 'opacity-70' : ''
      } ${className}`}
    >
      {isExporting ? <span className="animate-pulse">Exporting...</span> : children}
    </button>
  )
}

export default function Export({ studyId }) {
  const [exportStatus, setExportStatus] = useState(null)
  const [showCamtrapDPModal, setShowCamtrapDPModal] = useState(false)
  const [showImageDirectoriesModal, setShowImageDirectoriesModal] = useState(false)
  const [showProgressModal, setShowProgressModal] = useState(false)
  const [exportProgress, setExportProgress] = useState(null)

  // Listen for export progress events
  useEffect(() => {
    const unsubscribe = window.api.onExportProgress((progress) => {
      setExportProgress(progress)
    })
    return () => unsubscribe()
  }, [])

  const handleImageDirectoriesExport = () => {
    setShowImageDirectoriesModal(true)
  }

  const handleImageDirectoriesConfirm = async (options) => {
    setShowImageDirectoriesModal(false)
    setExportStatus(null)
    setShowProgressModal(true)
    setExportProgress(null)

    const result = await window.api.exportImageDirectories(studyId, options)

    setShowProgressModal(false)
    setExportProgress(null)

    if (result.cancelled) {
      return
    }

    if (result.success) {
      let message = `Successfully exported ${result.copiedCount} media files to ${result.speciesCount} directories in "${result.exportFolderName}"`
      if (result.errorCount > 0) {
        message += ` (${result.errorCount} errors)`
      }
      message += '.'

      setExportStatus({
        type: 'success',
        message,
        exportPath: result.exportPath
      })
    } else {
      setExportStatus({
        type: 'error',
        message: result.error || 'Export failed'
      })
    }
  }

  const handleImageDirectoriesCancel = () => {
    setShowImageDirectoriesModal(false)
  }

  const handleOpenExportFolder = () => {
    if (exportStatus?.exportPath) {
      window.electron.ipcRenderer.invoke('shell:open-path', exportStatus.exportPath)
    }
  }

  const handleCamtrapDPExport = () => {
    setShowCamtrapDPModal(true)
  }

  const handleCamtrapDPConfirm = async (options) => {
    setShowCamtrapDPModal(false)
    setExportStatus(null)

    // Show progress modal only when including media (which triggers downloads)
    if (options.includeMedia) {
      setShowProgressModal(true)
      setExportProgress(null)
    }

    const result = await window.api.exportCamtrapDP(studyId, options)

    setShowProgressModal(false)
    setExportProgress(null)

    if (result.cancelled) {
      return
    }

    if (result.success) {
      let message = `Successfully exported Camtrap DP package to "${result.exportFolderName}" with ${result.deploymentsCount} deployments, ${result.mediaCount} media files, and ${result.observationsCount} observations.`

      if (options.includeMedia && result.copiedMediaCount !== undefined) {
        message += ` Copied ${result.copiedMediaCount} media files.`
        if (result.mediaErrorCount > 0) {
          message += ` (${result.mediaErrorCount} errors)`
        }
      }

      setExportStatus({
        type: 'success',
        message,
        exportPath: result.exportPath
      })
    } else {
      setExportStatus({
        type: 'error',
        message: result.error || 'Camtrap DP export failed'
      })
    }
  }

  const handleCamtrapDPCancel = () => {
    setShowCamtrapDPModal(false)
  }

  const handleCancelExport = async () => {
    await window.api.cancelExport()
    setShowProgressModal(false)
    setExportProgress(null)
  }

  return (
    <div className="flex h-full py-6 overflow-auto">
      <div className="max-w-4xl w-full">
        {/* Status Messages */}
        {exportStatus && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              exportStatus.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm">{exportStatus.message}</p>
              {exportStatus.type === 'success' && exportStatus.exportPath && (
                <button
                  onClick={handleOpenExportFolder}
                  className="cursor-pointer border border-green-400 ml-4 px-3 py-1 bg-green-100 hover:bg-green-200 text-green-800 rounded text-sm font-medium transition-colors"
                >
                  Open Folder
                </button>
              )}
            </div>
          </div>
        )}

        {/* Export Methods Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-8">
          {/* Image Directories Export Card */}
          <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-2">
              <FolderTree size={20} className="text-gray-700" />
              <h3 className="text-lg font-semibold">Media Directories</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Export media organized into directories by species. Each species will have its own
              folder containing all identified media.
            </p>
            <div className="flex justify-start">
              <ExportButton onClick={handleImageDirectoriesExport} className="">
                Export Media Directories
              </ExportButton>
            </div>
          </div>

          {/* Camtrap DP Export Card */}
          <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-2">
              <Package size={20} className="text-gray-700" />
              <h3 className="text-lg font-semibold">Camtrap DP</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Export as a Camera Trap Data Package, a standardized format compatible with GBIF and
              other biodiversity platforms.
            </p>
            <div className="flex justify-start">
              <ExportButton onClick={handleCamtrapDPExport} className="">
                Export Camtrap DP
              </ExportButton>
            </div>
          </div>
        </div>
      </div>

      <CamtrapDPExportModal
        isOpen={showCamtrapDPModal}
        onConfirm={handleCamtrapDPConfirm}
        onCancel={handleCamtrapDPCancel}
        studyId={studyId}
      />

      <ImageDirectoriesExportModal
        isOpen={showImageDirectoriesModal}
        onConfirm={handleImageDirectoriesConfirm}
        onCancel={handleImageDirectoriesCancel}
        studyId={studyId}
      />

      <ExportProgressModal
        isOpen={showProgressModal}
        onCancel={handleCancelExport}
        progress={exportProgress}
      />
    </div>
  )
}
