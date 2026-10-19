import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

import { ReadoutCard } from './timeseries'
import { rangesToSegments } from './clockGeometry'
import { formatHourRange, hourBarSizePx, sectorPath } from '../utils/dailyActivityChart.js'
import { buildReadoutRows, niceYTicks, yAxisUnitLabel } from '../utils/timelineReadout.js'

const Y_AXIS_WIDTH = 64
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]
const POLAR_LABEL_ROOM_PX = 36
const SELECTION_FILL = 'rgb(59 130 246)'
const axisFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const formatHour = (h) => `${String(h).padStart(2, '0')}:00`
const muted = 'var(--color-muted-foreground)'

function useElementSize() {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

/**
 * Daily activity at real hourly values, drawn as a 24-hour clock ('polar'),
 * a line or grouped bars across 0–24 h. Axes use round ticks; hours in
 * `selectedRanges` (the time-of-day filter, [] for none) are shaded; hovering
 * shows each species' value for that hour.
 */
export default function DailyActivityExpandedChart({
  activityData,
  selectedSpecies,
  palette,
  metric,
  scientificToCommon,
  chartType,
  selectedRanges
}) {
  const [ref, { width, height }] = useElementSize()
  const keys = useMemo(() => selectedSpecies.map((s) => s.scientificName), [selectedSpecies])

  // One row per hour; `x` centres line points and bars in their hour slot,
  // `raw` keeps the unrounded row (with RAI nulls) for the readout.
  const rows = useMemo(
    () =>
      Array.from({ length: 24 }, (_, hour) => {
        const raw = activityData?.find((r) => r.hour === hour) ?? { hour }
        const item = { hour, x: hour + 0.5, raw }
        for (const key of keys) item[key] = raw[key] || 0
        return item
      }),
    [activityData, keys]
  )

  // 5% headroom before rounding up keeps the peak off the edge.
  const yTicks = useMemo(() => {
    let max = 0
    for (const row of rows) for (const key of keys) max = Math.max(max, row[key])
    return niceYTicks(max * 1.05)
  }, [rows, keys])
  const top = yTicks[yTicks.length - 1]

  const segments = useMemo(() => rangesToSegments(selectedRanges), [selectedRanges])

  const tooltip = (
    <Tooltip
      isAnimationActive={false}
      cursor={chartType === 'polar' ? false : { stroke: muted, strokeWidth: 1 }}
      content={({ active, payload }) =>
        active && payload?.length ? (
          <ReadoutCard
            title={formatHourRange(payload[0].payload.hour)}
            metric={metric}
            rows={buildReadoutRows({
              row: payload[0].payload.raw,
              selectedSpecies,
              palette,
              metric
            })}
            scientificToCommon={scientificToCommon}
          />
        ) : null
      }
    />
  )

  if (chartType === 'polar') {
    const cx = width / 2
    const cy = height / 2
    const r = Math.max(0, Math.min(width, height) / 2 - POLAR_LABEL_ROOM_PX)
    return (
      <div ref={ref} className="relative w-full h-full">
        {r > 0 && (
          <>
            {/* Selected hours, drawn under the chart as clock-face wedges. */}
            <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
              {segments.map(([start, end]) => (
                <path
                  key={`${start}-${end}`}
                  d={sectorPath({ cx, cy, r, start, end })}
                  fill={SELECTION_FILL}
                  fillOpacity={0.08}
                />
              ))}
            </svg>
            <RadarChart width={width} height={height} cx={cx} cy={cy} outerRadius={r} data={rows}>
              <PolarGrid gridType="circle" radialLines={false} />
              <PolarAngleAxis
                dataKey="hour"
                tickFormatter={(h) => (h % 3 === 0 ? formatHour(h) : '')}
                tick={{ fontSize: 10, fill: muted }}
              />
              {/* Value labels just left of midnight, clear of the "00:00" label. */}
              <PolarRadiusAxis
                angle={97.5}
                domain={[0, top]}
                tickCount={yTicks.length}
                tickFormatter={(v) => axisFormatter.format(v)}
                tick={{ fontSize: 9, fill: muted }}
                axisLine={false}
              />
              {tooltip}
              {selectedSpecies.map((species, index) => (
                <Radar
                  key={species.scientificName}
                  dataKey={species.scientificName}
                  stroke={palette[index % palette.length]}
                  fill={palette[index % palette.length]}
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              ))}
            </RadarChart>
          </>
        )}
      </div>
    )
  }

  const barSize = hourBarSizePx({
    plotWidth: width - Y_AXIS_WIDTH - 12,
    speciesCount: selectedSpecies.length
  })

  return (
    <div ref={ref} className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x"
            type="number"
            domain={[0, 24]}
            ticks={HOUR_TICKS}
            tickFormatter={formatHour}
            tick={{ fontSize: 10, fill: muted }}
            height={25}
          />
          <YAxis
            domain={[0, top]}
            ticks={yTicks}
            allowDataOverflow
            width={Y_AXIS_WIDTH}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: muted }}
            tickFormatter={(v) => axisFormatter.format(v)}
            label={{
              value: yAxisUnitLabel(metric),
              angle: -90,
              position: 'insideLeft',
              style: { textAnchor: 'middle', fontSize: 11, fill: muted }
            }}
          />
          {segments.map(([start, end]) => (
            <ReferenceArea
              key={`${start}-${end}`}
              x1={start}
              x2={end}
              fill={SELECTION_FILL}
              fillOpacity={0.08}
            />
          ))}
          {tooltip}
          {selectedSpecies.map((species, index) =>
            chartType === 'bar' ? (
              <Bar
                key={species.scientificName}
                dataKey={species.scientificName}
                fill={palette[index % palette.length]}
                barSize={barSize}
                isAnimationActive={false}
              />
            ) : (
              <Line
                key={species.scientificName}
                type="monotone"
                dataKey={species.scientificName}
                stroke={palette[index % palette.length]}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            )
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
