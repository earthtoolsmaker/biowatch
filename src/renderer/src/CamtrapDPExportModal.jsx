import { useState, useEffect } from 'react'
import { X, Layers, AlertTriangle } from 'lucide-react'

/**
 * Format sequence gap value for display
 */
function formatGapValue(seconds) {
  if (seconds === 0) return 'Off'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 120) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.round(seconds / 60)}m`
}

function CamtrapDPExportModal({ isOpen, onConfirm, onCancel, studyId }) {
  const [includeMedia, setIncludeMedia] = useState(true)
  const [species, setSpecies] = useState([])
  const [selectedSpecies, setSelectedSpecies] = useState(new Set())
  const [includeBlank, setIncludeBlank] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [nullTimestampCount, setNullTimestampCount] = useState(0)

  // Sequence gap state - initialized from localStorage
  const sequenceGapKey = `sequenceGap:${studyId}`
  const [sequenceGap, setSequenceGap] = useState(() => {
    const saved = localStorage.getItem(sequenceGapKey)
    return saved !== null ? Number(saved) : 120 // Default 2 minutes
  })

  // Fetch species list and null timestamp count when modal opens
  useEffect(() => {
    if (!isOpen || !studyId) return

    const fetchData = async () => {
      setLoading(true)
      setError(null)
      try {
        const [speciesResult, nullCountResult] = await Promise.all([
          window.api.getSpeciesDistribution(studyId),
          window.api.countMediaWithNullTimestamps(studyId)
        ])
        const speciesList = speciesResult.data || []
        setSpecies(speciesList)
        // Select all species by default
        setSelectedSpecies(new Set(speciesList.map((s) => s.scientificName)))
        setNullTimestampCount(nullCountResult.data || 0)
      } catch (err) {
        setError('Failed to load export data')
        console.error('Failed to fetch export data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
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
      includeMedia,
      selectedSpecies: Array.from(selectedSpecies),
      includeBlank,
      sequenceGap
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
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-start">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Export Camtrap DP</h2>
            <p className="text-sm text-gray-500 mt-1">
              Configure export options for your Camera Trap Data Package
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700 transition-colors"
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {loading ? (
            <div className="px-6 py-8 text-center text-gray-500">
              <div className="animate-pulse">Loading species...</div>
            </div>
          ) : error ? (
            <div className="px-6 py-8 text-center text-red-600">{error}</div>
          ) : species.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500">
              No species found in this study
            </div>
          ) : (
            <>
              <div className="px-6 py-3 border-b border-gray-100 flex gap-2">
                <button
                  onClick={handleSelectAll}
                  className="px-3 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition-colors"
                >
                  Select All
                </button>
                <button
                  onClick={handleDeselectAll}
                  className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  Deselect All
                </button>
                <span className="ml-auto text-xs text-gray-500 self-center">
                  {selectedSpecies.size} of {species.length} selected
                </span>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-2">
                <div className="space-y-1">
                  {species.map((s) => (
                    <label
                      key={s.scientificName}
                      className="flex items-center space-x-3 cursor-pointer hover:bg-gray-50 p-2 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSpecies.has(s.scientificName)}
                        onChange={() => handleSpeciesToggle(s.scientificName)}
                        className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <div className="flex-1 flex justify-between items-center">
                        <span className="text-sm text-gray-900">{s.scientificName}</span>
                        <span className="text-xs text-gray-500">{s.count} media</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="px-6 py-3 border-t border-gray-100">
            <label className="flex items-center space-x-3 cursor-pointer hover:bg-gray-50 p-2 rounded">
              <input
                type="checkbox"
                checked={includeBlank}
                onChange={(e) => setIncludeBlank(e.target.checked)}
                className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-900">
                  Include blank observations (no detections)
                </span>
                <p className="text-xs text-gray-500">
                  Export observations where no animals were detected
                </p>
              </div>
            </label>
          </div>

          {/* Sequence Gap Slider */}
          <div className="px-6 py-3 border-t border-gray-100">
            <div className="p-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Layers
                    size={16}
                    className={sequenceGap > 0 ? 'text-blue-500' : 'text-gray-400'}
                  />
                  <span className="text-sm font-medium text-gray-900">Sequence grouping</span>
                </div>
                <span className="text-sm font-medium text-blue-600">
                  {formatGapValue(sequenceGap)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="300"
                step="10"
                value={sequenceGap}
                onChange={(e) => setSequenceGap(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <p className="text-xs text-gray-500 mt-2">
                {sequenceGap === 0
                  ? 'Preserves imported event groupings (eventID from original data)'
                  : `Groups observations within ${formatGapValue(sequenceGap)} into sequences (generates new eventIDs)`}
              </p>
            </div>
          </div>

          <div className="px-6 py-3 border-t border-gray-100">
            <label className="flex items-start space-x-3 cursor-pointer hover:bg-gray-50 p-2 rounded">
              <input
                type="checkbox"
                checked={includeMedia}
                onChange={(e) => setIncludeMedia(e.target.checked)}
                className="w-4 h-4 mt-0.5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-900">Include media files</span>
                <p className="text-xs text-gray-500 mt-0.5">
                  Copy all images and videos to the export folder. This may take longer for large
                  datasets.
                </p>
              </div>
            </label>
          </div>

          {!loading && nullTimestampCount > 0 && (
            <div className="px-6 py-3 border-t border-gray-100">
              <div className="flex items-start gap-2 p-2 bg-amber-50 rounded border border-amber-200">
                <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  <span className="font-medium">{nullTimestampCount} media</span>{' '}
                  {nullTimestampCount === 1 ? 'file is' : 'files are'} missing timestamps and will
                  be excluded from export.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canExport}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
              canExport ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-300 cursor-not-allowed'
            }`}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  )
}

export default CamtrapDPExportModal
