import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChartColumn, ChartLine, X } from 'lucide-react'

import AnalysisMetricToggle from './AnalysisMetricToggle'
import TimelineChart, { SpeciesName } from './timeseries'

const CHART_TYPES = [
  { value: 'line', label: 'Lines', Icon: ChartLine },
  { value: 'bar', label: 'Bars', Icon: ChartColumn }
]

// Lines / Bars switch, styled like the metric switch beside it.
function ChartTypeToggle({ value, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label="Chart type"
      className="inline-flex shrink-0 rounded-md border border-border bg-card p-0.5"
    >
      {CHART_TYPES.map(({ value: type, label, Icon }) => {
        const selected = value === type
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(type)}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
              selected
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            <Icon size={11} />
            {label}
          </button>
        )
      })}
    </div>
  )
}

// A small uppercase caption in front of a group of header controls.
function ControlGroup({ label, children }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

/**
 * Enlarged view of the Explore timeline: real weekly values on a y-axis
 * fitted to the weeks in view, with a hover readout. The metric switch and
 * the date range (set only from the header pill) are the Explore tab's
 * own state, so changes here also apply to the map behind. Lines / Bars
 * only changes how this window draws the series.
 */
export default function TimelineExpandedModal({
  isOpen,
  onClose,
  isLoading,
  timeseriesData,
  selectedSpecies,
  palette,
  metric,
  setMetric,
  scientificToCommon,
  dateRange,
  setDateRange,
  chartType,
  setChartType
}) {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      // Radix closes its own popover (the pill's calendar) on this same Esc;
      // let that press only dismiss the popover, not the whole window.
      if (e.key !== 'Escape') return
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Header slot the chart portals its date pill into, keeping it off the plot.
  const [pillSlot, setPillSlot] = useState(null)

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[5000] bg-black/50 flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Observations over time"
        className="bg-card rounded-lg shadow-xl w-full h-[min(80vh,50vw)] min-h-[360px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* "Measure" also changes the map; "Show as" only this window. */}
        <div className="px-5 pt-4 pb-3 flex items-center gap-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Over time</h2>
          <ControlGroup label="Measure">
            <AnalysisMetricToggle value={metric} onChange={setMetric} boxed />
          </ControlGroup>
          <div className="w-px h-5 bg-border" aria-hidden="true" />
          <ControlGroup label="Show as">
            <ChartTypeToggle value={chartType} onChange={setChartType} />
          </ControlGroup>
          <div ref={setPillSlot} className="ml-auto shrink-0" />
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close"
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
        <div className="flex-1 min-h-0 px-5 py-4">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              Loading…
            </div>
          ) : (
            <TimelineChart
              timeseriesData={timeseriesData}
              selectedSpecies={selectedSpecies}
              dateRange={dateRange}
              setDateRange={setDateRange}
              palette={palette}
              metric={metric}
              scientificToCommon={scientificToCommon}
              showYAxis
              pillContainer={pillSlot}
              rangeGestures={false}
              chartType={chartType}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
