import { useState, useRef, useEffect } from 'react'
import { CameraOff, Loader2 } from 'lucide-react'

/**
 * Construct image URL for local files (same pattern as BestMediaCarousel.jsx)
 */
function constructImageUrl(fullFilePath, studyId) {
  if (!fullFilePath) return ''
  if (fullFilePath.startsWith('http')) {
    if (studyId) {
      return `cached-image://cache?studyId=${encodeURIComponent(studyId)}&url=${encodeURIComponent(fullFilePath)}`
    }
    return fullFilePath
  }
  return `local-file://get?path=${encodeURIComponent(fullFilePath)}`
}

/**
 * Check if the file path is a remote URL
 */
function isRemoteUrl(filePath) {
  return filePath?.startsWith('http')
}

/**
 * Species hover tooltip showing best image for a species
 */
export default function SpeciesTooltip({ imageData, position, studyId }) {
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const tooltipRef = useRef(null)
  const [adjustedPosition, setAdjustedPosition] = useState(position)

  // Reset state when imageData changes
  useEffect(() => {
    setImageError(false)
    setImageLoaded(false)
  }, [imageData?.mediaID])

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!tooltipRef.current) return

    const TOOLTIP_WIDTH = 280
    const TOOLTIP_HEIGHT = 230
    const PADDING = 16

    let { x, y } = position

    // Horizontal adjustment - stay within viewport
    if (x + TOOLTIP_WIDTH > window.innerWidth - PADDING) {
      x = position.x - TOOLTIP_WIDTH - 16 // Position to the left instead
    }

    // Vertical adjustment - prefer below, fallback to above
    if (y + TOOLTIP_HEIGHT > window.innerHeight - PADDING) {
      y = Math.max(PADDING, window.innerHeight - TOOLTIP_HEIGHT - PADDING)
    }

    setAdjustedPosition({ x, y })
  }, [position])

  if (!imageData?.filePath) {
    return null
  }

  return (
    <div
      ref={tooltipRef}
      className="fixed z-[10000] bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden pointer-events-none"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        width: 280
      }}
    >
      {/* Image */}
      <div className="relative w-full h-[180px] bg-gray-100">
        {imageError ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <CameraOff size={32} className="text-gray-300" />
          </div>
        ) : (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                {isRemoteUrl(imageData.filePath) ? (
                  <Loader2 size={24} className="text-gray-400 animate-spin" />
                ) : (
                  <div className="animate-pulse bg-gray-200 w-full h-full" />
                )}
              </div>
            )}
            <img
              src={constructImageUrl(imageData.filePath, studyId)}
              alt={imageData.scientificName}
              className={`w-full h-full object-cover transition-opacity duration-150 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          </>
        )}
      </div>

      {/* Species name footer */}
      <div className="px-2 py-1.5 bg-gray-50 border-t border-gray-100">
        <p className="text-xs text-gray-600 truncate italic">{imageData.scientificName}</p>
      </div>
    </div>
  )
}
