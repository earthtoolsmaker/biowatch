import { useState, useEffect } from 'react'
import { CameraOff, Loader2 } from 'lucide-react'
import { useCommonName } from '../utils/commonNames'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/index.js'

function toTitleCase(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
}

function capitalizeGenus(str) {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}

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

const IUCN_COLORS = {
  LC: 'bg-green-100 text-green-800',
  NT: 'bg-yellow-100 text-yellow-800',
  VU: 'bg-orange-100 text-orange-800',
  EN: 'bg-red-100 text-red-800',
  CR: 'bg-red-200 text-red-900',
  EX: 'bg-gray-800 text-white',
  EW: 'bg-gray-700 text-white',
  DD: 'bg-gray-100 text-gray-700',
  NE: 'bg-gray-100 text-gray-700'
}

function IucnBadge({ category }) {
  if (!category) return null
  const cls = IUCN_COLORS[category] ?? 'bg-gray-100 text-gray-700'
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${cls}`}
      title={`IUCN Red List: ${category}`}
    >
      {category}
    </span>
  )
}

/**
 * Species tooltip content showing best image for a species
 * Used with Radix UI Tooltip
 */
// Approx chars before the 5-line clamp visibly truncates at our font/width.
// Used to decide whether the "Show more" toggle is worth rendering.
const BLURB_CLAMP_THRESHOLD = 250

export default function SpeciesTooltipContent({ imageData, studyId }) {
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [blurbExpanded, setBlurbExpanded] = useState(false)
  const sciName = imageData?.scientificName
  const common = useCommonName(sciName)
  const info = resolveSpeciesInfo(sciName)

  // Reset state when imageData changes
  useEffect(() => {
    setImageError(false)
    setImageLoaded(false)
    setBlurbExpanded(false)
  }, [imageData?.mediaID, sciName])

  // Image source priority: study photo > Wikipedia thumbnail > placeholder.
  const imageSource = imageData?.filePath
    ? constructImageUrl(imageData.filePath, studyId)
    : info?.imageUrl
      ? constructImageUrl(info.imageUrl, studyId)
      : null

  if (!imageSource && !info?.blurb && !info?.iucn && !sciName) {
    return null
  }

  const hasCommon = common && common !== sciName

  return (
    <div className="w-[320px] bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden">
      {/* Image */}
      <div className="relative w-full h-[180px] bg-gray-100">
        {!imageSource || imageError ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <CameraOff size={32} className="text-gray-300" />
          </div>
        ) : (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                {isRemoteUrl(imageSource) ? (
                  <Loader2 size={24} className="text-gray-400 animate-spin" />
                ) : (
                  <div className="animate-pulse bg-gray-200 w-full h-full" />
                )}
              </div>
            )}
            <img
              src={imageSource}
              alt={sciName ?? ''}
              className={`w-full h-full object-cover transition-opacity duration-150 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          </>
        )}
      </div>

      {/* Footer: name + badge + blurb + Wikipedia link */}
      <div className="px-2.5 py-2 bg-gray-50 border-t border-gray-100 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs text-gray-600 truncate">
            {hasCommon ? (
              <>
                {toTitleCase(common)}{' '}
                <span className="italic text-gray-500">({capitalizeGenus(sciName)})</span>
              </>
            ) : (
              <span className="italic">{capitalizeGenus(sciName)}</span>
            )}
          </p>
          <IucnBadge category={info?.iucn} />
        </div>

        {info?.blurb && (
          <>
            <p
              className={`text-[11px] text-gray-700 leading-snug ${
                blurbExpanded ? 'max-h-48 overflow-y-auto pr-1' : 'line-clamp-5'
              }`}
            >
              {info.blurb}
            </p>
            {info.blurb.length > BLURB_CLAMP_THRESHOLD && (
              <button
                type="button"
                onClick={() => setBlurbExpanded((v) => !v)}
                className="text-[10px] text-blue-600 hover:underline"
              >
                {blurbExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </>
        )}

        {info?.wikipediaUrl && (
          <a
            href={info.wikipediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[10px] text-blue-600 hover:underline"
          >
            Read on Wikipedia
          </a>
        )}
      </div>
    </div>
  )
}
