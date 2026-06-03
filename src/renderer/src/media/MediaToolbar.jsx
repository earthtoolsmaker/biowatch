import { useMemo } from 'react'
import { Filter, LayoutGrid, Table2 } from 'lucide-react'
import ViewModeToggle from '../ui/ViewModeToggle.jsx'
import QuickViews from './QuickViews.jsx'
import { hasActiveFilters } from './mediaFilters.js'
import { resolveCommonName } from '../../../shared/commonNames/index.js'
import { formatScientificName } from '../utils/scientificName'
import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../utils/speciesUtils'

// Human label for a species chip: pseudo-species sentinels → friendly name,
// otherwise the common name, falling back to the formatted scientific name.
function speciesChipLabel(name) {
  if (name === BLANK_SENTINEL) return 'Blank'
  if (name === VEHICLE_SENTINEL) return 'Vehicle'
  const common = resolveCommonName(name)
  const label = common || formatScientificName(name)
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : name
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
const VIEW_MODES = ['grid', 'table']

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
function deriveChips(filters, deploymentNames = {}) {
  const chips = []
  for (const name of filters.species) {
    chips.push({
      id: `species:${name}`,
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
      label: deploymentNames[d] || d,
      clear: (f) => ({
        ...f,
        deployments: f.deployments.filter((x) => x !== d)
      })
    })
  }
  for (const s of filters.sources) {
    chips.push({
      id: `source:${s}`,
      label: s,
      clear: (f) => ({
        ...f,
        sources: f.sources.filter((x) => x !== s)
      })
    })
  }
  const dateLabel = formatDateChip(filters.dateRange)
  if (dateLabel) {
    chips.push({ id: 'date', label: dateLabel, clear: (f) => ({ ...f, dateRange: [null, null] }) })
  }
  if (filters.timeRange.ranges.length) {
    chips.push({
      id: 'time',
      label: 'Time of day',
      clear: (f) => ({ ...f, timeRange: { ranges: [] } })
    })
  }
  return chips
}

export default function MediaToolbar({
  filters,
  onOpenFilter,
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

      <button
        type="button"
        onClick={onOpenFilter}
        className={`relative inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[13px] font-medium ${
          filterActive
            ? 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
            : 'bg-card border-border hover:bg-input-background'
        }`}
      >
        <Filter className="w-3.5 h-3.5 opacity-80" />
        Filter
        {filterActive && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400" />
        )}
      </button>

      <QuickViews
        active={filters.quickView}
        counts={quickViewCounts}
        onSelect={(key) => onChange({ ...filters, quickView: key })}
      />

      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12.5px] font-medium bg-blue-50 text-blue-700 border border-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30"
        >
          {chip.label}
          <button
            type="button"
            aria-label={`Remove ${chip.label} filter`}
            className="opacity-60 hover:opacity-100 leading-none"
            onClick={() => onChange(chip.clear(filters))}
          >
            ✕
          </button>
        </span>
      ))}

      <div className="flex-1" />

      {typeof sequenceCount === 'number' && (
        <span className="text-[12.5px] text-muted-foreground">
          {sequenceCount.toLocaleString()} sequences
        </span>
      )}
    </div>
  )
}
