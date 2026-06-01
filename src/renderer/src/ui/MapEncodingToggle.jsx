import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { PieChart, Circle, Flame, Hexagon } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'

// The three ways the species-distribution map can encode the data. Labels are
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
 * On a single species, Composition is hidden (a one-species pie is just the
 * Abundance disc). On narrow maps the control collapses to icon-only so it
 * doesn't collide with the legend on the opposite corner — the hover cards
 * still name each mode.
 *
 * @param {object} props
 * @param {'pies'|'graduated'|'heatmap'|'hexbin'} props.value Active encoding key.
 * @param {(key: string) => void} props.onChange Called with the new encoding key.
 * @param {boolean} props.singleSpecies When true, the Composition segment is omitted.
 */
export default function MapEncodingToggle({ value, onChange, singleSpecies }) {
  const ref = useRef(null)
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    L.DomEvent.disableClickPropagation(el)
    L.DomEvent.disableScrollPropagation(el)

    // Collapse to icons when the map pane is too narrow to fit the labels
    // alongside the legend.
    const container = el.closest('.leaflet-container')
    if (!container) return undefined
    const measure = () => setCompact(container.clientWidth < 620)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const encodings = singleSpecies ? ENCODINGS.filter((e) => e.key !== 'pies') : ENCODINGS

  return (
    <div
      ref={ref}
      className="absolute bottom-5 left-5 z-[1000] flex items-center gap-0.5 bg-card p-1 rounded-md shadow-md cursor-default"
    >
      {encodings.map(({ key, label, icon: Icon, description }) => {
        const active = value === key
        return (
          <Tooltip.Root key={key}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                onClick={() => onChange(key)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 px-2 h-7 rounded text-xs cursor-pointer transition-colors ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                    : 'text-muted-foreground hover:text-foreground'
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
                <p className="text-muted-foreground leading-snug">{description}</p>
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )
      })}
    </div>
  )
}
