import { X, Info, Upload, FileText } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

/**
 * Pre-import modal: lets the user pick a CSV via drag-and-drop or via
 * the system file browser, then hands the resolved path to the parent
 * (which routes it through `deployments:parse-csv-for-import` and shows
 * the preview modal).
 */
export default function DeploymentsImportPickerModal({ onCancel, onFilePicked }) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [dragError, setDragError] = useState(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const handleBrowse = useCallback(async () => {
    const pick = await window.api.pickDeploymentsCsvFile()
    if (pick?.cancelled) return
    if (pick?.error) {
      setDragError(pick.error)
      return
    }
    onFilePicked(pick.filePath)
  }, [onFilePicked])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
    setDragError(null)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length === 0) {
        setDragError('No file detected. Drop a .csv file.')
        return
      }
      if (files.length > 1) {
        setDragError('Drop only one CSV file at a time.')
        return
      }
      const file = files[0]
      if (!file.name.toLowerCase().endsWith('.csv')) {
        setDragError(`'${file.name}' is not a .csv file.`)
        return
      }

      // Electron 32+ removed File.path; resolve via preload's webUtils.
      const filePath = window.api.getDroppedFilePath(file)
      if (!filePath) {
        setDragError(`Could not resolve a file path for '${file.name}'.`)
        return
      }
      onFilePicked(filePath)
    },
    [onFilePicked]
  )

  const handleBackdropMouseDown = (e) => {
    if (e.target === e.currentTarget) onCancel()
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Import deployments CSV"
      onMouseDown={handleBackdropMouseDown}
    >
      <div className="bg-card border border-border rounded-lg shadow-2xl w-[90vw] max-w-[560px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Import deployments CSV</h2>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Explanation */}
        <div className="flex items-start gap-2 px-4 py-2 border-b border-border bg-blue-50/60 dark:bg-blue-500/5 text-xs">
          <Info size={14} className="flex-shrink-0 mt-0.5 text-blue-600 dark:text-blue-300" />
          <div className="text-foreground/80 leading-relaxed">
            Import a CSV with <span className="font-medium text-foreground">deploymentID</span> and
            at least one of{' '}
            <span className="font-medium text-foreground">latitude, longitude,</span> or{' '}
            <span className="font-medium text-foreground">locationName</span>. Existing rows are
            matched by <span className="font-medium text-foreground">deploymentID</span>; empty
            cells leave values unchanged.
          </div>
        </div>

        {/* Drop zone */}
        <div className="px-4 py-5">
          <button
            type="button"
            onClick={handleBrowse}
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`w-full flex flex-col items-center justify-center gap-2 py-10 px-4 rounded-md border-2 border-dashed transition-colors cursor-pointer ${
              isDragOver
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
                : 'border-border bg-muted/30 hover:bg-muted/50 text-muted-foreground'
            }`}
            aria-label="Drop a CSV file or click to browse"
          >
            {isDragOver ? (
              <>
                <FileText size={28} />
                <div className="text-sm font-medium">Drop to import</div>
              </>
            ) : (
              <>
                <Upload size={28} />
                <div className="text-sm">
                  <span className="font-medium text-foreground">Drop a CSV here</span> or click to
                  browse
                </div>
                <div className="text-[11px]">.csv files only</div>
              </>
            )}
          </button>

          {dragError && (
            <div className="mt-2 text-[11px] text-red-700 dark:text-red-300 text-center">
              {dragError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-3 border-t border-border">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
