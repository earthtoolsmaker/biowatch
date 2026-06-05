import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as Tooltip from '@radix-ui/react-tooltip'
import { CameraOff, Loader2 } from 'lucide-react'
import { useCommonName } from '../utils/commonNames'
import { formatScientificName } from '../utils/scientificName'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/index.js'
import IucnBadge from './IucnBadge'
import { IUCN_ACCENT_BORDER } from './iucnPalette'
import CircularTimeFilter, { DailyActivityRadar, DailyActivityLine } from './clock'
import TimelineChart from './timeseries'
import { hasEnoughActivityData, MIN_ACTIVITY_DETECTIONS } from '../utils/activitySufficiency'

// Single accent for the hovercard's all-time activity charts (one species
// per card, so no multi-series palette is needed).
const ACTIVITY_PALETTE = ['rgb(37 99 235)']

// Small uppercase heading + top divider used to group the card's content
// (e.g. "Activity patterns", "Description"). Only render where the section
// actually has content so we never show an empty label. `action` renders a
// small control (e.g. the Wikipedia link) flush right on the heading row.
function SectionHeading({ children, action }) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
      <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {children}
      </span>
      {action}
    </div>
  )
}

// Wikipedia "W" wordmark (its favicon) as a compact clickable link. Used in
// the Description heading instead of a full-width "Read on Wikipedia" row.
function WikipediaLink({ url }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Read more on Wikipedia"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 -my-0.5 px-1.5 py-0.5 rounded font-serif text-sm leading-none text-muted-foreground transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-500/15 dark:hover:text-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          W
        </a>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          className="z-[100000] max-w-[200px] rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
        >
          Read more on Wikipedia
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

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

export default function SpeciesTooltipContent({
  imageData,
  studyId,
  size = 'md',
  showActivity = false,
  // Total detections for this species (from the distribution row). Used as a
  // cheap upper bound on the gate's timestamped-detection count: below the
  // threshold there can be no charts, so we skip both the fetch and the
  // loading skeleton (no flash for sparse species). The daily-activity sum
  // only ever counts timestamped detections, so it can't exceed this.
  detectionCount = 0
}) {
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [blurbExpanded, setBlurbExpanded] = useState(false)
  const sciName = imageData?.scientificName

  // Only species that could clear the gate are worth fetching / skeletoning.
  const mightHaveActivity = showActivity && detectionCount >= MIN_ACTIVITY_DETECTIONS

  // All-time, full-study activity for the hovered species. Fires only when
  // the card is mounted (Radix mounts content on open) and showActivity is on,
  // so the Media tab and quick hover-throughs don't trigger it. Cached per
  // study+species; gapSeconds is left undefined so the worker reads the
  // study's configured gap from metadata.
  //
  // daily-activity needs an explicit [start, end] (it returns [] otherwise),
  // so we mirror the Explore bottom row: the all-time range is the timeseries'
  // full extent (first..last day with data). We fetch the timeseries first,
  // then query daily activity over that range.
  const { data: activity, isError: activityError } = useQuery({
    queryKey: ['speciesHovercardActivity', studyId, sciName],
    queryFn: async () => {
      const ts = await window.api.getSequenceAwareTimeseries(studyId, [sciName], undefined, null)
      if (ts.error) throw new Error(ts.error)
      const timeseries = ts.data?.timeseries ?? []
      if (timeseries.length === 0) return { dailyActivity: [], timeseries: [] }

      const start = new Date(timeseries[0].date).toISOString()
      const end = new Date(timeseries[timeseries.length - 1].date).toISOString()
      const daily = await window.api.getSequenceAwareDailyActivity(
        studyId,
        [sciName],
        start,
        end,
        undefined,
        null
      )
      if (daily.error) throw new Error(daily.error)
      return { dailyActivity: daily.data ?? [], timeseries }
    },
    enabled: mightHaveActivity && !!studyId && !!sciName,
    staleTime: Infinity
  })

  const activitySpecies = sciName ? [{ scientificName: sciName }] : []
  const showCharts =
    mightHaveActivity &&
    !!activity &&
    hasEnoughActivityData(activity.dailyActivity, activity.timeseries, sciName)
  // Skeleton only while we're actually waiting on a fetch we expect to yield
  // charts — never for sparse species (gated out above) or after an error.
  const showActivitySkeleton = mightHaveActivity && !activity && !activityError
  const common = useCommonName(sciName)
  const info = resolveSpeciesInfo(sciName)
  const iucnUrl =
    info?.iucnTaxonId && info?.iucnAssessmentId
      ? `https://www.iucnredlist.org/species/${info.iucnTaxonId}/${info.iucnAssessmentId}`
      : null
  const isLarge = size === 'lg'
  const cardWidth = isLarge ? 'w-[400px]' : 'w-[320px]'
  const imageHeight = isLarge ? 'h-[230px]' : 'h-[180px]'
  const nameClass = isLarge ? 'text-sm text-foreground' : 'text-xs text-foreground'
  const blurbClass = isLarge ? 'text-[13px] text-foreground' : 'text-[11px] text-foreground'
  const linkClass = isLarge ? 'text-[12px]' : 'text-[10px]'

  // Reset state when imageData changes
  useEffect(() => {
    setImageError(false)
    setImageLoaded(false)
    setBlurbExpanded(false)
  }, [imageData?.mediaID, sciName])

  // Image source priority: scored study photo (bbox-best) > Wikipedia
  // thumbnail > fallback study photo (no bbox) > placeholder. The fallback
  // ranks below Wikipedia on purpose — a clean Wikipedia portrait usually reads
  // better than an arbitrary camera-trap frame, but a real frame still beats
  // showing nothing (e.g. CamTrap DP / GBIF studies with no bbox data).
  const studyPhotoUrl = imageData?.filePath ? constructImageUrl(imageData.filePath, studyId) : null
  const hasScoredPhoto = !!studyPhotoUrl && !imageData?.isFallback
  // Wikipedia thumbnails are global (same URL across all studies), so we omit
  // studyId to share one cache entry app-wide instead of duplicating per study.
  const wikiUrl = info?.imageUrl ? constructImageUrl(info.imageUrl, null) : null
  // True when the displayed image is the Wikipedia thumbnail. These come in
  // wildly varying aspect ratios, so we fit-with-letterbox (object-contain) on
  // a black background. Study photos (scored or fallback) are camera-trap-
  // shaped (~16:9), so they crop-to-fill (object-cover).
  const usingWikipediaImage = !hasScoredPhoto && !!wikiUrl
  const imageSource = hasScoredPhoto ? studyPhotoUrl : (wikiUrl ?? studyPhotoUrl)

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
        className={`relative w-full ${imageHeight} ${usingWikipediaImage ? 'bg-black' : 'bg-gray-100 dark:bg-muted'}`}
      >
        {!imageSource || imageError ? (
          // No usable image anywhere (no scored/fallback study photo, no
          // Wikipedia thumbnail, or the image failed to load). Mirror the
          // deployment hovercard's empty state (DeploymentHoverMap): a faint
          // grid panel + icon + label, so the slot reads as an intentional
          // "no photo" rather than a broken image.
          <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900">
            <div
              className="absolute inset-0 opacity-40 dark:opacity-20"
              style={{
                backgroundImage:
                  'linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)',
                backgroundSize: '22px 22px'
              }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-5 text-center">
              <CameraOff className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
              <span className="text-xs font-medium text-foreground">No photo available</span>
              <span className="text-[11px] leading-snug text-muted-foreground">
                No camera-trap image or reference photo was found for this species.
              </span>
            </div>
          </div>
        ) : (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-muted">
                {isRemoteUrl(imageSource) ? (
                  <Loader2 size={24} className="text-muted-foreground animate-spin" />
                ) : (
                  <div className="animate-pulse bg-gray-200 dark:bg-muted w-full h-full" />
                )}
              </div>
            )}
            <img
              src={imageSource}
              alt={sciName ?? ''}
              className={`w-full h-full ${usingWikipediaImage ? 'object-contain' : 'object-cover'} transition-opacity duration-150 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          </>
        )}
      </div>

      {/* Footer: name + badge + blurb + Wikipedia link */}
      <div className="px-2.5 py-2 bg-gray-50 dark:bg-muted border-t border-gray-100 dark:border-border space-y-1.5">
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

        {(showCharts || showActivitySkeleton) && (
          <div className="space-y-1.5">
            <SectionHeading>Activity patterns</SectionHeading>
            {showActivitySkeleton ? (
              <div className="space-y-1.5" aria-hidden="true">
                <div className="flex gap-1.5 h-[132px]">
                  <div className="flex-1 rounded-md border border-border bg-muted/40 animate-pulse" />
                  <div className="flex-1 rounded-md border border-border bg-muted/40 animate-pulse" />
                </div>
                <div className="h-[112px] rounded-md border border-border bg-muted/40 animate-pulse" />
              </div>
            ) : (
              <>
                {/* Row 1 — daytime (24h) shown both ways: polar activity radar
                    over the clock-face circle (the Explore bottom row's look,
                    minus the filter handles) and its X–Y line twin, side by
                    side. */}
                <div className="flex gap-1.5 h-[132px]">
                  <div className="relative flex-1 min-w-0 rounded-md border border-border bg-background/60">
                    <DailyActivityRadar
                      activityData={activity.dailyActivity}
                      selectedSpecies={activitySpecies}
                      palette={ACTIVITY_PALETTE}
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <CircularTimeFilter onChange={() => {}} mode="chips" chipSectors={[]} />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 rounded-md border border-border bg-background/60 p-1.5">
                    <DailyActivityLine
                      activityData={activity.dailyActivity}
                      selectedSpecies={activitySpecies}
                      palette={ACTIVITY_PALETTE}
                      showTrackStrip={false}
                    />
                  </div>
                </div>
                {/* Row 2 — activity over time (per-day, full study), display-only. */}
                <div className="h-[112px] rounded-md border border-border bg-background/60 p-1.5">
                  <TimelineChart
                    timeseriesData={activity.timeseries}
                    selectedSpecies={activitySpecies}
                    dateRange={[null, null]}
                    setDateRange={() => {}}
                    palette={ACTIVITY_PALETTE}
                    interactive={false}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {(info?.blurb || iucnUrl) && (
          <div className="space-y-1.5">
            <SectionHeading
              action={info?.wikipediaUrl && <WikipediaLink url={info.wikipediaUrl} />}
            >
              Description
            </SectionHeading>
            {info?.blurb && (
              <div className="space-y-1">
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
              </div>
            )}
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
          </div>
        )}
      </div>
    </div>
  )
}
