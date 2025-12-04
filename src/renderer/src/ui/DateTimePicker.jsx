import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'

/**
 * DateTimePicker component for editing ISO 8601 timestamps
 *
 * @param {Object} props
 * @param {string} props.value - ISO 8601 timestamp
 * @param {(newValue: string) => void} props.onChange - Called with new ISO timestamp on save
 * @param {() => void} props.onCancel - Called when picker is dismissed
 * @param {string} [props.className] - Additional CSS classes
 * @param {boolean} [props.dateOnly] - If true, hides the time picker section
 */
export default function DateTimePicker({ value, onChange, onCancel, className = '', dateOnly = false }) {
  // Parse initial value
  const initialDate = value ? new Date(value) : new Date()

  const [year, setYear] = useState(initialDate.getFullYear())
  const [month, setMonth] = useState(initialDate.getMonth())
  const [day, setDay] = useState(initialDate.getDate())
  const [hours, setHours] = useState(initialDate.getHours())
  const [minutes, setMinutes] = useState(initialDate.getMinutes())
  const [seconds, setSeconds] = useState(initialDate.getSeconds())

  const containerRef = useRef(null)

  // Handle click outside to cancel
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onCancel()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onCancel])

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  const [validationError, setValidationError] = useState(null)

  const handleSave = () => {
    // Validate year is within reasonable bounds
    if (year < 1970 || year > 2100) {
      setValidationError('Year must be between 1970 and 2100')
      return
    }

    // Validate day is valid for the selected month
    const daysInSelectedMonth = getDaysInMonth(year, month)
    if (day < 1 || day > daysInSelectedMonth) {
      setValidationError(`Invalid day for ${monthNames[month]} ${year}`)
      return
    }

    const newDate = new Date(year, month, day, hours, minutes, seconds)

    // Check if the date is valid
    if (isNaN(newDate.getTime())) {
      setValidationError('Invalid date/time combination')
      return
    }

    setValidationError(null)
    onChange(newDate.toISOString())
  }

  const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
  const getFirstDayOfMonth = (y, m) => new Date(y, m, 1).getDay()

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

  const monthNames = [
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

  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)

  const handleTimeInputChange = (setter, min, max) => (e) => {
    const val = e.target.value
    // Allow empty string for typing
    if (val === '') {
      setter(0)
      return
    }
    const num = parseInt(val, 10)
    if (!isNaN(num)) {
      setter(Math.min(max, Math.max(min, num)))
    }
  }

  return (
    <div
      ref={containerRef}
      className={`bg-white rounded-lg shadow-lg border border-gray-200 p-4 w-80 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prevMonth}
          className="p-1.5 hover:bg-gray-100 rounded transition-colors"
          type="button"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value, 10))}
            className="text-sm font-medium bg-transparent border-none cursor-pointer focus:outline-none"
          >
            {monthNames.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10) || year)}
            className="w-16 text-sm font-medium text-center border border-gray-200 rounded px-1 py-0.5"
            min="1900"
            max="2100"
          />
        </div>
        <button
          onClick={nextMonth}
          className="p-1.5 hover:bg-gray-100 rounded transition-colors"
          type="button"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1 mb-4">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <div key={d} className="text-center text-xs text-gray-500 py-1 font-medium">
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
          .map((_, i) => (
            <button
              key={i + 1}
              onClick={() => setDay(i + 1)}
              type="button"
              className={`text-center py-1.5 text-sm rounded transition-colors
                ${
                  day === i + 1
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'hover:bg-gray-100'
                }`}
            >
              {i + 1}
            </button>
          ))}
      </div>

      {/* Time Inputs - hidden when dateOnly is true */}
      {!dateOnly && (
        <div className="flex items-center gap-2 mb-4 justify-center bg-gray-50 rounded-lg py-2">
          <Clock size={16} className="text-gray-500" />
          <input
            type="number"
            min="0"
            max="23"
            value={hours.toString().padStart(2, '0')}
            onChange={handleTimeInputChange(setHours, 0, 23)}
            className="w-12 text-center border border-gray-200 rounded px-1 py-1.5 text-sm font-mono"
            title="Hours (0-23)"
          />
          <span className="text-gray-500 font-medium">:</span>
          <input
            type="number"
            min="0"
            max="59"
            value={minutes.toString().padStart(2, '0')}
            onChange={handleTimeInputChange(setMinutes, 0, 59)}
            className="w-12 text-center border border-gray-200 rounded px-1 py-1.5 text-sm font-mono"
            title="Minutes (0-59)"
          />
          <span className="text-gray-500 font-medium">:</span>
          <input
            type="number"
            min="0"
            max="59"
            value={seconds.toString().padStart(2, '0')}
            onChange={handleTimeInputChange(setSeconds, 0, 59)}
            className="w-12 text-center border border-gray-200 rounded px-1 py-1.5 text-sm font-mono"
            title="Seconds (0-59)"
          />
        </div>
      )}

      {/* Validation Error */}
      {validationError && (
        <p className="text-xs text-red-500 mb-2 text-center">{validationError}</p>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          type="button"
          className="flex-1 px-3 py-2 text-sm font-medium border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          type="button"
          className="flex-1 px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  )
}
