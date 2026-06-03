import { X } from 'lucide-react'

// Slide-over filter panel. Stub: the container, open/close, and reset are in
// place; the per-facet controls (species, deployment, source, date+time) are
// filled in by Plan 2 Phase 3. Filters remain fully drivable via the URL until
// then.
export default function FilterDrawer({ open, onClose, filters, onChange }) {
  if (!open) return null

  const hasAny =
    filters.species.length ||
    filters.deployments.length ||
    filters.sources.length ||
    filters.dateRange[0] ||
    filters.dateRange[1] ||
    filters.timeRange.ranges.length

  return (
    <div className="fixed inset-0 z-[1000]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-80 bg-card border-l border-border shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium">Filters</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="opacity-70 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 text-[13px] text-muted-foreground">
          Species, deployment, source, and date/time controls are coming here.
        </div>
        {hasAny ? (
          <div className="px-4 py-3 border-t border-border">
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...filters,
                  species: [],
                  deployments: [],
                  sources: [],
                  dateRange: [null, null],
                  timeRange: { ranges: [] }
                })
              }
              className="text-[13px] font-medium text-blue-700 dark:text-blue-300 hover:underline"
            >
              Clear all filters
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
