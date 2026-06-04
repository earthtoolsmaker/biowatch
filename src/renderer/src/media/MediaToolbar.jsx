import { useMemo } from 'react'
import {
  LayoutGrid,
  Table2,
  Filter,
  PawPrint,
  MapPin,
  Calendar,
  Clock,
  Film,
  Image as ImageIcon
} from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import ViewModeToggle from '../ui/ViewModeToggle.jsx'
import QuickViews from './QuickViews.jsx'
import { hasActiveFilters } from './mediaFilters.js'
import { resolveCommonName } from '../../../shared/commonNames/index.js'
import { formatScientificName } from '../utils/scientificName'
import { toTitleCase } from '../utils/textCase'
import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../utils/speciesUtils'

// Human label for a species chip: pseudo-species sentinels → friendly name,
// otherwise the common name in Title Case, falling back to the formatted
// scientific name (left as-is — only the genus is capitalized).
function speciesChipLabel(name) {
  if (name === BLANK_SENTINEL) return 'Blank'
  if (name === VEHICLE_SENTINEL) return 'Vehicle'
  const common = resolveCommonName(name)
  if (common) return toTitleCase(common)
  return formatScientificName(name) || name
}

// Grid/Table metadata for the shared ViewModeToggle (same look as Explore's
// Map | Gallery | Both segmented control).
const VIEW_META = {
  grid: {
    label: 'Grid',
    icon: LayoutGrid,
    description: 'Browse media as a grid of sequence thumbnails.'
  },
  table: {
    label: 'Table',
    icon: Table2,
    description: 'Inspect sequences as sortable rows with metadata.'
  }
}
const VIEW_MODES = ['table', 'grid']

// Format a [fromISO, toISO] pair into a compact human label.
function formatDateChip([from, to]) {
  if (!from && !to) return null
  const fmt = (s) => {
    const d = new Date(s)
    return Number.isNaN(d.getTime())
      ? s
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }
  if (from && to) return `${fmt(from)} → ${fmt(to)}`
  return from ? `From ${fmt(from)}` : `Until ${fmt(to)}`
}

// Derive the removable active-filter chips from filter state. Quick view is
// surfaced in the QuickViews row, so it is intentionally not duplicated here.
// Each chip carries a leading icon naming its facet (species/deployment/…) so
// the pills are self-describing and same-facet pills read as a group. Chips are
// pushed facet-by-facet, so same-type pills are already contiguous.
function deriveChips(filters, deploymentNames = {}) {
  const chips = []
  for (const name of filters.species) {
    chips.push({
      id: `species:${name}`,
      icon: PawPrint,
      type: 'Species',
      label: speciesChipLabel(name),
      clear: (f) => ({
        ...f,
        species: f.species.filter((s) => s !== name)
      })
    })
  }
  for (const d of filters.deployments) {
    chips.push({
      id: `deployment:${d}`,
      icon: MapPin,
      type: 'Deployment',
      label: deploymentNames[d] || d,
      clear: (f) => ({
        ...f,
        deployments: f.deployments.filter((x) => x !== d)
      })
    })
  }
  for (const t of filters.mediaTypes || []) {
    chips.push({
      id: `mediaType:${t}`,
      icon: t === 'video' ? Film : ImageIcon,
      type: 'Media type',
      label: t === 'video' ? 'Videos' : 'Images',
      clear: (f) => ({
        ...f,
        mediaTypes: f.mediaTypes.filter((x) => x !== t)
      })
    })
  }
  const dateLabel = formatDateChip(filters.dateRange)
  if (dateLabel) {
    chips.push({
      id: 'date',
      icon: Calendar,
      type: 'Date',
      label: dateLabel,
      clear: (f) => ({ ...f, dateRange: [null, null] })
    })
  }
  if (filters.timeRange.ranges.length) {
    chips.push({
      id: 'time',
      icon: Clock,
      type: 'Time',
      label: 'Time of day',
      clear: (f) => ({ ...f, timeRange: { ranges: [] } })
    })
  }
  return chips
}

// Show/hide toggle for the filter panel. A labelled button (icon + "Filters")
// rather than a bare icon, so it's discoverable; active-tinted while open or
// when facets are set, with a dot when facets are active. Mirrors the Quick
// views button style for toolbar consistency.
function FilterPanelToggle({ open, active, onToggle }) {
  const label = open ? 'Hide filters' : 'Show filters'
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-label={label}
          aria-pressed={open}
          className={`relative inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[13px] font-medium transition-colors ${
            open || active
              ? 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
              : 'bg-card border-border hover:bg-input-background'
          }`}
        >
          <Filter className="w-3.5 h-3.5 opacity-80" />
          Filters
          {active && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400" />
          )}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={8}
          className="z-[10000] max-w-[15rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
        >
          <div className="font-medium mb-1">{label}</div>
          <p className="text-muted-foreground leading-snug">
            Narrow sequences by species and deployment.
          </p>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export default function MediaToolbar({
  filters,
  filterOpen,
  onToggleFilter,
  onChange,
  sequenceCount,
  quickViewCounts,
  deploymentNames
}) {
  const chips = useMemo(() => deriveChips(filters, deploymentNames), [filters, deploymentNames])
  // The Filter button reflects the drawer facets (species/deployment/etc.), not
  // the quick view (which has its own button).
  const filterActive = hasActiveFilters({ ...filters, quickView: null })

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <ViewModeToggle
        value={filters.view}
        modes={VIEW_MODES}
        meta={VIEW_META}
        onChange={(view) => onChange({ ...filters, view })}
      />

      <div className="w-px h-6 bg-border mx-0.5" />

      <QuickViews
        active={filters.quickView}
        counts={quickViewCounts}
        onSelect={(key) =>
          onChange(
            key
              ? {
                  // A quick view is a fresh preset: selecting one resets the
                  // facet filters (species/deployment/media-type/date/time) so
                  // the view shows exactly its category. View mode and sort persist.
                  ...filters,
                  species: [],
                  deployments: [],
                  mediaTypes: [],
                  dateRange: [null, null],
                  timeRange: { ranges: [] },
                  quickView: key
                }
              : { ...filters, quickView: null }
          )
        }
      />

      {chips.map((chip) => {
        const Icon = chip.icon
        return (
          <span
            key={chip.id}
            title={`${chip.type}: ${chip.label}`}
            className="inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full text-[12.5px] font-medium bg-blue-50 text-blue-700 border border-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30"
          >
            {Icon && <Icon className="w-3.5 h-3.5 opacity-60" />}
            {chip.label}
            <button
              type="button"
              aria-label={`Remove ${chip.type} filter ${chip.label}`}
              className="opacity-60 hover:opacity-100 leading-none"
              onClick={() => onChange(chip.clear(filters))}
            >
              ✕
            </button>
          </span>
        )
      })}

      <div className="flex-1" />

      {typeof sequenceCount === 'number' && (
        <span className="text-[12.5px] text-muted-foreground">
          {sequenceCount.toLocaleString()} sequences
        </span>
      )}

      <FilterPanelToggle open={filterOpen} active={filterActive} onToggle={onToggleFilter} />
    </div>
  )
}
