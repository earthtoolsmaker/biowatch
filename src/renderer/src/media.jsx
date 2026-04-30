import {
  CameraOff,
  X,
  Calendar,
  Pencil,
  Check,
  Eye,
  EyeOff,
  SquarePlus,
  Layers,
  Play,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Heart,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Info
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation, useInfiniteQuery } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router'
import * as Tooltip from '@radix-ui/react-tooltip'
import CircularTimeFilter, { DailyActivityRadar } from './ui/clock'
import SpeciesDistribution from './ui/speciesDistribution'
import TimelineChart from './ui/timeseries'
import DateTimePicker from './ui/DateTimePicker'
import EditableBbox from './ui/EditableBbox'
import VideoBboxOverlay from './ui/VideoBboxOverlay.jsx'
import ObservationRail from './ui/ObservationRail'
import BboxLabelMinimal from './ui/BboxLabelMinimal'
import {
  getImageBounds,
  screenToNormalized,
  screenToNormalizedWithZoom
} from './utils/bboxCoordinates'
import { useZoomPan } from './hooks/useZoomPan'
import { useImagePrefetch } from './hooks/useImagePrefetch'
// Note: Sequence grouping is now done server-side via window.api.getSequences
import { getTopNonHumanSpecies } from './utils/speciesUtils'
import { useSequenceGap } from './hooks/useSequenceGap'
import { SequenceGapSlider } from './ui/SequenceGapSlider'
import { getSpeciesListFromBboxes, getSpeciesListFromSequence } from './utils/speciesFromBboxes'
import SpeciesLabel from './ui/SpeciesLabel'
import { useImportStatus } from './hooks/import'

/**
 * Overlay for drawing new bounding boxes.
 * Handles mouse events for click-drag bbox creation.
 * Simple manual mode - when active, captures all mouse events for drawing.
 * Supports zoom-aware coordinate conversion when zoomTransform is provided.
 */
