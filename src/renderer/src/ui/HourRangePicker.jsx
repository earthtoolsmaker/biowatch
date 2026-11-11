import * as Popover from '@radix-ui/react-popover'
import { Maximize2, X } from 'lucide-react'
import { formatHour, formatRange } from '../utils/dayPeriods'

// Keep a text draft in the input until blur/Enter, rather than querying on
// every keystroke. Unlike input[type=time], this also supports end-of-day 24:00.
function HourInput({ value, onChange, label }) {
  const formatted = formatHour(value)
  return (
    <label className="flex flex-col gap-1 text-[10px] font-medium text-muted-foreground">
      {label}
      <input
        key={formatted}
        type="text"
        defaultValue={formatted}
        aria-label={label}
        placeholder="HH:MM"
        maxLength={5}
        pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00"
        required
        className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-xs tabular-nums text-foreground outline-none focus:ring-2 focus:ring-blue-500"
        onBlur={(event) => {
          const input = event.currentTarget
          if (!input.validity.valid) {
            input.value = formatted
            return
          }
          const [hours, minutes] = input.value.split(':').map(Number)
          const next = hours + minutes / 60
          if (next !== value) onChange(next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            if (event.currentTarget.reportValidity()) event.currentTarget.blur()
          }
          if (event.key === 'Escape') event.currentTarget.value = formatted
        }}
      />
    </label>
  )
}

/** Precise camera-local clock ranges for the compact and expanded daily chart. */
export default function HourRangePicker({ ranges, onChange, onExpand }) {
  const cleared = ranges.length === 0
  const displayedRanges = cleared ? [{ start: 0, end: 24 }] : ranges
  const label = displayedRanges.map(formatRange).join(', ')
  const update = (index, side, value) => {
    const next = displayedRanges.map((range, i) =>
      i === index ? { ...range, [side]: value } : range
    )
    // Matching endpoints and 00:00 → 24:00 mean all hours, just as dragging
    // a full ring does. Don't apply the drag helper's rounding tolerance here.
    onChange(
      next.some(({ start, end }) => start === end || Math.abs(end - start) === 24) ? [] : next
    )
  }

  return (
    <div
      className={`inline-flex max-w-full items-center gap-1 rounded-full border pl-2 pr-1 py-0.5 text-[10px] font-medium shadow-sm ${
        cleared
          ? 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
          : 'border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300'
      }`}
    >
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label="Change time range"
            title={`${label} (camera-local clock time)`}
            className="min-w-0 truncate cursor-pointer rounded-full px-1 -mx-1 outline-none hover:bg-blue-200/70 dark:hover:bg-blue-500/30 focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {label}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            sideOffset={6}
            collisionPadding={12}
            aria-label="Time range"
            className="z-[10000] max-w-[calc(100vw-24px)] rounded-lg border border-border bg-card p-3 text-popover-foreground shadow-md"
          >
            <p className="mb-2 text-xs font-medium">Camera-local clock time</p>
            <div className="flex flex-col gap-2">
              {displayedRanges.map((range, index) => (
                <div key={index} className="flex items-end gap-2">
                  <HourInput
                    value={range.start}
                    label={displayedRanges.length > 1 ? `From ${index + 1}` : 'From'}
                    onChange={(value) => update(index, 'start', value)}
                  />
                  <span className="pb-1.5 text-xs text-muted-foreground">→</span>
                  <HourInput
                    value={range.end}
                    label={displayedRanges.length > 1 ? `To ${index + 1}` : 'To'}
                    onChange={(value) => update(index, 'end', value)}
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 max-w-60 text-[10px] text-muted-foreground">
              Use HH:MM (00:00–24:00). An end before the start wraps past midnight.
            </p>
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-2 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              All hours
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand daily activity"
          title="Expand daily activity"
          className="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-blue-200/70 dark:hover:bg-blue-500/30"
        >
          <Maximize2 size={9} strokeWidth={2.5} />
        </button>
      )}
      {!cleared && (
        <button
          type="button"
          onClick={() => onChange([])}
          aria-label="Clear time filter"
          title="Clear time filter"
          className="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-blue-200/70 dark:hover:bg-blue-500/30"
        >
          <X size={10} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}
