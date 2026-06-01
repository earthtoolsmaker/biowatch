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
  {
    key: 'polar',
    label: 'Polar',
    Icon: ChartPie,
    blurb:
      'A 24-hour clock face. Best for reading the daily rhythm at a glance — dawn and dusk peaks, day vs. night activity, and patterns that wrap around midnight.'
  },
  {
    key: 'xy',
    label: 'X–Y line',
    Icon: ChartLine,
    blurb:
      'A straight 0–24h axis. Best for reading exact hourly values and comparing several species’ curves side by side.'
  }
]

export default function ChartShapeToggle({ value, onChange }) {
  return (
    <div
      className="inline-flex items-stretch rounded-md border border-border bg-background overflow-hidden"
      role="radiogroup"
      aria-label="Chart shape"
    >
      {SHAPES.map(({ key, label, Icon, blurb }, idx) => {
        const active = value === key
        const isFirst = idx === 0
        return (
          <Tooltip.Root key={key}>
            <Tooltip.Trigger asChild>
              <button
                onClick={() => onChange(key)}
                className={`px-1.5 py-0.5 flex items-center justify-center transition-colors ${
                  isFirst ? '' : 'border-l border-border'
                } ${
                  active
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
                aria-label={label}
                aria-pressed={active}
                role="radio"
                aria-checked={active}
              >
                <Icon size={12} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="top"
                sideOffset={6}
                className="z-[10000] max-w-[220px] px-2.5 py-1.5 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
              >
                <p className="font-medium">{label}</p>
                <p className="mt-0.5 text-muted-foreground leading-snug">{blurb}</p>
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )
      })}
    </div>
  )
}
