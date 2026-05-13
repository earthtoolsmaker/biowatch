import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis
} from 'recharts'

import {
  clientXToDate,
  clampMinRange,
  clampPanToBounds,
  resolveAction,
  shouldClearToFullExtent,
  pxToDateMs,
  EDGE_PX_TOLERANCE,
  MIN_RANGE_MS
} from '../utils/timelineZoom.js'

const MARGIN_X = 4 // matches the LineChart margin used below

/**
 * TimelineChart — date-range brush over a per-day species time-series.
 *
 * The brush range, the chart's visible x-axis, and the parent's date
 * filter are the same state (`dateRange`). When dateRange is [null, null]
 * the chart shows the full data extent and no filter is applied.
 *
 * Gesture model — see docs/specs/2026-05-13-timeline-zoom-design.md.
 */
const TimelineChart = ({ timeseriesData, selectedSpecies, dateRange, setDateRange, palette }) => {
  const containerRef = useRef(null)
  const [dragState, setDragState] = useState(null)
  const isDragging = dragState !== null
  const [hoverAction, setHoverAction] = useState(null)

  const data = useMemo(() => {
    if (!timeseriesData) return []
    return timeseriesData.map((day) => {
      const item = { date: new Date(day.date).getTime() }
      selectedSpecies.forEach((species) => {
        item[species.scientificName] = day[species.scientificName] || 0
      })
      return item
    })
  }, [timeseriesData, selectedSpecies])

  const fullExtent = useMemo(() => {
    if (!data.length) return null
    return [new Date(data[0].date), new Date(data[data.length - 1].date)]
  }, [data])

  // `domain` is the date space the chart's XAxis is showing. Must always
  // match what XAxis renders so cursor-x → date conversions stay correct.
  // Unified viewport == filter: when dateRange is set, the chart zooms to
  // it; when cleared, the chart shows the full data extent. Widening past
  // the current viewport is via scroll wheel (see Task 4), not via
  // dragging a handle past the chart edge.
  const domain = useMemo(() => {
    if (!fullExtent) return null
    if (dateRange[0] && dateRange[1]) return [dateRange[0], dateRange[1]]
    return fullExtent
  }, [dateRange, fullExtent])

  const cleared = !dateRange[0] || !dateRange[1]

  const eventToDate = useCallback(
    (e, { clamp = true } = {}) => {
      if (!containerRef.current || !domain) return null
      const rect = containerRef.current.getBoundingClientRect()
      return clientXToDate({
        clientX: e.clientX,
        rect,
        marginX: MARGIN_X,
        domain,
        clamp
      })
    },
    [domain]
  )

  const edgeTolMs = useMemo(() => {
    if (!containerRef.current || !domain) return 0
    const rect = containerRef.current.getBoundingClientRect()
    return pxToDateMs({ px: EDGE_PX_TOLERANCE, rect, marginX: MARGIN_X, domain })
  }, [domain])

  const actionAt = useCallback(
    (cursorDate) => {
      if (!fullExtent) return null
      return resolveAction({
        cursorDate,
        range: dateRange,
        fullExtent,
        edgeTolMs
      })
    },
    [dateRange, fullExtent, edgeTolMs]
  )

  const commitDragOnRelease = useCallback(() => {
    setDragState((prev) => {
      if (!prev || !fullExtent) return null
      const { mode, liveStart, liveEnd } = prev
      let candidate
      if (mode === 'pan') {
        candidate = clampPanToBounds({
          start: liveStart,
          end: liveEnd,
          fullExtent
        })
      } else if (mode === 'create') {
        if (Math.abs(liveEnd.getTime() - liveStart.getTime()) < MIN_RANGE_MS) {
          return null
        }
        const s = liveStart < liveEnd ? liveStart : liveEnd
        const e = liveStart < liveEnd ? liveEnd : liveStart
        candidate = [s, e]
      } else {
        candidate = [liveStart, liveEnd]
      }
      if (shouldClearToFullExtent({ range: candidate, fullExtent })) {
        setDateRange([null, null])
      } else {
        setDateRange(candidate)
      }
      return null
    })
  }, [fullExtent, setDateRange])

  useEffect(() => {
    if (!isDragging) return
    const onDocMove = (e) => {
      setDragState((prev) => {
        if (!prev) return prev
        const cursor = clientXToDate({
          clientX: e.clientX,
          rect: containerRef.current.getBoundingClientRect(),
          marginX: MARGIN_X,
          domain,
          clamp: prev.mode !== 'pan'
        })
        if (!cursor || !fullExtent) return prev
        if (prev.mode === 'pan') {
          const newStartMs = cursor.getTime() - prev.panOffsetMs
          const [s, e] = clampPanToBounds({
            start: new Date(newStartMs),
            end: new Date(newStartMs + prev.panWidthMs),
            fullExtent
          })
          return { ...prev, liveStart: s, liveEnd: e }
        }
        if (prev.mode === 'edge-start') {
          const [s, e] = clampMinRange({
            start: cursor,
            end: prev.liveEnd,
            anchorSide: 'end'
          })
          return { ...prev, liveStart: s, liveEnd: e }
        }
        if (prev.mode === 'edge-end') {
          const [s, e] = clampMinRange({
            start: prev.liveStart,
            end: cursor,
            anchorSide: 'start'
          })
          return { ...prev, liveStart: s, liveEnd: e }
        }
        return { ...prev, liveEnd: cursor }
      })
    }
    const onDocUp = () => commitDragOnRelease()
    document.addEventListener('mousemove', onDocMove)
    document.addEventListener('mouseup', onDocUp)
    return () => {
      document.removeEventListener('mousemove', onDocMove)
      document.removeEventListener('mouseup', onDocUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, domain, fullExtent])

  const handleNativeDown = (e) => {
    if (!fullExtent) return
    e.preventDefault()
    const cursor = eventToDate(e)
    if (!cursor) return
    const action = actionAt(cursor)
    if (action === 'pan') {
      const start = dateRange[0]
      const end = dateRange[1]
      setDragState({
        mode: 'pan',
        liveStart: start,
        liveEnd: end,
        panOffsetMs: cursor.getTime() - start.getTime(),
        panWidthMs: end.getTime() - start.getTime()
      })
      return
    }
    if (action === 'edge-start') {
      const end = cleared ? fullExtent[1] : dateRange[1]
      setDragState({ mode: 'edge-start', liveStart: cursor, liveEnd: end })
      return
    }
    if (action === 'edge-end') {
      const start = cleared ? fullExtent[0] : dateRange[0]
      setDragState({ mode: 'edge-end', liveStart: start, liveEnd: cursor })
      return
    }
    setDragState({ mode: 'create', liveStart: cursor, liveEnd: cursor })
  }

  const handleNativeMove = (e) => {
    if (isDragging) return
    const cursor = eventToDate(e)
    if (!cursor) return
    setHoverAction(actionAt(cursor))
  }

  const handleNativeLeave = () => {
    if (!isDragging) setHoverAction(null)
  }

  const handleStart = (() => {
    if (isDragging) return dragState.liveStart
    if (!cleared) return dateRange[0]
    return fullExtent ? fullExtent[0] : null
  })()
  const handleEnd = (() => {
    if (isDragging) return dragState.liveEnd
    if (!cleared) return dateRange[1]
    return fullExtent ? fullExtent[1] : null
  })()

  const livePreview = (() => {
    if (!isDragging || dragState.mode !== 'create') return null
    const s = dragState.liveStart < dragState.liveEnd ? dragState.liveStart : dragState.liveEnd
    const e = dragState.liveStart < dragState.liveEnd ? dragState.liveEnd : dragState.liveStart
    return { x1: s.getTime(), x2: e.getTime() }
  })()

  // Filled band between the two handles, communicating "this is the
  // active filter." Shown when dateRange is set (handles narrowed) or
  // during an edge/pan drag. Suppressed during create (live preview
  // takes over) and when cleared (no filter to highlight).
  const selectedBand = (() => {
    if (livePreview) return null
    if (
      isDragging &&
      dragState.mode !== 'pan' &&
      dragState.mode !== 'edge-start' &&
      dragState.mode !== 'edge-end'
    )
      return null
    if (!handleStart || !handleEnd) return null
    const s = handleStart < handleEnd ? handleStart : handleEnd
    const e = handleStart < handleEnd ? handleEnd : handleStart
    if (s.getTime() === e.getTime()) return null
    if (cleared && !isDragging) return null
    return { x1: s.getTime(), x2: e.getTime() }
  })()

  const hoveredEdge = (() => {
    if (isDragging) {
      if (dragState.mode === 'edge-start') return 'start'
      if (dragState.mode === 'edge-end') return 'end'
      return null
    }
    if (hoverAction === 'edge-start') return 'start'
    if (hoverAction === 'edge-end') return 'end'
    return null
  })()

  const cursorStyle = (() => {
    const action = isDragging ? dragState.mode : hoverAction
    if (action === 'pan') return 'move'
    if (action === 'edge-start' || action === 'edge-end') return 'ew-resize'
    if (action === 'create') return 'crosshair'
    return 'default'
  })()

  return (
    <div
      ref={containerRef}
      className="w-full h-full select-none [&_*]:!cursor-[inherit]"
      style={{ cursor: cursorStyle }}
      onMouseDown={handleNativeDown}
      onMouseMove={handleNativeMove}
      onMouseLeave={handleNativeLeave}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 0, right: MARGIN_X, bottom: 0, left: MARGIN_X }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            type="number"
            scale="time"
            domain={domain ? [domain[0].getTime(), domain[1].getTime()] : ['dataMin', 'dataMax']}
            allowDataOverflow
            tick={{ fontSize: 10 }}
            tickFormatter={(ms) =>
              new Date(ms).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: '2-digit'
              })
            }
            interval="preserveStartEnd"
            minTickGap={50}
            height={25}
          />
          <YAxis hide domain={[0, 'auto']} />

          {selectedBand && (
            <ReferenceArea
              x1={selectedBand.x1}
              x2={selectedBand.x2}
              fill="rgb(59 130 246)"
              fillOpacity={0.15}
              stroke="rgb(59 130 246)"
              strokeOpacity={0.5}
              strokeWidth={1}
            />
          )}
          {livePreview && (
            <ReferenceArea
              x1={livePreview.x1}
              x2={livePreview.x2}
              fill="rgb(59 130 246)"
              fillOpacity={0.2}
              stroke="rgb(59 130 246)"
              strokeOpacity={0.7}
              strokeWidth={1}
            />
          )}

          {handleStart && (
            <ReferenceLine
              x={handleStart.getTime()}
              stroke="rgb(59 130 246)"
              strokeWidth={hoveredEdge === 'start' ? 3 : 2}
              isFront
              label={{
                position: 'center',
                content: ({ viewBox }) => {
                  if (!viewBox || viewBox.x === undefined) return null
                  const cy = viewBox.y + (viewBox.height ?? 0) / 2
                  return (
                    <circle
                      cx={viewBox.x}
                      cy={cy}
                      r={hoveredEdge === 'start' ? 6 : 4}
                      fill="rgb(59 130 246)"
                      stroke="white"
                      strokeWidth={1}
                    />
                  )
                }
              }}
            />
          )}
          {handleEnd && handleEnd.getTime() !== handleStart?.getTime() && (
            <ReferenceLine
              x={handleEnd.getTime()}
              stroke="rgb(59 130 246)"
              strokeWidth={hoveredEdge === 'end' ? 3 : 2}
              isFront
              label={{
                position: 'center',
                content: ({ viewBox }) => {
                  if (!viewBox || viewBox.x === undefined) return null
                  const cy = viewBox.y + (viewBox.height ?? 0) / 2
                  return (
                    <circle
                      cx={viewBox.x}
                      cy={cy}
                      r={hoveredEdge === 'end' ? 6 : 4}
                      fill="rgb(59 130 246)"
                      stroke="white"
                      strokeWidth={1}
                    />
                  )
                }
              }}
            />
          )}

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
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default TimelineChart
