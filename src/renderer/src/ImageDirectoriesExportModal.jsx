import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { resolveCommonName } from '../../shared/commonNames/index.js'
import { formatScientificName } from './utils/scientificName'

function ImageDirectoriesExportModal({ isOpen, onConfirm, onCancel, studyId }) {
  const [species, setSpecies] = useState([])
  const [selectedSpecies, setSelectedSpecies] = useState(new Set())
  const [includeBlank, setIncludeBlank] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Fetch species list when modal opens
  useEffect(() => {
    if (!isOpen || !studyId) return

    const fetchSpecies = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await window.api.getSpeciesDistribution(studyId)
        const speciesList = result.data || []
        setSpecies(speciesList)
        // Select all species by default
        setSelectedSpecies(new Set(speciesList.map((s) => s.scientificName)))
      } catch (err) {
        setError('Failed to load species list')
        console.error('Failed to fetch species:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchSpecies()
  }, [isOpen, studyId])

  // Handle Escape key
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
    onConfirm({
      selectedSpecies: Array.from(selectedSpecies),
      includeBlank
    })
  }

  const handleSpeciesToggle = (scientificName) => {
    setSelectedSpecies((prev) => {
      const next = new Set(prev)
      if (next.has(scientificName)) {
        next.delete(scientificName)
      } else {
        next.add(scientificName)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    setSelectedSpecies(new Set(species.map((s) => s.scientificName)))
  }

  const handleDeselectAll = () => {
    setSelectedSpecies(new Set())
  }

  const canExport = selectedSpecies.size > 0 || includeBlank

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-card rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex justify-between items-start">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Export Media Directories</h2>
            <p className="text-sm text-muted-foreground mt-1">Select species to export</p>
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {loading ? (
            <div className="px-6 py-8 text-center text-muted-foreground">
              <div className="animate-pulse">Loading species...</div>
            </div>
          ) : error ? (
            <div className="px-6 py-8 text-center text-red-600 dark:text-red-400">{error}</div>
          ) : species.length === 0 ? (
            <div className="px-6 py-8 text-center text-muted-foreground">
              No species found in this study
            </div>
          ) : (
            <>
              <div className="px-6 py-3 border-b border-border flex gap-2">
                <button
                  onClick={handleSelectAll}
                  className="px-3 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition-colors dark:text-blue-400 dark:bg-blue-500/15 dark:hover:bg-blue-500/25"
                >
                  Select All
                </button>
                <button
                  onClick={handleDeselectAll}
                  className="px-3 py-1 text-xs font-medium text-muted-foreground bg-muted hover:bg-accent rounded transition-colors"
                >
                  Deselect All
                </button>
                <span className="ml-auto text-xs text-muted-foreground self-center">
                  {selectedSpecies.size} of {species.length} selected
                </span>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-2">
                <div className="space-y-1">
                  {species.map((s) => {
                    // Match the picker / observation rail: prefer the
                    // dictionary's curated common name, fall back to the
                    // scientific name. Show the scientific in italics when it
                    // differs (so "yellow baboon (papio cynocephalus)").
                    const dictCommon = resolveCommonName(s.scientificName)
                    const showSci = dictCommon && dictCommon !== s.scientificName
                    const display = dictCommon || formatScientificName(s.scientificName)
                    return (
                      <label
                        key={s.scientificName}
                        className="flex items-center space-x-3 cursor-pointer hover:bg-accent p-2 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={selectedSpecies.has(s.scientificName)}
                          onChange={() => handleSpeciesToggle(s.scientificName)}
                          className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-border rounded dark:text-blue-400"
                        />
                        <div className="flex-1 flex justify-between items-center min-w-0">
                          <span
                            className={`text-sm text-foreground truncate ${showSci ? 'capitalize' : 'italic'}`}
                          >
                            {display}
                            {showSci && (
                              <span className="text-xs text-muted-foreground ml-2 italic normal-case">
                                ({formatScientificName(s.scientificName)})
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                            {s.count} media
                          </span>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          <div className="px-6 py-3 border-t border-border">
            <label className="flex items-center space-x-3 cursor-pointer hover:bg-accent p-2 rounded">
              <input
                type="checkbox"
                checked={includeBlank}
                onChange={(e) => setIncludeBlank(e.target.checked)}
                className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-border rounded dark:text-blue-400"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-foreground">
                  Include blank media (no detections)
                </span>
                <p className="text-xs text-muted-foreground">
                  Export media where no animals were detected
                </p>
              </div>
            </label>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-accent rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canExport}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
              canExport
                ? 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600'
                : 'bg-blue-300 dark:bg-blue-500/40 cursor-not-allowed'
            }`}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  )
}

export default ImageDirectoriesExportModal
