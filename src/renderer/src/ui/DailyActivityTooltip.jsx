import { buildReadoutRows, yAxisUnitLabel } from '../utils/timelineReadout.js'
import { SpeciesName } from './timeseries.jsx'

/** Shared hourly readout, always fed unscaled counts/rates rather than plot heights. */
export default function DailyActivityTooltip({
  row,
  selectedSpecies,
  palette,
  metric,
  scientificToCommon,
  timeMode
}) {
  if (!row || !metric) return null
  const hourLabel = (hour) => `${String(hour).padStart(2, '0')}:00`
  const rows = buildReadoutRows({ row, selectedSpecies, palette, metric })

  return (
    <div
      role="tooltip"
      className="w-72 max-w-full px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md pointer-events-none"
    >
      <div className="font-medium mb-1">
        {hourLabel(row.hour)}–{hourLabel(row.hour + 1)}
        <span className="ml-2 text-muted-foreground font-normal">
          {timeMode === 'solar' ? 'Solar time' : 'Camera-local time'}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground mb-1">{yAxisUnitLabel(metric)}</div>
      {rows.map((entry) => (
        <div key={entry.scientificName} className="flex items-center gap-2 py-0.5">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <SpeciesName
            scientificName={entry.scientificName}
            scientificToCommon={scientificToCommon}
            className="flex-1 truncate"
          />
          <span className="font-medium tabular-nums">{entry.formatted}</span>
        </div>
      ))}
    </div>
  )
}
