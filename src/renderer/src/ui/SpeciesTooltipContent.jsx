import { useState, useEffect } from 'react'
import { CameraOff, Loader2 } from 'lucide-react'
import { useCommonName } from '../utils/commonNames'
import { formatScientificName } from '../utils/scientificName'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/index.js'
import IucnBadge from './IucnBadge'
import { IUCN_ACCENT_BORDER } from './iucnPalette'

function toTitleCase(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
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

/**
 * Species tooltip content showing best image for a species
 * Used with Radix UI Tooltip
 */
// Approx chars before the 5-line clamp visibly truncates at our font/width.
// Used to decide whether the "Show more" toggle is worth rendering.
const BLURB_CLAMP_THRESHOLD = 250

export default function SpeciesTooltipContent({ imageData, studyId, size = 'md' }) {
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [blurbExpanded, setBlurbExpanded] = useState(false)
  const sciName = imageData?.scientificName
  const common = useCommonName(sciName)
  const info = resolveSpeciesInfo(sciName)
  const iucnUrl =
    info?.iucnTaxonId && info?.iucnAssessmentId
      ? `https://www.iucnredlist.org/species/${info.iucnTaxonId}/${info.iucnAssessmentId}`
      : null
  const isLarge = size === 'lg'
  const cardWidth = isLarge ? 'w-[400px]' : 'w-[320px]'
  const imageHeight = isLarge ? 'h-[230px]' : 'h-[180px]'
  const nameClass = isLarge ? 'text-sm text-foreground' : 'text-xs text-muted-foreground'
  const blurbClass = isLarge ? 'text-[13px] text-foreground' : 'text-[11px] text-foreground'
  const linkClass = isLarge ? 'text-[12px]' : 'text-[10px]'

  // Reset state when imageData changes
  useEffect(() => {
    setImageError(false)
    setImageLoaded(false)
    setBlurbExpanded(false)
  }, [imageData?.mediaID, sciName])

  // Image source priority: study photo > Wikipedia thumbnail > placeholder.
  // Study photos are usually camera-trap-shaped (~16:9), so we crop to fill
  // (object-cover). Wikipedia thumbnails come in wildly varying aspect
  // ratios, so we fit-with-letterbox (object-contain) on a black background
  // to avoid awkward crops.
  const usingFallbackImage = !imageData?.filePath && !!info?.imageUrl
  // Wikipedia thumbnails are global (same URL across all studies), so we omit
  // studyId to share one cache entry app-wide instead of duplicating per study.
  const imageSource = imageData?.filePath
    ? constructImageUrl(imageData.filePath, studyId)
    : info?.imageUrl
      ? constructImageUrl(info.imageUrl, null)
      : null

  if (!imageSource && !info?.blurb && !info?.iucn && !sciName) {
    return null
  }

  const hasCommon = common && common !== sciName

  return (
    <div
      className={`${cardWidth} bg-card rounded-lg shadow-xl border border-border overflow-hidden`}
    >
      {/* Image */}
      <div
        className={`relative w-full ${imageHeight} ${usingFallbackImage ? 'bg-black' : 'bg-muted'}`}
      >
        {!imageSource || imageError ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <CameraOff size={32} className="text-muted-foreground" />
          </div>
        ) : (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted">
                {isRemoteUrl(imageSource) ? (
                  <Loader2 size={24} className="text-muted-foreground animate-spin" />
                ) : (
                  <div className="animate-pulse bg-muted w-full h-full" />
                )}
              </div>
            )}
            <img
              src={imageSource}
              alt={sciName ?? ''}
              className={`w-full h-full ${usingFallbackImage ? 'object-contain' : 'object-cover'} transition-opacity duration-150 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          </>
        )}
      </div>

      {/* Footer: name + badge + blurb + Wikipedia link */}
      <div className="px-2.5 py-2 bg-muted border-t border-border space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className={`${nameClass} truncate`}>
            {hasCommon ? (
              <>
                {toTitleCase(common)}{' '}
                <span className="italic text-muted-foreground">
                  ({formatScientificName(sciName)})
                </span>
              </>
            ) : (
              <span className="italic">{formatScientificName(sciName)}</span>
            )}
          </p>
          <IucnBadge category={info?.iucn} />
        </div>

        {iucnUrl && (
          <a
            href={iucnUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`block border-l-4 ${IUCN_ACCENT_BORDER[info.iucn] ?? 'border-border'} pl-2 -ml-0.5 py-1 hover:bg-accent rounded-r transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300`}
          >
            <p className={`${blurbClass} font-semibold text-foreground`}>Why threatened?</p>
            <p className={`${linkClass} text-blue-600 dark:text-blue-400`}>
              View IUCN Red List assessment ↗
            </p>
          </a>
        )}

        {info?.blurb && (
          <>
            <p
              className={`${blurbClass} leading-snug ${
                blurbExpanded ? 'max-h-48 overflow-y-auto pr-1' : 'line-clamp-5'
              }`}
            >
              {info.blurb}
            </p>
            {info.blurb.length > BLURB_CLAMP_THRESHOLD && (
              <button
                type="button"
                onClick={() => setBlurbExpanded((v) => !v)}
                className={`${linkClass} text-blue-600 hover:underline dark:text-blue-400`}
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
            className={`block ${linkClass} text-blue-600 hover:underline dark:text-blue-400`}
          >
            Read on Wikipedia
          </a>
        )}
      </div>
    </div>
  )
}
