import { useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import * as HoverCard from '@radix-ui/react-hover-card'
import { getMapDisplayName } from '../utils/commonNames'
import { formatScientificName } from '../utils/scientificName'

const GAP_PX = 6 // matches gap-1.5
const OVERFLOW_RESERVE_PX = 42 // approx width of the "+N" pill, kept free

const CARD_CLASS =
  'z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md'

// One species line (color dot + common name + scientific name + optional
// observation count), shared by the chip card and the "+N" list card.
function SpeciesLine({ species, color, scientificToCommon }) {
  const common = getMapDisplayName(species.scientificName, scientificToCommon)
  const sci = formatScientificName(species.scientificName)
  const showSci = common && common !== species.scientificName
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0 mt-1"
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0">
        <div className={common ? 'capitalize text-foreground' : 'italic text-foreground'}>
          {common || sci}
        </div>
        {showSci && <div className="italic text-muted-foreground">{sci}</div>}
        {typeof species.count === 'number' && (
          <div className="text-muted-foreground tabular-nums">
            {species.count.toLocaleString()} observation{species.count !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Compact, in-control-bar readout of the selected species, shown when the
 * species rail is hidden so the legend + selection stay visible in any view.
 * Colors match the rail/map legend (palette indexed by position).
 *
 * - `compact` (narrow screens): a single count pill (dot + number), no removal.
 * - otherwise: fits as MANY removable chips (dot + name + ×) as the available
 *   width allows, then a "+N" overflow pill — measured with a ResizeObserver so
 *   it re-flows on resize and never pushes into the neighbouring controls.
 *
 * Hovering a chip shows a card with that species' info; hovering "+N" lists the
 * remaining species. The × is disabled when only one species remains. Adding
 * species is done by reopening the rail.
 */
export default function SelectedSpeciesChips({
  selectedSpecies,
  palette,
  scientificToCommon,
  onRemove,
  onOpen = () => {},
  compact = false
}) {
  const containerRef = useRef(null)
  const measureRef = useRef(null)
  const [visibleCount, setVisibleCount] = useState(selectedSpecies?.length ?? 0)

  useLayoutEffect(() => {
    if (compact) return
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure) return

    const recompute = () => {
      const avail = container.clientWidth
      const chipEls = Array.from(measure.children)
      let used = 0
      let count = 0
      for (let i = 0; i < chipEls.length; i++) {
        const w = chipEls[i].offsetWidth + (i > 0 ? GAP_PX : 0)
        const reserve = i < chipEls.length - 1 ? OVERFLOW_RESERVE_PX + GAP_PX : 0
        if (used + w + reserve <= avail) {
          used += w
          count++
        } else {
          break
        }
      }
      setVisibleCount(count)
    }

    recompute()
    const observer = new ResizeObserver(recompute)
    observer.observe(container)
    return () => observer.disconnect()
  }, [compact, selectedSpecies, scientificToCommon])

  if (!selectedSpecies || selectedSpecies.length === 0) return null

  const colorFor = (index) => palette[index % palette.length]
  const labelFor = (species) =>
    getMapDisplayName(species.scientificName, scientificToCommon) ||
    formatScientificName(species.scientificName)

  // Count pill: a dot + total, opening the rail on click and listing every
  // selected species on hover. Used on narrow screens (compact) and as the
  // wide-screen fallback when not even one chip fits.
  const countPill = () => (
    <HoverCard.Root openDelay={150} closeDelay={0}>
      <HoverCard.Trigger asChild>
        <button
          type="button"
          onClick={onOpen}
          aria-label="Show species panel"
          className="inline-flex items-center gap-1.5 h-7 rounded-full border border-border bg-card px-2.5 text-sm text-foreground flex-shrink-0 cursor-pointer hover:bg-accent"
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: colorFor(0) }}
          />
          <span className="tabular-nums">{selectedSpecies.length}</span>
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content side="bottom" align="start" sideOffset={6} className={CARD_CLASS}>
          <div className="font-medium mb-1">{selectedSpecies.length} selected species</div>
          {selectedSpecies.map((species, i) => (
            <SpeciesLine
              key={species.scientificName}
              species={species}
              color={colorFor(i)}
              scientificToCommon={scientificToCommon}
            />
          ))}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  )

  if (compact) {
    return countPill()
  }

  const removable = selectedSpecies.length > 1
  const showCountFallback = visibleCount === 0
  const visible = selectedSpecies.slice(0, visibleCount)
  const overflowSpecies = selectedSpecies.slice(visibleCount)

  const chipClass =
    'inline-flex items-center gap-1.5 h-7 rounded-full border border-border bg-card pl-2.5 pr-1.5 text-sm text-foreground flex-shrink-0 max-w-[12rem] cursor-default'

  return (
    <div ref={containerRef} className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
      {/* Hidden measurer — all chips at natural width, off-flow. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="absolute left-[-9999px] top-0 flex items-center gap-1.5 pointer-events-none"
      >
        {selectedSpecies.map((species) => (
          <span key={species.scientificName} className={chipClass}>
            <span className="w-2 h-2 rounded-full flex-shrink-0" />
            <span className="truncate capitalize">{labelFor(species)}</span>
            {removable && <span className="w-4 h-4 flex-shrink-0" />}
          </span>
        ))}
      </div>

      {showCountFallback ? (
        countPill()
      ) : (
        <>
          {visible.map((species, index) => {
            const label = labelFor(species)
            return (
              <HoverCard.Root key={species.scientificName} openDelay={150} closeDelay={0}>
                <HoverCard.Trigger asChild>
                  <span className={chipClass}>
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: colorFor(index) }}
                    />
                    <span className="truncate capitalize">{label}</span>
                    {removable && (
                      <button
                        type="button"
                        onClick={() => onRemove(species.scientificName)}
                        aria-label={`Remove ${label}`}
                        className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </span>
                </HoverCard.Trigger>
                <HoverCard.Portal>
                  <HoverCard.Content
                    side="bottom"
                    align="start"
                    sideOffset={6}
                    className={CARD_CLASS}
                  >
                    <SpeciesLine
                      species={species}
                      color={colorFor(index)}
                      scientificToCommon={scientificToCommon}
                    />
                  </HoverCard.Content>
                </HoverCard.Portal>
              </HoverCard.Root>
            )
          })}
          {overflowSpecies.length > 0 && (
            <HoverCard.Root openDelay={150} closeDelay={0}>
              <HoverCard.Trigger asChild>
                <span className="inline-flex items-center h-7 rounded-full border border-border bg-card px-2.5 text-sm text-muted-foreground tabular-nums flex-shrink-0 cursor-default">
                  +{overflowSpecies.length}
                </span>
              </HoverCard.Trigger>
              <HoverCard.Portal>
                <HoverCard.Content side="bottom" align="end" sideOffset={6} className={CARD_CLASS}>
                  <div className="font-medium mb-1">{overflowSpecies.length} more species</div>
                  {overflowSpecies.map((species, i) => (
                    <SpeciesLine
                      key={species.scientificName}
                      species={species}
                      color={colorFor(visibleCount + i)}
                      scientificToCommon={scientificToCommon}
                    />
                  ))}
                </HoverCard.Content>
              </HoverCard.Portal>
            </HoverCard.Root>
          )}
        </>
      )}
    </div>
  )
}
