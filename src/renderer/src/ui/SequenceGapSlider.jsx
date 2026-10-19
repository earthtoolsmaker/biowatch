import { useCallback, useEffect, useState } from 'react'
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
  // Local dragging state so the track/handle move smoothly without firing the
  // parent's onChange on every intermediate value. Every commit currently
  // invalidates every sequence-aware query (and spawns worker tasks), so we
  // only want to pay that cost when the user lets go.
  const [dragValue, setDragValue] = useState(value)
  useEffect(() => {
    setDragValue(value)
  }, [value])

  // Convert null to 0 for slider display, and 0 back to null.
  const sliderValue = dragValue ?? 0

  // Force-open the tooltip while the user is actively dragging the thumb so
  // the value stays readable mid-gesture. Hover/focus continues to drive
  // open/close through Radix the rest of the time.
  const [isDragging, setIsDragging] = useState(false)
  const [hoverOpen, setHoverOpen] = useState(false)

  const handleInput = (e) => {
    const n = Number(e.target.value)
    setDragValue(n === 0 ? null : n)
  }

  const commit = useCallback(() => {
    if (dragValue !== value) onChange(dragValue)
  }, [dragValue, value, onChange])

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Layers
          size={16}
          className={
            dragValue !== null ? 'text-blue-500 dark:text-blue-400' : 'text-muted-foreground'
          }
        />
        <Tooltip.Root open={isDragging || hoverOpen} onOpenChange={setHoverOpen}>
          <Tooltip.Trigger asChild>
            <input
              type="range"
              min="0"
              max={max}
              step="10"
              value={sliderValue}
              onChange={handleInput}
              onPointerDown={() => setIsDragging(true)}
              onPointerUp={() => setIsDragging(false)}
              onPointerCancel={() => setIsDragging(false)}
              onMouseUp={commit}
              onKeyUp={commit}
              onTouchEnd={commit}
              onBlur={commit}
              disabled={disabled}
              className={`flex-1 min-w-0 h-2 bg-muted rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                dragValue !== null ? 'accent-blue-500' : 'accent-gray-400 dark:accent-gray-500'
              }`}
              aria-label={`Sequence grouping: ${formatGapValue(dragValue)}`}
            />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="bottom"
              sideOffset={10}
              align="start"
              className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
            >
              <p className="font-medium mb-1">
                Sequence grouping
                <span className="ml-1.5 text-blue-600 dark:text-blue-400 font-semibold tabular-nums">
                  {formatGapValue(dragValue)}
                </span>
              </p>
              <p className="text-muted-foreground leading-snug">
                {dragValue === null
                  ? 'Off — keep the original event groupings from import.'
                  : `Group photos and videos taken within ${formatGapValue(dragValue)} of each other into a single sequence.`}
              </p>
              <Tooltip.Arrow className="fill-popover" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[3.5rem] text-right">
          {formatGapValue(dragValue)}
        </span>
      </div>
    )
  }

  // Full variant
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Layers
            size={16}
            className={
              dragValue !== null ? 'text-blue-500 dark:text-blue-400' : 'text-muted-foreground'
            }
          />
          <span className="text-sm font-medium text-foreground">Sequence grouping</span>
        </div>
        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
          {formatGapValue(dragValue)}
        </span>
      </div>
      <input
        type="range"
        min="0"
        max={max}
        step="10"
        value={sliderValue}
        onChange={handleInput}
        onMouseUp={commit}
        onKeyUp={commit}
        onTouchEnd={commit}
        onBlur={commit}
        disabled={disabled}
        className={`w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          dragValue !== null ? 'accent-blue-500' : 'accent-gray-400 dark:accent-gray-500'
        }`}
        aria-label={`Sequence grouping: ${formatGapValue(dragValue)}`}
      />
      {showDescription && (
        <p className="text-xs text-muted-foreground mt-2">
          {dragValue === null
            ? 'Preserves imported event groupings (eventID from original data)'
            : `Groups observations within ${formatGapValue(dragValue)} into sequences (generates new eventIDs)`}
        </p>
      )}
    </div>
  )
}

export default SequenceGapSlider
