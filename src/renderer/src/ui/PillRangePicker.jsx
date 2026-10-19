import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

/**
 * Month / year dropdown for the calendar caption, using the app's Radix
 * Select instead of react-day-picker's native <select> (whose option list
 * can't be themed). DayPicker's handlers read `e.target.value`.
 */
const CalendarDropdown = ({ options = [], value, onChange, disabled, 'aria-label': ariaLabel }) => (
  <Select
    value={String(value)}
    disabled={disabled}
    onValueChange={(v) => onChange?.({ target: { value: v } })}
  >
    <SelectTrigger
      aria-label={ariaLabel}
      className="h-6 w-auto gap-1 rounded-md border-border bg-transparent dark:bg-transparent px-2 py-0 text-xs font-medium text-foreground hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-500/15 dark:hover:text-blue-300 [&_svg]:size-3"
    >
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="z-[10001] max-h-64 min-w-[5rem] bg-card border-border">
      {options.map((o) => (
        <SelectItem
          key={o.value}
          value={String(o.value)}
          disabled={o.disabled}
          className="text-xs py-1 cursor-pointer data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700 dark:data-[highlighted]:bg-blue-500/15 dark:data-[highlighted]:text-blue-300"
        >
          {o.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
)

const formatPillDate = (d) =>
  d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * The "start → end" text of the timeline pill. Clicking it opens one
 * popup with a From and a To calendar side by side; each opens on its
 * own date so multi-year ranges need no paging. Every pick calls
 * `onPick(side, day)` right away and the popup stays open so the other
 * end can be adjusted too (Esc / click outside closes it).
 */
const PillRangePicker = ({ range, fullExtent, onPick, muted }) => {
  const [open, setOpen] = useState(false)
  const [start, end] = range

  const calendarProps = {
    mode: 'single',
    required: true,
    captionLayout: 'dropdown',
    startMonth: fullExtent[0],
    endMonth: fullExtent[1],
    weekStartsOn: 1,
    // Always 6 week rows so paging months never resizes the popup.
    fixedWeeks: true,
    components: { Dropdown: CalendarDropdown }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          className={`pointer-events-auto cursor-pointer rounded-full px-1 -mx-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 ${
            muted
              ? 'hover:bg-slate-200/70 hover:text-blue-700 dark:hover:bg-slate-500/30 dark:hover:text-blue-300'
              : 'hover:bg-blue-200/70 dark:hover:bg-blue-500/30'
          } ${open ? (muted ? 'bg-slate-200/70 dark:bg-slate-500/30' : 'bg-blue-200/70 dark:bg-blue-500/30') : ''}`}
          aria-label="Change date range"
          title="Change date range"
        >
          {formatPillDate(start)}
          {' → '}
          {formatPillDate(end)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="timeline-daypicker z-[10000] flex gap-3 bg-card text-popover-foreground rounded-lg border border-border shadow-md p-3"
        >
          <div>
            <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              From
            </p>
            <DayPicker
              {...calendarProps}
              selected={start}
              defaultMonth={start}
              onSelect={(day) => onPick('start', day)}
              disabled={[{ before: fullExtent[0] }, { after: end }]}
            />
          </div>
          <div className="w-px bg-border" />
          <div>
            <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              To
            </p>
            <DayPicker
              {...calendarProps}
              selected={end}
              defaultMonth={end}
              onSelect={(day) => onPick('end', day)}
              disabled={[{ before: start }, { after: fullExtent[1] }]}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export default PillRangePicker