function DrawingOverlay({ imageRef, containerRef, onComplete, zoomTransform }) {
  const [drawStart, setDrawStart] = useState(null)
  const [drawCurrent, setDrawCurrent] = useState(null)
  const imageBoundsRef = useRef(null)
  const zoomTransformRef = useRef(zoomTransform)

  // Keep zoom transform ref up to date
  useEffect(() => {
    zoomTransformRef.current = zoomTransform
  }, [zoomTransform])

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

    // Use zoom-aware coordinate conversion if zoom transform is present
    const zoom = zoomTransformRef.current
    const normalized =
      zoom && zoom.scale !== 1
        ? screenToNormalizedWithZoom(e.clientX, e.clientY, bounds, zoom)
        : screenToNormalized(e.clientX, e.clientY, bounds)
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

      // Use zoom-aware coordinate conversion if zoom transform is present
      const zoom = zoomTransformRef.current
      const normalized =
        zoom && zoom.scale !== 1
          ? screenToNormalizedWithZoom(e.clientX, e.clientY, bounds, zoom)
          : screenToNormalized(e.clientX, e.clientY, bounds)
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
  onTimestampUpdate,
  sequence,
  sequenceIndex,
  onSequenceNext,
  onSequencePrevious,
  hasNextInSequence,
  hasPreviousInSequence,
  isVideoMedia
}) {
  const [showBboxes, setShowBboxes] = useState(true)
  const [isEditingTimestamp, setIsEditingTimestamp] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [inlineTimestamp, setInlineTimestamp] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState(null)
  const [selectedObservationId, setSelectedObservationId] = useState(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  // Draw mode state for creating new bboxes
  const [isDrawMode, setIsDrawMode] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const [imageError, setImageError] = useState(false)
  // Track when current image has finished loading (for coordinating bbox rendering)
  const [isCurrentImageReady, setIsCurrentImageReady] = useState(false)
  // Transcoding state: 'idle' | 'checking' | 'transcoding' | 'ready' | 'error'
  const [transcodeState, setTranscodeState] = useState('idle')
  const [transcodeProgress, setTranscodeProgress] = useState(0)
  const [transcodedUrl, setTranscodedUrl] = useState(null)
  const [transcodeError, setTranscodeError] = useState(null)
  // Favorite state
  const [isFavorite, setIsFavorite] = useState(media?.favorite ?? false)
  const queryClient = useQueryClient()

  // Zoom and pan state for image viewing
  const {
    transform: zoomTransform,
    isZoomed,
    containerRef: zoomContainerRef,
    handleWheel: handleZoomWheel,
    handlePanStart,
    zoomIn,
    zoomOut,
    resetZoom,
    getTransformStyle
  } = useZoomPan({ minScale: 1, maxScale: 5, zoomStep: 0.25 })

  // Refs for positioning the observation editor near the label
  const imageContainerRef = useRef(null)
  const bboxLabelRefs = useRef({})
  const imageRef = useRef(null)

  // Refs + state for the video bbox overlay
  const videoRef = useRef(null)
  const videoContainerRef = useRef(null)
  const lastVideoTimeUpdateRef = useRef(0)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)

  // Initialize inline timestamp when media changes
  useEffect(() => {
    if (media?.timestamp) {
      setInlineTimestamp(new Date(media.timestamp).toLocaleString())
    }
    // Sync favorite state with media prop
    setIsFavorite(media?.favorite ?? false)
    // Reset editing state when media changes
    setIsEditingTimestamp(false)
    setShowDatePicker(false)
    setError(null)
    setVideoError(false)
    setImageError(false)
    // Reset transcoding state
    setTranscodeState('idle')
    setTranscodeProgress(0)
    setTranscodedUrl(null)
    setTranscodeError(null)
    // Reset video playback tracking
    setVideoCurrentTime(0)
    lastVideoTimeUpdateRef.current = 0
  }, [media?.mediaID, media?.timestamp, media?.favorite])

  // Video transcoding effect - check if video needs transcoding and handle it
  useEffect(() => {
    if (!isOpen || !media || !isVideoMedia(media)) return

    let cancelled = false
    let unsubscribeProgress = null

    const handleTranscoding = async () => {
      console.log('=== TRANSCODE FLOW START ===')
      console.log('media.filePath:', media.filePath)
      setTranscodeState('checking')

      try {
        // Check if video needs transcoding (unsupported format)
        const needsTranscode = await window.api.transcode.needsTranscoding(media.filePath)
        console.log('needsTranscode:', needsTranscode)

        if (cancelled) return

        if (!needsTranscode) {
          // Video is browser-compatible, no transcoding needed
          console.log('Video is browser-compatible, no transcoding needed')
          setTranscodeState('idle')
          return
        }

        // Check if we have a cached transcoded version
        const cachedPath = await window.api.transcode.getCached(studyId, media.filePath)
        console.log('cachedPath:', cachedPath)

        if (cancelled) return

        if (cachedPath) {
          // Use cached transcoded file
          const url = `local-file://get?path=${encodeURIComponent(cachedPath)}`
          console.log('Using cached transcoded file, URL:', url)
          setTranscodedUrl(url)
          setTranscodeState('ready')
          return
        }

        // Need to transcode - set up progress listener
        console.log('Starting transcoding...')
        setTranscodeState('transcoding')
        setTranscodeProgress(0)

        unsubscribeProgress = window.api.transcode.onProgress(({ filePath, progress }) => {
          if (filePath === media.filePath) {
            setTranscodeProgress(progress)
          }
        })

        // Start transcoding
        const result = await window.api.transcode.start(studyId, media.filePath)
        console.log('Transcoding result:', result)

        if (cancelled) return

        if (result.success) {
          const url = `local-file://get?path=${encodeURIComponent(result.path)}`
          console.log('Transcoding succeeded, URL:', url)
          setTranscodedUrl(url)
          setTranscodeState('ready')
        } else {
          console.error('Transcoding failed:', result.error)
          setTranscodeError(result.error || 'Transcoding failed')
          setTranscodeState('error')
        }
      } catch (err) {
        console.error('Transcoding exception:', err)
        if (!cancelled) {
          setTranscodeError(err.message || 'Transcoding failed')
          setTranscodeState('error')
        }
      }
    }

    handleTranscoding()

    // Cleanup - cancel transcode if modal closes or media changes
    return () => {
      cancelled = true
      if (unsubscribeProgress) {
        unsubscribeProgress()
      }
      // Cancel any active transcode for this file
      if (media?.filePath) {
        window.api.transcode.cancel(media.filePath)
      }
    }
  }, [isOpen, media, isVideoMedia, studyId])

  // For videos, include observations without bbox geometry
  const isVideo = isVideoMedia(media)

  // Fetch observations - first try with bbox coordinates, then include those without
  const { data: bboxes = [] } = useQuery({
    queryKey: ['mediaBboxes', studyId, media?.mediaID, isVideo],
    queryFn: async () => {
      // For videos, always include observations without bbox
      if (isVideo) {
        const response = await window.api.getMediaBboxes(studyId, media.mediaID, true)
        return response.data || []
      }
      // For images, first try to get bboxes with coordinates
      const response = await window.api.getMediaBboxes(studyId, media.mediaID, false)
      if (response.data && response.data.length > 0) {
        return response.data
      }
      // If no bboxes with coordinates, try to get observations without bbox (for class editing)
      const responseWithoutBbox = await window.api.getMediaBboxes(studyId, media.mediaID, true)
      return responseWithoutBbox.data || []
    },
    enabled: isOpen && !!media?.mediaID && !!studyId
  })

  // Fetch per-frame video detections (empty for images or videos without classification)
  const { data: videoFrameDetections = [] } = useQuery({
    queryKey: ['videoFrameDetections', studyId, media?.mediaID],
    queryFn: async () => {
      const response = await window.api.getVideoFrameDetections(studyId, media.mediaID)
      return response.data || []
    },
    enabled: isOpen && isVideo && !!media?.mediaID && !!studyId,
    staleTime: Infinity
  })

  const videoFps = media?.exifData?.fps || 1
  const currentFrameNumber = Math.floor(videoCurrentTime * videoFps)
  const currentFrameBboxes = useMemo(
    () => videoFrameDetections.filter((d) => d.frameNumber === currentFrameNumber),
    [videoFrameDetections, currentFrameNumber]
  )

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

      // Invalidate relevant queries. Timestamp edits shift which week / hour
      // a media falls into and can reshape sequence grouping, so every
      // sequence-aware cache needs to refresh alongside the raw media data.
      queryClient.invalidateQueries({ queryKey: ['media'] })
      queryClient.invalidateQueries({ queryKey: ['mediaBboxes', studyId, media.mediaID] })
      queryClient.invalidateQueries({ queryKey: ['sequences', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareSpeciesDistribution', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareTimeseries', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareDailyActivity', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareHeatmap', studyId] })
      queryClient.invalidateQueries({ queryKey: ['blankMediaCount', studyId] })
      queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })

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
    mutationFn: async ({
      observationID,
      scientificName,
      commonName,
      observationType,
      sex,
      lifeStage,
      behavior
    }) => {
      // Only include fields that are explicitly provided (not undefined)
      // This prevents overwriting existing values with null
      const updates = {}
      if (scientificName !== undefined) updates.scientificName = scientificName
      if (commonName !== undefined) updates.commonName = commonName
      if (observationType !== undefined) updates.observationType = observationType
      if (sex !== undefined) updates.sex = sex
      if (lifeStage !== undefined) updates.lifeStage = lifeStage
      if (behavior !== undefined) updates.behavior = behavior

      const response = await window.api.updateObservationClassification(
        studyId,
        observationID,
        updates
      )
      if (response.error) {
        throw new Error(response.error)
      }
      return response.data
    },
    onSuccess: () => {
      // Invalidate related queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['mediaBboxes', studyId, media?.mediaID] })
      queryClient.invalidateQueries({ queryKey: ['distinctSpecies', studyId] })
      queryClient.invalidateQueries({ queryKey: ['thumbnailBboxesBatch'] })
      queryClient.invalidateQueries({ queryKey: ['sequences', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareSpeciesDistribution', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareTimeseries', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareDailyActivity', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareHeatmap', studyId] })
      queryClient.invalidateQueries({ queryKey: ['blankMediaCount', studyId] })
      queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })
    }
  })

  // Mutation for toggling media favorite status
  const favoriteMutation = useMutation({
    mutationFn: async ({ mediaID, favorite }) => {
      const response = await window.api.setMediaFavorite(studyId, mediaID, favorite)
      if (response.error) {
        throw new Error(response.error)
      }
      return response
    },
    onMutate: async ({ favorite }) => {
      // Optimistic update
      setIsFavorite(favorite)
    },
    onError: () => {
      // Rollback on error
      setIsFavorite(!isFavorite)
    },
    onSettled: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })
      queryClient.invalidateQueries({ queryKey: ['media'] })
    }
  })

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
      // Bbox geometry feeds the best-media composite score (area / visibility / padding)
      queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })
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
      if (selectedObservationId === observationID) {
        setSelectedObservationId(null)
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
      queryClient.invalidateQueries({ queryKey: ['distinctSpecies', studyId] })
      queryClient.invalidateQueries({ queryKey: ['thumbnailBboxesBatch'] })
      queryClient.invalidateQueries({ queryKey: ['sequences', studyId] })
      // Deleting an observation changes species counts, timeseries, and can make
      // the underlying media become "blank" (no remaining observations).
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareSpeciesDistribution', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareTimeseries', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareDailyActivity', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareHeatmap', studyId] })
      queryClient.invalidateQueries({ queryKey: ['blankMediaCount', studyId] })
      queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })
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
      queryClient.invalidateQueries({ queryKey: ['thumbnailBboxesBatch'] })
      queryClient.invalidateQueries({ queryKey: ['sequences', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareSpeciesDistribution', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareTimeseries', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareDailyActivity', studyId] })
      queryClient.invalidateQueries({ queryKey: ['sequenceAwareHeatmap', studyId] })
      queryClient.invalidateQueries({ queryKey: ['blankMediaCount', studyId] })
      queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })
      // Exit draw mode and select the new observation
      setIsDrawMode(false)
      setSelectedObservationId(data.observationID)
    }
  })

  // Get default species from existing bboxes (most confident)
  const getDefaultSpecies = useCallback(() => {
    if (!bboxes || bboxes.length === 0) return { scientificName: null, commonName: null }

    // Find observation with highest classificationProbability
    const withProbability = bboxes.filter((b) => b.classificationProbability != null)
    if (withProbability.length === 0) {
      // No classification probability scores - use first with a species name
      const withSpecies = bboxes.find((b) => b.scientificName)
      return {
        scientificName: withSpecies?.scientificName || null,
        commonName: withSpecies?.commonName || null
      }
    }

    const mostConfident = withProbability.reduce((best, b) =>
      b.classificationProbability > best.classificationProbability ? b : best
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

  // Handle "Add observation → Whole image" from the rail. Creates an observation
  // with no bbox geometry; createMutation.onSuccess auto-selects it.
  const handleAddWholeImage = useCallback(() => {
    if (!media) return
    createMutation.mutate({
      mediaID: media.mediaID,
      deploymentID: media.deploymentID,
      timestamp: media.timestamp,
      scientificName: null,
      commonName: null,
      bboxX: null,
      bboxY: null,
      bboxWidth: null,
      bboxHeight: null
    })
  }, [media, createMutation])

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

      // Cycle bboxes with Tab/Shift+Tab — works regardless of focus, so a focused
      // species-picker input still hands Tab to the modal instead of walking
      // through the row's other buttons.
      if (e.key === 'Tab') {
        const visibleBboxes = bboxes.filter((b) => b.bboxX !== null && b.bboxX !== undefined)
        if (visibleBboxes.length > 0) {
          e.preventDefault()

          const currentIndex = visibleBboxes.findIndex(
            (b) => b.observationID === selectedObservationId
          )

          let nextIndex
          if (e.shiftKey) {
            nextIndex = currentIndex <= 0 ? visibleBboxes.length - 1 : currentIndex - 1
          } else {
            nextIndex = currentIndex >= visibleBboxes.length - 1 ? 0 : currentIndex + 1
          }

          setSelectedObservationId(visibleBboxes[nextIndex].observationID)
        }
        return
      }

      // When focus is in an input/textarea (species search, timestamp, etc.),
      // let the element handle keys natively — don't run modal-level shortcuts.
      const activeTag = document.activeElement?.tagName
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return

      // Escape closes the modal
      if (e.key === 'Escape') {
        onClose()
        return
      }

      // Delete/Backspace removes the selected observation
      if (selectedObservationId && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        handleDeleteObservation(selectedObservationId)
        return
      }

      if (e.key === 'ArrowLeft') {
        setIsDrawMode(false)
        // Ctrl+← jumps to the previous sequence directly, skipping within-sequence steps.
        if ((e.ctrlKey || e.metaKey) && hasPrevious) {
          onPrevious()
        } else if (hasPreviousInSequence) {
          onSequencePrevious()
        } else if (hasPrevious) {
          onPrevious()
        }
      } else if (e.key === 'ArrowRight') {
        setIsDrawMode(false)
        // Ctrl+→ jumps to the next sequence directly, skipping within-sequence steps.
        if ((e.ctrlKey || e.metaKey) && hasNext) {
          onNext()
        } else if (hasNextInSequence) {
          onSequenceNext()
        } else if (hasNext) {
          onNext()
        }
      } else if (e.key === 'Escape') {
        // If zoomed, reset zoom first; otherwise close modal
        if (isZoomed) {
          resetZoom()
        } else {
          onClose()
        }
      } else if (e.key === 'b' || e.key === 'B') {
        setShowBboxes((prev) => !prev)
      } else if (e.key === '?') {
        setShowShortcuts((prev) => !prev)
      } else if (e.key === '+' || e.key === '=') {
        // Zoom in
        e.preventDefault()
        zoomIn()
      } else if (e.key === '-' || e.key === '_') {
        // Zoom out
        e.preventDefault()
        zoomOut()
      } else if (e.key === '0') {
        // Reset zoom
        e.preventDefault()
        resetZoom()
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
    hasNextInSequence,
    hasPreviousInSequence,
    onSequenceNext,
    onSequencePrevious,
    isEditingTimestamp,
    showDatePicker,
    selectedObservationId,
    isDrawMode,
    handleDeleteObservation,
    isZoomed,
    resetZoom,
    zoomIn,
    zoomOut,
    bboxes
  ])

  // Reset selection, draw mode, zoom, and image ready state when changing images
  useEffect(() => {
    setSelectedObservationId(null)
    setIsDrawMode(false)
    setIsCurrentImageReady(false)
    resetZoom()
  }, [media?.mediaID, resetZoom])

  if (!isOpen || !media) return null

  // Check if there are actual bboxes with coordinates (not just observations without bbox)
  const bboxesWithCoords = bboxes.filter((b) => b.bboxX !== null && b.bboxX !== undefined)
  const hasBboxes = bboxesWithCoords.length > 0 || videoFrameDetections.length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={() => {
        if (selectedObservationId) {
          setSelectedObservationId(null)
        } else {
          onClose()
        }
      }}
    >
      <div className="relative max-w-7xl w-full h-full flex items-center justify-center">
        <div
          className="bg-white rounded-lg overflow-hidden shadow-2xl max-h-[90vh] flex flex-col max-w-full"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top toolbar - nav + sequence + timestamp on the left, actions on the right */}
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-200 bg-white">
            <div className="flex items-center gap-2 min-w-0 flex-1 text-xs text-gray-500">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (hasPreviousInSequence) onSequencePrevious()
                  else if (hasPrevious) onPrevious()
                }}
                disabled={
                  isEditingTimestamp ||
                  showDatePicker ||
                  isDrawMode ||
                  (!hasPreviousInSequence && !hasPrevious)
                }
                className="w-8 h-8 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                aria-label="Previous image"
                title="Previous (←)"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (hasNextInSequence) onSequenceNext()
                  else if (hasNext) onNext()
                }}
                disabled={
                  isEditingTimestamp ||
                  showDatePicker ||
                  isDrawMode ||
                  (!hasNextInSequence && !hasNext)
                }
                className="w-8 h-8 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                aria-label="Next image"
                title="Next (→)"
              >
                <ChevronRight size={18} />
              </button>
              {sequence && sequence.items.length > 1 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 font-medium text-[11px] flex-shrink-0">
                  <Layers size={11} />
                  {sequenceIndex + 1} / {sequence.items.length}
                </span>
              )}
              <div className="relative flex items-center gap-1.5 group min-w-0">
                {isEditingTimestamp ? (
                  <>
                    <input
                      type="text"
                      value={inlineTimestamp}
                      onChange={(e) => setInlineTimestamp(e.target.value)}
                      onKeyDown={handleInlineKeyDown}
                      className="text-xs text-gray-700 border border-gray-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[180px]"
                      autoFocus
                      disabled={isSaving}
                      placeholder="Enter date/time..."
                    />
                    <button
                      onClick={handleInlineSave}
                      disabled={isSaving}
                      className="text-blue-600 hover:text-blue-700 disabled:opacity-50 p-0.5"
                      title="Save (Enter)"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={handleInlineCancel}
                      disabled={isSaving}
                      className="text-gray-400 hover:text-gray-600 disabled:opacity-50 p-0.5"
                      title="Cancel (Escape)"
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      className="cursor-pointer hover:text-gray-900 hover:underline truncate"
                      onClick={handleInlineEdit}
                      title="Click to edit timestamp"
                    >
                      {media.timestamp
                        ? new Date(media.timestamp).toLocaleString()
                        : 'No timestamp'}
                    </span>
                    <button
                      onClick={handleInlineEdit}
                      className="text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 flex-shrink-0"
                      title="Edit timestamp inline"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={() => setShowDatePicker(true)}
                      className="text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 flex-shrink-0"
                      title="Open date picker"
                    >
                      <Calendar size={11} />
                    </button>
                  </>
                )}
                {showDatePicker && (
                  <div className="absolute left-0 top-full mt-2 z-50">
                    <DateTimePicker
                      value={media.timestamp}
                      onChange={handleTimestampSave}
                      onCancel={() => setShowDatePicker(false)}
                    />
                  </div>
                )}
              </div>
              {error && <span className="text-[11px] text-red-500">{error}</span>}
              {isSaving && (
                <span className="text-[11px] text-gray-400 animate-pulse">Saving...</span>
              )}
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  favoriteMutation.mutate({ mediaID: media.mediaID, favorite: !isFavorite })
                }}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                  isFavorite
                    ? 'text-red-600 bg-red-50 hover:bg-red-100'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Heart size={18} fill={isFavorite ? 'currentColor' : 'none'} />
              </button>

              {hasBboxes && <div className="w-px h-5 bg-gray-200 mx-1" />}

              {hasBboxes && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowBboxes((prev) => !prev)
                  }}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                    showBboxes
                      ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                  aria-label={showBboxes ? 'Hide bounding boxes' : 'Show bounding boxes'}
                  title={`${showBboxes ? 'Hide' : 'Show'} bounding boxes (B)`}
                >
                  {showBboxes ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowShortcuts((v) => !v)
                }}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                  showShortcuts
                    ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
                aria-label="Toggle keyboard shortcuts"
                aria-pressed={showShortcuts}
                title="Keyboard shortcuts"
              >
                <Info size={18} />
              </button>

              <div className="w-px h-5 bg-gray-200 mx-1" />

              <button
                onClick={onClose}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
                aria-label="Close modal"
                title="Close (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div
              ref={(el) => {
                imageContainerRef.current = el
                zoomContainerRef.current = el
              }}
              className="flex-1 min-w-0 flex items-center justify-center bg-black overflow-hidden relative"
              onClick={(e) => {
                // Deselect when clicking on the empty image area, not on a bbox/handle/button.
                if (!isDrawMode && e.target.tagName !== 'rect' && !e.target.closest('button')) {
                  setSelectedObservationId(null)
                }
              }}
              onWheel={!isVideoMedia(media) ? handleZoomWheel : undefined}
              onMouseDown={(e) => {
                // Only start pan if zoomed, not in draw mode, not clicking on a bbox
                if (
                  isZoomed &&
                  !isDrawMode &&
                  !selectedObservationId &&
                  e.target.tagName !== 'rect' &&
                  !e.target.closest('button')
                ) {
                  handlePanStart(e)
                }
              }}
              style={{
                cursor: isZoomed && !isDrawMode && !selectedObservationId ? 'grab' : undefined
              }}
            >
              {isVideoMedia(media) ? (
                // Transcoding states
                transcodeState === 'checking' ? (
                  <div className="flex flex-col items-center justify-center p-8 text-gray-500 min-h-[300px]">
                    <Loader2 size={48} className="animate-spin text-blue-500" />
                    <span className="mt-4 text-lg font-medium">Checking video format...</span>
                  </div>
                ) : transcodeState === 'transcoding' ? (
                  <div className="flex flex-col items-center justify-center p-8 text-gray-500 min-h-[300px]">
                    <div className="relative">
                      <Loader2 size={64} className="animate-spin text-blue-500" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-bold text-blue-600">
                          {transcodeProgress}%
                        </span>
                      </div>
                    </div>
                    <span className="mt-4 text-lg font-medium">Converting video...</span>
                    <span className="mt-2 text-sm text-gray-400">
                      This format requires conversion for browser playback
                    </span>
                    {/* Progress bar */}
                    <div className="mt-4 w-64 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${transcodeProgress}%` }}
                      />
                    </div>
                    <span className="mt-2 text-xs text-gray-400">{media.fileName}</span>
                  </div>
                ) : transcodeState === 'error' ? (
                  <div className="flex flex-col items-center justify-center p-8 text-gray-500 min-h-[300px]">
                    <Play size={64} className="text-red-400" />
                    <span className="mt-4 text-lg font-medium text-red-500">Conversion failed</span>
                    <span className="mt-2 text-sm text-gray-400">{transcodeError}</span>
                    <span className="mt-1 text-xs text-gray-400">{media.fileName}</span>
                  </div>
                ) : videoError && transcodeState !== 'ready' ? (
                  <div className="flex flex-col items-center justify-center p-8 text-gray-500 min-h-[300px]">
                    <Play size={64} />
                    <span className="mt-4 text-lg font-medium">Video</span>
                    <span className="mt-2 text-sm text-gray-400">
                      Format not supported by browser
                    </span>
                    <span className="mt-1 text-xs text-gray-400">{media.fileName}</span>
                  </div>
                ) : (
                  <div ref={videoContainerRef} className="relative">
                    <video
                      ref={videoRef}
                      key={transcodedUrl || media.filePath} // Force new element when source changes
                      src={(() => {
                        const videoSrc = transcodedUrl || constructImageUrl(media.filePath)
                        console.log('=== VIDEO ELEMENT ===')
                        console.log('transcodeState:', transcodeState)
                        console.log('transcodedUrl:', transcodedUrl)
                        console.log('media.filePath:', media.filePath)
                        console.log('Final video src:', videoSrc)
                        return videoSrc
                      })()}
                      className="max-w-full max-h-[calc(90vh-152px)] w-auto h-auto object-contain"
                      controls
                      autoPlay
                      onLoadStart={(e) => {
                        console.log('Video onLoadStart:', e.target.src)
                      }}
                      onLoadedData={(e) => {
                        console.log(
                          'Video onLoadedData:',
                          e.target.src,
                          'duration:',
                          e.target.duration
                        )
                      }}
                      onCanPlay={(e) => {
                        console.log('Video onCanPlay:', e.target.src)
                      }}
                      onTimeUpdate={(e) => {
                        const now = performance.now()
                        if (now - lastVideoTimeUpdateRef.current < 250) return
                        lastVideoTimeUpdateRef.current = now
                        setVideoCurrentTime(e.target.currentTime)
                      }}
                      onSeeked={(e) => {
                        // Force an immediate update after seeking so boxes jump with the scrubber.
                        lastVideoTimeUpdateRef.current = 0
                        setVideoCurrentTime(e.target.currentTime)
                      }}
                      onError={(e) => {
                        console.error('Video onError:', e.target.src)
                        console.error('Video error details:', e.target.error)
                        // Only set videoError if we're not in a transcoding state
                        // (to avoid showing error during transcoding)
                        if (transcodeState === 'idle' || transcodeState === 'ready') {
                          setVideoError(true)
                        }
                      }}
                    />
                    <VideoBboxOverlay
                      videoRef={videoRef}
                      containerRef={videoContainerRef}
                      currentFrameBboxes={currentFrameBboxes}
                      visible={showBboxes}
                    />
                  </div>
                )
              ) : imageError ? (
                <div className="flex flex-col items-center justify-center bg-gray-800 text-gray-400 aspect-[4/3] min-w-[70vw] max-h-[calc(90vh-152px)]">
                  <CameraOff size={128} />
                  <span className="mt-4 text-lg font-medium">Image not available</span>
                  <span className="mt-2 text-sm">{media.fileName}</span>
                </div>
              ) : (
                <>
                  {/* Zoomable container - wraps image and all overlays */}
                  <div
                    className="relative"
                    style={{
                      transform: getTransformStyle(),
                      transformOrigin: 'center center',
                      transition: 'transform 0.1s ease-out'
                    }}
                  >
                    <img
                      ref={imageRef}
                      src={constructImageUrl(media.filePath)}
                      alt={media.fileName || `Media ${media.mediaID}`}
                      className="max-w-full max-h-[calc(90vh-152px)] w-auto h-auto object-contain"
                      onLoad={() => setIsCurrentImageReady(true)}
                      onError={() => setImageError(true)}
                      draggable={false}
                    />
                    {/* Loading overlay - show spinner while image is loading */}
                    {!isCurrentImageReady && !imageError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gray-900/30 z-10 pointer-events-none">
                        <Loader2 size={32} className="animate-spin text-white/70" />
                      </div>
                    )}
                    {/* Empty-state hint - shown when image has no detections */}
                    {!hasBboxes &&
                      isCurrentImageReady &&
                      !imageError &&
                      !isDrawMode &&
                      !isVideoMedia(media) && (
                        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/35 backdrop-blur-sm text-white/70 text-[11px] font-medium">
                          <SquarePlus size={12} />
                          No detections
                        </div>
                      )}
                    {/* Bbox overlay - editable bounding boxes (only for images, only after image loads) */}
                    {showBboxes && hasBboxes && isCurrentImageReady && (
                      <>
                        <svg
                          className="absolute inset-0 w-full h-full"
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%'
                          }}
                        >
                          {bboxes.map((bbox) => (
                            <EditableBbox
                              key={bbox.observationID}
                              bbox={bbox}
                              isSelected={bbox.observationID === selectedObservationId}
                              onSelect={() => {
                                setSelectedObservationId(
                                  bbox.observationID === selectedObservationId
                                    ? null
                                    : bbox.observationID
                                )
                              }}
                              onUpdate={(newBbox) => handleBboxUpdate(bbox.observationID, newBbox)}
                              imageRef={imageRef}
                              containerRef={imageContainerRef}
                              zoomTransform={zoomTransform}
                              isValidated={bbox.classificationMethod === 'human'}
                            />
                          ))}
                        </svg>

                        {/* Clickable bbox labels - clicking label opens observation editor */}
                        <div className="absolute inset-0 w-full h-full pointer-events-none">
                          {bboxes.map((bbox) => (
                            <BboxLabelMinimal
                              key={bbox.observationID}
                              ref={(el) => {
                                bboxLabelRefs.current[bbox.observationID] = el
                              }}
                              bbox={bbox}
                              isSelected={bbox.observationID === selectedObservationId}
                              isValidated={bbox.classificationMethod === 'human'}
                              onClick={() => setSelectedObservationId(bbox.observationID)}
                            />
                          ))}
                        </div>
                      </>
                    )}

                    {/* Drawing overlay - only show when in draw mode (images only) */}
                    {isDrawMode && (
                      <DrawingOverlay
                        imageRef={imageRef}
                        containerRef={imageContainerRef}
                        onComplete={handleDrawComplete}
                        zoomTransform={zoomTransform}
                      />
                    )}
                  </div>

                  {/* Zoom controls - positioned at top center, outside the transformed container */}
                  {!isDrawMode && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-black/70 rounded-full px-3 py-1.5 shadow-lg">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          zoomOut()
                        }}
                        className="p-1 text-white hover:text-blue-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={zoomTransform.scale <= 1}
                        title="Zoom out (-)"
                      >
                        <ZoomOut size={18} />
                      </button>
                      <span className="text-white text-sm font-medium min-w-[3rem] text-center">
                        {Math.round(zoomTransform.scale * 100)}%
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          zoomIn()
                        }}
                        className="p-1 text-white hover:text-blue-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={zoomTransform.scale >= 5}
                        title="Zoom in (+)"
                      >
                        <ZoomIn size={18} />
                      </button>
                      {isZoomed && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            resetZoom()
                          }}
                          className="p-1 text-white hover:text-blue-300 transition-colors ml-1"
                          title="Reset zoom (0 or Esc)"
                        >
                          <RotateCcw size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <ObservationRail
              observations={bboxes}
              studyId={studyId}
              selectedObservationId={selectedObservationId}
              onSelectObservation={setSelectedObservationId}
              onUpdateClassification={(observationID, updates) =>
                updateMutation.mutate({ observationID, ...updates })
              }
              onDeleteObservation={handleDeleteObservation}
              onDrawRectangle={() => {
                setIsDrawMode(true)
                setShowBboxes(true)
              }}
              onAddWholeImage={handleAddWholeImage}
              showShortcuts={showShortcuts}
            />
          </div>

          {/* Footer - filename only; observation editing lives in the rail */}
          <div className="px-4 py-2.5 bg-gray-50 flex-shrink-0 border-t border-gray-200 text-xs text-gray-600">
            <div className="flex items-center gap-3">
              {media.fileName && (
                <span className="font-mono text-[11px] text-gray-400 truncate min-w-0 flex-1">
                  {media.fileName}
                </span>
              )}
            </div>

            {updateMutation.isPending && (
              <p className="text-[11px] text-blue-500 mt-1">Updating classification...</p>
            )}
            {updateMutation.isError && (
              <p className="text-[11px] text-red-500 mt-1">
                Error: {updateMutation.error?.message || 'Failed to update'}
              </p>
            )}
          </div>
        </div>
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
 * Collapsible control bar for gallery view options
 */
