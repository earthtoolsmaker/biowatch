import { CameraOff, X, Square, Calendar, Pencil, Check, Search, Ban } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useParams } from 'react-router'
import CircularTimeFilter, { DailyActivityRadar } from './ui/clock'
import SpeciesDistribution from './ui/speciesDistribution'
import TimelineChart from './ui/timeseries'
import DateTimePicker from './ui/DateTimePicker'

/**
 * Observation list panel - always visible list of all detections
 */
function ObservationListPanel({ bboxes, selectedId, onSelect }) {
  if (!bboxes || bboxes.length === 0) return null

  return (
    <div className="border-t border-gray-200 bg-gray-50 max-h-32 overflow-y-auto flex-shrink-0">
      <div className="px-4 py-1.5 text-xs font-medium text-gray-500 sticky top-0 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <span>
          {bboxes.length} detection{bboxes.length !== 1 ? 's' : ''}
        </span>
        <span className="text-gray-400">Click to edit</span>
      </div>
      {bboxes.map((bbox) => (
        <button
          key={bbox.observationID}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(bbox.observationID === selectedId ? null : bbox.observationID)
          }}
          className={`w-full px-4 py-2 flex items-center justify-between hover:bg-gray-100 transition-colors ${
            selectedId === bbox.observationID ? 'bg-lime-100' : ''
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                bbox.classificationMethod === 'human' ? 'bg-green-500' : 'bg-lime-500'
              }`}
            />
            <span className="text-sm font-medium truncate max-w-[200px]">
              {bbox.scientificName || 'Blank'}
            </span>
            {bbox.classificationMethod === 'human' && (
              <span className="text-xs text-green-600">✓</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {bbox.confidence && (
              <span className="text-xs text-gray-400">{Math.round(bbox.confidence * 100)}%</span>
            )}
            <Pencil size={14} className="text-gray-400" />
          </div>
        </button>
      ))}
    </div>
  )
}

/**
 * Species selection dropdown for editing observation classifications
 */
