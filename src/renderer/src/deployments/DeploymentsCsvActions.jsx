import { Download, Upload } from 'lucide-react'
import { useCallback, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { toast } from 'sonner'
import DeploymentsImportPreviewModal from './DeploymentsImportPreviewModal'
import DeploymentsExportPreviewModal from './DeploymentsExportPreviewModal'
import DeploymentsImportPickerModal from './DeploymentsImportPickerModal'

/**
 * Tab-level Export / Import buttons rendered in the always-visible
 * Deployments header strip (above the conditional timeline header).
 * Owns the entire import flow state. Calls `onApplied` after a successful
 * apply so the parent can invalidate caches.
 */
export default function DeploymentsCsvActions({ studyId, onApplied }) {
  const [preview, setPreview] = useState(null)
  const [isParsing, setIsParsing] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [applyError, setApplyError] = useState(null)

  const [exportRows, setExportRows] = useState(null)
  const [isLoadingExport, setIsLoadingExport] = useState(false)
  const [isSavingExport, setIsSavingExport] = useState(false)

  const handleExportClick = useCallback(async () => {
    setIsLoadingExport(true)
    try {
      const response = await window.api.getDeploymentsCsvPreview(studyId)
      if (response.error) {
        toast.error(`Could not load preview: ${response.error}`)
        return
      }
      setExportRows(response.data)
    } finally {
      setIsLoadingExport(false)
    }
  }, [studyId])

  const handleExportSave = useCallback(async () => {
    setIsSavingExport(true)
    try {
      const result = await window.api.exportDeploymentsCsv(studyId)
      if (result?.cancelled) return
      if (result?.error) {
        toast.error(`Export failed: ${result.error}`)
        return
      }
      const noun = result.rowCount === 1 ? 'deployment' : 'deployments'
      toast.success(`Exported ${result.rowCount} ${noun} to ${result.filePath}`)
      setExportRows(null)
    } finally {
      setIsSavingExport(false)
    }
  }, [studyId])

  const handleExportCancel = useCallback(() => {
    setExportRows(null)
  }, [])

  const [isPickerOpen, setIsPickerOpen] = useState(false)

  const handleImportClick = useCallback(() => {
    setIsPickerOpen(true)
  }, [])

  const handlePickerCancel = useCallback(() => {
    setIsPickerOpen(false)
  }, [])

  const handleFilePicked = useCallback(
    async (filePath) => {
      setIsPickerOpen(false)
      setIsParsing(true)
      try {
        const response = await window.api.parseDeploymentsCsvForImport(studyId, filePath)
        if (response.error) {
          toast.error(response.error)
          return
        }
        setPreview(response.data)
        setApplyError(null)
      } finally {
        setIsParsing(false)
      }
    },
    [studyId]
  )

  const handleApply = useCallback(
    async (applyPlan) => {
      setIsApplying(true)
      setApplyError(null)
      try {
        const response = await window.api.applyDeploymentsCsvImport(studyId, applyPlan)
        if (response.error) {
          setApplyError(response.error)
          return
        }
        const { deploymentsUpdated, locationsNamed } = response.summary
        const depNoun = deploymentsUpdated === 1 ? 'deployment' : 'deployments'
        const nameNoun = locationsNamed === 1 ? 'location name' : 'location names'
        toast.success(
          `Updated ${deploymentsUpdated} ${depNoun}. ${locationsNamed} ${nameNoun} propagated.`
        )
        setPreview(null)
        if (onApplied) onApplied()
      } finally {
        setIsApplying(false)
      }
    },
    [studyId, onApplied]
  )

  const handleCancel = useCallback(() => {
    setPreview(null)
    setApplyError(null)
  }, [])

  const btnClass =
    'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'

  return (
    <>
      <div className="inline-flex items-center rounded border border-border overflow-hidden bg-card">
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              onClick={handleExportClick}
              className={btnClass}
              aria-label="Export deployments CSV"
              disabled={isLoadingExport}
            >
              <Download size={12} />
              Export CSV
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="bottom"
              sideOffset={8}
              className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
            >
              <div className="font-medium mb-1">Export CSV</div>
              <p className="text-muted-foreground leading-snug">
                Download every deployment — locations, dates, and cameras — as a spreadsheet you can
                edit or share.
              </p>
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <div className="w-px self-stretch bg-border" aria-hidden="true" />
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              onClick={handleImportClick}
              className={btnClass}
              aria-label="Import deployments CSV"
            >
              <Upload size={12} />
              Import CSV
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="bottom"
              sideOffset={8}
              className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
            >
              <div className="font-medium mb-1">Import CSV</div>
              <p className="text-muted-foreground leading-snug">
                Bulk-update deployments from an edited CSV. You&apos;ll preview every change before
                it&apos;s applied.
              </p>
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>

      {(isParsing || isLoadingExport) && (
        <div className="fixed inset-0 z-[1900] flex items-center justify-center bg-black/20 text-xs text-white">
          {isLoadingExport ? 'Loading preview…' : 'Parsing CSV…'}
        </div>
      )}

      {exportRows && (
        <DeploymentsExportPreviewModal
          rows={exportRows}
          onCancel={handleExportCancel}
          onSave={handleExportSave}
          isSaving={isSavingExport}
        />
      )}

      {isPickerOpen && (
        <DeploymentsImportPickerModal
          onCancel={handlePickerCancel}
          onFilePicked={handleFilePicked}
        />
      )}

      {preview && (
        <DeploymentsImportPreviewModal
          preview={preview}
          onCancel={handleCancel}
          onApply={handleApply}
          isApplying={isApplying}
          errorMessage={applyError}
        />
      )}
    </>
  )
}
