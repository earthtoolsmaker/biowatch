import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, CameraOff, X, Heart } from 'lucide-react'

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
          <p className="text-white text-lg font-medium">{media.scientificName}</p>
          {media.timestamp && (
            <p className="text-white/70 text-sm">{new Date(media.timestamp).toLocaleString()}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Individual media card for the carousel (without bbox overlay)
 */
function MediaCard({ media, onClick }) {
  const [imageError, setImageError] = useState(false)

  return (
    <div
      className="flex-shrink-0 w-48 h-36 rounded-lg overflow-hidden cursor-pointer border border-gray-200 shadow-sm hover:shadow-md transition-shadow relative bg-gray-100"
      onClick={() => onClick(media)}
    >
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

      {/* Species label */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
        <p className="text-white text-xs font-medium truncate">{media.scientificName}</p>
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
export default function BestMediaCarousel({ studyId }) {
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
    staleTime: 60000 // Cache for 1 minute
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
            <MediaCard key={media.mediaID} media={media} onClick={() => setSelectedIndex(index)} />
          ))}
        </div>
      </div>

      {/* Image viewer modal */}
      {selectedIndex !== null && bestMedia[selectedIndex] && (
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
      )}
    </>
  )
}
