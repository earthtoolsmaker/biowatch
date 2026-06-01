import { Map as MapIcon, Images, Columns2 } from 'lucide-react'

const MODE_META = {
  map: { label: 'Map', icon: MapIcon },
  gallery: { label: 'Gallery', icon: Images },
  both: { label: 'Both', icon: Columns2 }
}

/**
 * Segmented control for the Explore tab's main view. `modes` is the list of
 * modes available at the current breakpoint (from getAvailableViewModes), so
 * 'both' is omitted on narrow windows. Uses an explicit blue active state to
 * match the other toggles in the control bar.
 */
export default function ViewModeToggle({ value, modes, onChange }) {
  return (
    <div className="inline-flex items-center rounded-md border border-border p-0.5 gap-0.5">
      {modes.map((mode) => {
        const { label, icon: Icon } = MODE_META[mode]
        const active = value === mode
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            aria-pressed={active}
            className={`flex items-center gap-1.5 px-2.5 h-7 rounded text-sm transition-colors ${
              active
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
