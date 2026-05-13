import { useEffect, useRef, useState } from 'react'
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
  XAxis,
  YAxis
} from 'recharts'

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
  const radius = 47
  const padding = 16 // Padding leaves room for hour labels outside the circle
  const svgSize = radius * 2 + padding * 2 // Increase SVG size to accommodate padding
  const center = { x: radius + padding, y: radius + padding } // Adjust center coordinates
  const labelOffset = 9 // Distance from circle edge to label center

  // Sync local state when parent updates the bounds externally (e.g. tab
  // switch). Does NOT fire onChange continuously — that happens only on
  // pointer release so downstream queries don't refetch per-mousemove.
  useEffect(() => {
    setStart(startTime)
    setEnd(endTime)
  }, [startTime, endTime])

  const isFullDayRange = () => {
    return Math.abs(end - start) >= 23.9 || start === end
  }

  const angleToTime = (angle) => {
    let time = (angle / 15) % 24
    return time
  }

  const timeToAngle = (time) => {
    return (time * 15) % 360
  }

  const angleToCoordinates = (angle) => {
    const radians = (angle - 90) * (Math.PI / 180)
    return {
      x: center.x + radius * Math.cos(radians),
      y: center.y + radius * Math.sin(radians)
    }
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
    // Commit-on-release: fire onChange once with the final value, rather
    // than per-mousemove during the drag.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingStart, isDraggingEnd, isDraggingArc, lastDragPosition])

  const startCoord = angleToCoordinates(timeToAngle(start))
  const endCoord = angleToCoordinates(timeToAngle(end))

  const createArc = (startAngle, endAngle) => {
    // Full-day check based on the PASSED angles (not closure state) so this
    // helper works correctly for both the drag arc and chip-driven sectors.
    const sweep = (((endAngle - startAngle) % 360) + 360) % 360
    if (startAngle === endAngle || sweep >= 358.5) {
      return `M ${center.x} ${center.y}
              L ${center.x} ${center.y - radius}
              A ${radius} ${radius} 0 1 1 ${center.x - 0.1} ${center.y - radius}
              Z`
    }

    const startRad = (startAngle - 90) * (Math.PI / 180)
    const endRad = (endAngle - 90) * (Math.PI / 180)

    let largeArcFlag
    if (startAngle <= endAngle) {
      largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1
    } else {
      largeArcFlag = 360 - startAngle + endAngle <= 180 ? 0 : 1
    }

    const startX = center.x + radius * Math.cos(startRad)
    const startY = center.y + radius * Math.sin(startRad)
    const endX = center.x + radius * Math.cos(endRad)
    const endY = center.y + radius * Math.sin(endRad)

    // Create a pie section by starting at center, moving to arc start,
    // drawing the arc, then closing back to center
    return `M ${center.x} ${center.y}
            L ${startX} ${startY}
            A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}
            Z`
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <svg
        className="select-none"
        width={svgSize}
        height={svgSize}
        onMouseMove={handleMouseMove}
        ref={svgRef}
      >
        <circle
          cx={center.x}
          cy={center.y}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="2"
        />

        {/* Hour labels at the four cardinal points, just outside the circle */}
        <text
          x={center.x}
          y={center.y - radius - labelOffset}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fill="var(--color-muted-foreground)"
        >
          0h
        </text>
        <text
          x={center.x + radius + labelOffset}
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
          y={center.y + radius + labelOffset}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fill="var(--color-muted-foreground)"
        >
          12h
        </text>
        <text
          x={center.x - radius - labelOffset}
          y={center.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fill="var(--color-muted-foreground)"
        >
          18h
        </text>

        {Array.from({ length: 24 }).map((_, i) => {
          const angle = timeToAngle(i)
          const coord = angleToCoordinates(angle)
          const isMajor = i % 6 === 0

          return (
            <g key={i}>
              <line
                x1={
                  isMajor
                    ? center.x + (radius - 5) * Math.cos((angle - 90) * (Math.PI / 180))
                    : coord.x
                }
                y1={
                  isMajor
                    ? center.y + (radius - 5) * Math.sin((angle - 90) * (Math.PI / 180))
                    : coord.y
                }
                x2={coord.x}
                y2={coord.y}
                stroke="var(--color-muted-foreground)"
                strokeWidth={isMajor ? 2 : 1}
              />
            </g>
          )
        })}

        {mode === 'chips' ? (
          chipSectors.map((sector, i) =>
            sector.start === 0 && sector.end === 24 ? (
              <circle
                key={i}
                cx={center.x}
                cy={center.y}
                r={radius}
                fill="rgb(59 130 246 / 0.15)"
                stroke="rgb(59 130 246 / 0.8)"
                strokeWidth="2"
                pointerEvents="none"
              />
            ) : (
              <path
                key={i}
                d={createArc(timeToAngle(sector.start), timeToAngle(sector.end))}
                fill="rgb(59 130 246 / 0.15)"
                stroke="rgb(59 130 246 / 0.8)"
                strokeWidth="2"
                pointerEvents="none"
              />
            )
          )
        ) : (
          <>
            {/* Suppress the highlight arc when the drag selection is full-day —
                otherwise "no filter" looks identical to "everything selected".
                Handles stay visible (overlap at top) so the user can still drag. */}
            {!isFullDayRange() && (
              <path
                d={createArc(timeToAngle(start), timeToAngle(end))}
                fill="rgb(59 130 246 / 0.15)"
                stroke="rgb(59 130 246 / 0.8)"
                strokeWidth="2"
                cursor="pointer"
                onMouseDown={handleMouseDown('arc')}
              />
            )}

            <circle
              cx={startCoord.x}
              cy={startCoord.y}
              r="4"
              fill="rgb(59 130 246)"
              cursor="pointer"
              onMouseDown={handleMouseDown('start')}
            />

            <circle
              cx={endCoord.x}
              cy={endCoord.y}
              r="4"
              fill="rgb(59 130 246)"
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
          <RadarChart data={formattedData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <PolarGrid radialLines={false} polarRadius={[]} strokeWidth={1} />
            <PolarAngleAxis dataKey="name" tick={false} />
            {/* <PolarRadiusAxis
              angle={30}
              domain={[0, 'auto']}
              tick={false}
              axisLine={false}
              tickCount={5}
            /> */}
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

/**
 * X–Y twin of DailyActivityRadar. Renders the same hourly-bin data as a
 * line per species across a 24-hour x-axis. Selected ranges are shaded
 * with the same blue used by the polar arc.
 *
 * Props mirror DailyActivityRadar plus:
 *   selectedRanges: Array<{start, end}> — hour ranges currently in the
 *     filter. Rendered as shaded bands.
 *   onArcChange: optional ({start, end}) => void — when provided AND there
 *     is exactly one (non-wrap-around) selected range, the chart shows a
 *     draggable end-line that the user can slide to extend/contract the
 *     range. Pass undefined (e.g. while chips are driving selection) to
 *     disable.
 */
const DailyActivityLine = ({
  activityData,
  selectedSpecies,
  palette,
  selectedRanges = [],
  onArcChange
}) => {
  // Drag interactions on the x-y chart:
  //   - click NEAR the end edge of an existing band  → slide the end edge
  //   - click INSIDE the band (not near edge)         → pan the whole band
  //                                                     (wraps at midnight)
  //   - click OUTSIDE any band, or no band at all     → drag-to-create
  // Wrap-around selections are panned but not edge-slid.
  const hasSingleBand = selectedRanges.length === 1
  const isWrapBand = hasSingleBand && selectedRanges[0].start >= selectedRanges[0].end
  const dragEnabled =
    typeof onArcChange === 'function' && (hasSingleBand || selectedRanges.length === 0)

  const [dragState, setDragState] = useState(null)
  // dragState shape:
  //   { mode: 'end',    liveStart, liveEnd }
  //   { mode: 'start',  liveStart, liveEnd }
  //   { mode: 'pan',    liveStart, liveEnd, panOffset, panWidth }
  //   { mode: 'create', liveStart, liveEnd }
  const isDragging = dragState !== null
  // Tracks what the cursor is hovering OVER (when not dragging) so we can
  // preview the action that a click would trigger: 'pan' | 'edge' | null.
  const [hoverAction, setHoverAction] = useState(null)

  const clamp = (v) => Math.max(0, Math.min(24, v))

  // Whether `cursor` is inside the (possibly wrap-around) band.
  const isInsideBand = (cursor, band) => {
    if (band.start < band.end) return cursor > band.start && cursor < band.end
    return cursor > band.start || cursor < band.end
  }

  const handleMouseDown = (e) => {
    if (!dragEnabled || !e || e.activeLabel === undefined || e.activeLabel === null) return
    const cursor = clamp(e.activeLabel)
    if (!hasSingleBand) {
      setDragState({ mode: 'create', liveStart: cursor, liveEnd: cursor })
      return
    }
    const { start, end } = selectedRanges[0]
    const width = isWrapBand ? 24 - start + end : end - start
    const edgeTol = Math.min(1.5, width / 3)
    if (!isWrapBand && cursor >= end - edgeTol && cursor <= end + edgeTol) {
      // slide end: pivot = start, moving = end
      setDragState({ mode: 'end', liveStart: start, liveEnd: cursor })
    } else if (!isWrapBand && cursor >= start - edgeTol && cursor <= start + edgeTol) {
      // slide start: pivot = end, moving = start
      setDragState({ mode: 'start', liveStart: cursor, liveEnd: end })
    } else if (isInsideBand(cursor, { start, end })) {
      const panOffset = isWrapBand && cursor < end ? cursor + 24 - start : cursor - start
      setDragState({ mode: 'pan', liveStart: start, liveEnd: end, panOffset, panWidth: width })
    } else {
      setDragState({ mode: 'create', liveStart: cursor, liveEnd: cursor })
    }
  }

  // Compute what action a click at `cursor` would trigger (used for both
  // hover-cursor previewing and the actual mousedown branch).
  const actionAt = (cursor) => {
    if (!hasSingleBand) return 'create'
    const { start, end } = selectedRanges[0]
    const width = isWrapBand ? 24 - start + end : end - start
    const edgeTol = Math.min(1.5, width / 3)
    if (!isWrapBand && cursor >= end - edgeTol && cursor <= end + edgeTol) return 'edge'
    if (!isWrapBand && cursor >= start - edgeTol && cursor <= start + edgeTol) return 'edge'
    if (isInsideBand(cursor, { start, end })) return 'pan'
    return 'create'
  }

  const handleMouseMove = (e) => {
    if (!e || e.activeLabel === undefined || e.activeLabel === null) {
      if (!isDragging) setHoverAction(null)
      return
    }
    const cursor = clamp(e.activeLabel)
    if (!isDragging) {
      if (dragEnabled) setHoverAction(actionAt(cursor))
      return
    }
    setDragState((prev) => {
      if (!prev) return prev
      if (prev.mode === 'pan') {
        const newStart = (((cursor - prev.panOffset) % 24) + 24) % 24
        const newEnd = (newStart + prev.panWidth) % 24
        return { ...prev, liveStart: newStart, liveEnd: newEnd }
      }
      if (prev.mode === 'start') return { ...prev, liveStart: cursor }
      // end / create
      return { ...prev, liveEnd: cursor }
    })
  }

  const handleMouseUp = () => {
    if (isDragging) {
      const { mode, liveStart, liveEnd } = dragState
      if (mode === 'pan') {
        onArcChange({ start: liveStart, end: liveEnd })
      } else if (liveStart !== liveEnd) {
        const start = Math.min(liveStart, liveEnd)
        const end = Math.max(liveStart, liveEnd)
        onArcChange({ start, end })
      }
    }
    setDragState(null)
  }
  const handleMouseLeave = () => {
    setDragState(null)
    setHoverAction(null)
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

  // Highlight the SELECTED ranges (consistent with the polar's blue arc).
  // Wrap-around ranges (start > end) split into two pieces.
  const selectedBands = []
  for (const r of selectedRanges) {
    if (r.start === r.end) continue
    if (r.start < r.end) {
      selectedBands.push([r.start, r.end])
    } else {
      selectedBands.push([r.start, 24])
      selectedBands.push([0, r.end])
    }
  }

  // Convert a (possibly wrap-around) {start, end} band into one or two
  // ReferenceArea-friendly [s, e] segments.
  const bandToSegments = (band) => {
    if (band.start === band.end) return []
    if (band.start < band.end) return [[band.start, band.end]]
    return [
      [band.start, 24],
      [0, band.end]
    ]
  }
  // Live band while dragging — for pan it can wrap around midnight.
  const liveBand = (() => {
    if (!isDragging) return null
    const { mode, liveStart, liveEnd } = dragState
    if (mode === 'pan') return { start: liveStart, end: liveEnd }
    return { start: Math.min(liveStart, liveEnd), end: Math.max(liveStart, liveEnd) }
  })()
  const liveSegments = liveBand ? bandToSegments(liveBand) : []

  // Edge-line positions for the visible handles.
  const handleStartX = (() => {
    if (isDragging) {
      const { mode, liveStart, liveEnd } = dragState
      if (mode === 'pan') return liveStart
      if (mode === 'create') return Math.min(liveStart, liveEnd)
      return Math.min(liveStart, liveEnd)
    }
    if (hasSingleBand && !isWrapBand) return selectedRanges[0].start
    return null
  })()
  const handleEndX = (() => {
    if (isDragging) {
      const { mode, liveStart, liveEnd } = dragState
      if (mode === 'pan') return liveEnd
      if (mode === 'create') return Math.max(liveStart, liveEnd)
      return Math.max(liveStart, liveEnd)
    }
    if (hasSingleBand && !isWrapBand) return selectedRanges[0].end
    return null
  })()

  // Dynamic cursor: previews the action when idle, reflects it during drag.
  const cursorClass = (() => {
    if (!dragEnabled) return ''
    const action = isDragging ? dragState.mode : hoverAction
    if (action === 'pan') return 'cursor-move'
    if (action === 'end' || action === 'start' || action === 'edge') return 'cursor-ew-resize'
    if (action === 'create') return 'cursor-crosshair'
    return 'cursor-default'
  })()

  return (
    <div className={`relative w-full h-full ${cursorClass}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={formattedData}
          margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
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
          {/* While dragging, show only the live band; otherwise the committed bands. */}
          {isDragging
            ? liveSegments.map(([s, e], i) => (
                <ReferenceArea
                  key={i}
                  x1={s}
                  x2={e}
                  fill="rgb(59 130 246)"
                  fillOpacity={0.2}
                  stroke="rgb(59 130 246)"
                  strokeOpacity={0.7}
                  strokeWidth={1}
                />
              ))
            : selectedBands.map(([s, e], i) => (
                <ReferenceArea
                  key={i}
                  x1={s}
                  x2={e}
                  fill="rgb(59 130 246)"
                  fillOpacity={0.15}
                  stroke="rgb(59 130 246)"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
              ))}
          {/* Draggable start-line handle. */}
          {dragEnabled && handleStartX !== null && (
            <ReferenceLine
              x={handleStartX}
              stroke="rgb(59 130 246)"
              strokeWidth={2}
              isFront
              label={{
                position: 'top',
                content: ({ viewBox }) =>
                  viewBox && viewBox.x !== undefined ? (
                    <circle
                      cx={viewBox.x}
                      cy={viewBox.y + 6}
                      r={4}
                      fill="rgb(59 130 246)"
                      stroke="white"
                      strokeWidth={1}
                    />
                  ) : null
              }}
            />
          )}
          {/* Draggable end-line handle. */}
          {dragEnabled && handleEndX !== null && handleEndX !== handleStartX && (
            <ReferenceLine
              x={handleEndX}
              stroke="rgb(59 130 246)"
              strokeWidth={2}
              isFront
              label={{
                position: 'top',
                content: ({ viewBox }) =>
                  viewBox && viewBox.x !== undefined ? (
                    <circle
                      cx={viewBox.x}
                      cy={viewBox.y + 6}
                      r={4}
                      fill="rgb(59 130 246)"
                      stroke="white"
                      strokeWidth={1}
                    />
                  ) : null
              }}
            />
          )}
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
  )
}

// Export all components
export { DailyActivityRadar, DailyActivityLine, CircularTimeFilter as default }
