import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Popover from '@radix-ui/react-popover'
import { Maximize2, X } from 'lucide-react'
import { DailyActivityPolar, DailyActivityLine } from './clock'
import ChartShapeToggle from './chartShapeToggle'
import HourRangePicker from './HourRangePicker'
import TimeModeToggle from './TimeModeToggle'
import { SpeciesName } from './timeseries'
import {
  DAY_PERIOD_ORDER,
  SOLAR_DAY_PERIOD_PRESETS,
  formatRange,
  selectSolarPeriod
} from '../utils/dayPeriods'
import { NORMALIZATION_RAI_100 } from '../../../shared/analysisMetric.js'

/** Both sizes edit Explore's existing filter and chart-shape state. */
export default function DailyActivityPanel({
  activityData,
  isLoading,
  metric,
  selectedSpecies,
  palette,
  scientificToCommon,
  timeMode,
  setTimeMode,
  chartShape,
  setChartShape,
  chipSelection,
  setChipSelection,
  arc,
  onArcChange,
  timeRange,
  visualRanges,
  onRangesChange
}) {
  const [expanded, setExpanded] = useState(false)
  const dialogRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    if (!expanded) return
    const previousFocus = document.activeElement
    closeRef.current?.focus()
    const onKeyDown = (event) => {
      // The first Escape dismisses the time picker, not the whole chart.
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return
      if (event.key === 'Escape') setExpanded(false)
      if (event.key === 'Tab') {
        const controls = dialogRef.current.querySelectorAll('button, input, [tabindex="0"]')
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [expanded])

  const hasActivity = activityData?.some((row) =>
    selectedSpecies.some(({ scientificName }) => row[scientificName] > 0)
  )
  const needsEffort = metric.normalization === NORMALIZATION_RAI_100
  const hasEffort = activityData?.some((row) => row.effortDays > 0)
  const emptyMessage =
    needsEffort && !hasEffort
      ? `No eligible camera effort for this selection. Set camera timezones and valid deployment start/end times in Deployments.${timeMode === 'solar' ? ' Solar time also needs deployment coordinates.' : ''}`
      : timeMode === 'solar'
        ? 'No solar-time activity for this selection. Solar time requires known UTC instants and deployment coordinates. Check camera timezones and locations in Deployments.'
        : 'No camera-local activity matches this selection.'

  const chart = isLoading ? (
    <div
      role="status"
      className="h-full flex items-center justify-center text-xs text-muted-foreground"
    >
      Loading…
    </div>
  ) : !hasActivity ? (
    <div
      role="status"
      className="h-full flex items-center justify-center px-3 text-center text-xs text-muted-foreground"
    >
      {emptyMessage}
    </div>
  ) : chartShape === 'polar' ? (
    <DailyActivityPolar
      activityData={activityData}
      selectedSpecies={selectedSpecies}
      palette={palette}
      timeMode={timeMode}
      periodSelection={chipSelection}
      onPeriodSelectionChange={setChipSelection}
      onChange={onArcChange}
      startTime={arc.start}
      endTime={arc.end}
      mode={timeMode === 'solar' || timeRange.ranges.length > 1 ? 'chips' : 'drag'}
      chipSectors={visualRanges}
    />
  ) : (
    <DailyActivityLine
      activityData={activityData}
      selectedSpecies={selectedSpecies}
      palette={palette}
      timeMode={timeMode}
      periodSelection={chipSelection}
      onPeriodSelectionChange={setChipSelection}
      selectedRanges={visualRanges}
      onArcChange={timeMode === 'clock' ? onArcChange : undefined}
    />
  )

  const hasHourFilter = timeRange.ranges.length > 0
  const solarSelectionLabel = !hasHourFilter
    ? 'All periods'
    : chipSelection.size
      ? DAY_PERIOD_ORDER.filter((key) => chipSelection.has(key))
          .map((key) => SOLAR_DAY_PERIOD_PRESETS[key].label)
          .join(', ')
      : 'Custom solar selection'
  const picker = (onExpand) =>
    timeMode === 'clock' ? (
      <HourRangePicker
        ranges={hasHourFilter ? visualRanges : []}
        onChange={onRangesChange}
        onExpand={onExpand}
      />
    ) : (
      <div
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 text-[10px] font-medium ${
          !hasHourFilter && !onExpand ? 'px-2' : 'pl-2 pr-1'
        } ${
          hasHourFilter
            ? 'text-blue-700 dark:text-blue-300 bg-blue-50/90 dark:bg-blue-500/15 border-blue-200/70 dark:border-blue-500/30'
            : 'text-slate-500 dark:text-slate-400 bg-slate-50/90 dark:bg-slate-500/10 border-slate-200/70 dark:border-slate-500/30'
        }`}
      >
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label="Change solar periods"
              title="Change solar periods"
              className={`min-w-0 truncate cursor-pointer rounded-full px-1 -mx-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 ${
                hasHourFilter
                  ? 'hover:bg-blue-200/70 dark:hover:bg-blue-500/30 data-[state=open]:bg-blue-200/70 dark:data-[state=open]:bg-blue-500/30'
                  : 'hover:bg-slate-200/70 hover:text-blue-700 dark:hover:bg-slate-500/30 dark:hover:text-blue-300 data-[state=open]:bg-slate-200/70 dark:data-[state=open]:bg-slate-500/30'
              }`}
            >
              {solarSelectionLabel}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              sideOffset={6}
              collisionPadding={12}
              aria-label="Solar periods"
              className="z-[10000] w-72 max-w-[calc(100vw-24px)] rounded-lg border border-border bg-card p-3 text-popover-foreground shadow-md"
            >
              <p className="mb-2 text-xs font-medium">Solar periods</p>
              <div
                role="group"
                aria-label="Selected solar periods"
                className="grid grid-cols-2 gap-2"
              >
                {DAY_PERIOD_ORDER.map((key) => {
                  const period = SOLAR_DAY_PERIOD_PRESETS[key]
                  const selected = chipSelection.has(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={period.label}
                      aria-pressed={selected}
                      title={period.description}
                      onClick={() => setChipSelection(selectSolarPeriod(chipSelection, key, true))}
                      className={`cursor-pointer rounded-md border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                        selected
                          ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300'
                          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      <span className="block text-xs font-medium">{period.label}</span>
                      <span className="block text-[10px] tabular-nums">
                        {formatRange(period.range)}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Combine periods by toggling them on or off. Times are normalized solar hours, not
                local clock time.
              </p>
              <button
                type="button"
                onClick={() => onRangesChange([])}
                className="mt-2 cursor-pointer text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                All periods
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
            className={`flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors ${
              hasHourFilter
                ? 'hover:bg-blue-200/70 dark:hover:bg-blue-500/30'
                : 'hover:bg-slate-200/70 dark:hover:bg-slate-500/30'
            }`}
          >
            <Maximize2 size={9} strokeWidth={2.5} />
          </button>
        )}
        {hasHourFilter && (
          <button
            type="button"
            onClick={() => onRangesChange([])}
            aria-label="Clear time filter"
            title="Show all periods"
            className="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-blue-200/70 dark:hover:bg-blue-500/30 transition-colors"
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        )}
      </div>
    )

  return (
    <>
      <div
        title={
          timeMode === 'solar'
            ? 'Daily activity — normalized solar hours'
            : 'Daily activity — camera-local clock time'
        }
        className="w-[250px] shrink-0 h-full rounded border border-border flex flex-col relative"
      >
        <div className="flex justify-center px-2 pt-1">{picker(() => setExpanded(true))}</div>
        <div className="flex-1 min-h-0 relative overflow-y-auto">{chart}</div>
        <div className="flex items-center justify-between px-2 pb-1.5 gap-2">
          <TimeModeToggle mode={timeMode} onChange={setTimeMode} />
          <ChartShapeToggle value={chartShape} onChange={setChartShape} />
        </div>
      </div>
      {expanded &&
        createPortal(
          <div
            className="fixed inset-0 z-[5000] bg-black/50 flex items-center justify-center p-8"
            onClick={() => setExpanded(false)}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Daily activity"
              className="bg-card rounded-lg shadow-xl w-full h-full flex flex-col min-h-0"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="px-5 pt-4 pb-3 flex flex-wrap items-center gap-4 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Daily activity</h2>
                <TimeModeToggle mode={timeMode} onChange={setTimeMode} />
                <ChartShapeToggle value={chartShape} onChange={setChartShape} />
                <div className="ml-auto min-w-0">{picker()}</div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Close"
                  className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="px-5 pt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {selectedSpecies.map((species, index) => (
                  <span key={species.scientificName} className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: palette[index % palette.length] }}
                    />
                    <SpeciesName
                      scientificName={species.scientificName}
                      scientificToCommon={scientificToCommon}
                    />
                  </span>
                ))}
              </div>
              <p className="px-5 pt-2 text-[10px] text-muted-foreground">
                Relative activity · each species scaled to its own peak
                {timeMode === 'solar' &&
                  ' · Select a period on the chart; Shift-click to combine periods.'}
              </p>
              <div className="flex-1 min-h-0 px-5 py-4">{chart}</div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
