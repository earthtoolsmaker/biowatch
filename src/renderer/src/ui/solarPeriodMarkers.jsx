import { Sunrise, Sun, Sunset, MoonStar } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { SOLAR_DAY_PERIOD_PRESETS, formatRange, selectSolarPeriod } from '../utils/dayPeriods'

const MARKERS = [
  { key: 'night', hour: 0, Icon: MoonStar },
  { key: 'dawn', hour: 6, Icon: Sunrise },
  { key: 'day', hour: 12, Icon: Sun },
  { key: 'dusk', hour: 18, Icon: Sunset }
]

// A line has two midnight endpoints; the circle's midnight is a single point.
const LINE_MARKERS = [...MARKERS, { key: 'night', hour: 24, Icon: MoonStar }]

/** Solar-period labels select one period, or toggle with Shift; empty means all hours. */
export default function SolarPeriodMarkers({
  selection,
  onChange,
  layout = 'circle',
  center,
  radius
}) {
  return (
    <div
      role="group"
      aria-label="Solar periods"
      className={
        layout === 'circle'
          ? 'absolute inset-0 pointer-events-none'
          : 'relative h-8 mx-2 flex-shrink-0'
      }
    >
      {(layout === 'line' ? LINE_MARKERS : MARKERS).map(({ key, hour, Icon }) => {
        const preset = SOLAR_DAY_PERIOD_PRESETS[key]
        const active = selection?.has(key) ?? false
        const angle = (hour / 24) * 2 * Math.PI - Math.PI / 2
        const style =
          layout === 'circle'
            ? {
                left: center + radius * Math.cos(angle),
                top: center + radius * Math.sin(angle),
                transform: 'translate(-50%, -50%)'
              }
            : { left: `${(hour / 24) * 100}%`, top: 0, transform: 'translateX(-50%)' }
        const className = `absolute w-6 h-6 rounded-md flex items-center justify-center ${onChange ? 'pointer-events-auto hover:bg-accent cursor-pointer' : ''} ${active ? 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-500/15' : 'text-muted-foreground'}`
        return (
          <Tooltip.Root key={`${key}-${hour}`}>
            <Tooltip.Trigger asChild>
              {onChange ? (
                <button
                  type="button"
                  aria-label={preset.label}
                  aria-pressed={active}
                  style={style}
                  className={className}
                  onClick={(event) => onChange(selectSolarPeriod(selection, key, event.shiftKey))}
                >
                  <Icon size={16} />
                </button>
              ) : (
                <span role="img" aria-label={preset.label} style={style} className={className}>
                  <Icon size={16} />
                </span>
              )}
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="top"
                sideOffset={6}
                className="z-[10000] max-w-64 rounded border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
              >
                <div className="font-medium">
                  {preset.label} · {formatRange(preset.range)} solar
                </div>
                <p>{preset.description}</p>
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )
      })}
    </div>
  )
}