function GalleryControls({
  showBboxes,
  onToggleBboxes,
  hasBboxes,
  sequenceGap,
  onSequenceGapChange,
  isExpanded,
  onToggleExpanded
}) {
  // Collapsed state: tiny chevron on the right
  if (!isExpanded) {
    return (
      <div className="flex items-center justify-end px-3 py-1 border-b border-gray-200 flex-shrink-0">
        <button
          onClick={onToggleExpanded}
          className="p-1 text-gray-300 hover:text-gray-400 hover:bg-gray-100 rounded transition-colors"
          title="Show gallery controls"
        >
          <ChevronDown size={14} />
        </button>
      </div>
    )
  }

  // Expanded state: full controls with chevron-up on the right
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 flex-shrink-0">
      {/* Sequence Gap Slider */}
      <SequenceGapSlider value={sequenceGap} onChange={onSequenceGapChange} variant="compact" />

      <div className="flex items-center gap-2">
        {/* Show Bboxes Toggle - only render if bboxes exist */}
        {hasBboxes && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                onClick={onToggleBboxes}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  showBboxes
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {showBboxes ? <Eye size={16} /> : <EyeOff size={16} />}
                <span>Boxes</span>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                sideOffset={8}
                align="end"
                className="z-[10000] max-w-xs px-3 py-2 bg-gray-900 text-white text-xs rounded-md shadow-lg"
              >
                <p className="font-medium mb-1">Bounding Boxes</p>
                <p className="text-gray-300">
                  Show detection boxes on thumbnails highlighting where animals were identified by
                  the AI model.
                </p>
                <Tooltip.Arrow className="fill-gray-900" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )}

        {/* Collapse toggle - chevron-up on the right */}
        <button
          onClick={onToggleExpanded}
          className="p-1 text-gray-300 hover:text-gray-400 hover:bg-gray-100 rounded transition-colors"
          title="Hide gallery controls"
        >
          <ChevronUp size={14} />
        </button>
      </div>
    </div>
  )
}

