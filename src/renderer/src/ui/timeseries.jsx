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
import { X } from 'lucide-react'

import {
  clientXToDate,
  clampMinRange,
  clampPanToBounds,
  resolveAction,
  shouldClearToFullExtent,
  pxToDateMs,
  zoomAroundAnchor,
  EDGE_PX_TOLERANCE,
  MIN_RANGE_MS
} from '../utils/timelineZoom.js'

const MARGIN_X = 4 // matches the LineChart margin used below

const formatPillDate = (d) =>
  d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''

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
  const wheelRafRef = useRef(null)
  const wheelPendingRef = useRef(null)

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
        if (!prev || !fullExtent) return prev
        if (prev.mode === 'pan') {
          const rect = containerRef.current.getBoundingClientRect()
          const innerWidth = rect.width - MARGIN_X * 2
          if (innerWidth <= 0) return prev
          const initialDomainMs = prev.panInitialEnd.getTime() - prev.panInitialStart.getTime()
          const deltaPx = e.clientX - prev.panStartClientX
          const deltaMs = deltaPx * (initialDomainMs / innerWidth)
          const newStartMs = prev.panInitialStart.getTime() + deltaMs
          const [panStart, panEnd] = clampPanToBounds({
            start: new Date(newStartMs),
            end: new Date(newStartMs + initialDomainMs),
            fullExtent
          })
          return { ...prev, liveStart: panStart, liveEnd: panEnd }
        }
        const cursor = clientXToDate({
          clientX: e.clientX,
          rect: containerRef.current.getBoundingClientRect(),
          marginX: MARGIN_X,
          domain,
          clamp: true
        })
        if (!cursor) return prev
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
      // Pan uses pixel-delta math against a frozen domain so the chart
      // can live-update its XAxis to liveStart/liveEnd without creating a
      // feedback loop (cursor→date based on a moving domain would zero
      // out the delta).
      setDragState({
        mode: 'pan',
        liveStart: start,
        liveEnd: end,
        panStartClientX: e.clientX,
        panInitialStart: start,
        panInitialEnd: end
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

  const handleWheel = (e) => {
    if (!fullExtent || !domain) return
    e.preventDefault()
    const cursor = eventToDate(e)
    if (!cursor) return
    // deltaY<0 (scroll up / two-finger up) → factor<1 → zoom in
    const factor = Math.exp(e.deltaY * 0.0015)
    const [zoomed0, zoomed1] = zoomAroundAnchor({
      start: domain[0],
      end: domain[1],
      anchor: cursor,
      factor
    })
    let nextStartMs = zoomed0.getTime()
    let nextEndMs = zoomed1.getTime()
    // Clamp to full extent on zoom-out.
    if (nextStartMs < fullExtent[0].getTime()) nextStartMs = fullExtent[0].getTime()
    if (nextEndMs > fullExtent[1].getTime()) nextEndMs = fullExtent[1].getTime()
    // Clamp to min range on zoom-in.
    if (nextEndMs - nextStartMs < MIN_RANGE_MS) {
      const anchorMs = cursor.getTime()
      nextStartMs = anchorMs - MIN_RANGE_MS / 2
      nextEndMs = anchorMs + MIN_RANGE_MS / 2
      if (nextStartMs < fullExtent[0].getTime()) {
        nextStartMs = fullExtent[0].getTime()
        nextEndMs = nextStartMs + MIN_RANGE_MS
      }
      if (nextEndMs > fullExtent[1].getTime()) {
        nextEndMs = fullExtent[1].getTime()
        nextStartMs = nextEndMs - MIN_RANGE_MS
      }
    }
    const candidate = [new Date(nextStartMs), new Date(nextEndMs)]
    wheelPendingRef.current = shouldClearToFullExtent({ range: candidate, fullExtent })
      ? [null, null]
      : candidate
    if (wheelRafRef.current !== null) return
    wheelRafRef.current = requestAnimationFrame(() => {
      wheelRafRef.current = null
      if (wheelPendingRef.current) {
        setDateRange(wheelPendingRef.current)
        wheelPendingRef.current = null
      }
    })
  }

  useEffect(
    () => () => {
      if (wheelRafRef.current !== null) cancelAnimationFrame(wheelRafRef.current)
    },
    []
  )

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

  // During pan we override the chart's visible domain so the line data
  // pans live under the cursor. Other modes keep the committed domain
  // (chart stays still; only handles slide).
  const displayedDomain = useMemo(
    () =>
      isDragging && dragState?.mode === 'pan' ? [dragState.liveStart, dragState.liveEnd] : domain,
    [isDragging, dragState?.mode, dragState?.liveStart, dragState?.liveEnd, domain]
  )

  // Handle color reflects the zoom/filter state: muted slate when the
  // chart is at full extent (no filter), saturated blue when zoomed in.
  // During a drag (edge/create) we use the saturated blue regardless,
  // since the user is actively narrowing.
  const handleColor = cleared && !isDragging ? 'rgb(148 163 184)' : 'rgb(59 130 246)'

  // Explicit ticks across the visible domain. Recharts' default tick
  // generation (with `interval="preserveStartEnd"` and a numeric XAxis)
  // pins the first and last ticks to the underlying data array's
  // extremes, which ignores our zoom domain. Generating ticks ourselves
  // guarantees the labels reflect what the user actually sees.
  const xAxisTicks = useMemo(() => {
    if (!displayedDomain) return undefined
    const startMs = displayedDomain[0].getTime()
    const endMs = displayedDomain[1].getTime()
    if (endMs <= startMs) return [startMs]
    const tickCount = 5
    const step = (endMs - startMs) / (tickCount - 1)
    return Array.from({ length: tickCount }, (_, i) => Math.round(startMs + i * step))
  }, [displayedDomain])

  // Custom tick renderer: anchors the leftmost label at start, rightmost
  // at end, so the dates of the zoom (first and last) stay visible at
  // the chart edges instead of being culled by Recharts' default
  // middle-anchored layout.
  const renderTick = ({ x, y, payload, index }) => {
    let textAnchor = 'middle'
    if (index === 0) textAnchor = 'start'
    else if (xAxisTicks && index === xAxisTicks.length - 1) textAnchor = 'end'
    return (
      <text
        x={x}
        y={y + 10}
        textAnchor={textAnchor}
        fontSize={10}
        fill="var(--color-muted-foreground)"
      >
        {new Date(payload.value).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: '2-digit'
        })}
      </text>
    )
  }

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="absolute inset-0 select-none [&_*]:!cursor-[inherit]"
        style={{ cursor: cursorStyle }}
        onMouseDown={handleNativeDown}
        onMouseMove={handleNativeMove}
        onMouseLeave={handleNativeLeave}
        onWheel={handleWheel}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 0, right: MARGIN_X, bottom: 0, left: MARGIN_X }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              type="number"
              scale="time"
              domain={
                displayedDomain
                  ? [displayedDomain[0].getTime(), displayedDomain[1].getTime()]
                  : ['dataMin', 'dataMax']
              }
              allowDataOverflow
              ticks={xAxisTicks}
              tick={renderTick}
              minTickGap={10}
              height={25}
            />
            <YAxis hide domain={[0, 'auto']} />

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
                stroke={handleColor}
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
                        fill={handleColor}
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
                stroke={handleColor}
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
                        fill={handleColor}
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
      {!cleared && (
        <div
          className="absolute top-1 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full text-[10px] font-medium text-blue-700 dark:text-blue-300 bg-blue-50/90 dark:bg-blue-500/15 border border-blue-200/70 dark:border-blue-500/30 pointer-events-none"
          aria-label="Date filter range"
        >
          <span>
            {formatPillDate(displayedDomain?.[0])}
            {' → '}
            {formatPillDate(displayedDomain?.[1])}
          </span>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              setDateRange([null, null])
            }}
            className="pointer-events-auto cursor-pointer inline-flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-blue-200/70 dark:hover:bg-blue-500/30 transition-colors"
            aria-label="Clear date filter"
            title="Clear date filter"
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        </div>
      )}
    </div>
  )
}

export default TimelineChart
