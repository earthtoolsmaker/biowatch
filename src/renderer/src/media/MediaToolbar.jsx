import { useMemo } from 'react'
import { Filter, LayoutGrid, Table2, ArrowUpDown } from 'lucide-react'
import ViewModeToggle from '../ui/ViewModeToggle.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.tsx'

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
function deriveChips(filters) {
  const chips = []
  for (const name of filters.species) {
    chips.push({
      id: `species:${name}`,
      label: name,
      clear: (f) => ({
        ...f,
        species: f.species.filter((s) => s !== name)
      })
    })
  }
  for (const d of filters.deployments) {
    chips.push({
      id: `deployment:${d}`,
      label: d,
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

export default function MediaToolbar({ filters, onOpenFilter, onChange, sequenceCount }) {
  const chips = useMemo(() => deriveChips(filters), [filters])

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
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card text-[13px] font-medium hover:bg-input-background"
      >
        <Filter className="w-3.5 h-3.5 opacity-80" />
        Filter
      </button>

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

      <Select value={filters.sort} onValueChange={(sort) => onChange({ ...filters, sort })}>
        <SelectTrigger
          size="sm"
          className="w-auto gap-1.5 text-[12.5px] font-medium"
          aria-label="Sort order"
        >
          <ArrowUpDown className="w-3.5 h-3.5 opacity-70" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest">Newest first</SelectItem>
          <SelectItem value="oldest">Oldest first</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
