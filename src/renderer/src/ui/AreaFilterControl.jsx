import { MapPin, X } from 'lucide-react'
import { useMap } from 'react-leaflet'

// Floating top-center pill for the map area filter. The pill body always
// snapshots the current viewport bounds on click — so when a filter is
// already active you can re-filter a freshly-panned area in one click (no
// clear-first dance). When a filter IS active the pill turns blue and a ✕
// appears inside it at the trailing edge; clicking the ✕ clears in one click
// without re-applying. The filter is a frozen snapshot: panning after
// applying does NOT recompute it until you click the pill again.
export default function AreaFilterControl({ areaFilter, onApplyAreaFilter }) {
  const map = useMap()
  const active = !!areaFilter

  const apply = () => {
    const b = map.getBounds()
    onApplyAreaFilter({
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest()
    })
  }

  const clear = (e) => {
    e.stopPropagation()
    onApplyAreaFilter(null)
  }

  return (
    <div className="leaflet-top" style={{ left: '50%', transform: 'translateX(-50%)' }}>
      <div className="leaflet-control">
        <div
          role="button"
          tabIndex={0}
          onClick={apply}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') apply()
          }}
          className={`flex items-center gap-1.5 h-7 rounded-full text-xs font-medium border shadow-sm transition-colors cursor-pointer ${
            active ? 'pl-3 pr-1.5' : 'px-3'
          } ${
            active
              ? 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/15 dark:border-blue-500/30 dark:hover:bg-blue-500/25'
              : 'text-muted-foreground bg-card border-border hover:bg-accent'
          }`}
          aria-label="Filter to this area"
          aria-pressed={active}
        >
          <MapPin size={14} />
          Filter to this area
          {active && (
            <button
              type="button"
              onClick={clear}
              className="flex items-center justify-center h-5 w-5 rounded-full hover:bg-blue-200/60 dark:hover:bg-blue-500/30 transition-colors"
              aria-label="Clear area filter"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
