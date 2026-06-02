import { Activity } from 'lucide-react'
import * as HoverCard from '@radix-ui/react-hover-card'
import { useShowFilterCharts } from '../hooks/useShowFilterCharts'

/**
 * Toggle button for the bottom-row filter charts (Clock + Timeline) on the
 * Media and Explore tabs. State is per-study and shared between both tabs
 * via {@link useShowFilterCharts}.
 *
 * Hidden entirely when `hasTemporalData === false` — studies whose media
 * rows have no timestamps (e.g. ENA24, Biome Health Project) can never
 * populate the Clock or Timeline, so the toggle would be meaningless.
 * Passing `true` or omitting the prop keeps the button visible (the latter
 * lets callers stay optimistic while the timeseries query is still loading).
 *
 * Uses a HoverCard (not a Tooltip) because the card contains an interactive
 * "Reset filters" action — Tooltip content isn't meant to be clicked, so the
 * click would fall through to whatever sits below.
 */
export default function FilterChartsToggle({
  studyId,
  hasTemporalData = true,
  isFiltering = false,
  dayFilterLabel = null,
  dateFilterLabel = null,
  areaFilterLabel = null,
  onResetFilters = null
}) {
  const { showFilterCharts, setShowFilterCharts } = useShowFilterCharts(studyId)

  if (!hasTemporalData) return null

  return (
    <HoverCard.Root openDelay={150} closeDelay={100}>
      <HoverCard.Trigger asChild>
        <button
          onClick={() => setShowFilterCharts((prev) => !prev)}
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors relative ${
            showFilterCharts
              ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
              : 'text-muted-foreground hover:bg-accent'
          }`}
          aria-label={showFilterCharts ? 'Hide filter charts' : 'Show filter charts'}
        >
          <Activity size={16} />
          {isFiltering && (
            <span
              className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-blue-500 ring-1 ring-background"
              aria-label="Filters active"
            />
          )}
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="bottom"
          sideOffset={8}
          align="end"
          className="z-[10000] max-w-[18rem] px-3.5 py-3 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
        >
          <div className="flex items-start justify-between gap-4 mb-2">
            <p className="font-medium leading-snug">
              {showFilterCharts ? 'Hide activity charts' : 'Show activity charts'}
            </p>
            {isFiltering && (
              <p className="text-blue-600 dark:text-blue-400 whitespace-nowrap leading-snug">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 mr-1 align-middle" />
                Active
              </p>
            )}
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Daily-activity clock and timeline — filter observations by time of day and date.
          </p>
          {isFiltering && (dayFilterLabel || dateFilterLabel || areaFilterLabel) && (
            <ul className="mt-3 pt-3 border-t border-border space-y-1.5 text-popover-foreground/90 leading-snug">
              {dayFilterLabel && (
                <li className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">Time of day</span>
                  <span className="flex-1">{dayFilterLabel}</span>
                </li>
              )}
              {dateFilterLabel && (
                <li className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">Date range</span>
                  <span className="flex-1">{dateFilterLabel}</span>
                </li>
              )}
              {areaFilterLabel && (
                <li className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">Map area</span>
                  <span className="flex-1">{areaFilterLabel}</span>
                </li>
              )}
            </ul>
          )}
          {isFiltering && onResetFilters && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={onResetFilters}
                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Reset filters
              </button>
            </div>
          )}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  )
}
