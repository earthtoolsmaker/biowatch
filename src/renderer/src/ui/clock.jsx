import { useEffect, useId, useRef, useState } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import {
  timeToAngle,
  angleToTime,
  rangesToSegments,
  rangesToBoundaries,
  bandToSegments,
  bandWidth,
  bandWraps,
  resolveAction,
  sectorPath
} from './clockGeometry.js'
import {
  isFullDayArc,
  SOLAR_DAY_PERIOD_PRESETS,
  SOLAR_PERIOD_AREAS,
  selectSolarPeriod
} from '../utils/dayPeriods.js'
import SolarPeriodMarkers from './solarPeriodMarkers.jsx'
import DailyActivityTooltip from './DailyActivityTooltip.jsx'

// Compact default for standalone filters and species hovercards. Explore's
// combined polar chart derives its radius from the available card space.
const DEFAULT_CLOCK_RADIUS = 42
const RING_GAP = 2
const RING_WIDTH = 4
// Reserve the same label/icon space so switching time modes never resizes the circle.
const TIME_FILTER_PADDING = 28
const TIME_LABEL_OFFSET = 16
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

// Shared pointer/keyboard behavior for the polar sectors and line-chart bands.
const solarAreaProps = (key, selection, onChange) => ({
  role: 'button',
  tabIndex: 0,
  'aria-label': `${SOLAR_DAY_PERIOD_PRESETS[key].label} area`,
  'aria-pressed': selection?.has(key) ?? false,
  'data-solar-period': key,
  className:
    'cursor-pointer fill-transparent hover:fill-blue-500/15 focus-visible:fill-blue-500/15 outline-none transition-colors',
  onClick: (event) => onChange(selectSolarPeriod(selection, key, event.shiftKey)),
  onKeyDown: (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onChange(selectSolarPeriod(selection, key, event.shiftKey))
    }
  }
})

