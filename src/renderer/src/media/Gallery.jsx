/**
 * Shared Gallery + ImageModal + supporting components.
 *
 * Used by:
 *   - src/renderer/src/media.jsx (the Media tab — study-wide)
 *   - src/renderer/src/media/DeploymentMediaGallery.jsx (the Deployments tab — deployment-scoped)
 *
 * Both consumers pass species/date/time filter inputs. The deployment-scoped
 * consumer additionally passes a deploymentID, which threads through to the
 * sequences query.
 */

import {
  CameraOff,
  X,
  Calendar,
  Pencil,
  Check,
  Clock,
  Eye,
  EyeOff,
  Layers,
  Play,
  Loader2,
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
import { useParams } from 'react-router'
import DeploymentLinkPill from './DeploymentLinkPill'
import EditableBbox from '../ui/EditableBbox'
import VideoBboxOverlay from '../ui/VideoBboxOverlay.jsx'
import ObservationRail from '../ui/ObservationRail'
import BboxLabelMinimal from '../ui/BboxLabelMinimal'
import { UndoProvider, useUndo } from '../undo/context.jsx'
import * as commands from '../undo/commands.js'
import { toast } from 'sonner'
import {
  getImageBounds,
  screenToNormalized,
  screenToNormalizedWithZoom
} from '../utils/bboxCoordinates'
import { useZoomPan } from '../hooks/useZoomPan'
import { useImagePrefetch } from '../hooks/useImagePrefetch'
import {
  getSpeciesCountsFromBboxes,
  getSpeciesCountsFromSequence
} from '../utils/speciesFromBboxes'
import { SpeciesCountLabel } from '../ui/SpeciesLabel'
import MediaTableView from './MediaTableView.jsx'
import { sortSequences } from './tableRows.js'
import { formatGridTimestamp } from '../utils/formatTimestamp'
import { useSequenceGap } from '../hooks/useSequenceGap'
import { useShowThumbnailBboxes } from '../hooks/useShowThumbnailBboxes'
import DateTimePicker from '../ui/DateTimePicker'

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
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-blue-500 text-white px-3 py-1 rounded-full text-sm font-medium shadow-lg pointer-events-none dark:bg-blue-400">
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
  deploymentID,
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
  // Browse-mode trigger for the species picker: { id, epoch }. The id names
  // which observation should open in browse mode (dropdown open with full
  // study list, current species highlighted); the epoch increments on every
  // label click so a re-click on the already-selected bbox forces the picker
  // to remount and re-trigger. Cleared by an effect whenever id falls out of
  // sync with selectedObservationId, so non-label selection paths never
  // inherit browse mode.
  const [pickerBrowse, setPickerBrowse] = useState({ id: null, epoch: 0 })
  useEffect(() => {
    if (pickerBrowse.id !== null && pickerBrowse.id !== selectedObservationId) {
      setPickerBrowse((prev) => ({ id: null, epoch: prev.epoch }))
    }
  }, [pickerBrowse.id, selectedObservationId])
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
  const undo = useUndo()

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
  const { data: bboxes = [], isPending: bboxesPending } = useQuery({
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
      queryClient.invalidateQueries({ queryKey: ['vehicleMediaCount', studyId] })
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

  // Invalidate all queries that depend on the per-media observations after a
  // create/delete/classification edit. Same set the previous mutations'
  // onSettled fired — kept inline so the undo path uses the identical fanout.
  // Declared early so the handlers below can list it as a stable dep.
  const invalidateAfterObservationChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['mediaBboxes', studyId, media?.mediaID] })
    queryClient.invalidateQueries({ queryKey: ['distinctSpecies', studyId] })
    queryClient.invalidateQueries({ queryKey: ['thumbnailBboxesBatch'] })
    queryClient.invalidateQueries({ queryKey: ['sequences', studyId] })
    queryClient.invalidateQueries({ queryKey: ['sequenceAwareSpeciesDistribution', studyId] })
    queryClient.invalidateQueries({ queryKey: ['sequenceAwareTimeseries', studyId] })
    queryClient.invalidateQueries({ queryKey: ['sequenceAwareDailyActivity', studyId] })
    queryClient.invalidateQueries({ queryKey: ['sequenceAwareHeatmap', studyId] })
    queryClient.invalidateQueries({ queryKey: ['blankMediaCount', studyId] })
    queryClient.invalidateQueries({ queryKey: ['vehicleMediaCount', studyId] })
    queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })
  }, [queryClient, studyId, media?.mediaID])

  // After every undo/redo, invalidate the same queries the forward path would
  // have. Without this, the bboxes useQuery still serves the pre-undo cache
  // and the change isn't visible until the modal is closed and reopened.
  useEffect(() => {
    return undo.onChange(() => {
      invalidateAfterObservationChange()
    })
  }, [undo, invalidateAfterObservationChange])

  // Surface failed undo/redo IPCs as a toast (the manager already drops the
  // poisoned entry from its stacks, so retry isn't useful).
  useEffect(() => {
    return undo.onError((msg) => toast.error(msg))
  }, [undo])

  // Optimistically patch the bboxes cache as soon as an entry is applied —
  // before the invalidation refetch lands. Without this there's a brief
  // window where the modal renders the pre-IPC state, causing a visible
  // flicker on drag-end and on undo/redo. The 3-element queryKey filter
  // prefix-matches the actual 4-element key (which also carries isVideo).
  useEffect(() => {
    return undo.onApplied((entry, kind) => {
      const { type, observationId, before, after } = entry
      const fields = kind === 'inverse' ? before : after
      queryClient.setQueriesData({ queryKey: ['mediaBboxes', studyId, entry.mediaId] }, (old) => {
        if (!Array.isArray(old)) return old
        if (type === 'create') {
          if (kind === 'inverse') return old.filter((b) => b.observationID !== observationId)
          // forward / redo — append the created row if not already there
          return old.some((b) => b.observationID === after.observationID) ? old : [...old, after]
        }
        if (type === 'delete') {
          if (kind === 'inverse')
            return old.some((b) => b.observationID === before.observationID)
              ? old
              : [...old, before]
          // forward / redo — remove the row
          return old.filter((b) => b.observationID !== before.observationID)
        }
        // update-bbox / update-classification — patch the matching row
        return old.map((b) => (b.observationID === observationId ? { ...b, ...fields } : b))
      })
    })
  }, [undo, queryClient, studyId])

  // Classification update — routed through the undo system. Local state
  // mirrors what the previous useMutation exposed (isPending / isError) so the
  // existing pending/error UI in the footer can keep working.
  const [classificationUpdatePending, setClassificationUpdatePending] = useState(false)
  const [classificationUpdateError, setClassificationUpdateError] = useState(null)

  const handleClassificationUpdate = useCallback(
    async (observationID, rawUpdates) => {
      // Only include fields explicitly provided (not undefined). This
      // prevents overwriting existing values with null.
      const after = {}
      if (rawUpdates.scientificName !== undefined) after.scientificName = rawUpdates.scientificName
      if (rawUpdates.commonName !== undefined) after.commonName = rawUpdates.commonName
      if (rawUpdates.observationType !== undefined)
        after.observationType = rawUpdates.observationType
      if (rawUpdates.sex !== undefined) after.sex = rawUpdates.sex
      if (rawUpdates.lifeStage !== undefined) after.lifeStage = rawUpdates.lifeStage
      if (rawUpdates.behavior !== undefined) after.behavior = rawUpdates.behavior

      const before = bboxes.find((b) => b.observationID === observationID)
      if (!before) return

      setClassificationUpdatePending(true)
      setClassificationUpdateError(null)

      const command = commands.updateClassification({
        api: window.api,
        studyId,
        mediaId: media.mediaID,
        observationId: observationID,
        before,
        after
      })
      try {
        await undo.exec(command)
      } catch (err) {
        setClassificationUpdateError(err)
        setClassificationUpdatePending(false)
        return
      }
      invalidateAfterObservationChange()
      setClassificationUpdatePending(false)
    },
    [bboxes, studyId, media?.mediaID, undo, invalidateAfterObservationChange]
  )

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

  const handleBboxUpdate = useCallback(
    async (observationID, newBbox) => {
      const before = bboxes.find((b) => b.observationID === observationID)
      if (!before) return

      // Synchronously apply the new bbox to the cache so the displayed bboxes
      // don't snap back to the pre-edit position during the IPC roundtrip.
      // The onApplied listener will overwrite this with the same data after
      // success, so the only visible difference is no flicker.
      queryClient.setQueriesData({ queryKey: ['mediaBboxes', studyId, media?.mediaID] }, (old) =>
        Array.isArray(old)
          ? old.map((b) =>
              b.observationID === observationID
                ? { ...b, ...newBbox, classificationMethod: 'human' }
                : b
            )
          : old
      )

      const command = commands.updateBbox({
        api: window.api,
        studyId,
        mediaId: media.mediaID,
        observationId: observationID,
        before,
        after: newBbox
      })
      try {
        await undo.exec(command)
      } catch (err) {
        console.error('Failed to update bbox:', err)
        // Rollback the optimistic patch
        queryClient.setQueriesData({ queryKey: ['mediaBboxes', studyId, media?.mediaID] }, (old) =>
          Array.isArray(old)
            ? old.map((b) => (b.observationID === observationID ? before : b))
            : old
        )
        return
      }
      queryClient.invalidateQueries({ queryKey: ['thumbnailBboxesBatch'] })
      queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })
    },
    [bboxes, queryClient, studyId, media?.mediaID, undo]
  )

  const handleDeleteObservation = useCallback(
    async (observationID) => {
      const before = bboxes.find((b) => b.observationID === observationID)
      if (!before) return

      if (selectedObservationId === observationID) {
        setSelectedObservationId(null)
      }

      const command = commands.delete_({
        api: window.api,
        studyId,
        mediaId: media.mediaID,
        before
      })
      try {
        await undo.exec(command)
      } catch (err) {
        console.error('Failed to delete observation:', err)
        return
      }
      invalidateAfterObservationChange()
    },
    [bboxes, studyId, media?.mediaID, selectedObservationId, undo, invalidateAfterObservationChange]
  )

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

  // Shared create-observation path for both the draw-mode flow and the
  // rail's "Add → Whole image" action: builds the create command, routes it
  // through the undo system, and refreshes the standard query fanout.
  const createObservationViaUndo = useCallback(
    async (observationData) => {
      const command = commands.create({
        api: window.api,
        studyId,
        mediaId: observationData.mediaID,
        observationData
      })
      try {
        await undo.exec(command)
      } catch (err) {
        console.error('Failed to create observation:', err)
        return
      }
      invalidateAfterObservationChange()
      setIsDrawMode(false)
      setSelectedObservationId(command.entry.observationId)
    },
    [studyId, undo, invalidateAfterObservationChange]
  )

  const handleDrawComplete = useCallback(
    async (bbox) => {
      if (!media) return
      const defaultSpecies = getDefaultSpecies()
      await createObservationViaUndo({
        mediaID: media.mediaID,
        deploymentID: media.deploymentID,
        timestamp: media.timestamp,
        scientificName: defaultSpecies.scientificName,
        commonName: defaultSpecies.commonName,
        bboxX: bbox.bboxX,
        bboxY: bbox.bboxY,
        bboxWidth: bbox.bboxWidth,
        bboxHeight: bbox.bboxHeight
      })
    },
    [media, getDefaultSpecies, createObservationViaUndo]
  )

  // "Add observation → Whole image" from the rail — no bbox geometry.
  const handleAddWholeImage = useCallback(async () => {
    if (!media) return
    await createObservationViaUndo({
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
  }, [media, createObservationViaUndo])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e) => {
      // Don't handle navigation keys when editing timestamp
      if (isEditingTimestamp || showDatePicker) return

      // Cmd+Z / Ctrl+Z → undo, Cmd+Shift+Z / Ctrl+Y → redo. Skip when an
      // editable element has focus so native text undo in the species picker's
      // input still works.
      const activeEl = document.activeElement
      const isEditable =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.isContentEditable)

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !isEditable) {
        e.preventDefault()
        undo.undo()
        return
      }
      if (
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y')
      ) {
        if (isEditable) return
        e.preventDefault()
        undo.redo()
        return
      }

      // Handle escape in draw mode
      if (isDrawMode) {
        if (e.key === 'Escape') {
          setIsDrawMode(false)
        }
        return
      }

      // Cycle bboxes with Tab/Shift+Tab — works regardless of focus, so a focused
      // species-picker input still hands Tab to the modal instead of walking
      // through the row's other buttons. Skip during IME composition (CJK
      // input uses Tab to commit candidates).
      if (e.key === 'Tab' && !e.nativeEvent?.isComposing) {
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
    bboxes,
    undo
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
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <div className="relative max-w-7xl w-full h-full flex items-center justify-center">
        <div
          className="bg-card rounded-lg overflow-hidden shadow-2xl max-h-[90vh] flex flex-col max-w-full"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top toolbar - nav + sequence + timestamp on the left, actions on the right */}
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-card">
            <div className="flex items-center gap-2 min-w-0 flex-1 text-xs text-muted-foreground">
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
                className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
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
                className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                aria-label="Next image"
                title="Next (→)"
              >
                <ChevronRight size={18} />
              </button>
              {sequence && sequence.items.length > 1 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium text-[11px] flex-shrink-0">
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
                      className="text-xs text-foreground border border-border rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[180px]"
                      autoFocus
                      disabled={isSaving}
                      placeholder="Enter date/time..."
                    />
                    <button
                      onClick={handleInlineSave}
                      disabled={isSaving}
                      className="text-blue-600 hover:text-blue-700 disabled:opacity-50 p-0.5 dark:text-blue-400 dark:hover:text-blue-400"
                      title="Save (Enter)"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={handleInlineCancel}
                      disabled={isSaving}
                      className="text-muted-foreground hover:text-muted-foreground disabled:opacity-50 p-0.5"
                      title="Cancel (Escape)"
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      className="cursor-pointer hover:text-foreground hover:underline truncate"
                      onClick={handleInlineEdit}
                      title="Click to edit timestamp"
                    >
                      {media.timestamp
                        ? new Date(media.timestamp).toLocaleString()
                        : 'No timestamp'}
                    </span>
                    <button
                      onClick={handleInlineEdit}
                      className="text-muted-foreground hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity p-0.5 flex-shrink-0"
                      title="Edit timestamp inline"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={() => setShowDatePicker(true)}
                      className="text-muted-foreground hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity p-0.5 flex-shrink-0"
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
              {error && <span className="text-[11px] text-red-500 dark:text-red-400">{error}</span>}
              {isSaving && (
                <span className="text-[11px] text-muted-foreground animate-pulse">Saving...</span>
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
                    ? 'text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-500/20 dark:bg-red-500/15'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Heart size={18} fill={isFavorite ? 'currentColor' : 'none'} />
              </button>

              {hasBboxes && <div className="w-px h-5 bg-muted mx-1" />}

              {hasBboxes && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowBboxes((prev) => !prev)
                  }}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                    showBboxes
                      ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-500/25 dark:bg-blue-500/15'
                      : 'text-muted-foreground hover:bg-accent'
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
                    ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-500/25 dark:bg-blue-500/15'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
                aria-label="Toggle keyboard shortcuts"
                aria-pressed={showShortcuts}
                title="Keyboard shortcuts"
              >
                <Info size={18} />
              </button>

              {!isVideoMedia(media) && !isDrawMode && (
                <>
                  {!isZoomed ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        zoomIn()
                      }}
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent transition-colors"
                      aria-label="Zoom in"
                      title="Zoom in (+)"
                    >
                      <ZoomIn size={18} />
                    </button>
                  ) : (
                    <div className="flex items-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          zoomOut()
                        }}
                        disabled={zoomTransform.scale <= 1}
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label="Zoom out"
                        title="Zoom out (-)"
                      >
                        <ZoomOut size={18} />
                      </button>
                      <span className="text-xs text-muted-foreground font-medium min-w-[2.75rem] text-center tabular-nums">
                        {Math.round(zoomTransform.scale * 100)}%
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          zoomIn()
                        }}
                        disabled={zoomTransform.scale >= 5}
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label="Zoom in"
                        title="Zoom in (+)"
                      >
                        <ZoomIn size={18} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          resetZoom()
                        }}
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent transition-colors"
                        aria-label="Reset zoom"
                        title="Reset zoom (0)"
                      >
                        <RotateCcw size={16} />
                      </button>
                    </div>
                  )}
                </>
              )}

              <div className="w-px h-5 bg-muted mx-1" />

              <button
                onClick={onClose}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent transition-colors"
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
                  <div className="flex flex-col items-center justify-center p-8 text-muted-foreground min-h-[300px]">
                    <Loader2 size={48} className="animate-spin text-blue-500 dark:text-blue-400" />
                    <span className="mt-4 text-lg font-medium">Checking video format...</span>
                  </div>
                ) : transcodeState === 'transcoding' ? (
                  <div className="flex flex-col items-center justify-center p-8 text-muted-foreground min-h-[300px]">
                    <div className="relative">
                      <Loader2
                        size={64}
                        className="animate-spin text-blue-500 dark:text-blue-400"
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                          {transcodeProgress}%
                        </span>
                      </div>
                    </div>
                    <span className="mt-4 text-lg font-medium">Converting video...</span>
                    <span className="mt-2 text-sm text-muted-foreground">
                      This format requires conversion for browser playback
                    </span>
                    {/* Progress bar */}
                    <div className="mt-4 w-64 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-300 dark:bg-blue-400"
                        style={{ width: `${transcodeProgress}%` }}
                      />
                    </div>
                    <span className="mt-2 text-xs text-muted-foreground">{media.fileName}</span>
                  </div>
                ) : transcodeState === 'error' ? (
                  <div className="flex flex-col items-center justify-center p-8 text-muted-foreground min-h-[300px]">
                    <Play size={64} className="text-red-400 dark:text-red-300" />
                    <span className="mt-4 text-lg font-medium text-red-500 dark:text-red-400">
                      Conversion failed
                    </span>
                    <span className="mt-2 text-sm text-muted-foreground">{transcodeError}</span>
                    <span className="mt-1 text-xs text-muted-foreground">{media.fileName}</span>
                  </div>
                ) : videoError && transcodeState !== 'ready' ? (
                  <div className="flex flex-col items-center justify-center p-8 text-muted-foreground min-h-[300px]">
                    <Play size={64} />
                    <span className="mt-4 text-lg font-medium">Video</span>
                    <span className="mt-2 text-sm text-muted-foreground">
                      Format not supported by browser
                    </span>
                    <span className="mt-1 text-xs text-muted-foreground">{media.fileName}</span>
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
                <div className="flex flex-col items-center justify-center bg-gray-800 text-muted-foreground aspect-[4/3] min-w-[70vw] max-h-[calc(90vh-152px)]">
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
                              onClick={() => {
                                setSelectedObservationId(bbox.observationID)
                                setPickerBrowse((prev) => ({
                                  id: bbox.observationID,
                                  epoch: prev.epoch + 1
                                }))
                              }}
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
                </>
              )}
            </div>
            <ObservationRail
              observations={bboxes}
              studyId={studyId}
              mediaId={media?.mediaID}
              selectedObservationId={selectedObservationId}
              onSelectObservation={setSelectedObservationId}
              pickerBrowseObservationId={pickerBrowse.id}
              pickerBrowseEpoch={pickerBrowse.epoch}
              onUpdateClassification={handleClassificationUpdate}
              onDeleteObservation={handleDeleteObservation}
              onDrawRectangle={() => {
                setIsDrawMode(true)
                setShowBboxes(true)
              }}
              onAddWholeImage={handleAddWholeImage}
              showShortcuts={showShortcuts}
              isLoading={bboxesPending}
            />
          </div>

          {/* Footer - filename + deployment link */}
          <div className="px-4 py-2.5 bg-card flex-shrink-0 border-t border-border text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              {media.fileName && (
                <span className="font-mono text-[11px] text-muted-foreground truncate min-w-0 flex-1">
                  {media.fileName}
                </span>
              )}
              {media.deploymentID && (
                <DeploymentLinkPill
                  studyId={studyId}
                  deploymentID={media.deploymentID}
                  locationName={media.locationName}
                  locationID={media.locationID}
                  interactive={!deploymentID}
                  onNavigate={onClose}
                />
              )}
            </div>

            {classificationUpdatePending && (
              <p className="text-[11px] text-blue-500 mt-1 dark:text-blue-400">
                Updating classification...
              </p>
            )}
            {classificationUpdateError && (
              <p className="text-[11px] text-red-500 mt-1 dark:text-red-400">
                Error: {classificationUpdateError?.message || 'Failed to update'}
              </p>
            )}
          </div>
        </div>
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
    <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 transition-transform duration-300 ease-out group-hover:scale-110">
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
  studyId,
  reviewed = false
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
      className="group border border-border rounded-lg overflow-hidden flex flex-col transition-all"
      style={{ width: itemWidth ? `${itemWidth}px` : undefined }}
    >
      <div
        ref={containerRef}
        className="relative bg-black flex items-center justify-center cursor-pointer hover:bg-gray-900 transition-colors overflow-hidden aspect-[4/3]"
        onClick={() => onImageClick(media)}
      >
        {reviewed && (
          <div
            className="absolute bottom-2 left-2 z-20 w-5 h-5 rounded-full bg-green-600 text-white flex items-center justify-center shadow"
            title="Reviewed by a human"
          >
            <Check size={12} />
          </div>
        )}
        {isVideo ? (
          <>
            {/* Video placeholder background - always visible */}
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 text-muted-foreground">
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
                className="relative z-10 w-full h-full object-contain transition-transform duration-300 ease-out group-hover:scale-110"
                loading="lazy"
              />
            ) : (
              /* Video element - overlays placeholder when it loads successfully */
              <video
                ref={imageRef}
                src={constructImageUrl(media.filePath)}
                className={`relative z-10 w-full h-full object-contain transition-transform duration-300 ease-out group-hover:scale-110 ${imageErrors[media.mediaID] ? 'hidden' : ''}`}
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
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-muted-foreground z-0">
                <Loader2 size={32} className="animate-spin" />
              </div>
            )}
            <img
              ref={imageRef}
              src={constructImageUrl(media.filePath)}
              alt={media.fileName || `Media ${media.mediaID}`}
              data-image={media.filePath}
              className={`w-full h-full object-contain ${imageErrors[media.mediaID] ? 'hidden' : ''} ${isImageLoading ? 'opacity-0' : 'opacity-100'} transition duration-300 ease-out group-hover:scale-110`}
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
            className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 text-muted-foreground"
            title="Image not available"
          >
            <CameraOff size={32} />
          </div>
        )}

        {/* Timestamp overlay (top-left) */}
        {media.timestamp && (
          <div className="absolute top-2 left-2 z-20 bg-black/65 text-white px-1.5 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 backdrop-blur-[2px] tabular-nums">
            <Clock size={11} />
            <span>{formatGridTimestamp(media.timestamp)}</span>
          </div>
        )}
      </div>

      <div className="p-2">
        <h3 className="text-sm font-semibold truncate capitalize">
          <SpeciesCountLabel entries={getSpeciesCountsFromBboxes(bboxes, media.scientificName)} />
        </h3>
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
  studyId,
  reviewed = false
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
      className="border border-border rounded-lg overflow-hidden flex flex-col transition-all relative group"
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
      <div className="absolute -top-1 -right-1 w-full h-full border border-border rounded-lg bg-muted -z-10 transform translate-x-1 -translate-y-1" />

      {/* Media container */}
      <div
        ref={containerRef}
        className="relative bg-black flex items-center justify-center cursor-pointer hover:bg-gray-900 transition-colors overflow-hidden aspect-[4/3]"
        onClick={handleClick}
      >
        {reviewed && (
          <div
            className="absolute bottom-2 left-2 z-20 w-5 h-5 rounded-full bg-green-600 text-white flex items-center justify-center shadow"
            title="Reviewed by a human"
          >
            <Check size={12} />
          </div>
        )}
        {isVideo ? (
          <>
            {/* Video placeholder background - always visible */}
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 text-muted-foreground">
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
                className="relative z-10 w-full h-full object-contain transition duration-300 ease-out group-hover:scale-110"
                loading="lazy"
              />
            ) : (
              /* Video element - overlays placeholder when it loads successfully */
              <video
                ref={imageRef}
                src={constructImageUrl(currentMedia.filePath)}
                className={`relative z-10 w-full h-full object-contain transition duration-300 ease-out group-hover:scale-110 ${imageErrors[currentMedia.mediaID] ? 'hidden' : ''}`}
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
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-muted-foreground z-0">
                <Loader2 size={32} className="animate-spin" />
              </div>
            )}
            <img
              ref={imageRef}
              src={constructImageUrl(currentMedia.filePath)}
              alt={currentMedia.fileName || `Media ${currentMedia.mediaID}`}
              className={`w-full h-full object-contain transition duration-300 ease-out group-hover:scale-110 ${imageErrors[currentMedia.mediaID] ? 'hidden' : ''} ${!loadedImages[currentMedia.mediaID] ? 'opacity-0' : 'opacity-100'}`}
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
            className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 text-muted-foreground"
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
                    idx === currentIndex ? 'bg-blue-500 dark:bg-blue-400' : 'bg-card/60'
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

        {/* Timestamp overlay (top-left) — updates as the sequence cycles */}
        {currentMedia.timestamp && (
          <div className="absolute top-2 left-2 z-20 bg-black/65 text-white px-1.5 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 backdrop-blur-[2px] tabular-nums">
            <Clock size={11} />
            <span>{formatGridTimestamp(currentMedia.timestamp)}</span>
          </div>
        )}
      </div>

      {/* Info section */}
      <div className="p-2">
        <h3 className="text-sm font-semibold truncate capitalize">
          <SpeciesCountLabel
            entries={getSpeciesCountsFromSequence(sequence.items, bboxesByMedia)}
          />
        </h3>
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
  speciesReady = false,
  deploymentID = null,
  source = null,
  mediaTypes = [],
  sort = 'newest',
  favorite = false,
  reviewed,
  lowConfidence = false,
  onlyNullTimestamps = false,
  areaFilter = null,
  onLoadedChange,
  embedded = false,
  view = 'grid'
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

  const { showThumbnailBboxes } = useShowThumbnailBboxes(id)

  const [itemWidth, setItemWidth] = useState(null)

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
  const { sequenceGap, isLoading: isSequenceGapLoading } = useSequenceGap(id)

  // Fetch pre-grouped sequences from main process with cursor-based pagination
  // This moves the grouping logic to the main process, keeping the client "dumb"
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isSuccess } =
    useInfiniteQuery({
      queryKey: [
        'sequences',
        id,
        sequenceGap,
        deploymentID,
        source,
        JSON.stringify(mediaTypes),
        sort,
        favorite,
        reviewed,
        lowConfidence,
        onlyNullTimestamps,
        JSON.stringify(species),
        dateRange[0]?.toISOString(),
        dateRange[1]?.toISOString(),
        JSON.stringify(timeRange.ranges ?? [{ start: timeRange.start, end: timeRange.end }]),
        includeNullTimestamps,
        JSON.stringify(areaFilter)
      ],
      queryFn: async ({ pageParam = null }) => {
        const response = await window.api.getSequences(id, {
          gapSeconds: sequenceGap,
          limit: PAGE_SIZE,
          cursor: pageParam,
          sort,
          filters: {
            species,
            dateRange:
              dateRange[0] && dateRange[1] ? { start: dateRange[0], end: dateRange[1] } : {},
            timeRange,
            deploymentID,
            source,
            mediaTypes,
            favorite,
            reviewed,
            lowConfidence,
            onlyNullTimestamps,
            bbox: areaFilter
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

  // Notify the parent once the first page has resolved — lets the Explore tab
  // hold the map full-size until the gallery has media to show.
  useEffect(() => {
    if (isSuccess) onLoadedChange?.()
  }, [isSuccess, onLoadedChange])

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

  // Table column sort (client-side), lifted here so one sorted order drives both
  // the table render and the modal's next/prev navigation.
  const [tableSort, setTableSort] = useState({ col: null, dir: 'asc' })
  const handleTableSort = useCallback((col) => {
    setTableSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }
    )
  }, [])

  // The order the user actually sees: when the Table view has an active column
  // sort, order the loaded sequences the same way; otherwise keep server order.
  // Modal navigation and the table both read this so they stay in lockstep.
  const navigableItems = useMemo(() => {
    if (view !== 'table' || !tableSort.col) return allNavigableItems
    return sortSequences(
      allNavigableItems,
      bboxesByMedia,
      isVideoMedia,
      tableSort.col,
      tableSort.dir
    )
    // isVideoMedia is a stable module-level function, not a dependency.
  }, [view, tableSort, allNavigableItems, bboxesByMedia])

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

  // Stable across renders (depends only on the study id) so memoized children —
  // notably the Table view's rows — aren't invalidated every parent render.
  const constructImageUrl = useCallback(
    (fullFilePath) => {
      if (fullFilePath.startsWith('http')) {
        // Use cached-image protocol for remote URLs to enable disk caching
        if (id) {
          return `cached-image://cache?studyId=${encodeURIComponent(id)}&url=${encodeURIComponent(fullFilePath)}`
        }
        return fullFilePath
      }

      return `local-file://get?path=${encodeURIComponent(fullFilePath)}`
    },
    [id]
  )

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
        const currentSeqIdx = navigableItems.findIndex((s) => s.id === currentSequence.id)
        const sequencesRemaining = navigableItems.length - 1 - currentSeqIdx
        if (sequencesRemaining <= PREFETCH_THRESHOLD && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      }
    }
  }, [
    currentSequence,
    currentSequenceIndex,
    navigableItems,
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

    // Find current sequence index in the displayed (sorted) order
    const currentSeqIdx = navigableItems.findIndex((s) =>
      s.items.some((m) => m.mediaID === selectedMedia.mediaID)
    )

    // Prefetch when approaching end of loaded data
    const sequencesRemaining = navigableItems.length - 1 - currentSeqIdx
    if (sequencesRemaining <= PREFETCH_THRESHOLD && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }

    if (currentSeqIdx < navigableItems.length - 1) {
      const nextSequence = navigableItems[currentSeqIdx + 1]
      const isMultiItem = nextSequence.items.length > 1
      setCurrentSequence(isMultiItem ? nextSequence : null)
      setCurrentSequenceIndex(0)
      setSelectedMedia(nextSequence.items[0])
    }
  }, [selectedMedia, navigableItems, hasNextPage, isFetchingNextPage, fetchNextPage])

  // Navigate to previous sequence/item globally
  const handlePreviousImage = useCallback(() => {
    if (!selectedMedia) return

    const currentSeqIdx = navigableItems.findIndex((s) =>
      s.items.some((m) => m.mediaID === selectedMedia.mediaID)
    )

    if (currentSeqIdx > 0) {
      const prevSequence = navigableItems[currentSeqIdx - 1]
      const isMultiItem = prevSequence.items.length > 1
      setCurrentSequence(isMultiItem ? prevSequence : null)
      // Start at end of previous sequence
      const lastIndex = prevSequence.items.length - 1
      setCurrentSequenceIndex(lastIndex)
      setSelectedMedia(prevSequence.items[lastIndex])
    }
  }, [selectedMedia, navigableItems])

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

  // Keep a ref to the current mediaID so the UndoManager can read it without
  // forcing renders. The manager only invokes this lazily during undo/redo.
  const selectedMediaIdRef = useRef(selectedMedia?.mediaID)
  useEffect(() => {
    selectedMediaIdRef.current = selectedMedia?.mediaID
  }, [selectedMedia?.mediaID])

  // Jump the modal to a specific mediaId — used by the UndoManager so that
  // undoing an edit on a different image surfaces it. Mirrors the state
  // mutations that handleNextImage performs but resolves by id.
  const navigateToMediaId = useCallback(
    async (targetMediaId) => {
      if (!targetMediaId || selectedMediaIdRef.current === targetMediaId) return
      const seq = navigableItems.find((s) => s.items.some((m) => m.mediaID === targetMediaId))
      if (!seq) return // target not in currently loaded pages — best-effort no-op
      const itemIdx = seq.items.findIndex((m) => m.mediaID === targetMediaId)
      const safeIdx = itemIdx >= 0 ? itemIdx : 0
      const isMultiItem = seq.items.length > 1
      setCurrentSequence(isMultiItem ? seq : null)
      setCurrentSequenceIndex(safeIdx)
      setSelectedMedia(seq.items[safeIdx])
    },
    [navigableItems]
  )

  // Calculate navigation availability based on sequences
  const currentSeqIdx = selectedMedia
    ? navigableItems.findIndex((s) => s.items.some((m) => m.mediaID === selectedMedia.mediaID))
    : -1
  const hasNextSequence = currentSeqIdx >= 0 && currentSeqIdx < navigableItems.length - 1
  const hasPreviousSequence = currentSeqIdx > 0

  // For sequence navigation within modal
  const hasNextInSequence =
    currentSequence && currentSequenceIndex < currentSequence.items.length - 1
  const hasPreviousInSequence = currentSequence && currentSequenceIndex > 0

  // Prefetch neighboring images when modal is open
  useEffect(() => {
    if (isModalOpen && currentSeqIdx >= 0) {
      prefetchNeighbors(navigableItems, currentSeqIdx)
    }
  }, [isModalOpen, currentSeqIdx, navigableItems, prefetchNeighbors])

  return (
    <>
      <UndoProvider
        studyId={id}
        getCurrentMediaId={() => selectedMediaIdRef.current}
        navigateTo={navigateToMediaId}
      >
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
          deploymentID={deploymentID}
          onTimestampUpdate={handleTimestampUpdate}
          sequence={currentSequence}
          sequenceIndex={currentSequenceIndex}
          onSequenceNext={handleSequenceNext}
          onSequencePrevious={handleSequencePrevious}
          hasNextInSequence={hasNextInSequence}
          hasPreviousInSequence={hasPreviousInSequence}
          isVideoMedia={isVideoMedia}
        />
      </UndoProvider>

      <div
        className={
          embedded
            ? 'relative flex flex-col h-full overflow-hidden'
            : 'relative flex flex-col h-full bg-card rounded border border-border overflow-hidden'
        }
      >
        {/* Grid — drop horizontal padding when embedded so the first
            image cell aligns with the panel's left edge (matches the map
            in the Deployments tab). */}
        <div
          ref={gridContainerRef}
          className={`flex flex-wrap gap-[12px] flex-1 overflow-auto content-start ${
            embedded ? (view === 'table' ? 'pb-3' : 'py-3') : 'p-3'
          }`}
        >
          {/* Sequences are returned pre-grouped from server, including null-timestamp items as individual sequences */}
          {view === 'table' ? (
            <MediaTableView
              sequences={navigableItems}
              bboxesByMedia={bboxesByMedia}
              constructImageUrl={constructImageUrl}
              isVideoMedia={isVideoMedia}
              onRowClick={handleImageClick}
              sortCol={tableSort.col}
              sortDir={tableSort.dir}
              onSort={handleTableSort}
              scrollRef={gridContainerRef}
            />
          ) : (
            allNavigableItems.map((sequence) => {
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
                    reviewed={sequence.reviewed === true}
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
                  reviewed={sequence.reviewed === true}
                />
              )
            })
          )}

          {/* Loading indicator and intersection target */}
          <div ref={loaderRef} className="w-full flex justify-center p-4">
            {/* Initial load — show a spinner, never the empty-state copy, until
                the query has actually resolved (a disabled/not-yet-enabled
                infinite query reports isLoading === false, so gating the empty
                message on isLoading alone flashes "no media" before fetch). */}
            {isLoading && mediaFiles.length === 0 && (
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground"></div>
                <span className="ml-2">Loading…</span>
              </div>
            )}
            {isFetchingNextPage && (
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground"></div>
                <span className="ml-2">Loading more...</span>
              </div>
            )}
            {!hasNextPage && mediaFiles.length > 0 && !isFetchingNextPage && (
              <p className="text-muted-foreground text-sm">No more media to load</p>
            )}
            {!hasNextPage && mediaFiles.length === 0 && isSuccess && (
              <p className="text-muted-foreground">No media files match the selected filters</p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default Gallery