/**
 * SVG overlay showing bboxes on a thumbnail
 * Handles letterboxing by calculating actual image bounds within the container.
 * Receives bbox data and refs as props from parent.
 */
function ThumbnailBboxOverlay({ bboxes, imageRef, containerRef }) {
  const [imageBounds, setImageBounds] = useState(null)

  useEffect(() => {
    const updateBounds = () => {
      if (imageRef?.current && containerRef?.current) {
        setImageBounds(getImageBounds(imageRef.current, containerRef.current))
      }
    }

    updateBounds()

    // Update on resize
    const resizeObserver = new ResizeObserver(updateBounds)
    if (containerRef?.current) {
      resizeObserver.observe(containerRef.current)
    }

    // Update when image loads
    const img = imageRef?.current
    if (img) {
      img.addEventListener('load', updateBounds)
    }

    return () => {
      resizeObserver.disconnect()
      if (img) {
        img.removeEventListener('load', updateBounds)
      }
    }
  }, [imageRef, containerRef])

  // Drop class-only observations (no bbox coordinates); getMediaBboxesBatch
  // returns them for species-label lookup but they have no geometry to draw.
  const drawableBboxes = bboxes?.filter((b) => b.bboxX != null) ?? []
  if (!drawableBboxes.length || !imageBounds) return null

  const { offsetX, offsetY, renderedWidth, renderedHeight } = imageBounds

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
      {drawableBboxes.map((bbox, index) => {
        const isValidated = bbox.classificationMethod === 'human'
        return (
          <rect
            key={bbox.observationID || index}
            x={offsetX + bbox.bboxX * renderedWidth}
            y={offsetY + bbox.bboxY * renderedHeight}
            width={bbox.bboxWidth * renderedWidth}
            height={bbox.bboxHeight * renderedHeight}
            stroke={isValidated ? '#2563eb' : '#60a5fa'}
            strokeWidth="2"
            strokeDasharray={isValidated ? undefined : '4 3'}
            fill="none"
          />
        )
      })}
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
  itemWidth,
  isVideoMedia,
  studyId
}) {
  const isVideo = isVideoMedia(media)
  const [thumbnailUrl, setThumbnailUrl] = useState(null)
  const [isExtractingThumbnail, setIsExtractingThumbnail] = useState(false)
  const [isImageLoading, setIsImageLoading] = useState(true)
  const imageRef = useRef(null)
  const containerRef = useRef(null)

  // Extract thumbnail for videos that need transcoding
  useEffect(() => {
    if (!isVideo || !media?.filePath || !studyId) return

    let cancelled = false

    const extractThumbnail = async () => {
      try {
        // Check if video needs transcoding (unsupported format)
        const needsTranscode = await window.api.transcode.needsTranscoding(media.filePath)
        if (!needsTranscode || cancelled) return

        // Check for cached thumbnail first
        const cached = await window.api.thumbnail.getCached(studyId, media.filePath)
        if (cached && !cancelled) {
          setThumbnailUrl(constructImageUrl(cached))
          return
        }

        // Extract thumbnail
        setIsExtractingThumbnail(true)
        const result = await window.api.thumbnail.extract(studyId, media.filePath)
        if (result.success && !cancelled) {
          setThumbnailUrl(constructImageUrl(result.path))
        }
      } catch (error) {
        console.error('Failed to extract thumbnail:', error)
      } finally {
        if (!cancelled) {
          setIsExtractingThumbnail(false)
        }
      }
    }

    extractThumbnail()

    return () => {
      cancelled = true
    }
  }, [isVideo, media?.filePath, media?.mediaID, constructImageUrl, studyId])

  return (
    <div
      className="border border-gray-300 rounded-lg overflow-hidden flex flex-col transition-all"
      style={{ width: itemWidth ? `${itemWidth}px` : undefined }}
    >
      <div
        ref={containerRef}
        className="relative bg-black flex items-center justify-center cursor-pointer hover:bg-gray-900 transition-colors overflow-hidden aspect-[4/3]"
        onClick={() => onImageClick(media)}
      >
        {isVideo ? (
          <>
            {/* Video placeholder background - always visible */}
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 text-gray-400">
              {isExtractingThumbnail ? (
                <>
                  <Loader2 size={32} className="animate-spin" />
                  <span className="text-xs mt-1">Loading...</span>
                </>
              ) : (
                <>
                  <Play size={32} />
                  <span className="text-xs mt-1">Video</span>
                </>
              )}
            </div>
            {/* Show extracted thumbnail for unsupported formats */}
            {thumbnailUrl ? (
              <img
                ref={imageRef}
                src={thumbnailUrl}
                alt={media.fileName || `Video ${media.mediaID}`}
                className="relative z-10 w-full h-full object-contain"
                loading="lazy"
              />
            ) : (
              /* Video element - overlays placeholder when it loads successfully */
              <video
                ref={imageRef}
                src={constructImageUrl(media.filePath)}
                className={`relative z-10 w-full h-full object-contain ${imageErrors[media.mediaID] ? 'hidden' : ''}`}
                onError={() => setImageErrors((prev) => ({ ...prev, [media.mediaID]: true }))}
                muted
                preload="metadata"
              />
            )}
            {/* Video indicator badge */}
            <div className="absolute bottom-2 right-2 z-20 bg-black/70 text-white px-1.5 py-0.5 rounded text-xs flex items-center gap-1">
              <Play size={12} />
            </div>
          </>
        ) : (
          <>
            {/* Loading placeholder for images */}
            {isImageLoading && !imageErrors[media.mediaID] && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-gray-400 z-0">
                <Loader2 size={32} className="animate-spin" />
              </div>
            )}
            <img
              ref={imageRef}
              src={constructImageUrl(media.filePath)}
              alt={media.fileName || `Media ${media.mediaID}`}
              data-image={media.filePath}
              className={`w-full h-full object-contain ${imageErrors[media.mediaID] ? 'hidden' : ''} ${isImageLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-200`}
              onLoad={() => setIsImageLoading(false)}
              onError={() => {
                setImageErrors((prev) => ({ ...prev, [media.mediaID]: true }))
                setIsImageLoading(false)
              }}
              loading="lazy"
            />
          </>
        )}

        {/* Bbox overlay - only for images */}
        {showBboxes && !isVideo && (
          <ThumbnailBboxOverlay bboxes={bboxes} imageRef={imageRef} containerRef={containerRef} />
        )}

        {/* Image error fallback - only for non-video */}
        {!isVideo && imageErrors[media.mediaID] && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 text-gray-400"
            title="Image not available"
          >
            <CameraOff size={32} />
          </div>
        )}
      </div>

      <div className="p-2">
        <h3 className="text-sm font-semibold truncate">
          <SpeciesLabel names={getSpeciesListFromBboxes(bboxes, media.scientificName)} />
        </h3>
        <p className="text-xs text-gray-500">
          {media.timestamp ? new Date(media.timestamp).toLocaleString() : 'No timestamp'}
        </p>
      </div>
    </div>
  )
}

