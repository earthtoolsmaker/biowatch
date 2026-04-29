import { useEffect, useMemo, useState } from 'react'
import { Lock, FolderOpen, X } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { modelZoo } from '../../shared/mlmodels.js'
import { countries } from '../../shared/countries.js'

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
  const [latestModel, setLatestModel] = useState(null) // {id, version} | null
  const [latestCountry, setLatestCountry] = useState(null) // string | null
  const [pickedModelKey, setPickedModelKey] = useState('') // 'speciesnet-4.0.1a'
  const [pickedCountry, setPickedCountry] = useState('')
  const [folder, setFolder] = useState('')
  const [submitting, setSubmitting] = useState(false)
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

  const isModelCompletelyInstalled = (model) => {
    const modelOk = installedModels.some(
      (m) => m.id === model.reference.id && m.version === model.reference.version
    )
    const envOk = installedEnvironments.some(
      (e) => e.id === model.pythonEnvironment.id && e.version === model.pythonEnvironment.version
    )
    return modelOk && envOk
  }

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

  const modelLocked = !!latestModel
  const pickedModel = useMemo(() => {
    if (!pickedModelKey) return null
    const [id, ...rest] = pickedModelKey.split('-')
    const version = rest.join('-')
    return modelZoo.find((m) => m.reference.id === id && m.reference.version === version) || null
  }, [pickedModelKey])

  const needsCountry = pickedModel?.reference?.id === 'speciesnet'
  const canImport = !!pickedModel && !!folder && (!needsCountry || !!pickedCountry)

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
        onImported?.()
        onClose()
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

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-[480px] max-w-[92vw] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-base font-medium text-gray-900">Add images directory</h3>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {/* Model */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Model</label>
            {modelLocked ? (
              <div className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-sm text-gray-700">
                <span className="flex items-center gap-2">
                  <Lock size={12} className="text-gray-400" />
                  {pickedModel
                    ? `${pickedModel.name} v${pickedModel.reference.version}`
                    : `${latestModel.id} v${latestModel.version}`}
                </span>
                <span className="text-xs text-gray-400">locked</span>
              </div>
            ) : (
              <Select
                value={pickedModelKey}
                onValueChange={(value) => {
                  const [id, ...rest] = value.split('-')
                  const version = rest.join('-')
                  const model = modelZoo.find(
                    (m) => m.reference.id === id && m.reference.version === version
                  )
                  if (model && isModelCompletelyInstalled(model)) {
                    setPickedModelKey(value)
                  }
                }}
              >
                <SelectTrigger className="w-full bg-white border-gray-200">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {modelZoo.map((m) => {
                    const installed = isModelCompletelyInstalled(m)
                    const modelOk = installedModels.some(
                      (im) => im.id === m.reference.id && im.version === m.reference.version
                    )
                    let suffix = ''
                    if (!modelOk) suffix = ' (not installed)'
                    else if (!installed) suffix = ' (environment missing)'
                    return (
                      <SelectItem
                        key={`${m.reference.id}-${m.reference.version}`}
                        value={`${m.reference.id}-${m.reference.version}`}
                        disabled={!installed}
                        className={!installed ? 'opacity-50 cursor-not-allowed' : ''}
                      >
                        {m.name} v{m.reference.version}
                        {suffix}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            )}
            {modelLocked && (
              <p className="text-xs text-gray-400 mt-1.5">
                Same model as the previous run for this study.
              </p>
            )}
          </div>

          {/* Country (only when model uses geofencing) */}
          {needsCountry && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Country <span className="text-gray-400 font-normal">(geofencing)</span>
              </label>
              <Select value={pickedCountry} onValueChange={setPickedCountry}>
                <SelectTrigger className="w-full bg-white border-gray-200">
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
                <p className="text-xs text-gray-400 mt-1.5">
                  Pre-filled from the previous run; change it for this folder if needed.
                </p>
              )}
            </div>
          )}

          {/* Folder */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Folder</label>
            <div className="flex gap-2">
              <div
                className="flex-1 px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-xs font-mono text-gray-600 truncate"
                style={folder ? { direction: 'rtl', textAlign: 'left' } : undefined}
                title={folder || ''}
              >
                {folder ? (
                  `‎${folder}`
                ) : (
                  <span className="text-gray-400 font-sans">No folder selected</span>
                )}
              </div>
              <button
                onClick={handleBrowse}
                disabled={submitting}
                className="px-3 py-2 border border-gray-200 rounded-md bg-white text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
              >
                <FolderOpen size={14} />
                {folder ? 'Change' : 'Browse'}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-1.5 border border-gray-200 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport || submitting}
            className={`px-4 py-1.5 rounded-md text-sm font-medium text-white ${
              canImport && !submitting
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-blue-300 cursor-not-allowed'
            }`}
          >
            {submitting ? 'Starting…' : 'Import'}
          </button>
        </footer>
      </div>
    </div>
  )
}
