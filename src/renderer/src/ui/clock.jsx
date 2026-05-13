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
  const padding = 8 // Add padding to prevent elements from being cut off
  const svgSize = radius * 2 + padding * 2 // Increase SVG size to accommodate padding
  const center = { x: radius + padding, y: radius + padding } // Adjust center coordinates

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
    if (isFullDayRange()) {
      // For full day range, create a complete circle
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
            <path
              d={createArc(timeToAngle(start), timeToAngle(end))}
              fill="rgb(59 130 246 / 0.15)"
              stroke="rgb(59 130 246 / 0.8)"
              strokeWidth="2"
              cursor="pointer"
              onMouseDown={handleMouseDown('arc')}
            />

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
      {/* Inner square anchors the hour labels to the radar's actual edges,
          not the (potentially wider-than-tall) parent. */}
      <div className="relative h-full aspect-square">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0.5 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground">
            0h
          </div>
          <div className="absolute top-1/2 right-0.5 -translate-y-1/2 text-[10px] text-muted-foreground">
            6h
          </div>
          <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground">
            12h
          </div>
          <div className="absolute top-1/2 left-0.5 -translate-y-1/2 text-[10px] text-muted-foreground">
            18h
          </div>
        </div>

        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={formattedData} margin={{ top: 16, right: 16, bottom: 16, left: 16 }}>
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
 * line per species across a 24-hour x-axis. Off-period bands (the inverse
 * of `selectedRanges`) are shaded; with no selection, no shading.
 *
 * Props mirror DailyActivityRadar plus:
 *   selectedRanges: Array<{start, end}> — hour ranges currently in the
 *     filter. Used to shade the *complement* of these as off-period bands.
 */
const DailyActivityLine = ({ activityData, selectedSpecies, palette, selectedRanges = [] }) => {
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

  return (
    <div className="relative w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={formattedData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
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
          {selectedBands.map(([s, e], i) => (
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
