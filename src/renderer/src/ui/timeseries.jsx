import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CartesianGrid,
  Customized,
  Line,
  LineChart,
  Rectangle,
  ResponsiveContainer,
  XAxis,
  YAxis
} from 'recharts'

// TimelineChart component using Recharts.
//
// dragDateRange is local state for the visual brush position during a drag;
// setDateRange (the parent prop) is only called on pointer release, so the
// downstream sequence-aware queries don't refetch once per mousemove.
const TimelineChart = ({ timeseriesData, selectedSpecies, dateRange, setDateRange, palette }) => {
  const draggingRef = useRef(false)
  const resizingRef = useRef(null) // null, 'left', or 'right'
  const dragStartXRef = useRef(null)
  const initialRangeRef = useRef(null)
  const chartRef = useRef(null)

  const [dragDateRange, setDragDateRange] = useState(dateRange)
  // Mirror dragDateRange into a ref so handleMouseUp (a long-lived
  // document event listener) can read the latest without the useCallback
  // being recreated mid-drag and leaking a stale listener reference.
  const dragDateRangeRef = useRef(dateRange)
  useEffect(() => {
    dragDateRangeRef.current = dragDateRange
  }, [dragDateRange])
  useEffect(() => {
    // Sync from prop only when not actively dragging, so external updates
    // don't clobber in-flight drag state.
    if (!draggingRef.current && resizingRef.current === null) {
      setDragDateRange(dateRange)
    }
  }, [dateRange])

  // Format data for Recharts
  const formatData = useCallback(() => {
    if (!timeseriesData) return []

    return timeseriesData.map((day) => {
      const item = {
        date: new Date(day.date),
        displayDate: new Date(day.date).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: '2-digit'
        })
      }

      // Add data for each selected species
      selectedSpecies.forEach((species) => {
        item[species.scientificName] = day[species.scientificName] || 0
      })

      return item
    })
  }, [timeseriesData, selectedSpecies])

  const data = formatData()

  // Custom component for the selection rectangle
  const SelectionRangeRectangle = (props) => {
    const { height, margin, xAxisMap } = props

    if (!dragDateRange[0] || !dragDateRange[1] || !data || data.length === 0 || !xAxisMap) {
      return null
    }

    // Use the xAxisMap scale function directly with actual Date objects
    const scale = xAxisMap ? xAxisMap[0].scale : null

    if (!scale) {
      return null
    }

    // Get the x positions using the scale function from xAxisMap with actual Date objects
    const x1 = scale(dragDateRange[0])
    const x2 = scale(dragDateRange[1])

    // Handle edge cases
    if (isNaN(x1) || isNaN(x2)) {
      console.log('Invalid x positions')
      return null
    }

    // Calculate width and get available height
    const rectWidth = Math.abs(x2 - x1)
    const rectHeight = height - margin.top - margin.bottom

    const handleMouseDown = (e, type) => {
      e.stopPropagation()
      e.preventDefault()

      if (type === 'move') {
        draggingRef.current = true
      } else {
        resizingRef.current = type
      }

      dragStartXRef.current = e.clientX
      initialRangeRef.current = [...dragDateRange]

      // Add global event listeners
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return (
      <g>
        {/* Main selection rectangle */}
        <Rectangle
          x={x1}
          y={margin.top}
          width={rectWidth}
          height={rectHeight}
          fill="rgba(0, 0, 255, 0.1)"
          stroke="rgba(0, 0, 255, 0.5)"
          onMouseDown={(e) => handleMouseDown(e, 'move')}
          style={{ cursor: 'move' }}
        />

        {/* Left resize handle */}
        <Rectangle
          x={x1}
          y={margin.top}
          width={5}
          height={rectHeight}
          fill="rgba(0, 0, 255, 0.2)"
          stroke="rgba(0, 0, 255, 0.7)"
          onMouseDown={(e) => handleMouseDown(e, 'left')}
          style={{ cursor: 'ew-resize' }}
        />

        {/* Right resize handle */}
        <Rectangle
          x={x1 + rectWidth - 5}
          y={margin.top}
          width={5}
          height={rectHeight}
          fill="rgba(0, 0, 255, 0.2)"
          stroke="rgba(0, 0, 255, 0.7)"
          onMouseDown={(e) => handleMouseDown(e, 'right')}
          style={{ cursor: 'ew-resize' }}
        />
      </g>
    )
  }

  const handleMouseMove = useCallback(
    (e) => {
      if (!draggingRef.current && !resizingRef.current) return
      if (!initialRangeRef.current || dragStartXRef.current === null || !chartRef.current) return

      const chartElement = chartRef.current
      if (!chartElement) return

      const chartRect = chartElement.getBoundingClientRect()
      const deltaX = e.clientX - dragStartXRef.current
      const percentDelta = deltaX / chartRect.width

      // Calculate how many days that represents
      const timeRange = data[data.length - 1].date.getTime() - data[0].date.getTime()
      const daysDelta = Math.round((percentDelta * timeRange) / (24 * 60 * 60 * 1000))

      let newStartDate, newEndDate

      if (draggingRef.current) {
        // Move the entire selection
        newStartDate = new Date(
          initialRangeRef.current[0].getTime() + daysDelta * 24 * 60 * 60 * 1000
        )
        newEndDate = new Date(
          initialRangeRef.current[1].getTime() + daysDelta * 24 * 60 * 60 * 1000
        )

        console.log('NEW START', newStartDate)
        console.log('NEW END', newEndDate)

        // Make sure we don't go out of bounds
        if (newStartDate < data[0].date) {
          const adjustment = data[0].date.getTime() - newStartDate.getTime()
          newStartDate = new Date(data[0].date)
          newEndDate = new Date(newEndDate.getTime() + adjustment)
        }

        if (newEndDate > data[data.length - 1].date) {
          const adjustment = newEndDate.getTime() - data[data.length - 1].date.getTime()
          newEndDate = new Date(data[data.length - 1].date)
          newStartDate = new Date(newStartDate.getTime() - adjustment)
        }
      } else if (resizingRef.current === 'left') {
        // Resize from the left side
        newStartDate = new Date(
          initialRangeRef.current[0].getTime() + daysDelta * 24 * 60 * 60 * 1000
        )
        newEndDate = initialRangeRef.current[1]

        // Make sure start doesn't go beyond end or start of data
        newStartDate = new Date(
          Math.max(
            data[0].date.getTime(),
            Math.min(
              newStartDate.getTime(),
              initialRangeRef.current[1].getTime() - 24 * 60 * 60 * 1000
            )
          )
        )
      } else if (resizingRef.current === 'right') {
        // Resize from the right side
        newStartDate = initialRangeRef.current[0]
        newEndDate = new Date(
          initialRangeRef.current[1].getTime() + daysDelta * 24 * 60 * 60 * 1000
        )

        // Make sure end doesn't go before start or beyond end of data
        newEndDate = new Date(
          Math.min(
            data[data.length - 1].date.getTime(),
            Math.max(
              newEndDate.getTime(),
              initialRangeRef.current[0].getTime() + 24 * 60 * 60 * 1000
            )
          )
        )
      }

      // Update only the local brush state during drag — parent's
      // setDateRange is deferred to mouseup so queries don't refetch
      // once per mousemove.
      setDragDateRange([newStartDate, newEndDate])
    },
    [data]
  )

  const handleMouseUp = useCallback(() => {
    const wasDragging = draggingRef.current || resizingRef.current !== null
    draggingRef.current = false
    resizingRef.current = null
    dragStartXRef.current = null
    initialRangeRef.current = null

    // Remove global event listeners
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)

    // Commit-on-release: fire setDateRange once with the final range,
    // unless the drag was effectively a no-op.
    if (wasDragging) {
      setDateRange(dragDateRangeRef.current)
    }
  }, [handleMouseMove, setDateRange])

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%" ref={chartRef}>
        <LineChart data={data} margin={{ top: 0, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            type="category"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 10 }}
            tickFormatter={(date) => {
              return date.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: '2-digit'
              })
            }}
            interval="preserveStartEnd"
            minTickGap={50}
            height={25}
          />
          <YAxis hide={true} />
          {/* <Tooltip content={<CustomTooltip />} /> */}

          {selectedSpecies.map((species, index) => (
            <Line
              key={species.scientificName}
              type="monotone"
              dataKey={species.scientificName}
              stroke={palette[index % palette.length]}
              dot={false}
              activeDot={{ r: 5 }}
              name={species.scientificName}
              fillOpacity={0.2}
              fill={palette[index % palette.length]}
            />
          ))}

          <Customized component={SelectionRangeRectangle} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default TimelineChart
