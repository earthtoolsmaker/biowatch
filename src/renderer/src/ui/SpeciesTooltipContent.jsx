import { useState, useEffect } from 'react'
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
 * Species tooltip content showing best image for a species
 * Used with Radix UI Tooltip
 */
export default function SpeciesTooltipContent({ imageData, studyId }) {
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)

  // Reset state when imageData changes
  useEffect(() => {
    setImageError(false)
    setImageLoaded(false)
  }, [imageData?.mediaID])

  if (!imageData?.filePath) {
    return null
  }

  return (
    <div className="w-[280px] bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden">
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
