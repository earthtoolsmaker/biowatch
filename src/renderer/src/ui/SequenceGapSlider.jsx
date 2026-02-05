import { Layers } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'

/**
 * Format sequence gap value for display
 * @param {number | null} seconds - The gap in seconds, or null for Off
 * @returns {string} - Formatted string (e.g., "Off", "30s", "1m 30s", "2m")
 */
function formatGapValue(seconds) {
  if (seconds === null || seconds === 0) return 'Off'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 120) return `${Math.floor(seconds / 60)}min ${seconds % 60}s`
  return `${Math.round(seconds / 60)}min`
}

/**
 * Reusable sequence gap slider component
 *
 * @param {Object} props
 * @param {number | null} props.value - Current gap in seconds (null or 10-300), null = Off
 * @param {function} props.onChange - Callback when value changes (receives null for Off, or number > 0)
 * @param {'compact' | 'full'} [props.variant='full'] - Display variant
 * @param {boolean} [props.showDescription=false] - Show description text below slider
 * @param {boolean} [props.disabled=false] - Disable the slider
 * @param {number} [props.max=300] - Maximum value in seconds
 */
export function SequenceGapSlider({
  value,
  onChange,
  variant = 'full',
  showDescription = false,
  disabled = false,
  max = 300
}) {
  // Convert null to 0 for slider display, and 0 back to null on change
  const sliderValue = value ?? 0
  const handleChange = (e) => {
    const newValue = Number(e.target.value)
    onChange(newValue === 0 ? null : newValue)
  }

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2">
        <Layers size={16} className={value !== null ? 'text-blue-500' : 'text-gray-400'} />
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <input
              type="range"
              min="0"
              max={max}
              step="10"
              value={sliderValue}
              onChange={handleChange}
              disabled={disabled}
              className="w-24 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={`Sequence grouping: ${formatGapValue(value)}`}
            />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="bottom"
              sideOffset={8}
              align="start"
              className="z-[10000] max-w-xs px-3 py-2 bg-gray-900 text-white text-xs rounded-md shadow-lg"
            >
              <p className="font-medium mb-1">Sequence Grouping</p>
              <p className="text-gray-300 mb-1.5">
                Groups nearby photos/videos into sequences for easier browsing.
              </p>
              <ul className="text-gray-300 space-y-0.5">
                <li>
                  <span className="text-white font-medium">Off:</span> Preserves original event
                  groupings from import
                </li>
                <li>
                  <span className="text-white font-medium">On:</span> Groups media taken within the
                  specified time gap
                </li>
              </ul>
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <span className="text-xs text-gray-600 w-12">{formatGapValue(value)}</span>
      </div>
    )
  }

  // Full variant
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Layers size={16} className={value !== null ? 'text-blue-500' : 'text-gray-400'} />
          <span className="text-sm font-medium text-gray-900">Sequence grouping</span>
        </div>
        <span className="text-sm font-medium text-blue-600">{formatGapValue(value)}</span>
      </div>
      <input
        type="range"
        min="0"
        max={max}
        step="10"
        value={sliderValue}
        onChange={handleChange}
        disabled={disabled}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={`Sequence grouping: ${formatGapValue(value)}`}
      />
      {showDescription && (
        <p className="text-xs text-gray-500 mt-2">
          {value === null
            ? 'Preserves imported event groupings (eventID from original data)'
            : `Groups observations within ${formatGapValue(value)} into sequences (generates new eventIDs)`}
        </p>
      )}
    </div>
  )
}

export default SequenceGapSlider
