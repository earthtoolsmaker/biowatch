import { useState, useEffect } from 'react'
import { FolderTree, Package } from 'lucide-react'
import CamtrapDPExportModal from './CamtrapDPExportModal'
import ImageDirectoriesExportModal from './ImageDirectoriesExportModal'
import ExportProgressModal from './ExportProgressModal'

function ExportRow({ icon: Icon, title, description, onClick, isFirst, isLast }) {
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
    <div
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3 ${
        isFirst ? 'pt-0' : ''
      } ${isLast ? 'pb-0' : ''}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-gray-500 shrink-0" />
          <span className="text-sm font-medium text-gray-900">{title}</span>
        </div>
        <p className="text-sm text-gray-500 mt-1">{description}</p>
      </div>
      <button
        onClick={handleClick}
        disabled={isExporting}
        className={`cursor-pointer transition-colors flex justify-center items-center gap-2 border border-gray-200 px-4 h-9 text-sm shadow-sm rounded-md hover:bg-gray-50 w-full sm:w-auto ${
          isExporting ? 'opacity-70' : ''
        }`}
      >
        {isExporting ? <span className="animate-pulse">Exporting...</span> : 'Export'}
      </button>
    </div>
  )
}

export default function Export({ studyId }) {
  const [exportStatus, setExportStatus] = useState(null)
  const [showCamtrapDPModal, setShowCamtrapDPModal] = useState(false)
  const [showImageDirectoriesModal, setShowImageDirectoriesModal] = useState(false)
  const [showProgressModal, setShowProgressModal] = useState(false)
  const [exportProgress, setExportProgress] = useState(null)

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
    <>
      {exportStatus && (
        <div
          className={`mb-4 p-3 rounded-md text-sm ${
            exportStatus.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <p>{exportStatus.message}</p>
            {exportStatus.type === 'success' && exportStatus.exportPath && (
              <button
                onClick={handleOpenExportFolder}
                className="cursor-pointer border border-green-400 px-3 py-1 bg-green-100 hover:bg-green-200 text-green-800 rounded text-xs font-medium transition-colors whitespace-nowrap"
              >
                Open Folder
              </button>
            )}
          </div>
        </div>
      )}

      <div className="divide-y divide-gray-100">
        <ExportRow
          icon={FolderTree}
          title="Media Directories"
          description="Media organized into folders by species."
          onClick={handleImageDirectoriesExport}
          isFirst
        />
        <ExportRow
          icon={Package}
          title="Camtrap DP"
          description="Camera Trap Data Package — GBIF compatible."
          onClick={handleCamtrapDPExport}
          isLast
        />
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
    </>
  )
}
