import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, CameraOff, X, Heart, Play, Loader2 } from 'lucide-react'

/**
 * Constructs a file URL for the local file protocol
 * @param {string} fullFilePath - Full path to the file
 * @returns {string} - URL for loading the file
 */
function constructImageUrl(fullFilePath) {
  if (!fullFilePath) return ''
  if (fullFilePath.startsWith('http')) {
    // Use HTTPS URL directly - browser cache will handle caching
    return fullFilePath
  }
  return `local-file://get?path=${encodeURIComponent(fullFilePath)}`
}

/**
 * Check if media item is a video based on fileMediatype or file extension
 */
function isVideoMedia(mediaItem) {
  if (mediaItem?.fileMediatype?.startsWith('video/')) return true
  const videoExtensions = ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.m4v']
  const ext = mediaItem?.fileName?.toLowerCase().match(/\.[^.]+$/)?.[0]
  return ext ? videoExtensions.includes(ext) : false
}

/**
 * Image viewer modal with navigation for the best captures carousel
 */
function ImageViewerModal({
  media,
  onClose,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
  studyId,
  onFavoriteChanged
}) {
  const [imageError, setImageError] = useState(false)
  const [isFavorite, setIsFavorite] = useState(media?.favorite ?? false)
  const hasFavoriteChanged = useRef(false)
  const queryClient = useQueryClient()

  // Reset image error and sync favorite when media changes
  useEffect(() => {
    setImageError(false)
    setIsFavorite(media?.favorite ?? false)
  }, [media?.mediaID, media?.favorite])

  // Mutation for toggling favorite status
  const favoriteMutation = useMutation({
    mutationFn: async ({ mediaID, favorite }) => {
      const response = await window.api.setMediaFavorite(studyId, mediaID, favorite)
      if (response.error) {
        throw new Error(response.error)
      }
      return response
    },
    onMutate: async ({ favorite }) => {
      setIsFavorite(favorite)
    },
    onError: () => {
      setIsFavorite(!isFavorite)
    },
    onSettled: () => {
      // Track that favorites changed, but don't invalidate bestMedia yet
      // This prevents the media from disappearing while still viewing it
      hasFavoriteChanged.current = true
      // Only invalidate media query (for ImageModal in media tab)
      queryClient.invalidateQueries({ queryKey: ['media'] })
    }
  })

  // Wrap onClose to trigger bestMedia invalidation after modal closes
  const handleClose = () => {
    onClose()
    if (hasFavoriteChanged.current && onFavoriteChanged) {
      onFavoriteChanged()
    }
  }

  // Handle keyboard events (Escape to close, Arrow keys to navigate)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose()
      } else if (e.key === 'ArrowRight' && hasNext) {
        onNext()
      } else if (e.key === 'ArrowLeft' && hasPrevious) {
        onPrevious()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, onNext, onPrevious, hasNext, hasPrevious, onFavoriteChanged])

  if (!media) return null

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1001]"
      onClick={handleClose}
    >
      {/* Close button */}
      <button
        onClick={handleClose}
        className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
        aria-label="Close"
      >
        <X size={24} />
      </button>

      {/* Favorite button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          favoriteMutation.mutate({ mediaID: media.mediaID, favorite: !isFavorite })
        }}
        className={`absolute top-4 right-16 z-10 p-2 rounded-full transition-colors ${
          isFavorite
            ? 'bg-red-500 text-white hover:bg-red-600'
            : 'bg-black/50 hover:bg-black/70 text-white'
        }`}
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Heart size={24} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>

      {/* Previous button */}
      {hasPrevious && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPrevious()
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
          aria-label="Previous image"
        >
          <ChevronLeft size={28} />
        </button>
      )}

      {/* Next button */}
      {hasNext && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onNext()
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
          aria-label="Next image"
        >
          <ChevronRight size={28} />
        </button>
      )}

      {/* Image container */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {imageError ? (
          <div className="flex flex-col items-center justify-center bg-gray-800 rounded-lg p-16">
            <CameraOff size={48} className="text-gray-400 mb-4" />
            <p className="text-gray-400">Image not available</p>
          </div>
        ) : (
          <img
            src={constructImageUrl(media.filePath)}
            alt={media.scientificName || 'Wildlife'}
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onError={() => setImageError(true)}
          />
        )}

        {/* Species info overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 rounded-b-lg">
          <p className="text-white text-lg font-medium">{media.scientificName || 'No species'}</p>
          {media.timestamp && (
            <p className="text-white/70 text-sm">{new Date(media.timestamp).toLocaleString()}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Video viewer modal with navigation and transcoding support
 */
function VideoViewerModal({
  media,
  onClose,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
  studyId,
  onFavoriteChanged
}) {
  const [videoError, setVideoError] = useState(false)
  const [isFavorite, setIsFavorite] = useState(media?.favorite ?? false)
  const hasFavoriteChanged = useRef(false)
  const queryClient = useQueryClient()

  // Transcoding state: 'idle' | 'checking' | 'transcoding' | 'ready' | 'error'
  const [transcodeState, setTranscodeState] = useState('idle')
  const [transcodeProgress, setTranscodeProgress] = useState(0)
  const [transcodedUrl, setTranscodedUrl] = useState(null)
  const [transcodeError, setTranscodeError] = useState(null)

  // Reset states when media changes
  useEffect(() => {
    setVideoError(false)
    setIsFavorite(media?.favorite ?? false)
    setTranscodeState('idle')
    setTranscodeProgress(0)
    setTranscodedUrl(null)
    setTranscodeError(null)
  }, [media?.mediaID, media?.favorite])

  // Video transcoding effect
  useEffect(() => {
    if (!media || !isVideoMedia(media)) return

    let cancelled = false
    let unsubscribeProgress = null

    const handleTranscoding = async () => {
      setTranscodeState('checking')

      try {
        const needsTranscode = await window.api.transcode.needsTranscoding(media.filePath)

        if (cancelled) return

        if (!needsTranscode) {
          setTranscodeState('idle')
          return
        }

        const cachedPath = await window.api.transcode.getCached(studyId, media.filePath)

        if (cancelled) return

        if (cachedPath) {
          const url = `local-file://get?path=${encodeURIComponent(cachedPath)}`
          setTranscodedUrl(url)
          setTranscodeState('ready')
          return
        }

        setTranscodeState('transcoding')
        setTranscodeProgress(0)

        unsubscribeProgress = window.api.transcode.onProgress(({ filePath, progress }) => {
          if (filePath === media.filePath) {
            setTranscodeProgress(progress)
          }
        })

        const result = await window.api.transcode.start(studyId, media.filePath)

        if (cancelled) return

        if (result.success) {
          const url = `local-file://get?path=${encodeURIComponent(result.path)}`
          setTranscodedUrl(url)
          setTranscodeState('ready')
        } else {
          setTranscodeError(result.error || 'Transcoding failed')
          setTranscodeState('error')
        }
      } catch (err) {
        if (!cancelled) {
          setTranscodeError(err.message || 'Transcoding failed')
          setTranscodeState('error')
        }
      }
    }

    handleTranscoding()

    return () => {
      cancelled = true
      if (unsubscribeProgress) {
        unsubscribeProgress()
      }
      if (media?.filePath) {
        window.api.transcode.cancel(media.filePath)
      }
    }
  }, [media, studyId])

  // Favorite mutation
  const favoriteMutation = useMutation({
    mutationFn: async ({ mediaID, favorite }) => {
      const response = await window.api.setMediaFavorite(studyId, mediaID, favorite)
      if (response.error) {
        throw new Error(response.error)
      }
      return response
    },
    onMutate: async ({ favorite }) => {
      setIsFavorite(favorite)
    },
    onError: () => {
      setIsFavorite(!isFavorite)
    },
    onSettled: () => {
      hasFavoriteChanged.current = true
      queryClient.invalidateQueries({ queryKey: ['media'] })
    }
  })

  const handleClose = () => {
    onClose()
    if (hasFavoriteChanged.current && onFavoriteChanged) {
      onFavoriteChanged()
    }
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose()
      } else if (e.key === 'ArrowRight' && hasNext) {
        onNext()
      } else if (e.key === 'ArrowLeft' && hasPrevious) {
        onPrevious()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, onNext, onPrevious, hasNext, hasPrevious, onFavoriteChanged])

  if (!media) return null

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1001]"
      onClick={handleClose}
    >
      {/* Close button */}
      <button
        onClick={handleClose}
        className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
        aria-label="Close"
      >
        <X size={24} />
      </button>

      {/* Favorite button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          favoriteMutation.mutate({ mediaID: media.mediaID, favorite: !isFavorite })
        }}
        className={`absolute top-4 right-16 z-10 p-2 rounded-full transition-colors ${
          isFavorite
            ? 'bg-red-500 text-white hover:bg-red-600'
            : 'bg-black/50 hover:bg-black/70 text-white'
        }`}
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Heart size={24} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>

      {/* Previous button */}
      {hasPrevious && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPrevious()
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
          aria-label="Previous video"
        >
          <ChevronLeft size={28} />
        </button>
      )}

      {/* Next button */}
      {hasNext && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onNext()
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
          aria-label="Next video"
        >
          <ChevronRight size={28} />
        </button>
      )}

      {/* Video container */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Transcoding states */}
        {transcodeState === 'checking' ? (
          <div className="flex flex-col items-center justify-center p-8 text-gray-400 min-h-[300px]">
            <Loader2 size={48} className="animate-spin text-blue-500" />
            <span className="mt-4 text-lg font-medium">Checking video format...</span>
          </div>
        ) : transcodeState === 'transcoding' ? (
          <div className="flex flex-col items-center justify-center p-8 text-gray-400 min-h-[300px]">
            <div className="relative">
              <Loader2 size={64} className="animate-spin text-blue-500" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-bold text-blue-400">{transcodeProgress}%</span>
              </div>
            </div>
            <span className="mt-4 text-lg font-medium">Converting video...</span>
            <span className="mt-2 text-sm text-gray-500">
              This format requires conversion for browser playback
            </span>
            <div className="mt-4 w-64 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${transcodeProgress}%` }}
              />
            </div>
            <span className="mt-2 text-xs text-gray-500">{media.fileName}</span>
          </div>
        ) : transcodeState === 'error' ? (
          <div className="flex flex-col items-center justify-center p-8 text-gray-400 min-h-[300px]">
            <Play size={64} className="text-red-400" />
            <span className="mt-4 text-lg font-medium text-red-400">Conversion failed</span>
            <span className="mt-2 text-sm text-gray-500">{transcodeError}</span>
            <span className="mt-1 text-xs text-gray-500">{media.fileName}</span>
          </div>
        ) : videoError && transcodeState !== 'ready' ? (
          <div className="flex flex-col items-center justify-center p-8 text-gray-400 min-h-[300px]">
            <Play size={64} />
            <span className="mt-4 text-lg font-medium">Video</span>
            <span className="mt-2 text-sm text-gray-500">Format not supported by browser</span>
            <span className="mt-1 text-xs text-gray-500">{media.fileName}</span>
          </div>
        ) : (
          <video
            key={transcodedUrl || media.filePath}
            src={transcodedUrl || constructImageUrl(media.filePath)}
            className="max-w-full max-h-[calc(90vh-120px)] w-auto h-auto object-contain rounded-lg"
            controls
            autoPlay
            onError={() => {
              if (transcodeState === 'idle' || transcodeState === 'ready') {
                setVideoError(true)
              }
            }}
          />
        )}

        {/* Species info overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 rounded-b-lg">
          <p className="text-white text-lg font-medium">{media.scientificName || 'No species'}</p>
          {media.timestamp && (
            <p className="text-white/70 text-sm">{new Date(media.timestamp).toLocaleString()}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Individual media card for the carousel (supports both images and videos)
 */
function MediaCard({ media, onClick, studyId }) {
  const [imageError, setImageError] = useState(false)
  const [thumbnailUrl, setThumbnailUrl] = useState(null)
  const [isExtractingThumbnail, setIsExtractingThumbnail] = useState(false)

  const isVideo = isVideoMedia(media)

  // Video thumbnail extraction effect
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
  }, [isVideo, media?.filePath, media?.mediaID, studyId])

  return (
    <div
      className="flex-shrink-0 w-48 h-36 rounded-lg overflow-hidden cursor-pointer border border-gray-200 shadow-sm hover:shadow-md transition-shadow relative bg-gray-100"
      onClick={() => onClick(media)}
    >
      {isVideo ? (
        <>
          {/* Video placeholder background */}
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
              src={thumbnailUrl}
              alt={media.fileName || `Video ${media.mediaID}`}
              className="relative z-10 w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            /* Video element - overlays placeholder when it loads successfully */
            <video
              src={constructImageUrl(media.filePath)}
              className={`relative z-10 w-full h-full object-cover ${imageError ? 'hidden' : ''}`}
              onError={() => setImageError(true)}
              muted
              preload="metadata"
            />
          )}

          {/* Video indicator badge */}
          <div className="absolute bottom-8 right-2 z-20 bg-black/70 text-white px-1.5 py-0.5 rounded text-xs flex items-center gap-1">
            <Play size={12} />
          </div>
        </>
      ) : (
        <>
          {/* Image thumbnail */}
          <img
            src={constructImageUrl(media.filePath)}
            alt={media.scientificName || 'Wildlife'}
            className={`w-full h-full object-cover ${imageError ? 'hidden' : ''}`}
            onError={() => setImageError(true)}
            loading="lazy"
          />

          {/* Error fallback */}
          {imageError && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-200">
              <CameraOff size={24} className="text-gray-400" />
            </div>
          )}
        </>
      )}

      {/* Species label */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 z-20">
        <p className="text-white text-xs font-medium truncate">
          {media.scientificName || 'Unknown species'}
        </p>
      </div>
    </div>
  )
}

