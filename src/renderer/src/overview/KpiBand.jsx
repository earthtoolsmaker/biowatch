import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as HoverCard from '@radix-ui/react-hover-card'
import {
  PawPrint,
  Camera,
  CalendarDays,
  Eye,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { useNavigate } from 'react-router'
import KpiTile from './KpiTile'
import SpanPicker from './SpanPicker'
import IucnBadge from '../ui/IucnBadge'
import SpeciesTooltipContent from '../ui/SpeciesTooltipContent'
import { useCommonName } from '../utils/commonNames'
import { formatScientificName } from '../utils/scientificName'
import { resolveCommonName } from '../../../shared/commonNames/index.js'
import {
  formatStatNumber,
  formatCompactCount,
  formatSpan,
  formatRangeShort
} from './utils/formatStats'

/**
 * Render `children` in a fixed-position layer anchored just below
 * `triggerRef`'s bounding rect, portalled to document.body so the popover
 * escapes the surrounding Panel's `overflow: hidden` (react-resizable-panels
 * sets that on every Panel container).
 */
function PortalPopover({ open, triggerRef, children }) {
  const [pos, setPos] = useState(null)

  useEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null)
      return
    }
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setPos({ left: rect.left, top: rect.bottom + 8 })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, triggerRef])

  if (!open || !pos) return null
  return createPortal(
    <div className="fixed z-[1000]" style={{ left: pos.left, top: pos.top }}>
      {children}
    </div>,
    document.body
  )
}

const ICON_SIZE = 14

/**
 * KPI band for the Overview tab. Five tiles: Species, Cameras, Span, Observations, Media.
 * - Span tile is editable (DateTimePicker popover).
 * - Species tile is clickable when threatenedCount > 0 (threatened-list popover).
 *
 * Renders as a horizontal carousel matching BestMediaCarousel's UX: fixed-width
 * tiles, snap scroll, scrollbar hidden, chevrons + fade gradients on the edges
 * when there's more to scroll. On wide screens all 5 tiles fit naturally so
 * the chevrons stay hidden.
 *
 * @param {Object} props
 * @param {string} props.studyId
 * @param {Object} props.studyData - The full study `data` object (description, contributors, temporal, …).
 * @param {boolean} props.isImporting - Whether an import is in progress; controls polling.
 */