function SpeciesSelector({ bbox, studyId, onClose, onUpdate }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [customSpecies, setCustomSpecies] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const inputRef = useRef(null)
  const customInputRef = useRef(null)

  // Fetch distinct species for the dropdown
  const { data: speciesList = [] } = useQuery({
    queryKey: ['distinctSpecies', studyId],
    queryFn: async () => {
      const response = await window.api.getDistinctSpecies(studyId)
      return response.data || []
    },
    staleTime: 30000 // Cache for 30 seconds
  })

  // Focus input on mount
  useEffect(() => {
    if (showCustomInput && customInputRef.current) {
      customInputRef.current.focus()
    } else if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [showCustomInput])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Filter species by search term
  const filteredSpecies = useMemo(() => {
    if (!searchTerm) return speciesList
    const term = searchTerm.toLowerCase()
    return speciesList.filter(
      (s) =>
        s.scientificName?.toLowerCase().includes(term) || s.commonName?.toLowerCase().includes(term)
    )
  }, [speciesList, searchTerm])

  const handleSelectSpecies = (scientificName, commonName = null) => {
    onUpdate({
      observationID: bbox.observationID,
      scientificName,
      commonName,
      observationType: 'animal'
    })
    onClose()
  }

  const handleMarkAsBlank = () => {
    onUpdate({
      observationID: bbox.observationID,
      scientificName: '',
      commonName: null,
      observationType: 'blank'
    })
    onClose()
  }

  const handleCustomSubmit = (e) => {
    e.preventDefault()
    if (customSpecies.trim()) {
      handleSelectSpecies(customSpecies.trim())
    }
  }

  return (
    <div
      className="absolute z-20 bg-white rounded-lg shadow-xl border border-gray-200 w-72 max-h-80 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Search/Custom input header */}
      <div className="p-2 border-b border-gray-100">
        {showCustomInput ? (
          <form onSubmit={handleCustomSubmit} className="flex gap-2">
            <input
              ref={customInputRef}
              type="text"
              value={customSpecies}
              onChange={(e) => setCustomSpecies(e.target.value)}
              placeholder="Enter species name..."
              className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={!customSpecies.trim()}
              className="px-2 py-1.5 bg-lime-500 text-white rounded hover:bg-lime-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              onClick={() => setShowCustomInput(false)}
              className="px-2 py-1.5 bg-gray-200 text-gray-600 rounded hover:bg-gray-300"
            >
              <X size={16} />
            </button>
          </form>
        ) : (
          <div className="relative">
            <Search size={16} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search species..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent"
            />
          </div>
        )}
      </div>

      {/* Species list */}
      <div className="max-h-52 overflow-y-auto">
        {/* Mark as Blank option */}
        <button
          onClick={handleMarkAsBlank}
          className="w-full px-3 py-2 text-left hover:bg-red-50 flex items-center gap-2 text-red-600 border-b border-gray-100"
        >
          <Ban size={16} />
          <span className="text-sm font-medium">Mark as Blank (False Positive)</span>
        </button>

        {/* Add Custom option */}
        {!showCustomInput && (
          <button
            onClick={() => setShowCustomInput(true)}
            className="w-full px-3 py-2 text-left hover:bg-blue-50 flex items-center gap-2 text-blue-600 border-b border-gray-100"
          >
            <span className="text-sm">+ Add custom species</span>
          </button>
        )}

        {/* Filtered species list */}
        {filteredSpecies.map((species) => (
          <button
            key={species.scientificName}
            onClick={() => handleSelectSpecies(species.scientificName, species.commonName)}
            className={`w-full px-3 py-2 text-left hover:bg-lime-50 flex items-center justify-between ${
              species.scientificName === bbox.scientificName ? 'bg-lime-100' : ''
            }`}
          >
            <div>
              <span className="text-sm font-medium">{species.scientificName}</span>
              {species.commonName && (
                <span className="text-xs text-gray-500 ml-2">({species.commonName})</span>
              )}
            </div>
            <span className="text-xs text-gray-400">{species.observationCount}</span>
          </button>
        ))}

        {filteredSpecies.length === 0 && searchTerm && (
          <div className="px-3 py-4 text-sm text-gray-500 text-center">
            No species found. Click &quot;Add custom species&quot; to add a new one.
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Clickable bbox label showing species name with smart positioning
 * - Labels near top edge are positioned below the bbox
 * - Labels near right edge are right-aligned
 */
function BboxLabel({ bbox, isSelected, onClick, isHuman }) {
  const displayName = bbox.scientificName || 'Blank'
  const confidence = bbox.confidence ? `${Math.round(bbox.confidence * 100)}%` : null

  // Smart positioning to avoid labels going outside visible area
  const isNearTop = bbox.bboxY < 0.08
  const isNearRight = bbox.bboxX + bbox.bboxWidth > 0.85

  // Calculate position and transform based on bbox location
  const leftPos = isNearRight ? `${(bbox.bboxX + bbox.bboxWidth) * 100}%` : `${bbox.bboxX * 100}%`
  const topPos = isNearTop ? `${(bbox.bboxY + bbox.bboxHeight) * 100}%` : `${bbox.bboxY * 100}%`
  const transformVal = isNearTop
    ? 'translateY(4px)'
    : isNearRight
      ? 'translate(-100%, -100%)'
      : 'translateY(-100%)'

  const style = {
    left: leftPos,
    top: topPos,
    transform: transformVal,
    maxWidth: '150px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`absolute px-2 py-0.5 rounded text-xs font-medium transition-all cursor-pointer hover:scale-105 ${
        isSelected
          ? 'bg-lime-500 text-white ring-2 ring-lime-300'
          : isHuman
            ? 'bg-green-500 text-white hover:bg-green-600'
            : 'bg-lime-500/90 text-white hover:bg-lime-600'
      }`}
      style={style}
      title={`${displayName}${confidence ? ` (${confidence})` : ''} - Click to edit`}
    >
      {displayName}
      {confidence && !isHuman && <span className="ml-1 opacity-75">{confidence}</span>}
      {isHuman && <span className="ml-1">✓</span>}
    </button>
  )
}

function ImageModal({
  isOpen,
  onClose,
  media,
  constructImageUrl,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
  studyId,
  onTimestampUpdate
}) {
  const [showBboxes, setShowBboxes] = useState(true)
  const [isEditingTimestamp, setIsEditingTimestamp] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [inlineTimestamp, setInlineTimestamp] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState(null)
  const [selectedBboxId, setSelectedBboxId] = useState(null)
  const queryClient = useQueryClient()

  // Initialize inline timestamp when media changes
  useEffect(() => {
    if (media?.timestamp) {
      setInlineTimestamp(new Date(media.timestamp).toLocaleString())
    }
    // Reset editing state when media changes
    setIsEditingTimestamp(false)
    setShowDatePicker(false)
    setError(null)
  }, [media?.mediaID, media?.timestamp])

  const { data: bboxes = [] } = useQuery({
    queryKey: ['mediaBboxes', studyId, media?.mediaID],
    queryFn: async () => {
      const response = await window.api.getMediaBboxes(studyId, media.mediaID)
      if (response.data) {
        return response.data
      }
      return []
    },
    enabled: isOpen && !!media?.mediaID && !!studyId
  })

  // Handle timestamp save
  const handleTimestampSave = async (newTimestamp) => {
    if (!media || !studyId) return

    setIsSaving(true)
    setError(null)

    // Store old timestamp for rollback
    const oldTimestamp = media.timestamp

    // Optimistic update
    if (onTimestampUpdate) {
      onTimestampUpdate(media.mediaID, newTimestamp)
    }

    try {
      const result = await window.api.setMediaTimestamp(studyId, media.mediaID, newTimestamp)

      if (result.error) {
        throw new Error(result.error)
      }

      // Update successful - use the formatted timestamp returned from backend
      const savedTimestamp = result.newTimestamp || newTimestamp

      // Update with the actual saved timestamp (preserves original format)
      if (onTimestampUpdate) {
        onTimestampUpdate(media.mediaID, savedTimestamp)
      }

      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['media'] })
      queryClient.invalidateQueries({ queryKey: ['mediaBboxes', studyId, media.mediaID] })

      setShowDatePicker(false)
      setIsEditingTimestamp(false)
      setInlineTimestamp(new Date(savedTimestamp).toLocaleString())
    } catch (err) {
      // Rollback on error
      if (onTimestampUpdate) {
        onTimestampUpdate(media.mediaID, oldTimestamp)
      }
      setError(err.message || 'Failed to update timestamp')
      console.error('Error updating timestamp:', err)
    } finally {
      setIsSaving(false)
    }
  }

  // Handle inline edit
  const handleInlineEdit = () => {
    setIsEditingTimestamp(true)
    setError(null)
  }

  const handleInlineSave = () => {
    try {
      // Trim whitespace
      const trimmedInput = inlineTimestamp.trim()
      if (!trimmedInput) {
        setError('Please enter a date and time')
        return
      }

      const parsedDate = new Date(trimmedInput)
      if (isNaN(parsedDate.getTime())) {
        setError('Invalid date format. Try: "12/25/2024, 2:30:00 PM" or "2024-12-25T14:30:00"')
        return
      }

      // Validate year is within reasonable bounds
      const year = parsedDate.getFullYear()
      if (year < 1970 || year > 2100) {
        setError('Year must be between 1970 and 2100')
        return
      }

      handleTimestampSave(parsedDate.toISOString())
    } catch {
      setError('Invalid date format. Try: "12/25/2024, 2:30:00 PM"')
    }
  }

  const handleInlineCancel = () => {
    setIsEditingTimestamp(false)
    if (media?.timestamp) {
      setInlineTimestamp(new Date(media.timestamp).toLocaleString())
    }
    setError(null)
  }

  // Handle inline keyboard events
  const handleInlineKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleInlineSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      handleInlineCancel()
    }
  }

  // Mutation for updating observation classification
  const updateMutation = useMutation({
    mutationFn: async ({ observationID, scientificName, commonName, observationType }) => {
      const response = await window.api.updateObservationClassification(studyId, observationID, {
        scientificName,
        commonName,
        observationType
      })
      if (response.error) {
        throw new Error(response.error)
      }
      return response.data
    },
    onSuccess: () => {
      // Invalidate related queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['mediaBboxes', studyId, media?.mediaID] })
      queryClient.invalidateQueries({ queryKey: ['speciesDistribution'] })
      queryClient.invalidateQueries({ queryKey: ['distinctSpecies', studyId] })
    }
  })

  const handleUpdateObservation = (updates) => {
    updateMutation.mutate(updates)
  }

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e) => {
      // Don't handle navigation keys when editing timestamp
      if (isEditingTimestamp || showDatePicker) return

      // Don't handle navigation if a bbox is selected (user is editing)
      if (selectedBboxId) {
        if (e.key === 'Escape') {
          setSelectedBboxId(null)
        }
        return
      }

      if (e.key === 'ArrowLeft' && hasPrevious) {
        onPrevious()
      } else if (e.key === 'ArrowRight' && hasNext) {
        onNext()
      } else if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'b' || e.key === 'B') {
        setShowBboxes((prev) => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    isOpen,
    onNext,
    onPrevious,
    onClose,
    hasNext,
    hasPrevious,
    isEditingTimestamp,
    showDatePicker,
    selectedBboxId
  ])

  // Reset selection when changing images
  useEffect(() => {
    setSelectedBboxId(null)
  }, [media?.mediaID])

  if (!isOpen || !media) return null

  const hasBboxes = bboxes.length > 0
  const selectedBbox = bboxes.find((b) => b.observationID === selectedBboxId)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={() => {
        if (selectedBboxId) {
          setSelectedBboxId(null)
        } else {
          onClose()
        }
      }}
    >
      <div className="relative max-w-7xl w-full h-full flex items-center justify-center">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-0 right-0 z-10 bg-white rounded-full p-2 hover:bg-gray-100 transition-colors"
          aria-label="Close modal"
        >
          <X size={24} />
        </button>

        {/* Bbox toggle button */}
        {hasBboxes && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowBboxes((prev) => !prev)
            }}
            className={`absolute top-0 right-12 z-10 rounded-full p-2 transition-colors ${showBboxes ? 'bg-lime-500 text-white hover:bg-lime-600' : 'bg-white hover:bg-gray-100'}`}
            aria-label={showBboxes ? 'Hide bounding boxes' : 'Show bounding boxes'}
            title={`${showBboxes ? 'Hide' : 'Show'} bounding boxes (B)`}
          >
            <Square size={24} />
          </button>
        )}

        <div
          className="bg-white rounded-lg overflow-hidden shadow-2xl max-h-[90vh] flex flex-col max-w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-center bg-gray-100 overflow-hidden relative">
            <img
              src={constructImageUrl(media.filePath)}
              alt={media.fileName || `Media ${media.mediaID}`}
              className="max-w-full max-h-[calc(90vh-120px)] w-auto h-auto object-contain"
            />
            {/* Bbox overlay */}
            {showBboxes && hasBboxes && (
              <>
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                >
                  {bboxes.map((bbox, index) => (
                    <rect
                      key={bbox.observationID || index}
                      x={`${bbox.bboxX * 100}%`}
                      y={`${bbox.bboxY * 100}%`}
                      width={`${bbox.bboxWidth * 100}%`}
                      height={`${bbox.bboxHeight * 100}%`}
                      stroke={
                        bbox.observationID === selectedBboxId
                          ? '#22c55e'
                          : bbox.classificationMethod === 'human'
                            ? '#22c55e'
                            : '#84cc16'
                      }
                      strokeWidth={bbox.observationID === selectedBboxId ? '4' : '3'}
                      fill="none"
                    />
                  ))}
                </svg>

                {/* Clickable bbox labels */}
                <div className="absolute inset-0 w-full h-full">
                  {bboxes.map((bbox) => (
                    <div key={bbox.observationID} className="relative w-full h-full">
                      <BboxLabel
                        bbox={bbox}
                        isSelected={bbox.observationID === selectedBboxId}
                        isHuman={bbox.classificationMethod === 'human'}
                        onClick={() =>
                          setSelectedBboxId(
                            bbox.observationID === selectedBboxId ? null : bbox.observationID
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Observation list panel - always visible */}
          <ObservationListPanel
            bboxes={bboxes}
            selectedId={selectedBboxId}
            onSelect={setSelectedBboxId}
          />

          {/* Footer with metadata */}
          <div className="px-4 py-3 bg-white flex-shrink-0 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{media.scientificName}</h3>
            </div>

            {/* Editable Timestamp Section */}
            <div className="relative mt-1">
              {isEditingTimestamp ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={inlineTimestamp}
                    onChange={(e) => setInlineTimestamp(e.target.value)}
                    onKeyDown={handleInlineKeyDown}
                    className="text-sm text-gray-700 border border-gray-300 rounded px-2 py-1 flex-1 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent"
                    autoFocus
                    disabled={isSaving}
                    placeholder="Enter date/time..."
                  />
                  <button
                    onClick={handleInlineSave}
                    disabled={isSaving}
                    className="text-lime-600 hover:text-lime-700 disabled:opacity-50 p-1"
                    title="Save (Enter)"
                  >
                    <Check size={18} />
                  </button>
                  <button
                    onClick={handleInlineCancel}
                    disabled={isSaving}
                    className="text-gray-400 hover:text-gray-600 disabled:opacity-50 p-1"
                    title="Cancel (Escape)"
                  >
                    <X size={18} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  <p
                    className="text-sm text-gray-500 cursor-pointer hover:text-gray-700 hover:underline"
                    onClick={handleInlineEdit}
                    title="Click to edit timestamp"
                  >
                    {media.timestamp ? new Date(media.timestamp).toLocaleString() : 'No timestamp'}
                  </p>
                  <button
                    onClick={handleInlineEdit}
                    className="text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                    title="Edit timestamp inline"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setShowDatePicker(true)}
                    className="text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                    title="Open date picker"
                  >
                    <Calendar size={14} />
                  </button>
                </div>
              )}

              {/* Error Message */}
              {error && <p className="text-xs text-red-500 mt-1">{error}</p>}

              {/* Saving indicator */}
              {isSaving && <p className="text-xs text-gray-400 mt-1 animate-pulse">Saving...</p>}

              {/* Date Picker Popup */}
              {showDatePicker && (
                <div className="absolute left-0 bottom-full mb-2 z-50">
                  <DateTimePicker
                    value={media.timestamp}
                    onChange={handleTimestampSave}
                    onCancel={() => setShowDatePicker(false)}
                  />
                </div>
              )}
            </div>

            {media.fileName && (
              <p className="text-xs text-gray-400 mt-1 truncate">{media.fileName}</p>
            )}
            {updateMutation.isPending && (
              <p className="text-xs text-blue-500 mt-1">Updating classification...</p>
            )}
            {updateMutation.isError && (
              <p className="text-xs text-red-500 mt-1">
                Error: {updateMutation.error?.message || 'Failed to update'}
              </p>
            )}
          </div>
        </div>

        {/* Species selector - positioned near bbox with smart clamping */}
        {selectedBbox && (
          <div className="fixed inset-0 z-[60]" onClick={() => setSelectedBboxId(null)}>
            <div
              className="absolute"
              style={{
                // Position near bbox, clamped to stay within visible area
                left: `clamp(16px, ${selectedBbox.bboxX * 100}%, calc(100% - 304px))`,
                // Below bbox if in top 30%, otherwise above
                top:
                  selectedBbox.bboxY < 0.3
                    ? `calc(${(selectedBbox.bboxY + selectedBbox.bboxHeight) * 100}% + 8px)`
                    : `calc(${selectedBbox.bboxY * 100}% - 8px)`,
                transform: selectedBbox.bboxY < 0.3 ? 'none' : 'translateY(-100%)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <SpeciesSelector
                bbox={selectedBbox}
                studyId={studyId}
                onClose={() => setSelectedBboxId(null)}
                onUpdate={handleUpdateObservation}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const palette = [
  'hsl(173 58% 39%)',
  'hsl(43 74% 66%)',
  'hsl(12 76% 61%)',
  'hsl(197 37% 24%)',
  'hsl(27 87% 67%)'
]

function Gallery({ species, dateRange, timeRange }) {
  const [mediaFiles, setMediaFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [imageErrors, setImageErrors] = useState({})
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [initialLoad, setInitialLoad] = useState(true)
  const [selectedMedia, setSelectedMedia] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const loaderRef = useRef(null)
  const PAGE_SIZE = 15
  const debounceTimeoutRef = useRef(null)

  const { id } = useParams()

  // Debounce function
  const debounce = (func, delay) => {
    return (...args) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
      debounceTimeoutRef.current = setTimeout(() => {
        func(...args)
      }, delay)
    }
  }

  // Set up Intersection Observer for infinite scrolling
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !initialLoad) {
          loadMoreMedia()
        }
      },
      { threshold: 0.1 }
    )

    if (loaderRef.current) {
      observer.observe(loaderRef.current)
    }

    return () => {
      if (loaderRef.current) {
        observer.unobserve(loaderRef.current)
      }
    }
  }, [hasMore, loading, initialLoad, loaderRef])

  // Create a memoized version of loadMedia to avoid recreating on each render
  const loadMedia = useCallback(
    async (pageNum, isNewSearch = false) => {
      try {
        setLoading(true)

        console.log(
          'Fetching media files for species:',
          species,
          dateRange,
          timeRange,
          'page:',
          pageNum
        )
        const response = await window.api.getMedia(id, {
          species,
          dateRange: { start: dateRange[0], end: dateRange[1] },
          timeRange,
          limit: PAGE_SIZE,
          offset: (pageNum - 1) * PAGE_SIZE
        })

        if (response.error) {
          console.warn('Error fetching media files:', response.error)
        } else {
          if (isNewSearch) {
            setMediaFiles(response.data)
          } else {
            setMediaFiles((prev) => [...prev, ...response.data])
          }

          setHasMore(response.data.length === PAGE_SIZE)
        }
      } catch (err) {
        console.warn(err)
      } finally {
        setLoading(false)
        setInitialLoad(false)
      }
    },
    [id, species, dateRange, timeRange]
  )

  // Create a debounced version of loadMedia
  const debouncedLoadMedia = useMemo(
    () => debounce((pageNum, isNewSearch) => loadMedia(pageNum, isNewSearch), 100),
    [loadMedia]
  )

  useEffect(() => {
    // Reset pagination when filters change
    // setMediaFiles([])
    setPage(1)
    setHasMore(true)
    setInitialLoad(true)

    if (!dateRange[0] || !dateRange[1]) return

    debouncedLoadMedia(1, true)
  }, [species, dateRange, timeRange, id, debouncedLoadMedia])

  const loadMoreMedia = () => {
    if (!loading && hasMore) {
      const nextPage = page + 1
      setPage(nextPage)
      loadMedia(nextPage, false)
    }
  }

  const constructImageUrl = (fullFilePath) => {
    if (fullFilePath.startsWith('http')) {
      return fullFilePath
    }

    return `local-file://get?path=${encodeURIComponent(fullFilePath)}`
  }

  const handleImageClick = (media) => {
    setSelectedMedia(media)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedMedia(null)
  }

  const handleNextImage = () => {
    if (!selectedMedia) return
    const currentIndex = mediaFiles.findIndex((m) => m.mediaID === selectedMedia.mediaID)
    if (currentIndex < mediaFiles.length - 1) {
      setSelectedMedia(mediaFiles[currentIndex + 1])
    }
  }

  const handlePreviousImage = () => {
    if (!selectedMedia) return
    const currentIndex = mediaFiles.findIndex((m) => m.mediaID === selectedMedia.mediaID)
    if (currentIndex > 0) {
      setSelectedMedia(mediaFiles[currentIndex - 1])
    }
  }

  // Handle optimistic timestamp update
  const handleTimestampUpdate = useCallback((mediaID, newTimestamp) => {
    setMediaFiles((prev) =>
      prev.map((m) => (m.mediaID === mediaID ? { ...m, timestamp: newTimestamp } : m))
    )
    // Also update selectedMedia if it's the one being edited
    setSelectedMedia((prev) =>
      prev?.mediaID === mediaID ? { ...prev, timestamp: newTimestamp } : prev
    )
  }, [])

  const currentIndex = selectedMedia
    ? mediaFiles.findIndex((m) => m.mediaID === selectedMedia.mediaID)
    : -1
  const hasNext = currentIndex >= 0 && currentIndex < mediaFiles.length - 1
  const hasPrevious = currentIndex > 0

  return (
    <>
      <ImageModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        media={selectedMedia}
        constructImageUrl={constructImageUrl}
        onNext={handleNextImage}
        onPrevious={handlePreviousImage}
        hasNext={hasNext}
        hasPrevious={hasPrevious}
        studyId={id}
        onTimestampUpdate={handleTimestampUpdate}
      />
      <div className="flex flex-wrap gap-[12px] h-full overflow-auto">
        {mediaFiles.map((media) => (
          <div
            key={media.mediaID}
            className="border border-gray-300 rounded-lg overflow-hidden min-w-[200px] w-[calc(33%-7px)] flex flex-col h-max"
          >
            <div
              className="bg-gray-100 flex items-center justify-center cursor-pointer hover:bg-gray-200 transition-colors"
              onClick={() => handleImageClick(media)}
            >
              <img
                src={constructImageUrl(media.filePath)}
                alt={media.fileName || `Media ${media.mediaID}`}
                data-image={media.filePath}
                className={`object-contain w-full h-auto min-h-20 ${imageErrors[media.mediaID] ? 'hidden' : ''}`}
                onError={() => {
                  setImageErrors((prev) => ({ ...prev, [media.mediaID]: true }))
                }}
                loading="lazy"
              />
              {imageErrors[media.mediaID] && (
                <div
                  className="flex items-center justify-center w-full h-full bg-gray-100 text-gray-400 flex-1"
                  title={`Image not available or failed to load because it's not public or has been deleted/moved locally ${media.filePath}`}
                >
                  <CameraOff size={32} />
                </div>
              )}
            </div>
            <div className="p-2">
              <h3 className="text-sm font-semibold truncate">{media.scientificName}</h3>
              <p className="text-xs text-gray-500">{new Date(media.timestamp).toLocaleString()}</p>
            </div>
          </div>
        ))}

        {/* Loading indicator and intersection target */}
        <div ref={loaderRef} className="w-full flex justify-center p-4">
          {loading && !initialLoad && (
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
              <span className="ml-2">Loading more...</span>
            </div>
          )}
          {!hasMore && mediaFiles.length > 0 && (
            <p className="text-gray-500 text-sm">No more images to load</p>
          )}
          {!hasMore && mediaFiles.length === 0 && !loading && (
            <p className="text-gray-500">No media files match the selected filters</p>
          )}
        </div>
      </div>
    </>
  )
}

export default function Activity({ studyData, studyId }) {
  const { id } = useParams()
  const actualStudyId = studyId || id // Use passed studyId or from params

  const [error, setError] = useState(null)
  const [selectedSpecies, setSelectedSpecies] = useState([])
  const [dateRange, setDateRange] = useState([null, null])
  const [timeRange, setTimeRange] = useState({ start: 0, end: 24 })
  const [timeseriesData, setTimeseriesData] = useState(null)
  const [speciesDistributionData, setSpeciesDistributionData] = useState(null)
  const [dailyActivityData, setDailyActivityData] = useState(null)

  const taxonomicData = studyData?.taxonomic || null

  useEffect(() => {
    async function fetchData() {
      try {
        const speciesResponse = await window.api.getSpeciesDistribution(actualStudyId)

        if (speciesResponse.error) {
          setError(speciesResponse.error)
        } else {
          setSpeciesDistributionData(speciesResponse.data)
          setSelectedSpecies(speciesResponse.data.slice(0, 2))
        }
      } catch (err) {
        setError(err.message || 'Failed to fetch activity data')
      }
    }

    if (actualStudyId) {
      fetchData()
    }
  }, [actualStudyId])

  useEffect(() => {
    async function fetchTimeseriesData() {
      if (!selectedSpecies.length || !actualStudyId) return

      try {
        const speciesNames = selectedSpecies.map((s) => s.scientificName)
        const response = await window.api.getSpeciesTimeseries(actualStudyId, speciesNames)

        if (response.error) {
          console.error('Error fetching species timeseries:', response.error)
          return
        }

        setTimeseriesData(response.data.timeseries)
      } catch (err) {
        console.error('Failed to fetch species timeseries:', err)
      }
    }

    fetchTimeseriesData()
  }, [selectedSpecies, actualStudyId])

  useEffect(() => {
    if (
      timeseriesData &&
      timeseriesData.length > 0 &&
      dateRange[0] === null &&
      dateRange[1] === null
    ) {
      const totalPeriods = timeseriesData.length
      const startIndex = Math.max(totalPeriods - Math.max(Math.ceil(totalPeriods * 0.3), 2), 0)
      const endIndex = totalPeriods - 1

      let startDate = new Date(timeseriesData[startIndex].date)
      let endDate = new Date(timeseriesData[endIndex].date)

      // Ensure a minimum range of 1 day if dates are the same
      // if (startDate.getTime() === endDate.getTime()) {
      //   endDate = new Date(startDate)
      //   endDate.setDate(endDate.getDate() + 1) // Add one day to end date
      // }

      setDateRange([startDate, endDate])
    }
  }, [timeseriesData])

  console.log('dateRange', dateRange)

  useEffect(() => {
    async function fetchDailyActivityData() {
      if (!selectedSpecies.length || !dateRange[0] || !dateRange[1]) return

      try {
        const speciesNames = selectedSpecies.map((s) => s.scientificName)
        const response = await window.api.getSpeciesDailyActivity(
          actualStudyId,
          speciesNames,
          dateRange[0].toISOString(),
          dateRange[1].toISOString()
        )

        if (response.error) {
          console.error('Error fetching daily activity data:', response.error)
          return
        }

        setDailyActivityData(response.data)
      } catch (err) {
        console.error('Failed to fetch daily activity data:', err)
      }
    }

    fetchDailyActivityData()
  }, [dateRange, selectedSpecies, actualStudyId])

  // Handle time range changes
  const handleTimeRangeChange = useCallback((newTimeRange) => {
    setTimeRange(newTimeRange)
  }, [])

  // Handle species selection changes
  const handleSpeciesChange = useCallback((newSelectedSpecies) => {
    // Ensure we have at least one species selected
    if (newSelectedSpecies.length === 0) {
      return
    }
    setSelectedSpecies(newSelectedSpecies)
  }, [])

  return (
    <div className="px-4 flex flex-col h-full">
      {error ? (
        <div className="text-red-500 py-4">Error: {error}</div>
      ) : (
        <div className="flex flex-col h-full gap-4">
          {/* First row - takes remaining space */}
          <div className="flex flex-row gap-4 flex-1 min-h-0">
            {/* Species Distribution - left side */}

            {/* Map - right side */}
            <div className="h-full flex-1">
              <Gallery
                species={selectedSpecies.map((s) => s.scientificName)}
                dateRange={dateRange}
                timeRange={timeRange}
              />
            </div>
            <div className="h-full overflow-auto w-xs">
              {speciesDistributionData && (
                <SpeciesDistribution
                  data={speciesDistributionData}
                  taxonomicData={taxonomicData}
                  selectedSpecies={selectedSpecies}
                  onSpeciesChange={handleSpeciesChange}
                  palette={palette}
                />
              )}
            </div>
          </div>

          {/* Second row - fixed height with timeline and clock */}
          <div className="w-full flex h-[130px] flex-shrink-0 gap-3">
            <div className="w-[140px] h-full rounded border border-gray-200 flex items-center justify-center relative">
              <DailyActivityRadar
                activityData={dailyActivityData}
                selectedSpecies={selectedSpecies}
                palette={palette}
              />
              <div className="absolute w-full h-full flex items-center justify-center">
                <CircularTimeFilter
                  onChange={handleTimeRangeChange}
                  startTime={timeRange.start}
                  endTime={timeRange.end}
                />
              </div>
            </div>
            <div className="flex-grow rounded px-2 border border-gray-200">
              <TimelineChart
                timeseriesData={timeseriesData}
                selectedSpecies={selectedSpecies}
                dateRange={dateRange}
                setDateRange={setDateRange}
                palette={palette}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
