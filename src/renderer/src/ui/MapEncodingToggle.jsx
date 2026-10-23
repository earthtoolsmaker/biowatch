import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { PieChart, Circle, Flame, Hexagon, GitCompareArrows } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'

// The ways the species-distribution map can encode the data. Labels are
// the human-facing names settled on during design; the keys match the
// persisted `mapEncoding` value in SpeciesMap.
const ENCODINGS = [
  {
    key: 'pies',
    label: 'Composition',
    icon: PieChart,
    description: 'A pie per location showing the species mix, sized by observation count.'
  },
  {
    key: 'graduated',
    label: 'Abundance',
    icon: Circle,
    description:
      'One circle per location, sized by total count and colored by the dominant species. Easiest for comparing how busy sites are.'
  },
  {
    key: 'heatmap',
    label: 'Density',
    icon: Flame,
    description:
      'A kernel-density glow of total activity across all selected species. Best for spotting hotspots on dense surveys.'
  },
  {
    key: 'hexbin',
    label: 'Hex grid',
    icon: Hexagon,
    description:
      'Aggregates nearby sites into a hex grid colored by total activity. Tames overlap on dense, crowded maps.'
  },
  {
    key: 'comparative',
    label: 'Comparative',
    icon: GitCompareArrows,
    description:
      'Compare independently normalized spatial distributions within the area filter, or across all study locations when no area is selected.'
  }
]

/**
 * Compact segmented control overlaid on the map (bottom-left) for switching
 * how the distribution is drawn. Because it lives inside the Leaflet container,
 * it's automatically hidden whenever the map pane is (gallery view dims the map
 * to opacity-0/pointer-events-none).
 *
 * Each segment carries a title+description hover card in the same style as the
 * Explore view toggle. Click/scroll propagation is disabled so interacting with
 * the control doesn't pan or zoom the map underneath.
 *
 * A single blue pill is absolutely positioned behind the buttons and slides
 * (transitioning left/width) to the active segment, mirroring ViewModeToggle.
 * Positions are measured from the button elements and re-measured on resize,
 * when collapsing to icon-only, and when the available encodings change.
 *
 * On a single species, Composition is hidden (a one-species pie is just the
 * Abundance disc). On narrow maps the control collapses to icon-only so it
 * doesn't collide with the legend on the opposite corner — the hover cards
 * still name each mode.
 *
 * @param {object} props
 * @param {'pies'|'graduated'|'heatmap'|'hexbin'|'comparative'} props.value Active encoding key.
 * @param {(key: string) => void} props.onChange Called with the new encoding key.
 * @param {boolean} props.singleSpecies When true, the Composition segment is omitted.
 */
export default function MapEncodingToggle({
  value,
  onChange,
  singleSpecies,
  selectionCount,
  comparativeMode,
  onComparativeModeChange
}) {
  const ref = useRef(null)
  const btnRefs = useRef({})
  const [compact, setCompact] = useState(false)
  const [pill, setPill] = useState(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    L.DomEvent.disableClickPropagation(el)
    L.DomEvent.disableScrollPropagation(el)

    // Collapse to icons when the map pane is too narrow to fit the labels
    // alongside the legend.
    const container = el.closest('.leaflet-container')
    if (!container) return undefined
    const measure = () => setCompact(container.clientWidth < 760)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const encodings = singleSpecies ? ENCODINGS.filter((e) => e.key !== 'pies') : ENCODINGS

  // Slide the blue pill to the active segment. Re-measure when the selection,
  // the icon-only collapse, or the available encodings change, since each
  // alters button widths/offsets.
  useLayoutEffect(() => {
    const btn = btnRefs.current[value]
    if (!btn) return
    setPill({ left: btn.offsetLeft, width: btn.offsetWidth })
  }, [value, compact, singleSpecies])

  return (
    <div
      ref={ref}
      className="absolute bottom-5 left-5 z-[1000] flex flex-col gap-1 bg-card p-1 rounded-md shadow-md cursor-default"
    >
      <div className="relative flex items-center gap-0.5">
        {pill && (
          <span
            aria-hidden="true"
            className="absolute top-0 h-7 rounded bg-blue-50 dark:bg-blue-950 transition-[left,width] duration-200 ease-out"
            style={{ left: pill.left, width: pill.width }}
          />
        )}
        {encodings.map(({ key, label, icon: Icon, description }) => {
          const active = value === key
          const disabled = key === 'comparative' && selectionCount < 2
          return (
            <Tooltip.Root key={key}>
              <Tooltip.Trigger asChild>
                <button
                  ref={(el) => {
                    btnRefs.current[key] = el
                  }}
                  type="button"
                  onClick={() => !disabled && onChange(key)}
                  aria-label={label}
                  aria-disabled={disabled}
                  aria-pressed={active}
                  className={`relative z-10 flex items-center gap-1.5 px-2 h-7 rounded text-xs transition-colors ${
                    disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
                  } ${
                    active
                      ? 'text-blue-700 dark:text-blue-300'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon size={14} />
                  {!compact && label}
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="top"
                  sideOffset={8}
                  className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
                >
                  <div className="font-medium mb-1">{label}</div>
                  <p className="text-muted-foreground leading-snug">
                    {disabled ? 'Select multiple taxonomies to compare distributions' : description}
                  </p>
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          )
        })}
      </div>
      {value === 'comparative' && (
        <div
          className="flex items-center gap-1 border-t border-border pt-1"
          aria-label="Comparison mode"
        >
          {['overlap', 'difference'].map((mode) => {
            const disabled = mode === 'difference' && selectionCount !== 2
            return (
              <Tooltip.Root key={mode}>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    aria-pressed={comparativeMode === mode}
                    aria-disabled={disabled}
                    onClick={() => !disabled && onComparativeModeChange(mode)}
                    className={`px-2 h-7 rounded text-xs ${
                      disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
                    } ${
                      comparativeMode === mode
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {mode === 'overlap' ? 'Overlap' : 'Difference'}
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="top"
                    sideOffset={8}
                    className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
                  >
                    {disabled
                      ? 'Difference requires exactly two selected taxonomies'
                      : mode === 'overlap'
                        ? 'Shared density across all selected taxonomies'
                        : 'First selected taxonomy minus the second selected taxonomy'}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            )
          })}
        </div>
      )}
    </div>
  )
}
