import { useState } from 'react'
import { ChartColumn, ChartLine } from 'lucide-react'

import AnalysisMetricToggle from './AnalysisMetricToggle'
import ExpandedChartModal, { ChoiceToggle, ControlGroup } from './ExpandedChartModal'
import TimelineChart from './timeseries'

const CHART_TYPES = [
  { value: 'line', label: 'Lines', Icon: ChartLine },
  { value: 'bar', label: 'Bars', Icon: ChartColumn }
]

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
  // Header slot the chart portals its date pill into, keeping it off the plot.
  const [pillSlot, setPillSlot] = useState(null)

  return (
    <ExpandedChartModal
      isOpen={isOpen}
      onClose={onClose}
      title="Over time"
      ariaLabel="Observations over time"
      controls={
        // "Measure" also changes the map; "Show as" only this window.
        <>
          <ControlGroup label="Measure">
            <AnalysisMetricToggle value={metric} onChange={setMetric} boxed />
          </ControlGroup>
          <div className="w-px h-5 bg-border" aria-hidden="true" />
          <ControlGroup label="Show as">
            <ChoiceToggle
              label="Chart type"
              options={CHART_TYPES}
              value={chartType}
              onChange={setChartType}
            />
          </ControlGroup>
        </>
      }
      headerRight={<div ref={setPillSlot} />}
      selectedSpecies={selectedSpecies}
      palette={palette}
      scientificToCommon={scientificToCommon}
      isLoading={isLoading}
    >
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
    </ExpandedChartModal>
  )
}
