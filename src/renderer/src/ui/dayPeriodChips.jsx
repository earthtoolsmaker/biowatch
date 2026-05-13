import { Sunrise, Sun, Sunset, Moon } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { DAY_PERIOD_ORDER, DAY_PERIOD_PRESETS, formatRange } from '../utils/dayPeriods'

const ICONS = {
  dawn: Sunrise,
  day: Sun,
  dusk: Sunset,
  night: Moon
}

/**
 * Four icon buttons (Dawn / Day / Dusk / Night) above the polar clock.
 * Multi-select: each button toggles its key in the `selection` Set.
 * Visual treatment matches FilterChartsToggle for coherence with the
 * rest of the gap-slider strip.
 *
 * Props:
 *   selection: Set<string> — currently active chip keys
 *   onChange: (newSelection: Set<string>) => void
 */
export default function DayPeriodChips({ selection, onChange }) {
  const toggle = (key) => {
    const next = new Set(selection)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  return (
    <div className="flex items-center gap-1">
      {DAY_PERIOD_ORDER.map((key) => {
        const Icon = ICONS[key]
        const active = selection.has(key)
        const preset = DAY_PERIOD_PRESETS[key]
        return (
          <Tooltip.Root key={key}>
            <Tooltip.Trigger asChild>
              <button
                onClick={() => toggle(key)}
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                  active
                    ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
                aria-label={preset.label}
                aria-pressed={active}
              >
                <Icon size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="top"
                sideOffset={8}
                className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
              >
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <span className="font-medium">{preset.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatRange(preset.range)}
                  </span>
                </div>
                <p className="text-muted-foreground leading-snug">{preset.description}</p>
                <Tooltip.Arrow className="fill-popover" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )
      })}
    </div>
  )
}
