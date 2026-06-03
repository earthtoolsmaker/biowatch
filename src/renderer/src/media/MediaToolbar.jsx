import { useMemo } from 'react'
import { Filter, LayoutGrid, Table2, ArrowUpDown } from 'lucide-react'

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

      <label className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border bg-card text-[12.5px] font-medium">
        <ArrowUpDown className="w-3.5 h-3.5 opacity-70" />
        <select
          value={filters.sort}
          onChange={(e) => onChange({ ...filters, sort: e.target.value })}
          className="bg-transparent outline-none cursor-pointer"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </label>

      <div className="inline-flex items-center bg-input-background border border-border rounded-lg p-0.5">
        <button
          type="button"
          aria-pressed={filters.view === 'grid'}
          onClick={() => onChange({ ...filters, view: 'grid' })}
          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12.5px] font-medium ${
            filters.view === 'grid' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          Grid
        </button>
        <button
          type="button"
          disabled
          title="Table view coming soon"
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12.5px] font-medium text-muted-foreground opacity-50 cursor-not-allowed"
        >
          <Table2 className="w-3.5 h-3.5" />
          Table
        </button>
      </div>
    </div>
  )
}