const CircularTimeFilter = ({
  onChange,
  startTime = 6,
  endTime = 18,
  mode = 'drag',
  readOnly = false,
  chipSectors = [],
  radius = DEFAULT_CLOCK_RADIUS,
  timeMode = 'clock',
  periodSelection,
  onPeriodSelectionChange
}) => {
  const [isDraggingStart, setIsDraggingStart] = useState(false)
  const [isDraggingEnd, setIsDraggingEnd] = useState(false)
  const [isDraggingArc, setIsDraggingArc] = useState(false)
  const [start, setStart] = useState(startTime)
  const [end, setEnd] = useState(endTime)
  const [lastDragPosition, setLastDragPosition] = useState(null)
  const svgRef = useRef(null)
  const solarAreaClipId = useId()

  const RING_MID = radius + RING_GAP + RING_WIDTH / 2
  const RING_OUTER = radius + RING_GAP + RING_WIDTH
  const svgSize = RING_OUTER * 2 + TIME_FILTER_PADDING * 2
  const center = {
    x: RING_OUTER + TIME_FILTER_PADDING,
    y: RING_OUTER + TIME_FILTER_PADDING
  }
  const labelOffset = RING_OUTER + TIME_LABEL_OFFSET
  const resetRadius = Math.min(16, radius / 3)

  // Sync local state when parent updates bounds externally. Does NOT fire
  // onChange continuously — that happens only on pointer release.
  useEffect(() => {
    setStart(startTime)
    setEnd(endTime)
  }, [startTime, endTime])

  const dragMode = mode !== 'chips'
  const interactive = dragMode && !readOnly
  // No filter includes every hour, so it always gets a full blue ring.
  const fullDayDrag = dragMode && isFullDayArc({ start, end })
  // Expanded mode shows the whole day without any selection styling.
  const ranges = readOnly
    ? []
    : fullDayDrag
      ? [{ start: 0, end: 24 }]
      : dragMode
        ? [{ start, end }]
        : chipSectors
  const segments = rangesToSegments(ranges)
  const isFullRing = segments.length === 1 && segments[0][0] === 0 && segments[0][1] === 24
  // Expanded charts show every hourly boundary, compact charts only the filter edges.
  const boundaries = readOnly ? HOURS : fullDayDrag ? [] : rangesToBoundaries(ranges)

  // Point on a circle of radius r at the given clock hour.
  const pointAt = (hour, r) => {
    const rad = (timeToAngle(hour) - 90) * (Math.PI / 180)
    return { x: center.x + r * Math.cos(rad), y: center.y + r * Math.sin(rad) }
  }

  // Open arc (stroked, not filled) along RING_MID from startHour to endHour,
  // drawn clockwise. Used for partial selections.
  const ringArcPath = (startHour, endHour) => {
    const a = pointAt(startHour, RING_MID)
    const b = pointAt(endHour, RING_MID)
    const sweep = (((endHour - startHour) % 24) + 24) % 24
    const largeArc = sweep > 12 ? 1 : 0
    return `M ${a.x} ${a.y} A ${RING_MID} ${RING_MID} 0 ${largeArc} 1 ${b.x} ${b.y}`
  }

  const handleMouseDown = (handle) => (e) => {
    if (handle === 'start') {
      setIsDraggingStart(true)
    } else if (handle === 'end') {
      setIsDraggingEnd(true)
    } else if (handle === 'arc') {
      setIsDraggingArc(true)
      const svgRect = svgRef.current.getBoundingClientRect()
      const x = e.clientX - svgRect.left - center.x
      const y = e.clientY - svgRect.top - center.y
      let angle = Math.atan2(y, x) * (180 / Math.PI) + 90
      if (angle < 0) angle += 360
      setLastDragPosition(angle)
    }
  }

  const handleMouseMove = (e) => {
    if (!isDraggingStart && !isDraggingEnd && !isDraggingArc) return
    const svgRect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - svgRect.left - center.x
    const y = e.clientY - svgRect.top - center.y
    let angle = Math.atan2(y, x) * (180 / Math.PI) + 90
    if (angle < 0) angle += 360

    if (isDraggingStart) {
      setStart(angleToTime(angle))
    } else if (isDraggingEnd) {
      setEnd(angleToTime(angle))
    } else if (isDraggingArc) {
      if (lastDragPosition !== null) {
        let angleDiff = angle - lastDragPosition
        if (angleDiff > 180) angleDiff -= 360
        if (angleDiff < -180) angleDiff += 360
        const timeDiff = angleDiff / 15
        let newStart = (start + timeDiff) % 24
        let newEnd = (end + timeDiff) % 24
        if (newStart < 0) newStart += 24
        if (newEnd < 0) newEnd += 24
        setStart(newStart)
        setEnd(newEnd)
      }
      setLastDragPosition(angle)
    }
  }

  const handleMouseUp = () => {
    const wasDragging = isDraggingStart || isDraggingEnd || isDraggingArc
    setIsDraggingStart(false)
    setIsDraggingEnd(false)
    setIsDraggingArc(false)
    setLastDragPosition(null)
    // Commit-on-release: fire onChange once with the final value.
    if (wasDragging) onChange({ start, end })
  }

  useEffect(() => {
    if (isDraggingStart || isDraggingEnd || isDraggingArc) {
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('mousemove', handleMouseMove)
    }
    return () => {
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('mousemove', handleMouseMove)
    }
    // start/end are in the deps so the window listeners always close over the
    // current range — otherwise dragging a start/end handle commits the stale
    // pre-drag value on release (lastDragPosition only changes during arc pans).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingStart, isDraggingEnd, isDraggingArc, lastDragPosition, start, end])

  const startCoord = pointAt(start, RING_MID)
  const endCoord = pointAt(end, RING_MID)

  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="relative flex-shrink-0" style={{ width: svgSize, height: svgSize }}>
        <svg
          data-testid="time-filter-circle"
          data-selected-ranges={JSON.stringify(fullDayDrag ? [] : ranges)}
          className="select-none"
          width={svgSize}
          height={svgSize}
          onMouseMove={handleMouseMove}
          ref={svgRef}
        >
          {timeMode === 'solar' && (
            <>
              <defs>
                <clipPath id={solarAreaClipId} clipPathUnits="userSpaceOnUse">
                  <path
                    clipRule="evenodd"
                    d={`M 0 0 H ${svgSize} V ${svgSize} H 0 Z
                      M ${center.x - resetRadius} ${center.y}
                      a ${resetRadius} ${resetRadius} 0 1 0 ${resetRadius * 2} 0
                      a ${resetRadius} ${resetRadius} 0 1 0 ${-resetRadius * 2} 0 Z`}
                  />
                </clipPath>
              </defs>
              <g clipPath={`url(#${solarAreaClipId})`}>
                {onPeriodSelectionChange &&
                  SOLAR_PERIOD_AREAS.map(({ key, start, end }) => (
                    <path
                      key={key}
                      d={sectorPath(start, end, radius, center)}
                      {...solarAreaProps(key, periodSelection, onPeriodSelectionChange)}
                    >
                      <title>{SOLAR_DAY_PERIOD_PRESETS[key].label}</title>
                    </path>
                  ))}
              </g>
              {onPeriodSelectionChange && (
                <circle
                  cx={center.x}
                  cy={center.y}
                  r={resetRadius}
                  pointerEvents="fill"
                  role="button"
                  tabIndex={0}
                  aria-label="Show all hours"
                  data-testid="solar-reset-selection"
                  className="cursor-pointer fill-transparent stroke-transparent hover:fill-blue-500/15 hover:stroke-blue-500/40 focus-visible:fill-blue-500/15 focus-visible:stroke-blue-500/40 outline-none transition-colors"
                  onClick={() => onPeriodSelectionChange(new Set())}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onPeriodSelectionChange(new Set())
                    }
                  }}
                >
                  <title>Show all hours</title>
                </circle>
              )}
            </>
          )}
          {/* Inner reference circle aligned to the radar's outer edge. */}
          <circle
            cx={center.x}
            cy={center.y}
            r={radius}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="1"
          />

          {/* Clock labels are replaced by solar-period controls in solar mode. */}
          {timeMode === 'clock' &&
            (readOnly ? HOURS : [0, 6, 12, 18]).map((hour) => {
              const p = pointAt(hour, labelOffset)
              return (
                <text
                  key={hour}
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="12"
                  fill="var(--color-muted-foreground)"
                >
                  {hour}h
                </text>
              )
            })}

          {/* Hourly spokes in expanded mode; selection edges in compact mode. */}
          {boundaries.map((hour) => {
            const p = pointAt(hour, radius)
            return (
              <line
                key={`bound-${hour}`}
                x1={center.x}
                y1={center.y}
                x2={p.x}
                y2={p.y}
                stroke="var(--color-muted-foreground)"
                strokeWidth="1"
                strokeDasharray="3 3"
                strokeOpacity={readOnly ? 0.25 : 0.5}
                pointerEvents="none"
              />
            )
          })}

          {/* The filter track is only useful in compact mode. */}
          {!readOnly && (
            <circle
              cx={center.x}
              cy={center.y}
              r={RING_MID}
              fill="none"
              stroke="var(--color-muted)"
              strokeWidth={RING_WIDTH}
            />
          )}

          {/* Blue selection on the ring. Full-day -> full ring; else arcs.
            The arc is the drag target for panning in interactive mode. */}
          {isFullRing ? (
            <circle
              cx={center.x}
              cy={center.y}
              r={RING_MID}
              fill="none"
              stroke="rgb(59 130 246)"
              strokeWidth={RING_WIDTH}
              cursor={interactive ? 'pointer' : 'default'}
              onMouseDown={interactive ? handleMouseDown('arc') : undefined}
            />
          ) : (
            segments.map(([s, e], i) => (
              <path
                key={i}
                d={ringArcPath(s, e)}
                fill="none"
                stroke="rgb(59 130 246)"
                strokeWidth={RING_WIDTH}
                strokeLinecap="butt"
                cursor={interactive ? 'pointer' : 'default'}
                onMouseDown={interactive ? handleMouseDown('arc') : undefined}
              />
            ))
          )}

          {/* Draggable handles (interactive mode only). */}
          {interactive && (
            <>
              <circle
                cx={startCoord.x}
                cy={startCoord.y}
                r="5"
                fill="rgb(59 130 246)"
                stroke="white"
                strokeWidth="1.5"
                cursor="pointer"
                onMouseDown={handleMouseDown('start')}
              />
              <circle
                cx={endCoord.x}
                cy={endCoord.y}
                r="5"
                fill="rgb(59 130 246)"
                stroke="white"
                strokeWidth="1.5"
                cursor="pointer"
                onMouseDown={handleMouseDown('end')}
              />
            </>
          )}
        </svg>
        {timeMode === 'solar' && (
          <SolarPeriodMarkers
            selection={periodSelection}
            onChange={onPeriodSelectionChange}
            center={center.x}
            radius={labelOffset}
          />
        )}
      </div>
    </div>
  )
}

