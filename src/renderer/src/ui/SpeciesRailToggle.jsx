import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'

/**
 * Show/hide toggle for the species rail, sitting at the right end of the
 * Explore control bar (above the rail it controls). Active-tinted when the
 * rail is shown. Tooltip style matches the other control-bar toggles.
 */
export default function SpeciesRailToggle({ visible, onToggle }) {
  const Icon = visible ? PanelRightClose : PanelRightOpen
  const label = visible ? 'Hide species panel' : 'Show species panel'
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-label={label}
          aria-pressed={visible}
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
            visible
              ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
              : 'text-muted-foreground hover:bg-accent'
          }`}
        >
          <Icon size={16} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={10}
          align="end"
          className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
        >
          <p className="font-medium mb-1">{label}</p>
          <p className="text-muted-foreground leading-snug">
            The species list also serves as the map legend.
          </p>
          <Tooltip.Arrow className="fill-popover" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
