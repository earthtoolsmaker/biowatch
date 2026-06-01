import { Map as MapIcon, Images, Columns2 } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'

const MODE_META = {
  map: {
    label: 'Map',
    icon: MapIcon,
    description: 'Species distribution across camera-trap locations.'
  },
  gallery: {
    label: 'Gallery',
    icon: Images,
    description: 'Browse the captured media as a sequence grid.'
  },
  both: {
    label: 'Both',
    icon: Columns2,
    description: 'Show the map and gallery side by side.'
  }
}

/**
 * Segmented control for the Explore tab's main view. `modes` is the list of
 * modes available at the current breakpoint (from getAvailableViewModes), so
 * 'both' is omitted on narrow windows. Uses an explicit blue active state to
 * match the other toggles in the control bar. Each segment carries a
 * title+description tooltip in the same style as the Deployments tab.
 */
export default function ViewModeToggle({ value, modes, onChange }) {
  return (
    <div className="inline-flex items-center gap-1">
      {modes.map((mode) => {
        const { label, icon: Icon, description } = MODE_META[mode]
        const active = value === mode
        return (
          <Tooltip.Root key={mode}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                onClick={() => onChange(mode)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md border text-sm transition-colors ${
                  active
                    ? 'bg-card text-blue-700 border-border shadow-sm dark:text-blue-300'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
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