// New component for species daily activity visualization
const DailyActivityRadar = ({
  activityData,
  selectedSpecies,
  palette,
  radius = DEFAULT_CLOCK_RADIUS
}) => {
  const chartRef = useRef(null)

  // Convert the activity data to a format suitable for the radar chart
  const formatData = (data) => {
    if (!data || !data.length) {
      return Array(24)
        .fill()
        .map((_, i) => ({
          hour: i,
          name: `${i}:00`
        }))
    }

    return data.map((hourData) => ({
      ...hourData,
      name: `${hourData.hour}:00`
    }))
  }

  const formattedData = formatData(activityData)

  return (
    <div className="relative w-full h-full flex items-center justify-center" ref={chartRef}>
      <div className="absolute inset-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart
            data={formattedData}
            margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
            outerRadius={radius}
          >
            <PolarGrid radialLines={false} polarRadius={[]} strokeWidth={1} />
            <PolarAngleAxis dataKey="name" tick={false} />
            {selectedSpecies.map((species, index) => (
              <Radar
                key={species.scientificName}
                name={species.scientificName}
                dataKey={species.scientificName}
                stroke={palette[index % palette.length]}
                fill={palette[index % palette.length]}
                fillOpacity={0.1}
                dot={false}
                activeDot={{ r: 5 }}
              />
            ))}
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// A draggable boundary handle on the line-mode track strip. `left` is a
// CSS percentage; `active` enlarges it on hover.
function StripHandle({ left, active }) {
  const size = active ? 12 : 9
  return (
    <div
      className="absolute top-1/2 rounded-full bg-blue-500 border border-white"
      style={{ left, width: size, height: size, transform: 'translate(-50%, -50%)' }}
    />
  )
}

/**
 * X–Y twin of DailyActivityRadar. Renders the same hourly-bin data as a
 * line per species across a 24-hour x-axis. The selected ranges are shown
 * in a dedicated track strip BELOW the axis (not over the plot), so the
 * activity curves stay unobstructed.
 *
 * Props mirror DailyActivityRadar plus:
 *   selectedRanges: Array<{start, end}> — hour ranges currently in the
 *     filter. Rendered as blue segments on the track strip.
 *   onArcChange: optional ({start, end}) => void — when provided AND there
 *     is at most one selected range, the strip is draggable (create / resize
 *     / pan). Pass undefined (e.g. while chips drive selection) to disable.
 */
const DailyActivityLine = ({
  activityData,
  readoutData,
  metric,
  scientificToCommon,
  selectedSpecies,
  palette,
  selectedRanges = [],
  onArcChange,
  // The selection track strip below the axis is only useful when the chart
  // drives a filter. Display-only uses (e.g. the species hovercard) pass false
  // to drop the otherwise-empty grey bar.
  showTrackStrip = true,
  showHourlyGrid = false,
  timeMode = 'clock',
  periodSelection,
  onPeriodSelectionChange
}) => {
  const hasSingleBand = selectedRanges.length === 1
  const isWrapBand = hasSingleBand && bandWraps(selectedRanges[0])
  const dragEnabled =
    typeof onArcChange === 'function' && (hasSingleBand || selectedRanges.length === 0)

  const stripRef = useRef(null)
  const [readoutX, setReadoutX] = useState(null)
  const [dragState, setDragState] = useState(null)
  // dragState: { mode: 'create'|'start'|'end'|'pan', liveStart, liveEnd, panOffset?, panWidth? }
  const isDragging = dragState !== null
  const [hoverAction, setHoverAction] = useState(null)

  // Pointer x over the strip -> hour [0,24]. The strip's inner box already
  // excludes the 8px insets, so no margin math is needed. When clamp01 is
  // false the value can exceed [0,24] (used during pan so the band wraps).
  const eventToHour = (e, { clamp01 = true } = {}) => {
    if (!stripRef.current) return null
    const rect = stripRef.current.getBoundingClientRect()
    if (rect.width <= 0) return null
    const raw = (e.clientX - rect.left) / rect.width
    const ratio = clamp01 ? Math.max(0, Math.min(1, raw)) : raw
    return ratio * 24
  }

  const handleMouseUp = () => {
    setDragState((prev) => {
      if (prev) {
        const { mode, liveStart, liveEnd } = prev
        if (mode === 'pan') {
          onArcChange({ start: liveStart, end: liveEnd })
        } else if (liveStart !== liveEnd) {
          onArcChange({ start: Math.min(liveStart, liveEnd), end: Math.max(liveStart, liveEnd) })
        }
      }
      return null
    })
  }

  const formatData = (data) => {
    if (!data || !data.length) {
      return Array(24)
        .fill()
        .map((_, i) => ({ hour: i }))
    }
    return data.map((d) => ({ ...d, hour: d.hour }))
  }
  const formattedData = formatData(activityData)

  // Live band while dragging — for pan it can wrap around midnight.
  const liveBand = (() => {
    if (!isDragging) return null
    const { mode, liveStart, liveEnd } = dragState
    if (mode === 'pan') return { start: liveStart, end: liveEnd }
    return { start: Math.min(liveStart, liveEnd), end: Math.max(liveStart, liveEnd) }
  })()

  // Segments + handle positions: live band while dragging, else the committed selection.
  const segments = liveBand ? bandToSegments(liveBand) : rangesToSegments(selectedRanges)
  // Interior boundary hours, drawn as dashed vertical guides in the plot.
  const boundaries = rangesToBoundaries(liveBand ? [liveBand] : selectedRanges)
  const handleStartX = (() => {
    if (isDragging) {
      const { mode, liveStart, liveEnd } = dragState
      return mode === 'pan' ? liveStart : Math.min(liveStart, liveEnd)
    }
    if (hasSingleBand && !isWrapBand) return selectedRanges[0].start
    return null
  })()
  const handleEndX = (() => {
    if (isDragging) {
      const { mode, liveStart, liveEnd } = dragState
      return mode === 'pan' ? liveEnd : Math.max(liveStart, liveEnd)
    }
    if (hasSingleBand && !isWrapBand) return selectedRanges[0].end
    return null
  })()

  const cursorStyle = (() => {
    if (!dragEnabled) return undefined
    const action = isDragging ? dragState.mode : hoverAction
    if (action === 'pan') return 'move'
    if (action === 'end' || action === 'start' || action === 'edge-start' || action === 'edge-end')
      return 'ew-resize'
    if (action === 'create') return 'crosshair'
    return 'default'
  })()
  const hoveredEdge =
    hoverAction === 'edge-start' || (isDragging && dragState.mode === 'start')
      ? 'start'
      : hoverAction === 'edge-end' || (isDragging && dragState.mode === 'end')
        ? 'end'
        : null

  // While dragging, listen on the document so the cursor can leave the strip.
  useEffect(() => {
    if (!isDragging) return
    const onDocMove = (e) => {
      setDragState((prev) => {
        if (!prev) return prev
        const cursor = eventToHour(e, { clamp01: prev.mode !== 'pan' })
        if (cursor === null) return prev
        if (prev.mode === 'pan') {
          const newStart = (((cursor - prev.panOffset) % 24) + 24) % 24
          const newEnd = (newStart + prev.panWidth) % 24
          return { ...prev, liveStart: newStart, liveEnd: newEnd }
        }
        if (prev.mode === 'start') return { ...prev, liveStart: cursor }
        return { ...prev, liveEnd: cursor }
      })
    }
    const onDocUp = () => handleMouseUp()
    document.addEventListener('mousemove', onDocMove)
    document.addEventListener('mouseup', onDocUp)
    return () => {
      document.removeEventListener('mousemove', onDocMove)
      document.removeEventListener('mouseup', onDocUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging])

  const handleStripMove = (e) => {
    if (isDragging || !dragEnabled) return
    const cursor = eventToHour(e)
    if (cursor === null) return
    setHoverAction(resolveAction(cursor, selectedRanges))
  }
  const handleStripDown = (e) => {
    if (!dragEnabled) return
    e.preventDefault()
    const cursor = eventToHour(e)
    if (cursor === null) return
    const action = resolveAction(cursor, selectedRanges)
    if (action === 'create') {
      setDragState({ mode: 'create', liveStart: cursor, liveEnd: cursor })
    } else if (action === 'edge-end') {
      setDragState({ mode: 'end', liveStart: selectedRanges[0].start, liveEnd: cursor })
    } else if (action === 'edge-start') {
      setDragState({ mode: 'start', liveStart: cursor, liveEnd: selectedRanges[0].end })
    } else {
      // pan
      const { start, end } = selectedRanges[0]
      const width = bandWidth(selectedRanges[0])
      const panOffset = isWrapBand && cursor < end ? cursor + 24 - start : cursor - start
      setDragState({ mode: 'pan', liveStart: start, liveEnd: end, panOffset, panWidth: width })
    }
  }
  const handleStripLeave = () => {
    if (!isDragging) setHoverAction(null)
  }

  const pct = (hour) => `${(hour / 24) * 100}%`

  return (
    <div className="relative w-full h-full flex flex-col select-none">
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={formattedData}
            margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
            onMouseMove={
              readoutData
                ? (state) => setReadoutX(state.isTooltipActive ? state.chartX : null)
                : undefined
            }
            onMouseLeave={() => setReadoutX(null)}
          >
            <CartesianGrid strokeOpacity={0} />
            {readoutData && (
              <Tooltip
                filterNull={false}
                isAnimationActive={false}
                cursor={false}
                wrapperStyle={{ pointerEvents: 'none', zIndex: 10 }}
                content={({ active, viewBox }) => {
                  if (!active || readoutX === null || !(viewBox.width > 0)) return null
                  // Use the containing [hour, hour + 1) interval, not Recharts'
                  // nearest data point (which switches halfway through a bucket).
                  const hour = Math.min(
                    23,
                    Math.max(0, Math.floor(((readoutX - viewBox.x) / viewBox.width) * 24))
                  )
                  return (
                    <DailyActivityTooltip
                      row={readoutData.find((row) => row.hour === hour)}
                      selectedSpecies={selectedSpecies}
                      palette={palette}
                      metric={metric}
                      scientificToCommon={scientificToCommon}
                      timeMode={timeMode}
                    />
                  )
                }}
              />
            )}
            <XAxis
              dataKey="hour"
              type="number"
              domain={[0, 24]}
              ticks={showHourlyGrid ? [...HOURS, 24] : [0, 6, 12, 18, 24]}
              interval={0}
              tickFormatter={(hour) => `${hour}h`}
              tick={
                timeMode === 'solar'
                  ? false
                  : { fontSize: 9, fill: 'var(--color-muted-foreground)' }
              }
              height={timeMode === 'solar' ? 4 : 30}
              axisLine={false}
              tickLine={false}
            />
            {/* 10% headroom so a species' peak isn't flush against the top
                edge (otherwise the line gets clipped into a flat "cap"). */}
            <YAxis hide domain={[0, (dataMax) => (dataMax > 0 ? dataMax * 1.1 : 1)]} />
            {/* Keep reference areas direct children so Recharts discovers them. */}
            {timeMode === 'solar' &&
              onPeriodSelectionChange &&
              SOLAR_PERIOD_AREAS.flatMap(({ key, start, end }) =>
                bandToSegments({ start, end }).map(([s, e]) => (
                  <ReferenceArea
                    key={`${key}-${s}`}
                    x1={s}
                    x2={e}
                    shape={({ x, y, width, height }) => (
                      <rect
                        x={x}
                        y={y}
                        width={width}
                        height={height}
                        {...solarAreaProps(key, periodSelection, onPeriodSelectionChange)}
                      >
                        <title>{SOLAR_DAY_PERIOD_PRESETS[key].label}</title>
                      </rect>
                    )}
                  />
                ))
              )}
            {/* Expanded mode exposes every hourly bucket in either time basis. */}
            {(showHourlyGrid ? [...HOURS, 24] : boundaries).map((hour) => (
              <ReferenceLine
                key={`bound-${hour}`}
                x={hour}
                stroke="var(--color-muted-foreground)"
                strokeWidth={1}
                strokeDasharray="3 3"
                strokeOpacity={showHourlyGrid ? 0.25 : 0.5}
              />
            ))}
            {selectedSpecies.map((species, index) => (
              <Line
                key={species.scientificName}
                type="monotone"
                dataKey={species.scientificName}
                stroke={palette[index % palette.length]}
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {timeMode === 'solar' && (
        <SolarPeriodMarkers
          layout="line"
          selection={periodSelection}
          onChange={onPeriodSelectionChange}
        />
      )}

      {/* Selection track strip below the axis. 8px insets match the chart's
          left/right margin so hour 0..24 line up with the plot. */}
      {showTrackStrip && (
        <div className="px-2 pb-1" style={cursorStyle ? { cursor: cursorStyle } : undefined}>
          <div
            ref={stripRef}
            className="relative h-1.5 rounded-full bg-muted"
            onMouseDown={handleStripDown}
            onMouseMove={handleStripMove}
            onMouseLeave={handleStripLeave}
          >
            {segments.map(([s, e], i) => (
              <div
                key={i}
                className="absolute top-0 h-full rounded-full"
                style={{ left: pct(s), width: pct(e - s), backgroundColor: 'rgb(59 130 246)' }}
              />
            ))}
            {/* start always renders; end only when it doesn't coincide with start */}
            {dragEnabled && handleStartX !== null && (
              <StripHandle left={pct(handleStartX)} active={hoveredEdge === 'start'} />
            )}
            {dragEnabled && handleEndX !== null && handleEndX !== handleStartX && (
              <StripHandle left={pct(handleEndX)} active={hoveredEdge === 'end'} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Keep the radar and its selection overlay on exactly the same responsive
// geometry. Only measured DOM bounds are state; all radii are derived.
const DailyActivityPolar = ({
  activityData,
  readoutData,
  metric,
  scientificToCommon,
  selectedSpecies,
  palette,
  timeMode = 'clock',
  ...filterProps
}) => {
  const containerRef = useRef(null)
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const [pointer, setPointer] = useState(null)

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setBounds({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const radius = Math.max(
    1,
    Math.min(bounds.width, bounds.height) / 2 - TIME_FILTER_PADDING - RING_GAP - RING_WIDTH - 6 // clearance around the outer icons/labels
  )

  // The filter SVG covers the radar, so observe pointer movement on their
  // shared parent instead of relying on Recharts' obscured hover targets.
  const handlePointerMove = (event) => {
    if (!readoutData || event.buttons) {
      setPointer(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const distance = Math.hypot(x - bounds.width / 2, y - bounds.height / 2)
    setPointer(distance > 16 && distance <= radius ? { x, y } : null)
  }
  const angle = pointer
    ? (Math.atan2(pointer.y - bounds.height / 2, pointer.x - bounds.width / 2) * 180) / Math.PI + 90
    : 0
  // Each wedge belongs to its starting hour, including the 23:00–00:00 wedge.
  const hoveredHour = Math.floor(((angle + 360) % 360) / 15)
  const hoveredRow = pointer && readoutData?.find((row) => row.hour === hoveredHour)

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-w-0 min-h-0"
      onPointerMove={readoutData ? handlePointerMove : undefined}
      onPointerDown={() => setPointer(null)}
      onPointerLeave={() => setPointer(null)}
    >
      {bounds.width > 0 && bounds.height > 0 && (
        <>
          <DailyActivityRadar
            activityData={activityData}
            selectedSpecies={selectedSpecies}
            palette={palette}
            radius={radius}
          />
          <div className="absolute inset-0">
            <CircularTimeFilter {...filterProps} timeMode={timeMode} radius={radius} />
          </div>
          {hoveredRow && (
            <>
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <path
                  d={sectorPath(hoveredHour, hoveredHour + 1, radius, {
                    x: bounds.width / 2,
                    y: bounds.height / 2
                  })}
                  fill="var(--color-muted-foreground)"
                  fillOpacity={0.08}
                />
              </svg>
              <div
                className="absolute z-10 pointer-events-none max-w-full"
                style={{
                  left: Math.max(0, Math.min(pointer.x + 12, bounds.width - 288)),
                  top: Math.max(
                    0,
                    Math.min(pointer.y + 12, bounds.height - (72 + selectedSpecies.length * 24))
                  )
                }}
              >
                <DailyActivityTooltip
                  row={hoveredRow}
                  selectedSpecies={selectedSpecies}
                  palette={palette}
                  metric={metric}
                  scientificToCommon={scientificToCommon}
                  timeMode={timeMode}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

export { DailyActivityPolar, DailyActivityRadar, DailyActivityLine, CircularTimeFilter as default }
