import { Download, Upload } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import DeploymentsImportPreviewModal from './DeploymentsImportPreviewModal'

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

  const handleExport = useCallback(async () => {
    const result = await window.api.exportDeploymentsCsv(studyId)
    if (result?.cancelled) return
    if (result?.error) {
      toast.error(`Export failed: ${result.error}`)
      return
    }
    const noun = result.rowCount === 1 ? 'deployment' : 'deployments'
    toast.success(`Exported ${result.rowCount} ${noun} to ${result.filePath}`)
  }, [studyId])

  const handleImport = useCallback(async () => {
    const pick = await window.api.pickDeploymentsCsvFile()
    if (pick?.cancelled) return
    if (pick?.error) {
      toast.error(`Could not open file: ${pick.error}`)
      return
    }

    setIsParsing(true)
    try {
      const response = await window.api.parseDeploymentsCsvForImport(studyId, pick.filePath)
      if (response.error) {
        toast.error(response.error)
        return
      }
      setPreview(response.data)
      setApplyError(null)
    } finally {
      setIsParsing(false)
    }
  }, [studyId])

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
    'inline-flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded'

  return (
    <>
      <button onClick={handleExport} title="Export deployments CSV" className={btnClass}>
        <Download size={12} />
        Export CSV
      </button>
      <button onClick={handleImport} title="Import deployments CSV" className={btnClass}>
        <Upload size={12} />
        Import CSV
      </button>

      {isParsing && (
        <div className="fixed inset-0 z-[1900] flex items-center justify-center bg-black/20 text-xs text-white">
          Parsing CSV…
        </div>
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
