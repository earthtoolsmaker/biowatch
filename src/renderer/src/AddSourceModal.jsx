import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Lock, FolderOpen, X } from 'lucide-react'
import { useImportStatus } from './hooks/import'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Button } from './ui/button.jsx'
import { modelZoo } from '../../shared/mlmodels.js'
import { countries } from '../../shared/countries.js'
import StartingImportModal from './StartingImportModal.jsx'
import ModelSelect from './models/ModelSelect.jsx'
import { getModelInstallStatus } from './models/installStatus.js'

/**
 * One modal for adding a folder to an existing study.
 *
 * - When the study has a previous model run, the model is locked to that run
 *   (read-only). Country is pre-filled but stays editable.
 * - When there is no prior run, the model picker is enabled and the user
 *   chooses one. Country is asked when the chosen model uses geofencing
 *   (currently SpeciesNet only).
 *
 * Imports run via `window.api.addFolder(studyId, dir, modelRef, country)`.
 */
export default function AddSourceModal({ isOpen, studyId, onClose, onImported }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { importStatus } = useImportStatus(studyId)
  const [latestModel, setLatestModel] = useState(null) // {id, version} | null
  const [latestCountry, setLatestCountry] = useState(null) // string | null
  const [pickedModelKey, setPickedModelKey] = useState('') // 'speciesnet-4.0.1a'
  const [pickedCountry, setPickedCountry] = useState('')
  const [folder, setFolder] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [waitingForFirstBatch, setWaitingForFirstBatch] = useState(false)
  const [minDisplayElapsed, setMinDisplayElapsed] = useState(false)
  const doneAtStartRef = useRef(0)
  const [error, setError] = useState(null)
  const [installedModels, setInstalledModels] = useState([])
  const [installedEnvironments, setInstalledEnvironments] = useState([])

  // Fetch installed model/env lists once when the modal opens.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    Promise.all([
      window.api.listInstalledMLModels(),
      window.api.listInstalledMLModelEnvironments()
    ]).then(([models, envs]) => {
      if (cancelled) return
      setInstalledModels(models || [])
      setInstalledEnvironments(envs || [])
    })
    return () => {
      cancelled = true
    }
  }, [isOpen])

  const isModelCompletelyInstalled = (model) =>
    getModelInstallStatus(model, installedModels, installedEnvironments) === 'installed'

  // Fetch the study's latest model run when the modal opens.
  useEffect(() => {
    if (!isOpen || !studyId) return
    let cancelled = false
    window.api.getStudyLatestModelOptions(studyId).then((res) => {
      if (cancelled) return
      setLatestModel(res?.modelReference || null)
      setLatestCountry(res?.country || null)
      if (res?.modelReference) {
        setPickedModelKey(`${res.modelReference.id}-${res.modelReference.version}`)
      } else {
        setPickedModelKey('')
      }
      setPickedCountry(res?.country || '')
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, studyId])

  // Reset transient state every time the modal closes.
  useEffect(() => {
    if (!isOpen) {
      setFolder('')
      setError(null)
      setSubmitting(false)
      setWaitingForFirstBatch(false)
    }
  }, [isOpen])

  // ESC closes.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, submitting, onClose])

  // Minimum display time. Guarantees the user sees the transitional view
  // long enough to read the "what happens next" copy before any auto-close
  // can fire. Explicit dismiss (Continue in background / ESC / ✕ /
  // backdrop) still works immediately.
  useEffect(() => {
    if (!waitingForFirstBatch) {
      setMinDisplayElapsed(false)
      return
    }
    const id = setTimeout(() => setMinDisplayElapsed(true), 3000)
    return () => clearTimeout(id)
  }, [waitingForFirstBatch])

  // Auto-close once a new job completes. importStatus.done is study-wide
  // and may already be non-zero from prior runs, so we compare against
  // the snapshot captured when we entered the transitional state. Gated
  // on minDisplayElapsed so the modal is visible long enough to register.
  useEffect(() => {
    if (!waitingForFirstBatch || !minDisplayElapsed) return
    if ((importStatus?.done ?? 0) > doneAtStartRef.current) {
      onImported?.()
      onClose()
    }
  }, [waitingForFirstBatch, minDisplayElapsed, importStatus?.done, onImported, onClose])

  // Failsafe: if no job completes within 15s, dismiss the modal anyway.
  // The import is genuinely running by this point (addFolder resolved),
  // so trapping the user behind the spinner would be worse than closing.
  useEffect(() => {
    if (!waitingForFirstBatch) return
    const id = setTimeout(() => {
      onImported?.()
      onClose()
    }, 15000)
    return () => clearTimeout(id)
  }, [waitingForFirstBatch, onImported, onClose])

  const modelLocked = !!latestModel
  const pickedModel = useMemo(() => {
    if (!pickedModelKey) return null
    const [id, ...rest] = pickedModelKey.split('-')
    const version = rest.join('-')
    return modelZoo.find((m) => m.reference.id === id && m.reference.version === version) || null
  }, [pickedModelKey])

  const needsCountry = pickedModel?.reference?.id === 'speciesnet'
  const canImport =
    !!pickedModel &&
    !!folder &&
    (!needsCountry || !!pickedCountry) &&
    isModelCompletelyInstalled(pickedModel)

  const handleBrowse = async () => {
    const result = await window.api.selectImagesDirectoryOnly()
    if (result?.success && result.directoryPath) {
      setFolder(result.directoryPath)
    }
  }

  const handleImport = async () => {
    if (!canImport || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await window.api.addFolder(
        studyId,
        folder,
        pickedModel.reference,
        needsCountry ? pickedCountry : null
      )
      if (res?.success) {
        // Kick the import-status query so the global progress bar picks up the
        // new run on its next refetch. Setting isRunning=true here also
        // re-arms the polling interval (hooks/import.js refetches only while
        // isRunning is truthy).
        queryClient.setQueryData(['importStatus', studyId], (prev) => ({
          ...(prev || { total: 0, done: 0 }),
          isRunning: true
        }))
        queryClient.invalidateQueries({ queryKey: ['importStatus', studyId] })
        // Read from the cache, not the closure: `importStatus` here is
        // captured from the render before this handler was invoked, so it
        // misses any polls that landed during `await addFolder(...)`.
        doneAtStartRef.current = queryClient.getQueryData(['importStatus', studyId])?.done ?? 0
        setWaitingForFirstBatch(true)
        setSubmitting(false)
      } else {
        setError(res?.error || res?.message || 'Import failed')
        setSubmitting(false)
      }
    } catch (err) {
      setError(err.message || 'Import failed')
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  if (waitingForFirstBatch) {
    return (
      <StartingImportModal
        isOpen
        folderPath={folder}
        importStatus={importStatus}
        onDismiss={onClose}
      />
    )
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-card rounded-lg shadow-xl w-[480px] max-w-[92vw] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-medium text-foreground">Add images directory</h3>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-muted-foreground disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {/* Model */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Model</label>
            {modelLocked ? (
              <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 dark:border-border rounded-md bg-gray-50 dark:bg-muted text-sm text-gray-700 dark:text-foreground">
                <Lock size={12} className="text-muted-foreground" />
                <span>
                  {pickedModel
                    ? `${pickedModel.name} v${pickedModel.reference.version}`
                    : `${latestModel.id} v${latestModel.version}`}
                </span>
              </div>
            ) : (
              <ModelSelect
                value={
                  pickedModelKey
                    ? (() => {
                        const [id, ...rest] = pickedModelKey.split('-')
                        return { id, version: rest.join('-') }
                      })()
                    : null
                }
                onChange={(ref) => setPickedModelKey(`${ref.id}-${ref.version}`)}
                installedModels={installedModels}
                installedEnvironments={installedEnvironments}
                onBeforeNavigate={onClose}
                triggerClassName="w-full bg-card border-border"
              />
            )}
            {modelLocked && pickedModel && !isModelCompletelyInstalled(pickedModel) && (
              <div className="mt-1.5 flex items-center gap-2">
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  This model is no longer installed. Reinstall it to add a new directory.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onClose()
                    navigate('/settings/ml_zoo')
                  }}
                >
                  Open Models
                </Button>
              </div>
            )}
            {modelLocked && (!pickedModel || isModelCompletelyInstalled(pickedModel)) && (
              <p className="text-xs text-muted-foreground mt-1.5">
                Same model as the previous run for this study.
              </p>
            )}
          </div>

          {/* Country (only when model uses geofencing) */}
          {needsCountry && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Country <span className="text-muted-foreground font-normal">(geofencing)</span>
              </label>
              <Select value={pickedCountry} onValueChange={setPickedCountry}>
                <SelectTrigger className="w-full bg-card border-border">
                  <SelectValue placeholder="Select a country" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {countries.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {latestCountry && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Pre-filled from the previous run; change it for this folder if needed.
                </p>
              )}
            </div>
          )}

          {/* Folder */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Folder</label>
            <div className="flex gap-2">
              <div
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-border rounded-md bg-gray-50 dark:bg-muted text-xs font-mono text-gray-600 dark:text-muted-foreground truncate"
                style={folder ? { direction: 'rtl', textAlign: 'left' } : undefined}
                title={folder || ''}
              >
                {folder ? (
                  `‎${folder}`
                ) : (
                  <span className="text-muted-foreground font-sans">No folder selected</span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBrowse}
                disabled={submitting}
                className="gap-1.5"
              >
                <FolderOpen size={14} />
                {folder ? 'Change' : 'Browse'}
              </Button>
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-md px-3 py-2 dark:text-red-400 dark:bg-red-500/15">
              {error}
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-border bg-gray-50 dark:bg-muted">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleImport} disabled={!canImport || submitting}>
            {submitting ? 'Starting…' : 'Import'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
