import {
  CameraOff,
  X,
  Square,
  Calendar,
  Pencil,
  Check,
  Search,
  Trash2,
  Grid3x3,
  Plus
} from 'lucide-react'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useParams } from 'react-router'
import CircularTimeFilter, { DailyActivityRadar } from './ui/clock'
import SpeciesDistribution from './ui/speciesDistribution'
import TimelineChart from './ui/timeseries'
import DateTimePicker from './ui/DateTimePicker'
import EditableBbox from './ui/EditableBbox'
import { computeBboxLabelPosition, computeSelectorPosition } from './utils/positioning'
import { getImageBounds, screenToNormalized } from './utils/bboxCoordinates'

/**
 * Observation list panel - always visible list of all detections
 */
function ObservationListPanel({ bboxes, selectedId, onSelect, onDelete }) {
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
        <div
          key={bbox.observationID}
          className={`w-full px-4 py-2 flex items-center justify-between hover:bg-gray-100 transition-colors ${
            selectedId === bbox.observationID ? 'bg-lime-100' : ''
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSelect(bbox.observationID === selectedId ? null : bbox.observationID)
            }}
            className="flex items-center gap-2 flex-1 text-left"
          >
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
          </button>
          <div className="flex items-center gap-2">
            {bbox.confidence && (
              <span className="text-xs text-gray-400">{Math.round(bbox.confidence * 100)}%</span>
            )}
            <Pencil size={14} className="text-gray-400" />
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(bbox.observationID)
              }}
              className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors"
              title="Delete observation"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
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
const BboxLabel = forwardRef(function BboxLabel(
  { bbox, isSelected, onClick, onDelete, isHuman },
  ref
) {
  const displayName = bbox.scientificName || 'Blank'
  const confidence = bbox.confidence ? `${Math.round(bbox.confidence * 100)}%` : null

  // Use the extracted positioning function
  const { left: leftPos, top: topPos, transform: transformVal } = computeBboxLabelPosition(bbox)

  const style = {
    left: leftPos,
    top: topPos,
    transform: transformVal,
    maxWidth: '200px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }

  return (
    <div ref={ref} className="absolute flex items-center gap-1 pointer-events-auto" style={style}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        className={`px-2 py-0.5 rounded text-xs font-medium transition-all cursor-pointer hover:scale-105 ${
          isSelected
            ? 'bg-lime-500 text-white ring-2 ring-lime-300'
            : isHuman
              ? 'bg-green-500 text-white hover:bg-green-600'
              : 'bg-lime-500/90 text-white hover:bg-lime-600'
        }`}
        title={`${displayName}${confidence ? ` (${confidence})` : ''} - Click to edit`}
      >
        {displayName}
        {confidence && !isHuman && <span className="ml-1 opacity-75">{confidence}</span>}
        {isHuman && <span className="ml-1">✓</span>}
      </button>
      {isSelected && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="p-1 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
          title="Delete observation"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
})

/**
 * Overlay for drawing new bounding boxes.
 * Handles mouse events for click-drag bbox creation.
 * Simple manual mode - when active, captures all mouse events for drawing.
 */
function DrawingOverlay({ imageRef, containerRef, onComplete }) {
  const [drawStart, setDrawStart] = useState(null)
  const [drawCurrent, setDrawCurrent] = useState(null)
  const imageBoundsRef = useRef(null)

  // Minimum bbox size (5% of image dimension)
  const MIN_SIZE = 0.05

  // Calculate image bounds when the overlay mounts or refs change
  useEffect(() => {
    const updateBounds = () => {
      if (imageRef?.current && containerRef?.current) {
        imageBoundsRef.current = getImageBounds(imageRef.current, containerRef.current)
      }
    }
    updateBounds()

    // Also update on resize
    window.addEventListener('resize', updateBounds)
    return () => window.removeEventListener('resize', updateBounds)
  }, [imageRef, containerRef])

  const handleMouseDown = useCallback((e) => {
    e.stopPropagation()
    const bounds = imageBoundsRef.current
    if (!bounds) return

    const normalized = screenToNormalized(e.clientX, e.clientY, bounds)
    if (!normalized) return

    // Only start if click is within image bounds (0-1)
    if (normalized.x >= 0 && normalized.x <= 1 && normalized.y >= 0 && normalized.y <= 1) {
      setDrawStart(normalized)
      setDrawCurrent(normalized)
    }
  }, [])

  const handleMouseMove = useCallback(
    (e) => {
      if (!drawStart) return

      const bounds = imageBoundsRef.current
      if (!bounds) return

      const normalized = screenToNormalized(e.clientX, e.clientY, bounds)
      if (!normalized) return

      // Clamp to image bounds
      setDrawCurrent({
        x: Math.max(0, Math.min(1, normalized.x)),
        y: Math.max(0, Math.min(1, normalized.y))
      })
    },
    [drawStart]
  )

  const handleMouseUp = useCallback(() => {
    if (!drawStart || !drawCurrent) {
      setDrawStart(null)
      setDrawCurrent(null)
      return
    }

    // Calculate bbox from start and current points
    const minX = Math.min(drawStart.x, drawCurrent.x)
    const minY = Math.min(drawStart.y, drawCurrent.y)
    const maxX = Math.max(drawStart.x, drawCurrent.x)
    const maxY = Math.max(drawStart.y, drawCurrent.y)

    const width = maxX - minX
    const height = maxY - minY

    // Minimum size check
    if (width >= MIN_SIZE && height >= MIN_SIZE) {
      onComplete({
        bboxX: minX,
        bboxY: minY,
        bboxWidth: width,
        bboxHeight: height
      })
    }

    setDrawStart(null)
    setDrawCurrent(null)
  }, [drawStart, drawCurrent, onComplete])

  // Calculate preview rect in percentages
  const previewRect =
    drawStart && drawCurrent
      ? {
          x: Math.min(drawStart.x, drawCurrent.x) * 100,
          y: Math.min(drawStart.y, drawCurrent.y) * 100,
          width: Math.abs(drawCurrent.x - drawStart.x) * 100,
          height: Math.abs(drawCurrent.y - drawStart.y) * 100
        }
      : null

  return (
    <>
      {/* Transparent overlay to capture all mouse events for drawing */}
      <div
        className="absolute inset-0 z-30 cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Drawing preview */}
      {previewRect && (
        <svg className="absolute inset-0 w-full h-full z-30 pointer-events-none">
          <rect
            x={`${previewRect.x}%`}
            y={`${previewRect.y}%`}
            width={`${previewRect.width}%`}
            height={`${previewRect.height}%`}
            stroke="#3b82f6"
            strokeWidth="2"
            strokeDasharray="5,5"
            fill="rgba(59, 130, 246, 0.1)"
          />
        </svg>
      )}

      {/* Draw mode indicator */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-blue-500 text-white px-3 py-1 rounded-full text-sm font-medium shadow-lg pointer-events-none">
        Click and drag to draw a box
      </div>
    </>
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
  const [showSpeciesSelector, setShowSpeciesSelector] = useState(false) // Only show when clicking label
  const [selectorPosition, setSelectorPosition] = useState(null)
  // Draw mode state for creating new bboxes
  const [isDrawMode, setIsDrawMode] = useState(false)
  const queryClient = useQueryClient()

  // Refs for positioning the species selector near the label
  const imageContainerRef = useRef(null)
  const bboxLabelRefs = useRef({})
  const imageRef = useRef(null)

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

  // Compute selector position when a bbox is selected AND species selector should be shown
  useEffect(() => {
    if (
      !selectedBboxId ||
      !showSpeciesSelector ||
      !bboxLabelRefs.current[selectedBboxId] ||
      !imageContainerRef.current
    ) {
      setSelectorPosition(null)
      return
    }

    const labelEl = bboxLabelRefs.current[selectedBboxId]
    const labelRect = labelEl.getBoundingClientRect()
    const containerRect = imageContainerRef.current.getBoundingClientRect()

    const position = computeSelectorPosition(labelRect, containerRect)
    setSelectorPosition(position)
  }, [selectedBboxId, showSpeciesSelector])

  // Recalculate position on window resize
  useEffect(() => {
    if (!selectedBboxId || !showSpeciesSelector) return

    const handleResize = () => {
      if (bboxLabelRefs.current[selectedBboxId] && imageContainerRef.current) {
        const labelEl = bboxLabelRefs.current[selectedBboxId]
        const labelRect = labelEl.getBoundingClientRect()
        const containerRect = imageContainerRef.current.getBoundingClientRect()
        const position = computeSelectorPosition(labelRect, containerRect)
        setSelectorPosition(position)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [selectedBboxId, showSpeciesSelector])

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

  // Mutation for updating observation bounding box coordinates
  const updateBboxMutation = useMutation({
    mutationFn: async ({ observationID, bbox }) => {
      const response = await window.api.updateObservationBbox(studyId, observationID, bbox)
      if (response.error) {
        throw new Error(response.error)
      }
      return response.data
    },
    onMutate: async ({ observationID, bbox }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['mediaBboxes', studyId, media?.mediaID] })

      // Snapshot previous value for rollback
      const previous = queryClient.getQueryData(['mediaBboxes', studyId, media?.mediaID])

      // Optimistically update the cache
      queryClient.setQueryData(['mediaBboxes', studyId, media?.mediaID], (old) =>
        old?.map((b) =>
          b.observationID === observationID ? { ...b, ...bbox, classificationMethod: 'human' } : b
        )
      )

      return { previous }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['mediaBboxes', studyId, media?.mediaID], context.previous)
      }
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: ['mediaBboxes', studyId, media?.mediaID] })
      // Also update thumbnail grid
      queryClient.invalidateQueries({ queryKey: ['thumbnailBboxesBatch'] })
    }
  })

  const handleBboxUpdate = useCallback(
    (observationID, newBbox) => {
      updateBboxMutation.mutate({ observationID, bbox: newBbox })
    },
    [updateBboxMutation]
  )

  // Mutation for deleting observation
  const deleteMutation = useMutation({
    mutationFn: async (observationID) => {
      const response = await window.api.deleteObservation(studyId, observationID)
      if (response.error) {
        throw new Error(response.error)
      }
      return response.data
    },
    onMutate: async (observationID) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['mediaBboxes', studyId, media?.mediaID] })

      // Snapshot previous value for rollback
      const previous = queryClient.getQueryData(['mediaBboxes', studyId, media?.mediaID])

      // Optimistically remove the observation from cache
      queryClient.setQueryData(['mediaBboxes', studyId, media?.mediaID], (old) =>
        old?.filter((b) => b.observationID !== observationID)
      )

      // Clear selection if deleted bbox was selected
      if (selectedBboxId === observationID) {
        setSelectedBboxId(null)
        setShowSpeciesSelector(false)
      }

      return { previous }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['mediaBboxes', studyId, media?.mediaID], context.previous)
      }
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: ['mediaBboxes', studyId, media?.mediaID] })
      // Also update thumbnail grid
      queryClient.invalidateQueries({ queryKey: ['thumbnailBboxesBatch'] })
    }
  })

  const handleDeleteObservation = useCallback(
    (observationID) => {
      deleteMutation.mutate(observationID)
    },
    [deleteMutation]
  )

  // Mutation for creating new observation
  const createMutation = useMutation({
    mutationFn: async (observationData) => {
      const response = await window.api.createObservation(studyId, observationData)
      if (response.error) {
        throw new Error(response.error)
      }
      return response.data
    },
    onSuccess: (data) => {
      // Invalidate related queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['mediaBboxes', studyId, media?.mediaID] })
      queryClient.invalidateQueries({ queryKey: ['distinctSpecies', studyId] })
      queryClient.invalidateQueries({ queryKey: ['speciesDistribution'] })
      // Also update thumbnail grid
      queryClient.invalidateQueries({ queryKey: ['thumbnailBboxesBatch'] })
      // Exit draw mode and select the new observation
      setIsDrawMode(false)
      setSelectedBboxId(data.observationID)
    }
  })

  // Get default species from existing bboxes (most confident)
  const getDefaultSpecies = useCallback(() => {
    if (!bboxes || bboxes.length === 0) return { scientificName: null, commonName: null }

    // Find observation with highest confidence
    const withConfidence = bboxes.filter((b) => b.confidence != null)
    if (withConfidence.length === 0) {
      // No confidence scores - use first with a species name
      const withSpecies = bboxes.find((b) => b.scientificName)
      return {
        scientificName: withSpecies?.scientificName || null,
        commonName: withSpecies?.commonName || null
      }
    }

    const mostConfident = withConfidence.reduce((best, b) =>
      b.confidence > best.confidence ? b : best
    )
    return {
      scientificName: mostConfident.scientificName,
      commonName: mostConfident.commonName || null
    }
  }, [bboxes])

  // Handle draw completion - create new observation
  const handleDrawComplete = useCallback(
    (bbox) => {
      if (!media) return

      const defaultSpecies = getDefaultSpecies()
      const observationData = {
        mediaID: media.mediaID,
        deploymentID: media.deploymentID,
        timestamp: media.timestamp,
        scientificName: defaultSpecies.scientificName,
        commonName: defaultSpecies.commonName,
        bboxX: bbox.bboxX,
        bboxY: bbox.bboxY,
        bboxWidth: bbox.bboxWidth,
        bboxHeight: bbox.bboxHeight
      }

      createMutation.mutate(observationData)
    },
    [media, getDefaultSpecies, createMutation]
  )

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e) => {
      // Don't handle navigation keys when editing timestamp
      if (isEditingTimestamp || showDatePicker) return

      // Handle escape in draw mode
      if (isDrawMode) {
        if (e.key === 'Escape') {
          setIsDrawMode(false)
        }
        return
      }

      // Handle keys when a bbox is selected
      if (selectedBboxId) {
        if (e.key === 'Escape') {
          setSelectedBboxId(null)
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          handleDeleteObservation(selectedBboxId)
        }
        return
      }

      if (e.key === 'ArrowLeft' && hasPrevious) {
        setIsDrawMode(false)
        onPrevious()
      } else if (e.key === 'ArrowRight' && hasNext) {
        setIsDrawMode(false)
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
    selectedBboxId,
    isDrawMode,
    handleDeleteObservation
  ])

  // Reset selection and draw mode when changing images
  useEffect(() => {
    setSelectedBboxId(null)
    setIsDrawMode(false)
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

        {/* Add bbox button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setIsDrawMode(true)
            setSelectedBboxId(null)
            setShowSpeciesSelector(false)
            setShowBboxes(true) // Ensure bboxes are visible when adding
          }}
          className={`absolute top-0 z-10 rounded-full p-2 transition-colors ${
            hasBboxes ? 'right-24' : 'right-12'
          } ${
            isDrawMode ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-white hover:bg-gray-100'
          }`}
          aria-label="Add new bounding box"
          title="Add new detection (click and drag on image)"
        >
          <Plus size={24} />
        </button>

        <div
          className="bg-white rounded-lg overflow-hidden shadow-2xl max-h-[90vh] flex flex-col max-w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            ref={imageContainerRef}
            className="flex items-center justify-center bg-gray-100 overflow-hidden relative"
            onClick={() => {
              setSelectedBboxId(null)
              setShowSpeciesSelector(false)
            }}
          >
            <img
              ref={imageRef}
              src={constructImageUrl(media.filePath)}
              alt={media.fileName || `Media ${media.mediaID}`}
              className="max-w-full max-h-[calc(90vh-120px)] w-auto h-auto object-contain"
            />
            {/* Bbox overlay - editable bounding boxes */}
            {showBboxes && hasBboxes && (
              <>
                <svg
                  className="absolute inset-0 w-full h-full"
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                >
                  {bboxes.map((bbox) => (
                    <EditableBbox
                      key={bbox.observationID}
                      bbox={bbox}
                      isSelected={bbox.observationID === selectedBboxId}
                      onSelect={() => {
                        // Clicking bbox selects it for geometry editing only, NOT species selector
                        setSelectedBboxId(
                          bbox.observationID === selectedBboxId ? null : bbox.observationID
                        )
                        setShowSpeciesSelector(false) // Close species selector when clicking bbox
                      }}
                      onUpdate={(newBbox) => handleBboxUpdate(bbox.observationID, newBbox)}
                      imageRef={imageRef}
                      containerRef={imageContainerRef}
                      color={bbox.classificationMethod === 'human' ? '#22c55e' : '#84cc16'}
                    />
                  ))}
                </svg>

                {/* Clickable bbox labels - clicking label opens species selector */}
                <div className="absolute inset-0 w-full h-full pointer-events-none">
                  {bboxes.map((bbox) => (
                    <BboxLabel
                      key={bbox.observationID}
                      ref={(el) => {
                        bboxLabelRefs.current[bbox.observationID] = el
                      }}
                      bbox={bbox}
                      isSelected={bbox.observationID === selectedBboxId}
                      isHuman={bbox.classificationMethod === 'human'}
                      onClick={() => {
                        // Clicking label selects bbox AND opens species selector
                        setSelectedBboxId(bbox.observationID)
                        setShowSpeciesSelector(true)
                      }}
                      onDelete={() => handleDeleteObservation(bbox.observationID)}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Drawing overlay - only show when in draw mode */}
            {isDrawMode && (
              <DrawingOverlay
                imageRef={imageRef}
                containerRef={imageContainerRef}
                onComplete={handleDrawComplete}
              />
            )}
          </div>

          {/* Observation list panel - always visible */}
          <ObservationListPanel
            bboxes={bboxes}
            selectedId={selectedBboxId}
            onSelect={setSelectedBboxId}
            onDelete={handleDeleteObservation}
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

        {/* Species selector - positioned near the BboxLabel, only shown when clicking label */}
        {selectedBbox && showSpeciesSelector && selectorPosition && (
          <div
            className="fixed inset-0 z-[60]"
            onClick={() => {
              setShowSpeciesSelector(false)
              setSelectedBboxId(null)
            }}
          >
            <div
              className="fixed"
              style={{
                left: `${selectorPosition.x}px`,
                top: `${selectorPosition.y}px`,
                transform: selectorPosition.transform
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <SpeciesSelector
                bbox={selectedBbox}
                studyId={studyId}
                onClose={() => {
                  setShowSpeciesSelector(false)
                  setSelectedBboxId(null)
                }}
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

/**
 * Control bar for gallery view options
 */
function GalleryControls({ showBboxes, onToggleBboxes, gridColumns, onCycleGrid }) {
  const gridLabels = { 3: '3x', 4: '4x', 5: '5x' }

  return (
    <div className="flex items-center justify-end gap-2 px-3 py-2 border-b border-gray-200 flex-shrink-0">
      {/* Show Bboxes Toggle */}
      <button
        onClick={onToggleBboxes}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          showBboxes
            ? 'bg-lime-500 text-white hover:bg-lime-600'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
        }`}
        title="Show bounding boxes on thumbnails"
      >
        <Square size={16} />
        <span>Boxes</span>
      </button>

      {/* Grid Density Cycle */}
      <button
        onClick={onCycleGrid}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
        title={`Grid: ${gridColumns} columns (click to cycle)`}
      >
        <Grid3x3 size={16} />
        <span>{gridLabels[gridColumns]}</span>
      </button>
    </div>
  )
}

