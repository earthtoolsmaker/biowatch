import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import AnalysisMetricToggle from './AnalysisMetricToggle'
import TimelineChart, { SpeciesName } from './timeseries'

/**
 * Enlarged view of the Explore timeline: real weekly values on a y-axis
 * fitted to the weeks in view, with a hover readout. The metric switch and
 * the date range (drag, scroll-zoom, pill calendars) are the Explore tab's
 * own state, so changes here also apply to the map behind.
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
  setDateRange
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
        <div className="px-5 pt-4 pb-3 flex items-center gap-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Over time</h2>
          <AnalysisMetricToggle value={metric} onChange={setMetric} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 text-xs text-muted-foreground">
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
          <div ref={setPillSlot} className="ml-auto shrink-0" />
          <button
            type="button"
            onClick={onClose}
            className=" w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={16} />
          </button>
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
              edgeHandles={false}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
