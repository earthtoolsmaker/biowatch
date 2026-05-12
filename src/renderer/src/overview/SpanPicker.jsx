import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]
const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/**
 * Date-range picker — two side-by-side calendars in a single popover with
 * shared Reset / Cancel / Save buttons. `value` and `onChange` use ISO date
 * strings (`YYYY-MM-DD`).
 *
 * @param {Object} props
 * @param {string|null} props.startValue - ISO date string for start (or null).
 * @param {string|null} props.endValue - ISO date string for end (or null).
 * @param {(range: { start: string, end: string }) => void} props.onSave - Called with both dates on Save.
 * @param {() => void} props.onCancel - Called on Cancel / Escape / outside click.
 * @param {() => void} [props.onResetToAuto] - When provided, renders a "Reset to auto" link.
 * @param {React.RefObject<HTMLElement>} [props.ignoreOutsideClickRef] - Element whose clicks should not count as "outside" (e.g., the trigger button — letting it toggle without races).
 */
export default function SpanPicker({
  startValue,
  endValue,
  onSave,
  onCancel,
  onResetToAuto,
  ignoreOutsideClickRef
}) {
  const containerRef = useRef(null)

  const [start, setStart] = useState(() => parseIsoDate(startValue))
  const [end, setEnd] = useState(() => parseIsoDate(endValue))
  const [validationError, setValidationError] = useState(null)

  // Click-outside / Escape close (single handler at the wrapper level).
  useEffect(() => {
    const onMouseDown = (e) => {
      if (containerRef.current && containerRef.current.contains(e.target)) return
      if (ignoreOutsideClickRef?.current && ignoreOutsideClickRef.current.contains(e.target)) return
      onCancel()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onCancel, ignoreOutsideClickRef])

  const handleSave = () => {
    if (!start || !end) {
      setValidationError('Both start and end dates are required')
      return
    }
    if (start > end) {
      setValidationError('Start date must be before end date')
      return
    }
    setValidationError(null)
    onSave({
      start: toIsoDate(start),
      end: toIsoDate(end)
    })
  }

  return (
    <div
      ref={containerRef}
      className="bg-card rounded-lg shadow-xl border border-border p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex gap-3">
        <CalendarPane label="Start" value={start} onChange={setStart} />
        <div className="w-px bg-muted self-stretch" aria-hidden="true" />
        <CalendarPane label="End" value={end} onChange={setEnd} />
      </div>

      {validationError && (
        <p className="text-xs text-red-500 mt-2 text-center dark:text-red-400">{validationError}</p>
      )}

      <div
        className={`flex items-center mt-2.5 gap-2 ${onResetToAuto ? 'justify-between' : 'justify-end'}`}
      >
        {onResetToAuto && (
          <button
            type="button"
            onClick={onResetToAuto}
            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
            title="Clear override and fall back to auto-derived range"
          >
            Reset to auto
          </button>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-2.5 py-1 text-xs font-medium border border-border rounded-md hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-2.5 py-1 text-xs font-medium bg-blue-600 text-white dark:bg-blue-500 dark:text-white rounded-md hover:bg-blue-700 transition-colors dark:hover:bg-blue-600"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * One calendar pane — month/year header + day grid + click-to-select.
 */
function CalendarPane({ label, value, onChange }) {
  // Render-month state — defaults to the value's month, but the user can
  // navigate without changing the selected date.
  const [year, setYear] = useState(() => (value ? value.getFullYear() : new Date().getFullYear()))
  const [month, setMonth] = useState(() => (value ? value.getMonth() : new Date().getMonth()))

  const daysInMonth = useMemo(() => new Date(year, month + 1, 0).getDate(), [year, month])
  const firstDay = useMemo(() => new Date(year, month, 1).getDay(), [year, month])

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11)
      setYear(year - 1)
    } else {
      setMonth(month - 1)
    }
  }

  const nextMonth = () => {
    if (month === 11) {
      setMonth(0)
      setYear(year + 1)
    } else {
      setMonth(month + 1)
    }
  }

  const isSelected = (day) =>
    value && value.getFullYear() === year && value.getMonth() === month && value.getDate() === day

  return (
    <div className="w-60">
      <div className="text-[0.6rem] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
        {label}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={prevMonth}
          className="p-1 hover:bg-accent rounded transition-colors"
          type="button"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-1.5">
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value, 10))}
            className="text-xs font-medium bg-transparent border-none cursor-pointer focus:outline-none"
          >
            {MONTHS.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10) || year)}
            className="w-14 text-xs font-medium text-center border border-border rounded px-1 py-0.5"
            min="1900"
            max="2100"
          />
        </div>
        <button
          onClick={nextMonth}
          className="p-1 hover:bg-accent rounded transition-colors"
          type="button"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {DAYS_OF_WEEK.map((d) => (
          <div
            key={d}
            className="text-center text-[0.65rem] text-muted-foreground py-0.5 font-medium"
          >
            {d}
          </div>
        ))}
        {Array(firstDay)
          .fill(null)
          .map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
        {Array(daysInMonth)
          .fill(null)
          .map((_, i) => {
            const day = i + 1
            const selected = isSelected(day)
            return (
              <button
                key={day}
                type="button"
                onClick={() => onChange(new Date(year, month, day))}
                className={`text-xs py-1 rounded transition-colors ${
                  selected
                    ? 'bg-blue-600 text-white dark:bg-blue-500 dark:text-white font-medium'
                    : 'text-foreground hover:bg-accent'
                }`}
              >
                {day}
              </button>
            )
          })}
      </div>
    </div>
  )
}

function parseIsoDate(iso) {
  if (!iso) return null
  // Accept 'YYYY-MM-DD' or full ISO. Use UTC parsing then read components in
  // local time — matches DateTimePicker's behavior.
  const d = new Date(iso.includes('T') ? iso : `${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function toIsoDate(date) {
  // Output 'YYYY-MM-DD' from local-time components (the picker shows local).
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