/**
 * SVG overlay showing bboxes on a thumbnail
 * Receives bbox data as prop from parent (batch fetched at Gallery level)
 */
function ThumbnailBboxOverlay({ bboxes }) {
  if (!bboxes || bboxes.length === 0) return null

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none z-10"
      preserveAspectRatio="none"
    >
      {bboxes.map((bbox, index) => (
        <rect
          key={bbox.observationID || index}
          x={`${bbox.bboxX * 100}%`}
          y={`${bbox.bboxY * 100}%`}
          width={`${bbox.bboxWidth * 100}%`}
          height={`${bbox.bboxHeight * 100}%`}
          stroke="#84cc16"
          strokeWidth="2"
          fill="none"
        />
      ))}
    </svg>
  )
}

/**
 * Individual thumbnail card with optional bbox overlay
 */
function ThumbnailCard({
  media,
  constructImageUrl,
  onImageClick,
  imageErrors,
  setImageErrors,
  showBboxes,
  bboxes,
  widthClass
}) {
  return (
    <div
      className={`border border-gray-300 rounded-lg overflow-hidden min-w-[150px] ${widthClass} flex flex-col h-max transition-all`}
    >
      <div
        className="relative bg-gray-100 flex items-center justify-center cursor-pointer hover:bg-gray-200 transition-colors overflow-hidden"
        onClick={() => onImageClick(media)}
      >
        <div className="relative w-full">
          <img
            src={constructImageUrl(media.filePath)}
            alt={media.fileName || `Media ${media.mediaID}`}
            data-image={media.filePath}
            className={`w-full h-auto min-h-20 object-contain ${imageErrors[media.mediaID] ? 'hidden' : ''}`}
            onError={() => setImageErrors((prev) => ({ ...prev, [media.mediaID]: true }))}
            loading="lazy"
          />

          {/* Bbox overlay */}
          {showBboxes && <ThumbnailBboxOverlay bboxes={bboxes} />}
        </div>

        {imageErrors[media.mediaID] && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-gray-100 text-gray-400"
            title="Image not available"
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
  )
}

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

  // Grid controls state
  const [showThumbnailBboxes, setShowThumbnailBboxes] = useState(false)
  const [gridColumns, setGridColumns] = useState(3)

  // Grid column CSS classes
  const gridColumnClasses = {
    3: 'w-[calc(33.333%-8px)]',
    4: 'w-[calc(25%-9px)]',
    5: 'w-[calc(20%-10px)]'
  }
  const thumbnailWidthClass = gridColumnClasses[gridColumns]

  // Cycle grid density handler
  const handleCycleGrid = useCallback(() => {
    setGridColumns((prev) => (prev === 5 ? 3 : prev + 1))
  }, [])

  const { id } = useParams()

  // Batch fetch bboxes for all visible media when showThumbnailBboxes is enabled
  const mediaIDs = useMemo(() => mediaFiles.map((m) => m.mediaID), [mediaFiles])

  const { data: bboxesByMedia = {} } = useQuery({
    queryKey: ['thumbnailBboxesBatch', id, mediaIDs],
    queryFn: async () => {
      const response = await window.api.getMediaBboxesBatch(id, mediaIDs)
      return response.data || {}
    },
    enabled: showThumbnailBboxes && mediaIDs.length > 0 && !!id,
    staleTime: 60000
  })

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

      <div className="flex flex-col h-full bg-white rounded border border-gray-200 overflow-hidden">
        {/* Control Bar */}
        <GalleryControls
          showBboxes={showThumbnailBboxes}
          onToggleBboxes={() => setShowThumbnailBboxes((prev) => !prev)}
          gridColumns={gridColumns}
          onCycleGrid={handleCycleGrid}
        />

        {/* Grid */}
        <div className="flex flex-wrap gap-[12px] flex-1 overflow-auto p-3">
          {mediaFiles.map((media) => (
            <ThumbnailCard
              key={media.mediaID}
              media={media}
              constructImageUrl={constructImageUrl}
              onImageClick={handleImageClick}
              imageErrors={imageErrors}
              setImageErrors={setImageErrors}
              showBboxes={showThumbnailBboxes}
              bboxes={bboxesByMedia[media.mediaID] || []}
              widthClass={thumbnailWidthClass}
            />
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
      const startIndex = 0
      const endIndex = timeseriesData.length - 1

      let startDate = new Date(timeseriesData[startIndex].date)
      let endDate = new Date(timeseriesData[endIndex].date)

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
