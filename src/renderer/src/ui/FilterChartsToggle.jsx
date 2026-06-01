import { SlidersHorizontal } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useShowFilterCharts } from '../hooks/useShowFilterCharts'

/**
 * Toggle button for the bottom-row filter charts (Clock + Timeline) on the
 * Media and Activity tabs. State is per-study and shared between both tabs
 * via {@link useShowFilterCharts}.
 *
 * Hidden entirely when `hasTemporalData === false` — studies whose media
 * rows have no timestamps (e.g. ENA24, Biome Health Project) can never
 * populate the Clock or Timeline, so the toggle would be meaningless.
 * Passing `true` or omitting the prop keeps the button visible (the latter
 * lets callers stay optimistic while the timeseries query is still loading).
 *
 * Visual treatment mirrors the bbox toggle in GalleryDisplayStrip so the
 * two icons read as a coherent set in the gap-slider strip.
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
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          onClick={() => setShowFilterCharts((prev) => !prev)}
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors relative ${
            showFilterCharts
              ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
              : 'text-muted-foreground hover:bg-accent'
          }`}
          aria-label={showFilterCharts ? 'Hide filter charts' : 'Show filter charts'}
        >
          <SlidersHorizontal size={16} />
          {isFiltering && (
            <span
              className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-blue-500 ring-1 ring-background"
              aria-label="Filters active"
            />
          )}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={10}
          align="end"
          className="z-[10000] max-w-[18rem] px-3.5 py-3 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
        >
          <div className="flex items-start justify-between gap-4 mb-2">
            <p className="font-medium leading-snug">
              {showFilterCharts ? 'Hide filter charts' : 'Show filter charts'}
            </p>
            {isFiltering && (
              <p className="text-blue-600 dark:text-blue-400 whitespace-nowrap leading-snug">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 mr-1 align-middle" />
                Active
              </p>
            )}
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Daily-activity clock and timeline filters.
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
          <Tooltip.Arrow className="fill-popover" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
