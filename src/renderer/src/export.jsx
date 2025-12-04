import { useState } from 'react'
import { FolderTree, Package } from 'lucide-react'

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

export default function Export({ studyId, importerName }) {
  const [exportStatus, setExportStatus] = useState(null)

  const isLocalStudy = importerName?.startsWith('local/')

  const handleImageDirectoriesExport = async () => {
    setExportStatus(null)
    const result = await window.api.exportImageDirectories(studyId)

    if (result.cancelled) {
      return
    }

    if (result.success) {
      setExportStatus({
        type: 'success',
        message: `Successfully exported ${result.copiedCount} images to ${result.speciesCount} species directories in "${result.exportFolderName}"${result.errorCount > 0 ? ` (${result.errorCount} errors)` : ''}.`,
        exportPath: result.exportPath
      })
    } else {
      setExportStatus({
        type: 'error',
        message: result.error || 'Export failed'
      })
    }
  }

  const handleOpenExportFolder = () => {
    if (exportStatus?.exportPath) {
      window.electron.ipcRenderer.invoke('shell:open-path', exportStatus.exportPath)
    }
  }

  const handleCamtrapDPExport = async () => {
    setExportStatus(null)
    const result = await window.api.exportCamtrapDP(studyId)

    if (result.cancelled) {
      return
    }

    if (result.success) {
      setExportStatus({
        type: 'success',
        message: `Successfully exported Camtrap DP package to "${result.exportFolderName}" with ${result.deploymentsCount} deployments, ${result.mediaCount} media files, and ${result.observationsCount} observations.`,
        exportPath: result.exportPath
      })
    } else {
      setExportStatus({
        type: 'error',
        message: result.error || 'Camtrap DP export failed'
      })
    }
  }

  return (
    <div className="flex h-full p-8 overflow-auto">
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
          {/* Image Directories Export Card - Only for local studies */}
          {isLocalStudy && (
            <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-2">
                <FolderTree size={20} className="text-gray-700" />
                <h3 className="text-lg font-semibold">Image Directories</h3>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Export images organized into directories by species. Each species will have its own
                folder containing all identified images.
              </p>
              <div className="flex justify-start">
                <ExportButton onClick={handleImageDirectoriesExport} className="">
                  Export Image Directories
                </ExportButton>
              </div>
            </div>
          )}

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
    </div>
  )
}
