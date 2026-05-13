import { ChartPie, ChartLine } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'

/**
 * Two-button group that switches the daily-activity chart between the
 * polar radar and the x-y line. Sits in the top-right of the clock card.
 *
 * Props:
 *   value: 'polar' | 'xy'
 *   onChange: (next) => void
 */
const SHAPES = [
  { key: 'polar', label: 'Polar', Icon: ChartPie },
  { key: 'xy', label: 'X–Y line', Icon: ChartLine }
]

export default function ChartShapeToggle({ value, onChange }) {
  return (
    <div className="flex gap-0.5">
      {SHAPES.map(({ key, label, Icon }) => {
        const active = value === key
        return (
          <Tooltip.Root key={key}>
            <Tooltip.Trigger asChild>
              <button
                onClick={() => onChange(key)}
                className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                  active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent'
                }`}
                aria-label={label}
                aria-pressed={active}
              >
                <Icon size={12} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                sideOffset={6}
                className="z-[10000] px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
              >
                {label}
                <Tooltip.Arrow className="fill-popover" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )
      })}
    </div>
  )
}