/**
 * Best Media Carousel component for the Overview page.
 * Displays top-scoring media files based on bbox quality heuristic.
 *
 * @param {Object} props
 * @param {string} props.studyId - Study ID to fetch media for
 */
export default function BestMediaCarousel({ studyId, isRunning }) {
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const carouselRef = useRef(null)
  const queryClient = useQueryClient()

  // Fetch best media using the scoring heuristic
  const {
    data: bestMedia = [],
    isLoading,
    error
  } = useQuery({
    queryKey: ['bestMedia', studyId],
    queryFn: async () => {
      const response = await window.api.getBestMedia(studyId, { limit: 12 })
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    staleTime: 60000, // Cache for 1 minute
    refetchInterval: isRunning ? 5000 : false // Poll every 5s during ML run
  })

  // Check scroll state when media changes or on resize
  useEffect(() => {
    if (!carouselRef.current) return

    const checkScroll = () => {
      const container = carouselRef.current
      if (!container) return
      setCanScrollLeft(container.scrollLeft > 0)
      setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 5)
    }

    const container = carouselRef.current
    container.addEventListener('scroll', checkScroll)
    checkScroll()
    window.addEventListener('resize', checkScroll)

    return () => {
      container?.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [bestMedia])

  const scroll = (direction) => {
    if (!carouselRef.current) return
    const container = carouselRef.current
    const scrollAmount = container.clientWidth * 0.75
    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    })
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="h-44">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Best Captures</h3>
        <div className="h-36 flex items-center justify-center text-gray-400">
          <span className="animate-pulse">Loading best captures...</span>
        </div>
      </div>
    )
  }

  // Hide carousel if no data or error
  if (error || bestMedia.length === 0) {
    return null
  }

  return (
    <>
      <div className="relative">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Best Captures</h3>

        {/* Left scroll button */}
        {canScrollLeft && (
          <button
            className="absolute left-0 top-1/2 translate-y-1 z-10 bg-white/90 rounded-full p-1 shadow-md border border-gray-200"
            onClick={() => scroll('left')}
            aria-label="Scroll left"
          >
            <ChevronLeft size={20} />
          </button>
        )}

        {/* Right scroll button */}
        {canScrollRight && (
          <button
            className="absolute right-0 top-1/2 translate-y-1 z-10 bg-white/90 rounded-full p-1 shadow-md border border-gray-200"
            onClick={() => scroll('right')}
            aria-label="Scroll right"
          >
            <ChevronRight size={20} />
          </button>
        )}

        {/* Left fade effect */}
        {canScrollLeft && (
          <div className="absolute left-0 top-6 bottom-0 w-12 bg-gradient-to-r from-white to-transparent z-[1] pointer-events-none" />
        )}

        {/* Right fade effect */}
        {canScrollRight && (
          <div className="absolute right-0 top-6 bottom-0 w-12 bg-gradient-to-l from-white to-transparent z-[1] pointer-events-none" />
        )}

        {/* Carousel container */}
        <div
          ref={carouselRef}
          className="flex gap-4 overflow-x-auto scrollbar-hide"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {bestMedia.map((media, index) => (
            <MediaCard
              key={media.mediaID}
              media={media}
              onClick={() => setSelectedIndex(index)}
              studyId={studyId}
            />
          ))}
        </div>
      </div>

      {/* Media viewer modal - choose based on media type */}
      {selectedIndex !== null &&
        bestMedia[selectedIndex] &&
        (isVideoMedia(bestMedia[selectedIndex]) ? (
          <VideoViewerModal
            media={bestMedia[selectedIndex]}
            onClose={() => setSelectedIndex(null)}
            onNext={() => setSelectedIndex((i) => Math.min(i + 1, bestMedia.length - 1))}
            onPrevious={() => setSelectedIndex((i) => Math.max(i - 1, 0))}
            hasNext={selectedIndex < bestMedia.length - 1}
            hasPrevious={selectedIndex > 0}
            studyId={studyId}
            onFavoriteChanged={() =>
              queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })
            }
          />
        ) : (
          <ImageViewerModal
            media={bestMedia[selectedIndex]}
            onClose={() => setSelectedIndex(null)}
            onNext={() => setSelectedIndex((i) => Math.min(i + 1, bestMedia.length - 1))}
            onPrevious={() => setSelectedIndex((i) => Math.max(i - 1, 0))}
            hasNext={selectedIndex < bestMedia.length - 1}
            hasPrevious={selectedIndex > 0}
            studyId={studyId}
            onFavoriteChanged={() =>
              queryClient.invalidateQueries({ queryKey: ['bestMedia', studyId] })
            }
          />
        ))}
    </>
  )
}
