import { ChartColumn, ChartLine, ChartPie } from 'lucide-react'

import AnalysisMetricToggle from './AnalysisMetricToggle'
import DailyActivityExpandedChart from './DailyActivityExpandedChart'
import ExpandedChartModal, { ChoiceToggle, ControlGroup } from './ExpandedChartModal'

const CHART_TYPES = [
  { value: 'polar', label: 'Polar', Icon: ChartPie },
  { value: 'line', label: 'Line', Icon: ChartLine },
  { value: 'bar', label: 'Bars', Icon: ChartColumn }
]

/**
 * Enlarged view of the Explore daily-activity clock: real hourly values with
 * a hover readout. The metric switch is the Explore tab's own state, so
 * changes here also apply to the map behind; Polar / Line / Bars only
 * changes how this window draws the series. The time-of-day filter is set
 * on the clock card; this window only shades the hours it covers.
 * `subtitle` names the date range the activity covers.
 */
export default function DailyActivityExpandedModal({
  isOpen,
  onClose,
  isLoading,
  activityData,
  selectedSpecies,
  palette,
  metric,
  setMetric,
  scientificToCommon,
  selectedRanges,
  subtitle,
  chartType,
  setChartType
}) {
  return (
    <ExpandedChartModal
      isOpen={isOpen}
      onClose={onClose}
      title="Daily activity"
      subtitle={subtitle}
      ariaLabel="Daily activity"
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
      selectedSpecies={selectedSpecies}
      palette={palette}
      scientificToCommon={scientificToCommon}
      isLoading={isLoading}
    >
      <DailyActivityExpandedChart
        activityData={activityData}
        selectedSpecies={selectedSpecies}
        palette={palette}
        metric={metric}
        scientificToCommon={scientificToCommon}
        chartType={chartType}
        selectedRanges={selectedRanges}
      />
    </ExpandedChartModal>
  )
}
