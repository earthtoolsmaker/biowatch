import { Children, cloneElement, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import * as HoverCard from '@radix-ui/react-hover-card'
import { CameraOff, ChevronLeft, ChevronRight } from 'lucide-react'
import { useSequenceGap } from '../hooks/useSequenceGap'
import { useCommonName } from '../utils/commonNames'
import { formatScientificName } from '../utils/scientificName'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/index.js'
import { isBlank, isDomestic, isHumanOrVehicle, isNonSpeciesLabel } from '../utils/speciesUtils'
import SpeciesTooltipContent from '../ui/SpeciesTooltipContent'
import { useHorizontalWheelScroll } from '../hooks/useHorizontalWheelScroll'

const TOP_N = 8

/**
 * Fallback for the Best Captures band when there's no scored media yet.
 * Shows the most common detected species using their bundled Wikipedia
 * thumbnails. Hidden if no species have an `imageUrl` available.
 */
export default function CommonSpeciesFallback({ studyId }) {
  const navigate = useNavigate()
  const { sequenceGap } = useSequenceGap(studyId)

  const { data: speciesData } = useQuery({
    queryKey: ['sequenceAwareSpeciesDistribution', studyId, sequenceGap],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareSpeciesDistribution(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId && sequenceGap !== undefined,
    staleTime: Infinity
  })

  // Top species by count, excluding blanks/humans/processing labels, with a
  // resolvable Wikipedia image. Pre-sorted by count descending from the API.
  const candidates = (speciesData || [])
    .filter(
      (s) =>
        !isBlank(s.scientificName) &&
        !isHumanOrVehicle(s.scientificName) &&
        !isDomestic(s.scientificName) &&
        !isNonSpeciesLabel(s.scientificName)
    )
    .map((s) => ({
      ...s,
      info: resolveSpeciesInfo(s.scientificName)
    }))
    .filter((s) => s.info?.imageUrl)
    .slice(0, TOP_N)

  if (candidates.length === 0) return null

  const handleClick = (scientificName) => {
    navigate(`/study/${studyId}/media?species=${encodeURIComponent(scientificName)}`)
  }

  return (
    <section>
      <h3 className="text-[0.7rem] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
        Featured species
      </h3>
      <ScrollableStrip>
        {candidates.map((c) => (
          <SpeciesReferenceCard
            key={c.scientificName}
            species={c}
            studyId={studyId}
            onClick={handleClick}
          />
        ))}
      </ScrollableStrip>
    </section>
  )
}

/**
 * Horizontal strip with chevron scroll buttons + fades.
 * Matches the BestMediaCarousel pattern.
 */
function ScrollableStrip({ children }) {
  const containerRef = useRef(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [scrollSignal, setScrollSignal] = useState(0)

  useHorizontalWheelScroll(containerRef)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const checkScroll = () => {
      setCanScrollLeft(container.scrollLeft > 0)
      setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 5)
    }

    const onScroll = () => {
      checkScroll()
      setScrollSignal((s) => s + 1)
    }

    container.addEventListener('scroll', onScroll)
    checkScroll()
    window.addEventListener('resize', checkScroll)

    return () => {
      container.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [children])

  const scroll = (direction) => {
    const container = containerRef.current
    if (!container) return
    container.scrollBy({
      left: direction === 'left' ? -container.clientWidth * 0.75 : container.clientWidth * 0.75,
      behavior: 'smooth'
    })
  }

  return (
    <div className="relative">
      {canScrollLeft && (
        <button
          type="button"
          className="absolute left-0 top-[5.75rem] -translate-y-1/2 z-10 bg-card/90 rounded-full p-1 shadow-md border border-border"
          onClick={() => scroll('left')}
          aria-label="Scroll left"
        >
          <ChevronLeft size={20} />
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          className="absolute right-0 top-[5.75rem] -translate-y-1/2 z-10 bg-card/90 rounded-full p-1 shadow-md border border-border"
          onClick={() => scroll('right')}
          aria-label="Scroll right"
        >
          <ChevronRight size={20} />
        </button>
      )}
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-card to-transparent dark:from-card z-[1] pointer-events-none" />
      )}
      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-card to-transparent dark:from-card z-[1] pointer-events-none" />
      )}
      <div
        ref={containerRef}
        className="flex gap-3 overflow-x-auto scrollbar-hide py-3"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {Children.map(children, (child) => cloneElement(child, { scrollSignal }))}
      </div>
    </div>
  )
}

function SpeciesReferenceCard({ species, studyId, onClick, scrollSignal }) {
  const [imageError, setImageError] = useState(false)
  const [hoverOpen, setHoverOpen] = useState(false)
  const resolvedCommon = useCommonName(species.scientificName)
  const showSci = !resolvedCommon && species.scientificName
  const commonName =
    resolvedCommon || formatScientificName(species.scientificName) || 'Unknown species'

  useEffect(() => {
    if (scrollSignal > 0) setHoverOpen(false)
  }, [scrollSignal])

  return (
    <HoverCard.Root open={hoverOpen} onOpenChange={setHoverOpen} openDelay={400} closeDelay={120}>
      <HoverCard.Trigger asChild>
        <button
          type="button"
          onClick={() => onClick(species.scientificName)}
          className="group flex-shrink-0 w-56 rounded-lg overflow-hidden cursor-pointer border border-border shadow hover:shadow-md transition-shadow text-left bg-card"
        >
          <div className="relative w-full h-40 bg-muted overflow-hidden">
            {imageError ? (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <CameraOff size={24} />
              </div>
            ) : (
              <img
                src={species.info.imageUrl}
                alt={species.scientificName}
                className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-110"
                loading="lazy"
                onError={() => setImageError(true)}
                referrerPolicy="no-referrer"
              />
            )}
          </div>
          <div className="px-2 py-1.5">
            <p
              className={`text-xs font-medium text-foreground truncate ${showSci ? 'italic' : 'capitalize'}`}
            >
              {commonName}
            </p>
            <p className="text-[0.65rem] text-muted-foreground">
              {species.count.toLocaleString('en-US')} observations
            </p>
          </div>
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          sideOffset={8}
          align="center"
          avoidCollisions={true}
          collisionPadding={16}
          className="species-hovercard z-[10000]"
        >
          <SpeciesTooltipContent
            imageData={{ scientificName: species.scientificName }}
            studyId={studyId}
            size="lg"
          />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  )
}
