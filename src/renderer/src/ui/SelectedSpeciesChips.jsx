import { useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { getMapDisplayName } from '../utils/commonNames'
import { formatScientificName } from '../utils/scientificName'

const GAP_PX = 6 // matches gap-1.5
const OVERFLOW_RESERVE_PX = 42 // approx width of the "+N" pill, kept free

/**
 * Compact, in-control-bar readout of the selected species, shown when the
 * species rail is hidden so the legend + selection stay visible in any view.
 * Colors match the rail/map legend (palette indexed by position).
 *
 * - `compact` (narrow screens): a single count pill (dot + number), no removal.
 * - otherwise: fits as MANY removable chips (dot + name + ×) as the available
 *   width allows, then a "+N" overflow pill. The fit is measured with a
 *   ResizeObserver so it re-flows as the bar resizes; it never pushes into the
 *   neighbouring controls. The × is disabled when only one species remains
 *   (selection can't be empty). Adding species is done by reopening the rail.
 */
export default function SelectedSpeciesChips({
  selectedSpecies,
  palette,
  scientificToCommon,
  onRemove,
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
        // Reserve room for the "+N" pill unless this is the last chip.
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

  const labelFor = (species) =>
    getMapDisplayName(species.scientificName, scientificToCommon) ||
    formatScientificName(species.scientificName)

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1.5 h-7 rounded-full border border-border bg-card px-2.5 text-sm text-foreground flex-shrink-0">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: palette[0 % palette.length] }}
        />
        <span className="tabular-nums">{selectedSpecies.length}</span>
      </div>
    )
  }

  const removable = selectedSpecies.length > 1
  // If not even one chip fits, fall back to a count pill so something shows.
  const showCountFallback = visibleCount === 0
  const visible = selectedSpecies.slice(0, visibleCount)
  const overflow = selectedSpecies.length - visible.length

  const chipClass =
    'inline-flex items-center gap-1.5 h-7 rounded-full border border-border bg-card pl-2.5 pr-1.5 text-sm text-foreground flex-shrink-0 max-w-[12rem]'

  return (
    <div ref={containerRef} className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
      {/* Hidden measurer — all chips at natural width, off-flow, so the fit
          calculation isn't affected by what's currently rendered. */}
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
        <div className="inline-flex items-center gap-1.5 h-7 rounded-full border border-border bg-card px-2.5 text-sm text-foreground flex-shrink-0">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: palette[0 % palette.length] }}
          />
          <span className="tabular-nums">{selectedSpecies.length}</span>
        </div>
      ) : (
        <>
          {visible.map((species, index) => {
            const label = labelFor(species)
            return (
              <span key={species.scientificName} className={chipClass}>
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: palette[index % palette.length] }}
                />
                <span className="truncate capitalize">{label}</span>
                {removable && (
                  <button
                    type="button"
                    onClick={() => onRemove(species.scientificName)}
                    aria-label={`Remove ${label}`}
                    className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            )
          })}
          {overflow > 0 && (
            <span className="inline-flex items-center h-7 rounded-full border border-border bg-card px-2.5 text-sm text-muted-foreground tabular-nums flex-shrink-0">
              +{overflow}
            </span>
          )}
        </>
      )}
    </div>
  )
}