/**
 * Thumbnail card for a sequence of related media files.
 * Auto-cycles through images with configurable interval.
 */
function SequenceCard({
  sequence,
  constructImageUrl,
  onSequenceClick,
  imageErrors,
  setImageErrors,
  showBboxes,
  bboxesByMedia,
  itemWidth,
  cycleInterval = 1000,
  isVideoMedia,
  studyId
}) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isHovering, setIsHovering] = useState(false)
  const [videoThumbnails, setVideoThumbnails] = useState({}) // Map of mediaID -> thumbnailUrl
  const [extractingThumbnails, setExtractingThumbnails] = useState({})
  const [loadedImages, setLoadedImages] = useState({}) // Map of mediaID -> loaded status
  const imageRef = useRef(null)
  const containerRef = useRef(null)

  const itemCount = sequence.items.length
  // Guard against currentIndex being out of bounds (can happen when sequence changes)
  const safeIndex = Math.min(currentIndex, itemCount - 1)
  const currentMedia = sequence.items[safeIndex]
  const isVideo = isVideoMedia(currentMedia)

  // Extract thumbnails for videos that need transcoding
  useEffect(() => {
    if (!studyId) return

    let cancelled = false

    const extractThumbnails = async () => {
      for (const media of sequence.items) {
        if (!isVideoMedia(media) || cancelled) continue

        try {
          const needsTranscode = await window.api.transcode.needsTranscoding(media.filePath)
          if (!needsTranscode || cancelled) continue

          // Check for cached thumbnail first
          const cached = await window.api.thumbnail.getCached(studyId, media.filePath)
          if (cached && !cancelled) {
            setVideoThumbnails((prev) => ({ ...prev, [media.mediaID]: constructImageUrl(cached) }))
            continue
          }

          // Extract thumbnail
          setExtractingThumbnails((prev) => ({ ...prev, [media.mediaID]: true }))
          const result = await window.api.thumbnail.extract(studyId, media.filePath)
          if (result.success && !cancelled) {
            setVideoThumbnails((prev) => ({
              ...prev,
              [media.mediaID]: constructImageUrl(result.path)
            }))
          }
        } catch (error) {
          console.error('Failed to extract thumbnail for sequence item:', error)
        } finally {
          if (!cancelled) {
            setExtractingThumbnails((prev) => ({ ...prev, [media.mediaID]: false }))
          }
        }
      }
    }

    extractThumbnails()

    return () => {
      cancelled = true
    }
  }, [sequence.id, sequence.items, constructImageUrl, isVideoMedia, studyId])

  // Auto-cycle effect - only runs when hovering
  useEffect(() => {
    if (!isHovering || itemCount <= 1) return

    const intervalId = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % itemCount)
    }, cycleInterval)

    return () => clearInterval(intervalId)
  }, [itemCount, cycleInterval, isHovering])

  // Reset index when sequence changes
  useEffect(() => {
    setCurrentIndex(0)
  }, [sequence.id])

  // Preload next media for smooth transitions (only for images)
  useEffect(() => {
    if (!isHovering || itemCount <= 1) return
    const nextIndex = (safeIndex + 1) % itemCount
    const nextMedia = sequence.items[nextIndex]
    // Only preload if next item is an image
    if (!isVideoMedia(nextMedia)) {
      const img = new Image()
      img.src = constructImageUrl(nextMedia.filePath)
    }
  }, [safeIndex, sequence, constructImageUrl, itemCount, isVideoMedia, isHovering])

  const handleClick = () => {
    onSequenceClick(sequence.items[0], sequence)
  }

  const currentThumbnailUrl = videoThumbnails[currentMedia.mediaID]
  const isExtractingCurrentThumbnail = extractingThumbnails[currentMedia.mediaID]

  return (
    <div
      className="border border-gray-300 rounded-lg overflow-hidden flex flex-col transition-all relative group"
      style={{ width: itemWidth ? `${itemWidth}px` : undefined }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => {
        setIsHovering(false)
        setCurrentIndex(0)
      }}
    >
      {/* Sequence badge */}
      <div className="absolute top-2 right-2 z-20 bg-black/70 text-white px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1">
        <Layers size={12} />
        <span>{itemCount}</span>
      </div>

      {/* Stacked effect (visual indicator) */}
      <div className="absolute -top-1 -right-1 w-full h-full border border-gray-200 rounded-lg bg-gray-100 -z-10 transform translate-x-1 -translate-y-1" />

      {/* Media container */}
      <div
        ref={containerRef}
        className="relative bg-black flex items-center justify-center cursor-pointer hover:bg-gray-900 transition-colors overflow-hidden aspect-[4/3]"
        onClick={handleClick}
      >
        {isVideo ? (
          <>
            {/* Video placeholder background - always visible */}
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 text-gray-400">
              {isExtractingCurrentThumbnail ? (
                <>
                  <Loader2 size={32} className="animate-spin" />
                  <span className="text-xs mt-1">Loading...</span>
                </>
              ) : (
                <>
                  <Play size={32} />
                  <span className="text-xs mt-1">Video</span>
                </>
              )}
            </div>
            {/* Show extracted thumbnail for unsupported formats */}
            {currentThumbnailUrl ? (
              <img
                ref={imageRef}
                src={currentThumbnailUrl}
                alt={currentMedia.fileName || `Video ${currentMedia.mediaID}`}
                className="relative z-10 w-full h-full object-contain transition-opacity duration-300"
                loading="lazy"
              />
            ) : (
              /* Video element - overlays placeholder when it loads successfully */
              <video
                ref={imageRef}
                src={constructImageUrl(currentMedia.filePath)}
                className={`relative z-10 w-full h-full object-contain transition-opacity duration-300 ${imageErrors[currentMedia.mediaID] ? 'hidden' : ''}`}
                onError={() =>
                  setImageErrors((prev) => ({ ...prev, [currentMedia.mediaID]: true }))
                }
                muted
                preload="metadata"
              />
            )}
            {/* Video indicator badge */}
            <div className="absolute bottom-2 right-2 z-20 bg-black/70 text-white px-1.5 py-0.5 rounded text-xs flex items-center gap-1">
              <Play size={12} />
            </div>
          </>
        ) : (
          <>
            {/* Loading placeholder for images */}
            {!loadedImages[currentMedia.mediaID] && !imageErrors[currentMedia.mediaID] && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-gray-400 z-0">
                <Loader2 size={32} className="animate-spin" />
              </div>
            )}
            <img
              ref={imageRef}
              src={constructImageUrl(currentMedia.filePath)}
              alt={currentMedia.fileName || `Media ${currentMedia.mediaID}`}
              className={`w-full h-full object-contain transition-opacity duration-300 ${imageErrors[currentMedia.mediaID] ? 'hidden' : ''} ${!loadedImages[currentMedia.mediaID] ? 'opacity-0' : 'opacity-100'}`}
              onLoad={() => setLoadedImages((prev) => ({ ...prev, [currentMedia.mediaID]: true }))}
              onError={() => {
                setImageErrors((prev) => ({ ...prev, [currentMedia.mediaID]: true }))
                setLoadedImages((prev) => ({ ...prev, [currentMedia.mediaID]: true }))
              }}
              loading="lazy"
            />
          </>
        )}

        {/* Bbox overlay for current image - only for images */}
        {showBboxes && !isVideo && (
          <ThumbnailBboxOverlay
            bboxes={bboxesByMedia[currentMedia.mediaID] || []}
            imageRef={imageRef}
            containerRef={containerRef}
          />
        )}

        {/* Image error fallback - only for non-video */}
        {!isVideo && imageErrors[currentMedia.mediaID] && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 text-gray-400"
            title="Image not available"
          >
            <CameraOff size={32} />
          </div>
        )}

        {/* Progress indicator */}
        {itemCount > 1 && (
          <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex gap-1">
            {itemCount <= 8 ? (
              // Dots for small sequences
              sequence.items.map((_, idx) => (
                <div
                  key={idx}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    idx === currentIndex ? 'bg-blue-500' : 'bg-white/60'
                  }`}
                />
              ))
            ) : (
              // Counter text for large sequences
              <span className="text-xs font-medium text-white bg-black/50 px-1.5 py-0.5 rounded">
                {currentIndex + 1}/{itemCount}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Info section */}
      <div className="p-2">
        <h3 className="text-sm font-semibold truncate">
          <SpeciesLabel names={getSpeciesListFromSequence(sequence.items, bboxesByMedia)} />
        </h3>
        <p className="text-xs text-gray-500">
          {currentMedia.timestamp
            ? new Date(currentMedia.timestamp).toLocaleString()
            : 'No timestamp'}
        </p>
      </div>
    </div>
  )
}

// Module-scoped cache of mediaIDs with known image load errors.
// Persists across Gallery mount/unmount cycles within the same session.
const failedMediaIds = new Set()

// Check if media item is a video based on fileMediatype or file extension
// Defined at module level so it can be used in useMemo before component initialization
function isVideoMedia(mediaItem) {
  // Check IANA media type first
  if (mediaItem?.fileMediatype?.startsWith('video/')) {
    return true
  }
  // Fallback: check file extension for videos without fileMediatype set
  const videoExtensions = ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.m4v']
  const ext = mediaItem?.fileName?.toLowerCase().match(/\.[^.]+$/)?.[0]
  return ext ? videoExtensions.includes(ext) : false
}

function Gallery({
  species,
  dateRange,
  timeRange,
  includeNullTimestamps = false,
  speciesReady = false
}) {
  const [imageErrors, setImageErrors] = useState(() => {
    const initial = {}
    for (const mediaID of failedMediaIds) {
      initial[mediaID] = true
    }
    return initial
  })
  const setImageErrorsWithCache = useCallback((updater) => {
    setImageErrors((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      for (const [mediaID, hasError] of Object.entries(next)) {
        if (hasError) failedMediaIds.add(mediaID)
      }
      return next
    })
  }, [])
  const [selectedMedia, setSelectedMedia] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const loaderRef = useRef(null)
  const gridContainerRef = useRef(null)
  const PAGE_SIZE = 15
  const PREFETCH_THRESHOLD = 5 // Prefetch when within 5 sequences of end

  // Sequence grouping state
  const [currentSequence, setCurrentSequence] = useState(null)
  const [currentSequenceIndex, setCurrentSequenceIndex] = useState(0)

  const { id } = useParams()
  const queryClient = useQueryClient()

  // Grid controls state - persisted per study in localStorage
  const showBboxesKey = `showBboxes:${id}`
  const [showThumbnailBboxes, setShowThumbnailBboxes] = useState(() => {
    const saved = localStorage.getItem(showBboxesKey)
    return saved !== null ? JSON.parse(saved) : false
  })

  const [itemWidth, setItemWidth] = useState(null)

  const [controlsExpanded, setControlsExpanded] = useState(false)

  // Persist showThumbnailBboxes to localStorage when it changes
  useEffect(() => {
    localStorage.setItem(showBboxesKey, JSON.stringify(showThumbnailBboxes))
  }, [showThumbnailBboxes, showBboxesKey])

  // Auto-switch grid columns and calculate exact item width based on container width
  useEffect(() => {
    const container = gridContainerRef.current
    if (!container) return

    const MIN_THUMBNAIL_WIDTH = 250
    const GAP = 12

    const updateGridLayout = (containerWidth) => {
      // Calculate how many columns fit at minimum width
      // containerWidth = n * itemWidth + (n-1) * gap
      // Solving for n: n = (containerWidth + gap) / (minWidth + gap)
      const maxColumns = Math.floor((containerWidth + GAP) / (MIN_THUMBNAIL_WIDTH + GAP))
      const columns = Math.max(1, Math.min(maxColumns, 7)) // Clamp between 1-7

      // Calculate exact width to fill container perfectly
      // itemWidth = (containerWidth - (columns - 1) * gap) / columns
      const width = (containerWidth - (columns - 1) * GAP) / columns

      setItemWidth(Math.floor(width)) // Floor to avoid subpixel issues
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateGridLayout(entry.contentRect.width)
      }
    })

    resizeObserver.observe(container)
    // Initial calculation
    updateGridLayout(container.offsetWidth)

    return () => resizeObserver.disconnect()
  }, [])

  // Sequence gap - uses React Query cache for cross-component sync
  // Default value is set during study import based on whether the dataset has eventIDs
  const { sequenceGap, setSequenceGap, isLoading: isSequenceGapLoading } = useSequenceGap(id)

  // Fetch pre-grouped sequences from main process with cursor-based pagination
  // This moves the grouping logic to the main process, keeping the client "dumb"
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: [
      'sequences',
      id,
      sequenceGap,
      JSON.stringify(species),
      dateRange[0]?.toISOString(),
      dateRange[1]?.toISOString(),
      timeRange.start,
      timeRange.end,
      includeNullTimestamps
    ],
    queryFn: async ({ pageParam = null }) => {
      const response = await window.api.getSequences(id, {
        gapSeconds: sequenceGap,
        limit: PAGE_SIZE,
        cursor: pageParam,
        filters: {
          species,
          dateRange: dateRange[0] && dateRange[1] ? { start: dateRange[0], end: dateRange[1] } : {},
          timeRange
        }
      })
      if (response.error) throw new Error(response.error)
      return response.data
    },
    getNextPageParam: (lastPage) => {
      // Use cursor-based pagination - server returns nextCursor
      return lastPage.hasMore ? lastPage.nextCursor : undefined
    },
    enabled:
      !!id &&
      (includeNullTimestamps || (!!dateRange[0] && !!dateRange[1])) &&
      !isSequenceGapLoading &&
      speciesReady
  })

  // Flatten all pages of sequences into a single array
  // Server already handles null-timestamp media as individual sequences at the end
  const allNavigableItems = useMemo(
    () => data?.pages.flatMap((page) => page.sequences) ?? [],
    [data]
  )

  // Extract all media files from sequences for bbox fetching
  const mediaFiles = useMemo(
    () => allNavigableItems.flatMap((seq) => seq.items),
    [allNavigableItems]
  )

  // Batch fetch bboxes for all visible media (needed for species name display and bbox overlays)
  const mediaIDs = useMemo(() => mediaFiles.map((m) => m.mediaID), [mediaFiles])

  const { data: bboxesByMedia = {} } = useQuery({
    queryKey: ['thumbnailBboxesBatch', id, mediaIDs],
    queryFn: async () => {
      const response = await window.api.getMediaBboxesBatch(id, mediaIDs)
      return response.data || {}
    },
    enabled: mediaIDs.length > 0 && !!id,
    staleTime: 60000
  })

  // Check if any media have bboxes (lightweight check for showing/hiding toggle)
  const { data: anyMediaHaveBboxes = false } = useQuery({
    queryKey: ['mediaHaveBboxes', id, mediaIDs],
    queryFn: async () => {
      const response = await window.api.checkMediaHaveBboxes(id, mediaIDs)
      return response.data || false
    },
    enabled: mediaIDs.length > 0 && !!id,
    staleTime: 60000
  })

  // Set up Intersection Observer for infinite scrolling
  useEffect(() => {
    const currentLoader = loaderRef.current

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 }
    )

    if (currentLoader) {
      observer.observe(currentLoader)
    }

    return () => {
      if (currentLoader) {
        observer.unobserve(currentLoader)
      }
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const constructImageUrl = (fullFilePath) => {
    if (fullFilePath.startsWith('http')) {
      // Use cached-image protocol for remote URLs to enable disk caching
      if (id) {
        return `cached-image://cache?studyId=${encodeURIComponent(id)}&url=${encodeURIComponent(fullFilePath)}`
      }
      return fullFilePath
    }

    return `local-file://get?path=${encodeURIComponent(fullFilePath)}`
  }

  // Image prefetching for smooth modal navigation
  const { prefetchNeighbors } = useImagePrefetch({
    constructImageUrl,
    isVideoMedia,
    prefetchRadius: 2
  })

  // Handle click on single image or sequence
  const handleImageClick = (media, sequence = null) => {
    setSelectedMedia(media)
    setCurrentSequence(sequence)
    setCurrentSequenceIndex(
      sequence ? sequence.items.findIndex((m) => m.mediaID === media.mediaID) : 0
    )
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedMedia(null)
    setCurrentSequence(null)
    setCurrentSequenceIndex(0)
  }

  // Navigate within current sequence
  const handleSequenceNext = useCallback(() => {
    if (!currentSequence) return
    const nextIndex = currentSequenceIndex + 1
    if (nextIndex < currentSequence.items.length) {
      setCurrentSequenceIndex(nextIndex)
      setSelectedMedia(currentSequence.items[nextIndex])

      // Prefetch when at last item in sequence (next ArrowRight moves to next sequence)
      if (nextIndex === currentSequence.items.length - 1) {
        const currentSeqIdx = allNavigableItems.findIndex((s) => s.id === currentSequence.id)
        const sequencesRemaining = allNavigableItems.length - 1 - currentSeqIdx
        if (sequencesRemaining <= PREFETCH_THRESHOLD && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      }
    }
  }, [
    currentSequence,
    currentSequenceIndex,
    allNavigableItems,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage
  ])

  const handleSequencePrevious = useCallback(() => {
    if (!currentSequence) return
    const prevIndex = currentSequenceIndex - 1
    if (prevIndex >= 0) {
      setCurrentSequenceIndex(prevIndex)
      setSelectedMedia(currentSequence.items[prevIndex])
    }
  }, [currentSequence, currentSequenceIndex])

  // Navigate to next sequence/item globally
  const handleNextImage = useCallback(() => {
    if (!selectedMedia) return

    // Find current sequence index in allNavigableItems (includes null-timestamp media)
    const currentSeqIdx = allNavigableItems.findIndex((s) =>
      s.items.some((m) => m.mediaID === selectedMedia.mediaID)
    )

    // Prefetch when approaching end of loaded data
    const sequencesRemaining = allNavigableItems.length - 1 - currentSeqIdx
    if (sequencesRemaining <= PREFETCH_THRESHOLD && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }

    if (currentSeqIdx < allNavigableItems.length - 1) {
      const nextSequence = allNavigableItems[currentSeqIdx + 1]
      const isMultiItem = nextSequence.items.length > 1
      setCurrentSequence(isMultiItem ? nextSequence : null)
      setCurrentSequenceIndex(0)
      setSelectedMedia(nextSequence.items[0])
    }
  }, [selectedMedia, allNavigableItems, hasNextPage, isFetchingNextPage, fetchNextPage])

  // Navigate to previous sequence/item globally
  const handlePreviousImage = useCallback(() => {
    if (!selectedMedia) return

    const currentSeqIdx = allNavigableItems.findIndex((s) =>
      s.items.some((m) => m.mediaID === selectedMedia.mediaID)
    )

    if (currentSeqIdx > 0) {
      const prevSequence = allNavigableItems[currentSeqIdx - 1]
      const isMultiItem = prevSequence.items.length > 1
      setCurrentSequence(isMultiItem ? prevSequence : null)
      // Start at end of previous sequence
      const lastIndex = prevSequence.items.length - 1
      setCurrentSequenceIndex(lastIndex)
      setSelectedMedia(prevSequence.items[lastIndex])
    }
  }, [selectedMedia, allNavigableItems])

  // Handle optimistic timestamp update
  const handleTimestampUpdate = useCallback(
    (mediaID, newTimestamp) => {
      // Update the infinite query cache
      queryClient.setQueryData(['media', id, species, dateRange, timeRange], (oldData) => {
        if (!oldData) return oldData
        return {
          ...oldData,
          pages: oldData.pages.map((page) =>
            page.map((m) => (m.mediaID === mediaID ? { ...m, timestamp: newTimestamp } : m))
          )
        }
      })
      // Also update selectedMedia if it's the one being edited
      setSelectedMedia((prev) =>
        prev?.mediaID === mediaID ? { ...prev, timestamp: newTimestamp } : prev
      )
    },
    [queryClient, id, species, dateRange, timeRange]
  )

  // Calculate navigation availability based on sequences
  const currentSeqIdx = selectedMedia
    ? allNavigableItems.findIndex((s) => s.items.some((m) => m.mediaID === selectedMedia.mediaID))
    : -1
  const hasNextSequence = currentSeqIdx >= 0 && currentSeqIdx < allNavigableItems.length - 1
  const hasPreviousSequence = currentSeqIdx > 0

  // For sequence navigation within modal
  const hasNextInSequence =
    currentSequence && currentSequenceIndex < currentSequence.items.length - 1
  const hasPreviousInSequence = currentSequence && currentSequenceIndex > 0

  // Prefetch neighboring images when modal is open
  useEffect(() => {
    if (isModalOpen && currentSeqIdx >= 0) {
      prefetchNeighbors(allNavigableItems, currentSeqIdx)
    }
  }, [isModalOpen, currentSeqIdx, allNavigableItems, prefetchNeighbors])

  return (
    <>
      <ImageModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        media={selectedMedia}
        constructImageUrl={constructImageUrl}
        onNext={handleNextImage}
        onPrevious={handlePreviousImage}
        hasNext={hasNextSequence}
        hasPrevious={hasPreviousSequence}
        studyId={id}
        onTimestampUpdate={handleTimestampUpdate}
        sequence={currentSequence}
        sequenceIndex={currentSequenceIndex}
        onSequenceNext={handleSequenceNext}
        onSequencePrevious={handleSequencePrevious}
        hasNextInSequence={hasNextInSequence}
        hasPreviousInSequence={hasPreviousInSequence}
        isVideoMedia={isVideoMedia}
      />

      <div className="flex flex-col h-full bg-white rounded border border-gray-200 overflow-hidden">
        {/* Collapsible Control Bar */}
        <GalleryControls
          showBboxes={showThumbnailBboxes}
          onToggleBboxes={() => setShowThumbnailBboxes((prev) => !prev)}
          hasBboxes={anyMediaHaveBboxes}
          sequenceGap={sequenceGap}
          onSequenceGapChange={setSequenceGap}
          isExpanded={controlsExpanded}
          onToggleExpanded={() => setControlsExpanded((prev) => !prev)}
        />

        {/* Grid */}
        <div
          ref={gridContainerRef}
          className="flex flex-wrap gap-[12px] flex-1 overflow-auto p-3 content-start"
        >
          {/* Sequences are returned pre-grouped from server, including null-timestamp items as individual sequences */}
          {allNavigableItems.map((sequence) => {
            const isMultiItem = sequence.items.length > 1

            if (isMultiItem) {
              return (
                <SequenceCard
                  key={sequence.id}
                  sequence={sequence}
                  constructImageUrl={constructImageUrl}
                  onSequenceClick={handleImageClick}
                  imageErrors={imageErrors}
                  setImageErrors={setImageErrorsWithCache}
                  showBboxes={showThumbnailBboxes}
                  bboxesByMedia={bboxesByMedia}
                  itemWidth={itemWidth}
                  isVideoMedia={isVideoMedia}
                  studyId={id}
                />
              )
            }

            // Single item - use existing ThumbnailCard
            const media = sequence.items[0]
            return (
              <ThumbnailCard
                key={media.mediaID}
                media={media}
                constructImageUrl={constructImageUrl}
                onImageClick={(m) => handleImageClick(m, null)}
                imageErrors={imageErrors}
                setImageErrors={setImageErrorsWithCache}
                showBboxes={showThumbnailBboxes}
                bboxes={bboxesByMedia[media.mediaID] || []}
                itemWidth={itemWidth}
                isVideoMedia={isVideoMedia}
                studyId={id}
              />
            )
          })}

          {/* Loading indicator and intersection target */}
          <div ref={loaderRef} className="w-full flex justify-center p-4">
            {isFetchingNextPage && (
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
                <span className="ml-2">Loading more...</span>
              </div>
            )}
            {!hasNextPage && mediaFiles.length > 0 && !isFetchingNextPage && (
              <p className="text-gray-500 text-sm">No more media to load</p>
            )}
            {!hasNextPage && mediaFiles.length === 0 && !isLoading && (
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
  const [searchParams, setSearchParams] = useSearchParams()

  const [selectedSpecies, setSelectedSpecies] = useState([])
  // Flips true after selectedSpecies has been initialised from the
  // speciesDistributionData effect, so downstream components (Gallery,
  // Timeline, Radar) only mount once their queryKey inputs are stable
  // rather than fetching on every cascading state update.
  const [speciesInitialized, setSpeciesInitialized] = useState(false)
  const [dateRange, setDateRange] = useState([null, null])
  const [fullExtent, setFullExtent] = useState([null, null])
  const [timeRange, setTimeRange] = useState({ start: 0, end: 24 })
  const { importStatus } = useImportStatus(actualStudyId, 5000)

  // Sequence gap - uses React Query for sync across components
  const { sequenceGap } = useSequenceGap(actualStudyId)

  const taxonomicData = studyData?.taxonomic || null

  // Fetch sequence-aware species distribution data
  // sequenceGap in queryKey ensures refetch when slider changes (backend fetches from metadata)
  const { data: speciesDistributionData, error: speciesDistributionError } = useQuery({
    queryKey: ['sequenceAwareSpeciesDistribution', actualStudyId, sequenceGap],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareSpeciesDistribution(actualStudyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!actualStudyId && sequenceGap !== undefined,
    placeholderData: (prev) => prev,
    refetchInterval: importStatus?.isRunning ? 5000 : false,
    staleTime: Infinity
  })

  // Fetch blank media count (media without observations)
  const { data: blankCount = 0 } = useQuery({
    queryKey: ['blankMediaCount', actualStudyId],
    queryFn: async () => {
      const response = await window.api.getBlankMediaCount(actualStudyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!actualStudyId,
    refetchInterval: importStatus?.isRunning ? 5000 : false,
    staleTime: Infinity
  })

  // Initialize selectedSpecies when speciesDistributionData loads
  // Check URL params first (from overview click), then default to top species
  useEffect(() => {
    if (!speciesDistributionData) return

    const preSelectedSpecies = searchParams.get('species')

    if (preSelectedSpecies) {
      // Find the species in distribution data to get full object with count
      const speciesData = speciesDistributionData.find(
        (s) => s.scientificName === preSelectedSpecies
      )
      if (speciesData) {
        setSelectedSpecies([speciesData])
        // Clear the URL param after applying
        setSearchParams({}, { replace: true })
        setSpeciesInitialized(true)
        return
      }
    }

    // Default: select top 2 non-human species if no selection yet
    if (selectedSpecies.length === 0) {
      setSelectedSpecies(getTopNonHumanSpecies(speciesDistributionData, 2))
    }
    // Signal to downstream components (Gallery, Timeline, Radar) that species
    // inputs have settled so their queryKey stabilises and they fetch once.
    setSpeciesInitialized(true)
  }, [speciesDistributionData, searchParams, setSearchParams, selectedSpecies.length])

  // Drop filter entries whose species no longer exists (e.g. after a rename
  // or mark-as-blank). Preserve identity when nothing changes.
  useEffect(() => {
    if (!speciesDistributionData) return
    const validNames = new Set(speciesDistributionData.map((s) => s.scientificName))
    setSelectedSpecies((prev) => {
      const filtered = prev.filter((s) => validNames.has(s.scientificName))
      return filtered.length === prev.length ? prev : filtered
    })
  }, [speciesDistributionData])

  // Memoize speciesNames to avoid unnecessary re-renders
  const speciesNames = useMemo(
    () => selectedSpecies.map((s) => s.scientificName),
    [selectedSpecies]
  )

  // Fetch sequence-aware timeseries data
  // sequenceGap in queryKey ensures refetch when slider changes (backend fetches from metadata)
  const { data: timeseriesQueryData } = useQuery({
    queryKey: ['sequenceAwareTimeseries', actualStudyId, [...speciesNames].sort(), sequenceGap],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareTimeseries(actualStudyId, speciesNames)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!actualStudyId && speciesNames.length > 0 && sequenceGap !== undefined,
    placeholderData: (prev) => prev,
    refetchInterval: importStatus?.isRunning ? 5000 : false
  })
  const timeseriesData = timeseriesQueryData?.timeseries ?? []

  // Check if dataset has temporal data
  const hasTemporalData = useMemo(() => {
    return timeseriesData && timeseriesData.length > 0
  }, [timeseriesData])

  // Initialize fullExtent from timeseries data for timeline display
  // Note: We intentionally do NOT auto-set dateRange here.
  // Keeping dateRange as [null, null] means "select all" (no date filtering),
  // which fixes bugs where week-start boundaries exclude same-day media with later timestamps.
  // dateRange only changes when user explicitly brushes the timeline.
  useEffect(() => {
    if (hasTemporalData && fullExtent[0] === null && fullExtent[1] === null) {
      const startIndex = 0
      const endIndex = timeseriesData.length - 1

      const startDate = new Date(timeseriesData[startIndex].date)
      const endDate = new Date(timeseriesData[endIndex].date)

      setFullExtent([startDate, endDate])
    }
  }, [hasTemporalData, timeseriesData, fullExtent])

  // Compute if user has selected full temporal range (with 1 day tolerance)
  // Also true when dataset has no temporal data (to include all null-timestamp media)
  // Also true when dateRange is [null, null] (no explicit selection = include all)
  const isFullRange = useMemo(() => {
    // If dateRange is null/null, treat as full range (include all including null timestamps)
    if (!dateRange[0] && !dateRange[1]) return true

    if (!hasTemporalData) return true
    if (!fullExtent[0] || !fullExtent[1]) return false

    const tolerance = 86400000 // 1 day in milliseconds
    const startMatch = Math.abs(fullExtent[0].getTime() - dateRange[0].getTime()) < tolerance
    const endMatch = Math.abs(fullExtent[1].getTime() - dateRange[1].getTime()) < tolerance
    return startMatch && endMatch
  }, [hasTemporalData, fullExtent, dateRange])

  // Fetch sequence-aware daily activity data.
  // Effective dateRange falls back to fullExtent so the radar can render
  // before the user has brushed a custom range. Gallery keeps its
  // dateRange-null = "select all" semantic untouched; this fallback is
  // local to the daily-activity query.
  const dailyActivityStart = dateRange[0] ?? fullExtent[0]
  const dailyActivityEnd = dateRange[1] ?? fullExtent[1]
  const { data: dailyActivityData } = useQuery({
    queryKey: [
      'sequenceAwareDailyActivity',
      actualStudyId,
      [...speciesNames].sort(),
      dailyActivityStart?.toISOString(),
      dailyActivityEnd?.toISOString(),
      sequenceGap
    ],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareDailyActivity(
        actualStudyId,
        speciesNames,
        dailyActivityStart?.toISOString(),
        dailyActivityEnd?.toISOString()
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled:
      !!actualStudyId &&
      speciesNames.length > 0 &&
      !!dailyActivityStart &&
      !!dailyActivityEnd &&
      sequenceGap !== undefined,
    placeholderData: (prev) => prev,
    refetchInterval: importStatus?.isRunning ? 5000 : false
  })

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
      {speciesDistributionError ? (
        <div className="text-red-500 py-4">Error: {speciesDistributionError.message}</div>
      ) : (
        <div className="flex flex-col h-full gap-4">
          {/* First row - takes remaining space */}
          <div className="flex flex-row gap-4 flex-1 min-h-0">
            {/* Species Distribution - left side */}

            {/* Map - right side */}
            <div className="h-full flex-1">
              {speciesInitialized && sequenceGap !== undefined && (
                <Gallery
                  species={selectedSpecies.map((s) => s.scientificName)}
                  dateRange={dateRange}
                  timeRange={timeRange}
                  includeNullTimestamps={isFullRange}
                  speciesReady={speciesInitialized}
                />
              )}
            </div>
            <div className="h-full overflow-auto w-xs">
              {speciesDistributionData && (
                <SpeciesDistribution
                  data={speciesDistributionData}
                  taxonomicData={taxonomicData}
                  selectedSpecies={selectedSpecies}
                  onSpeciesChange={handleSpeciesChange}
                  palette={palette}
                  blankCount={blankCount}
                  studyId={actualStudyId}
                />
              )}
            </div>
          </div>

          {/* Second row - fixed height with timeline and clock.
              Hidden entirely until species + sequenceGap are settled so the
              bordered containers don't appear empty during the initial load. */}
          {speciesInitialized && sequenceGap !== undefined && (
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
                  dateRange={[dateRange[0] ?? fullExtent[0], dateRange[1] ?? fullExtent[1]]}
                  setDateRange={setDateRange}
                  palette={palette}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
