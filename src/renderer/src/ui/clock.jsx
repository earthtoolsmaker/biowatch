import { useEffect, useRef, useState } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
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
  resolveAction
} from './clockGeometry.js'
import { isFullDayArc } from '../utils/dayPeriods.js'

// Outer radius (in px) of the activity radar and the inner reference circle.
// The selection ring lives OUTSIDE this, so the radar is kept a little
// smaller than the old full-size circle to leave room for the ring without
// growing the widget's footprint (which would collide with the mode toggle).
const CLOCK_OUTER_RADIUS_PX = 42

// Selection ring sits just OUTSIDE the radar circle so it never covers the
// activity blob. Radii are in the same px space as CLOCK_OUTER_RADIUS_PX.
const RING_GAP = 2 // gap between radar edge and ring
const RING_WIDTH = 4 // stroke thickness of the ring
const RING_MID = CLOCK_OUTER_RADIUS_PX + RING_GAP + RING_WIDTH / 2
const RING_OUTER = CLOCK_OUTER_RADIUS_PX + RING_GAP + RING_WIDTH

const CircularTimeFilter = ({
  onChange,
  startTime = 6,
  endTime = 18,
  mode = 'drag',
  chipSectors = []
}) => {
  const [isDraggingStart, setIsDraggingStart] = useState(false)
  const [isDraggingEnd, setIsDraggingEnd] = useState(false)
  const [isDraggingArc, setIsDraggingArc] = useState(false)
  const [start, setStart] = useState(startTime)
  const [end, setEnd] = useState(endTime)
  const [lastDragPosition, setLastDragPosition] = useState(null)
  const svgRef = useRef(null)

  const padding = 14 // room for hour labels outside the ring
  const svgSize = RING_OUTER * 2 + padding * 2
  const center = { x: RING_OUTER + padding, y: RING_OUTER + padding }
  const labelOffset = RING_OUTER + 8

  // Sync local state when parent updates bounds externally. Does NOT fire
  // onChange continuously — that happens only on pointer release.
  useEffect(() => {
    setStart(startTime)
    setEnd(endTime)
  }, [startTime, endTime])

  const interactive = mode !== 'chips'
  // A full-day freeform drag is "no filter" (same as the backend's
  // isFullDayArc and the x-y view) — render no blue so it doesn't look like
  // an active full selection. Chip-driven full day (the default) is the
  // intended full ring and is left to the chipSectors path below.
  const fullDayDrag = interactive && isFullDayArc({ start, end })
  // Ranges to paint as blue arcs: the live drag band, or the chip sectors.
  const ranges = interactive ? [{ start, end }] : chipSectors
  const segments = fullDayDrag ? [] : rangesToSegments(ranges)
  const isFullRing = segments.length === 1 && segments[0][0] === 0 && segments[0][1] === 24
  // Interior boundary hours, drawn as dashed radial guides into the plot.
  const boundaries = fullDayDrag ? [] : rangesToBoundaries(ranges)

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
      <svg
        className="select-none"
        width={svgSize}
        height={svgSize}
        onMouseMove={handleMouseMove}
        ref={svgRef}
      >
        {/* Inner reference circle aligned to the radar's outer edge. */}
        <circle
          cx={center.x}
          cy={center.y}
          r={CLOCK_OUTER_RADIUS_PX}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="1"
        />

        {/* Hour labels just outside the ring. */}
        <text
          x={center.x}
          y={center.y - labelOffset}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fill="var(--color-muted-foreground)"
        >
          0h
        </text>
        <text
          x={center.x + labelOffset}
          y={center.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fill="var(--color-muted-foreground)"
        >
          6h
        </text>
        <text
          x={center.x}
          y={center.y + labelOffset}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fill="var(--color-muted-foreground)"
        >
          12h
        </text>
        <text
          x={center.x - labelOffset}
          y={center.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fill="var(--color-muted-foreground)"
        >
          18h
        </text>

        {/* Dashed radial guides at the selection boundaries (center -> radar
            edge), so it's visible where the window sits over the activity. */}
        {boundaries.map((hour) => {
          const p = pointAt(hour, CLOCK_OUTER_RADIUS_PX)
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
              strokeOpacity="0.5"
            />
          )
        })}

        {/* Gray track ring. */}
        <circle
          cx={center.x}
          cy={center.y}
          r={RING_MID}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={RING_WIDTH}
        />

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
    </div>
  )
}

// New component for species daily activity visualization
const DailyActivityRadar = ({ activityData, selectedSpecies, palette }) => {
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
      <div className="relative h-full aspect-square">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart
            data={formattedData}
            margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
            outerRadius={CLOCK_OUTER_RADIUS_PX}
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
  selectedSpecies,
  palette,
  selectedRanges = [],
  onArcChange
}) => {
  const hasSingleBand = selectedRanges.length === 1
  const isWrapBand = hasSingleBand && bandWraps(selectedRanges[0])
  const dragEnabled =
    typeof onArcChange === 'function' && (hasSingleBand || selectedRanges.length === 0)

  const stripRef = useRef(null)
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
          <ComposedChart data={formattedData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeOpacity={0} />
            <XAxis
              dataKey="hour"
              type="number"
              domain={[0, 24]}
              ticks={[0, 6, 12, 18, 24]}
              tick={{ fontSize: 9, fill: 'var(--color-muted-foreground)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide domain={[0, 'auto']} />
            {/* Dashed vertical guides at the selection boundaries. */}
            {boundaries.map((hour) => (
              <ReferenceLine
                key={`bound-${hour}`}
                x={hour}
                stroke="var(--color-muted-foreground)"
                strokeWidth={1}
                strokeDasharray="3 3"
                strokeOpacity={0.5}
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
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Selection track strip below the axis. 8px insets match the chart's
          left/right margin so hour 0..24 line up with the plot. */}
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
    </div>
  )
}

// Export all components
export { DailyActivityRadar, DailyActivityLine, CircularTimeFilter as default }