export default function KpiBand({ studyId, studyData, isImporting }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // Single open-popover state — opening one auto-closes its sibling so the
  // Span picker and the Threatened-species list never stack on top of
  // each other.
  const [openPopover, setOpenPopover] = useState(null) // 'span' | 'threatened' | null
  const showPicker = openPopover === 'span'
  const showThreatened = openPopover === 'threatened'
  const togglePopover = (which) => setOpenPopover((cur) => (cur === which ? null : which))
  const closePopover = () => setOpenPopover(null)
  const spanTriggerRef = useRef(null)
  const speciesTriggerRef = useRef(null)
  // Track whether either edge of the scroll area is reached so the chevrons
  // + fade gradients only render when there's something to scroll toward.
  const carouselRef = useRef(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const container = carouselRef.current
    if (!container) return
    const checkScroll = () => {
      setCanScrollLeft(container.scrollLeft > 0)
      setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 5)
    }
    container.addEventListener('scroll', checkScroll)
    window.addEventListener('resize', checkScroll)
    checkScroll()
    return () => {
      container.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [])

  const scrollCarousel = (direction) => {
    const container = carouselRef.current
    if (!container) return
    const amount = container.clientWidth * 0.75
    container.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' })
  }

  const { data: stats } = useQuery({
    queryKey: ['overviewStats', studyId],
    queryFn: async () => {
      const response = await window.api.getOverviewStats(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    refetchInterval: isImporting ? 5000 : false,
    placeholderData: (prev) => prev
  })

  const speciesCount = stats?.speciesCount ?? null
  const threatenedCount = stats?.threatenedCount ?? null
  const threatenedSpecies = stats?.threatenedSpecies ?? []
  const cameraCount = stats?.cameraCount ?? null
  const locationCount = stats?.locationCount ?? null
  const observationCount = stats?.observationCount ?? null
  const cameraDays = stats?.cameraDays ?? null
  const mediaCount = stats?.mediaCount ?? null
  const rangeStart = stats?.derivedRange?.start ?? null
  const rangeEnd = stats?.derivedRange?.end ?? null

  const saveRange = async ({ start, end }) => {
    const newTemporal = { ...(studyData?.temporal || {}), start, end }
    await window.api.updateStudy(studyId, {
      data: { ...studyData, temporal: newTemporal }
    })
    queryClient.invalidateQueries({ queryKey: ['study'] })
    queryClient.invalidateQueries({ queryKey: ['overviewStats', studyId] })
    closePopover()
  }

  const resetDatesToAuto = async () => {
    const newTemporal = { ...(studyData?.temporal || {}) }
    delete newTemporal.start
    delete newTemporal.end
    await window.api.updateStudy(studyId, {
      data: { ...studyData, temporal: newTemporal }
    })
    queryClient.invalidateQueries({ queryKey: ['study'] })
    queryClient.invalidateQueries({ queryKey: ['overviewStats', studyId] })
    closePopover()
  }

  // Tiles are pinned at w-56 to match BestMediaCarousel's MediaCard width.
  // `py-2` reserves vertical room so tile hover shadows aren't clipped —
  // `overflow-x: auto` forces y-axis clipping. On wide screens all 5 tiles
  // fit and the chevrons hide naturally because canScrollRight stays false.
  const tileWrapperClass = 'flex flex-shrink-0 w-56 snap-start'

  return (
    <div className="relative">
      {canScrollLeft && (
        <>
          <button
            type="button"
            onClick={() => scrollCarousel('left')}
            aria-label="Scroll KPIs left"
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-card/90 rounded-full p-1 shadow-md border border-border"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-white to-transparent z-[1] pointer-events-none" />
        </>
      )}
      {canScrollRight && (
        <>
          <button
            type="button"
            onClick={() => scrollCarousel('right')}
            aria-label="Scroll KPIs right"
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-card/90 rounded-full p-1 shadow-md border border-border"
          >
            <ChevronRight size={20} />
          </button>
          <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white to-transparent z-[1] pointer-events-none" />
        </>
      )}
      <div
        ref={carouselRef}
        className="flex overflow-x-auto snap-x snap-mandatory gap-3 py-2 scrollbar-hide"
      >
        <div className={tileWrapperClass} ref={speciesTriggerRef}>
          <KpiTile
            icon={<PawPrint size={ICON_SIZE} />}
            label="Species"
            value={formatStatNumber(speciesCount)}
            sub={threatenedCount > 0 ? 'threatened' : null}
            subAccent={threatenedCount > 0 ? formatStatNumber(threatenedCount) : null}
            onClick={threatenedCount > 0 ? () => togglePopover('threatened') : undefined}
          />
        </div>
        <PortalPopover
          open={showThreatened && threatenedSpecies.length > 0}
          triggerRef={speciesTriggerRef}
        >
          <ThreatenedSpeciesPopover
            studyId={studyId}
            species={threatenedSpecies}
            onClose={closePopover}
            ignoreOutsideClickRef={speciesTriggerRef}
          />
        </PortalPopover>

        <div className={tileWrapperClass}>
          <KpiTile
            icon={<Camera size={ICON_SIZE} />}
            label="Deployments"
            value={formatStatNumber(cameraCount)}
            sub={locationCount > 0 ? `across ${formatStatNumber(locationCount)} locations` : null}
            onClick={cameraCount > 0 ? () => navigate(`/study/${studyId}/deployments`) : undefined}
          />
        </div>

        <div className={tileWrapperClass} ref={spanTriggerRef}>
          <KpiTile
            icon={<CalendarDays size={ICON_SIZE} />}
            label="Span"
            value={formatSpan(rangeStart, rangeEnd)}
            sub={formatRangeShort(rangeStart, rangeEnd)}
            onEdit={() => togglePopover('span')}
          />
        </div>
        <PortalPopover open={showPicker} triggerRef={spanTriggerRef}>
          <SpanPicker
            startValue={rangeStart}
            endValue={rangeEnd}
            onSave={saveRange}
            onCancel={closePopover}
            onResetToAuto={resetDatesToAuto}
            ignoreOutsideClickRef={spanTriggerRef}
          />
        </PortalPopover>

        <div className={tileWrapperClass}>
          <KpiTile
            icon={<Eye size={ICON_SIZE} />}
            label="Observations"
            value={formatStatNumber(observationCount)}
            sub={cameraDays > 0 ? `from ${formatCompactCount(cameraDays)} camera-days` : null}
            onClick={observationCount > 0 ? () => navigate(`/study/${studyId}/media`) : undefined}
          />
        </div>
        <div className={tileWrapperClass}>
          <KpiTile
            icon={<ImageIcon size={ICON_SIZE} />}
            label="Media"
            value={formatStatNumber(mediaCount)}
            sub={mediaCount > 0 ? 'photos & videos' : null}
            onClick={mediaCount > 0 ? () => navigate(`/study/${studyId}/media`) : undefined}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Popover listing the threatened species detected in this study.
 * Each row links to the media tab filtered by that species.
 */
function ThreatenedSpeciesPopover({ studyId, species, onClose, ignoreOutsideClickRef }) {
  const navigate = useNavigate()
  const containerRef = useRef(null)
  // Bumped on every scroll of the list — child rows watch this and close
  // their hover card when it changes so the card doesn't drift while the
  // anchor moves with the scroll.
  const [scrollSignal, setScrollSignal] = useState(0)

  useEffect(() => {
    const onMouseDown = (e) => {
      if (containerRef.current && containerRef.current.contains(e.target)) return
      if (ignoreOutsideClickRef?.current && ignoreOutsideClickRef.current.contains(e.target)) return
      // Ignore clicks inside any Radix portal-rendered content (e.g. the
      // species hover-card tooltip that pops out from a row in this list).
      // Without this, clicking a link inside the tooltip is treated as
      // outside the popover and closes the whole stack.
      if (e.target.closest('[data-radix-popper-content-wrapper]')) return
      onClose()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, ignoreOutsideClickRef])

  const handleClick = (scientificName) => {
    navigate(`/study/${studyId}/media?species=${encodeURIComponent(scientificName)}`)
  }

  // Sort by display name (common name from the bundled dictionary, falling
  // back to scientific name) so the popover lists species alphabetically.
  // The synchronous dictionary lookup is enough — GBIF-resolved common
  // names are an edge case and would require holding state for async work.
  const sortedSpecies = [...species].sort((a, b) => {
    const aDisplay = (resolveCommonName(a.scientificName) || a.scientificName).toLowerCase()
    const bDisplay = (resolveCommonName(b.scientificName) || b.scientificName).toLowerCase()
    return aDisplay.localeCompare(bDisplay)
  })

  return (
    <div
      ref={containerRef}
      onScroll={() => setScrollSignal((s) => s + 1)}
      className="bg-card rounded-lg shadow-xl border border-border w-72 max-h-80 overflow-y-auto"
    >
      <div className="px-3 py-2 border-b border-border sticky top-0 bg-card">
        <div className="text-[0.7rem] uppercase tracking-wider text-muted-foreground font-semibold">
          Threatened species
        </div>
      </div>
      <ul className="py-1">
        {sortedSpecies.map((s) => (
          <ThreatenedSpeciesRow
            key={s.scientificName}
            studyId={studyId}
            scientificName={s.scientificName}
            iucn={s.iucn}
            onClick={() => handleClick(s.scientificName)}
            scrollSignal={scrollSignal}
          />
        ))}
      </ul>
    </div>
  )
}

function ThreatenedSpeciesRow({ studyId, scientificName, iucn, onClick, scrollSignal }) {
  const commonName = useCommonName(scientificName)
  const display =
    commonName && commonName !== scientificName ? commonName : formatScientificName(scientificName)
  const showScientific = commonName && commonName !== scientificName
  const [hoverOpen, setHoverOpen] = useState(false)
  // Close any open card when the parent list scrolls — Radix HoverCard
  // tracks its trigger, so without this the card "rides along" with the row.
  useEffect(() => {
    if (scrollSignal > 0) setHoverOpen(false)
  }, [scrollSignal])
  return (
    <li>
      <HoverCard.Root open={hoverOpen} onOpenChange={setHoverOpen} openDelay={200} closeDelay={120}>
        <HoverCard.Trigger asChild>
          <button
            type="button"
            onClick={onClick}
            className="w-full text-left px-3 py-1.5 hover:bg-blue-50 transition-colors flex items-center gap-2 dark:hover:bg-blue-500/15"
          >
            <span className="flex-shrink-0">
              <IucnBadge category={iucn} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span
                className={`text-sm text-foreground ${showScientific ? 'capitalize' : 'italic'}`}
              >
                {display}
              </span>
              {showScientific && (
                <span className="text-xs italic text-muted-foreground ml-1.5">
                  {formatScientificName(scientificName)}
                </span>
              )}
            </span>
          </button>
        </HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content
            side="right"
            sideOffset={8}
            align="center"
            avoidCollisions={true}
            collisionPadding={16}
            className="z-[10001]"
          >
            <SpeciesTooltipContent imageData={{ scientificName }} studyId={studyId} size="lg" />
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>
    </li>
  )
}
