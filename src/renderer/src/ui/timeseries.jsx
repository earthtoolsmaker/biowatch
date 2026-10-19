import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { Maximize2, X } from 'lucide-react'

import { analysisMetricUnit } from '../utils/analysisMetric.js'
import { getMapDisplayName } from '../utils/commonNames.js'
import { formatScientificName } from '../utils/scientificName.js'
import {
  barSizePx,
  buildReadoutRows,
  formatWeekLabel,
  maxValueInRange,
  niceYTicks,
  yAxisUnitLabel
} from '../utils/timelineReadout.js'

import {
  clientXToDate,
  clampMinRange,
  clampPanToBounds,
  resolveAction,
  shouldClearToFullExtent,
  pickDayRange,
  pxToDateMs,
  zoomAroundAnchor,
  EDGE_PX_TOLERANCE,
  MIN_RANGE_MS
} from '../utils/timelineZoom.js'
import PillRangePicker from './PillRangePicker.jsx'

const MARGIN_X = 4 // matches the LineChart margin used below
const Y_AXIS_WIDTH = 64

// The plot area's box: the gesture layer minus the y-axis gutter (when shown),
// so cursor→date math stays aligned with the drawn x-axis.
const plotRect = (el, yAxisWidth) => {
  const r = el.getBoundingClientRect()
  return { left: r.left + yAxisWidth, width: r.width - yAxisWidth }
}

// Min horizontal space each x-axis date label needs so labels like
// "May 29, 18" don't crowd each other at small chart widths.
const TICK_MIN_SPACING_PX = 110
const TICK_MIN = 2
const TICK_MAX = 8

const axisFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

// Same naming as the Explore map legend: capitalized common name, else the
// italic scientific name.
export const SpeciesName = ({ scientificName, scientificToCommon, className = '' }) => {
  const common = getMapDisplayName(scientificName, scientificToCommon)
  return (
    <span className={`${className} ${common ? 'capitalize' : 'italic'}`}>
      {common || formatScientificName(scientificName)}
    </span>
  )
}

// Hover readout: the hovered week plus each species' real (unscaled) value,
// read from the row's `raw` copy so a peak-scaled chart still reports counts.
const ReadoutContent = ({
  active,
  payload,
  label,
  selectedSpecies,
  palette,
  metric,
  scientificToCommon
}) => {
  if (!active || !payload?.length || !metric) return null
  const rows = buildReadoutRows({
    row: payload[0].payload.raw,
    selectedSpecies,
    palette,
    metric
  })
  return (
    <div className="min-w-[10rem] max-w-[18rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="font-medium whitespace-nowrap">Week of {formatWeekLabel(label)}</span>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {analysisMetricUnit(metric)}
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.scientificName} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
          <SpeciesName
            scientificName={r.scientificName}
            scientificToCommon={scientificToCommon}
            className="flex-1 truncate"
          />
          <span className="font-medium tabular-nums">{r.formatted}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * TimelineChart — date-range brush over a per-day species time-series.
 *
 * The brush range, the chart's visible x-axis, and the parent's date
 * filter are the same state (`dateRange`). When dateRange is [null, null]
 * the chart shows the full data extent and no filter is applied.
 *
 * Gesture model — see docs/specs/2026-05-13-timeline-zoom-design.md.
 *
 * `interactive` (default true) gates all brush/pan/zoom gestures and the
 * range handles/pill. Pass false for a read-only sparkline (e.g. the
 * all-time over-time chart in the species hovercard), where only the line
 * and axis are drawn.
 *
 * Passing `metric` turns on a hover readout of each species' value for the
 * hovered week. Values come from `readoutData` (rows aligned 1:1 with
 * `timeseriesData`, e.g. the unscaled rows behind a peak-scaled series),
 * falling back to `timeseriesData` itself. `showYAxis` draws a numeric axis
 * titled with the metric's unit (only meaningful for unscaled data);
 * `onExpand` adds an expand button to the date pill that calls it;
 * `pillContainer` (a DOM node) renders the pill there instead of over the plot.
 * `rangeGestures={false}` turns off the plot's range gestures (drag to
 * create/pan/resize, scroll-zoom) and the edge handles, leaving the pill as
 * the only range control. `chartType` draws `'line'` (default) or grouped
 * weekly `'bar'`s.
 */
const TimelineChart = ({
  timeseriesData,
  selectedSpecies,
  dateRange,
  setDateRange,
  palette,
  interactive = true,
  readoutData,
  metric,
  scientificToCommon,
  showYAxis = false,
  onExpand,
  pillContainer,
  rangeGestures = true,
  chartType = 'line'
}) => {
  const containerRef = useRef(null)
  const yAxisWidth = showYAxis ? Y_AXIS_WIDTH : 0
  const [dragState, setDragState] = useState(null)
  const isDragging = dragState !== null
  const [hoverAction, setHoverAction] = useState(null)
  const wheelRafRef = useRef(null)
  const wheelPendingRef = useRef(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.getBoundingClientRect().width
      setContainerWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const data = useMemo(() => {
    if (!timeseriesData) return []
    return timeseriesData.map((day, i) => {
      const item = { date: new Date(day.date).getTime(), raw: readoutData?.[i] ?? day }
      selectedSpecies.forEach((species) => {
        item[species.scientificName] = day[species.scientificName] || 0
      })
      return item
    })
  }, [timeseriesData, readoutData, selectedSpecies])

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
      const rect = plotRect(containerRef.current, yAxisWidth)
      return clientXToDate({
        clientX: e.clientX,
        rect,
        marginX: MARGIN_X,
        domain,
        clamp
      })
    },
    [domain, yAxisWidth]
  )

  const edgeTolMs = useMemo(() => {
    if (!containerRef.current || !domain) return 0
    const rect = plotRect(containerRef.current, yAxisWidth)
    return pxToDateMs({ px: EDGE_PX_TOLERANCE, rect, marginX: MARGIN_X, domain })
  }, [domain, yAxisWidth])

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
          const rect = plotRect(containerRef.current, yAxisWidth)
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
          rect: plotRect(containerRef.current, yAxisWidth),
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

  const pickDay = useCallback(
    (side, day) => {
      if (!fullExtent) return
      setDateRange(pickDayRange({ side, day, range: dateRange, fullExtent }))
    },
    [dateRange, fullExtent, setDateRange]
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
  // Tick count scales with chart width so labels stay readable from
  // narrow side-panels up to full-screen layouts.
  const xAxisTicks = useMemo(() => {
    if (!displayedDomain) return undefined
    const startMs = displayedDomain[0].getTime()
    const endMs = displayedDomain[1].getTime()
    if (endMs <= startMs) return [startMs]
    const innerWidth = Math.max(0, containerWidth - yAxisWidth - MARGIN_X * 2)
    const tickCount = Math.max(
      TICK_MIN,
      Math.min(TICK_MAX, Math.floor(innerWidth / TICK_MIN_SPACING_PX))
    )
    const step = (endMs - startMs) / (tickCount - 1)
    return Array.from({ length: tickCount }, (_, i) => Math.round(startMs + i * step))
  }, [displayedDomain, containerWidth, yAxisWidth])

  // With a numeric axis, fit it to the weeks in view rather than the whole
  // study, so zooming into a quiet stretch doesn't leave flat lines. 5%
  // headroom before rounding up keeps a peak (and the smoothed curve's
  // overshoot) off the top edge.
  const yTicks = useMemo(() => {
    if (!showYAxis || !displayedDomain) return null
    const max = maxValueInRange(
      data,
      displayedDomain,
      selectedSpecies.map((s) => s.scientificName)
    )
    return niceYTicks(max * 1.05)
  }, [showYAxis, data, displayedDomain, selectedSpecies])

  // Bars on a time axis need an explicit width: one week's slot at the
  // current zoom, shared between the species.
  const barSize = useMemo(
    () =>
      barSizePx({
        plotWidth: containerWidth - yAxisWidth - MARGIN_X * 2,
        domainMs: displayedDomain ? displayedDomain[1] - displayedDomain[0] : 0,
        speciesCount: selectedSpecies.length
      }),
    [containerWidth, yAxisWidth, displayedDomain, selectedSpecies.length]
  )

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

  const pill = interactive && fullExtent && displayedDomain && (
    <div
      className={`${
        pillContainer ? '' : 'absolute top-1 left-1/2 -translate-x-1/2 z-10'
      } flex items-center gap-1.5 py-0.5 rounded-full text-[10px] font-medium border pointer-events-none ${
        cleared && !onExpand ? 'px-2' : 'pl-2 pr-1'
      } ${
        cleared
          ? 'text-slate-500 dark:text-slate-400 bg-slate-50/90 dark:bg-slate-500/10 border-slate-200/70 dark:border-slate-500/30'
          : 'text-blue-700 dark:text-blue-300 bg-blue-50/90 dark:bg-blue-500/15 border-blue-200/70 dark:border-blue-500/30'
      }`}
      aria-label="Date filter range"
    >
      <PillRangePicker
        range={displayedDomain}
        fullExtent={fullExtent}
        onPick={pickDay}
        muted={cleared}
      />
      {onExpand && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onExpand()
          }}
          className={`pointer-events-auto cursor-pointer inline-flex items-center justify-center w-3.5 h-3.5 rounded-full transition-colors ${
            cleared
              ? 'hover:bg-slate-200/70 dark:hover:bg-slate-500/30'
              : 'hover:bg-blue-200/70 dark:hover:bg-blue-500/30'
          }`}
          aria-label="Expand timeline"
          title="Expand timeline"
        >
          <Maximize2 size={9} strokeWidth={2.5} />
        </button>
      )}
      {!cleared && (
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
      )}
    </div>
  )

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="absolute inset-0 select-none [&_*]:!cursor-[inherit]"
        style={{ cursor: interactive && rangeGestures ? cursorStyle : 'default' }}
        onMouseDown={interactive && rangeGestures ? handleNativeDown : undefined}
        onMouseMove={interactive && rangeGestures ? handleNativeMove : undefined}
        onMouseLeave={interactive && rangeGestures ? handleNativeLeave : undefined}
        onWheel={interactive && rangeGestures ? handleWheel : undefined}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            // Top margin with an axis so the top tick label isn't cut in half.
            margin={{ top: showYAxis ? 8 : 0, right: MARGIN_X, bottom: 0, left: MARGIN_X }}
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
              interval={0}
              minTickGap={-1}
              height={25}
            />
            {/* 10% headroom so the peak isn't flush against the top edge
                (otherwise the line gets clipped into a flat "cap"). With a
                visible axis, the round ticks above provide the headroom. */}
            {showYAxis ? (
              <YAxis
                domain={[0, yTicks[yTicks.length - 1]]}
                ticks={yTicks}
                allowDataOverflow
                width={Y_AXIS_WIDTH}
                tickLine={false}
                axisLine={false}
                fontSize={10}
                tick={{ fill: 'var(--color-muted-foreground)' }}
                tickFormatter={(v) => axisFormatter.format(v)}
                label={{
                  value: yAxisUnitLabel(metric),
                  angle: -90,
                  position: 'insideLeft',
                  style: {
                    textAnchor: 'middle',
                    fontSize: 11,
                    fill: 'var(--color-muted-foreground)'
                  }
                }}
              />
            ) : (
              <YAxis hide domain={[0, (dataMax) => (dataMax > 0 ? dataMax * 1.1 : 1)]} />
            )}

            {metric && (
              <Tooltip
                active={isDragging ? false : undefined}
                isAnimationActive={false}
                cursor={{ stroke: 'var(--color-muted-foreground)', strokeWidth: 1 }}
                content={
                  <ReadoutContent
                    selectedSpecies={selectedSpecies}
                    palette={palette}
                    metric={metric}
                    scientificToCommon={scientificToCommon}
                  />
                }
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

            {interactive && rangeGestures && handleStart && (
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
            {interactive &&
              rangeGestures &&
              handleEnd &&
              handleEnd.getTime() !== handleStart?.getTime() && (
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

            {chartType === 'bar'
              ? selectedSpecies.map((species, index) => (
                  <Bar
                    key={species.scientificName}
                    dataKey={species.scientificName}
                    fill={palette[index % palette.length]}
                    barSize={barSize}
                    name={species.scientificName}
                    isAnimationActive={false}
                  />
                ))
              : selectedSpecies.map((species, index) => (
                  <Line
                    key={species.scientificName}
                    type="monotone"
                    dataKey={species.scientificName}
                    stroke={palette[index % palette.length]}
                    strokeWidth={1.5}
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
      {pill && (pillContainer ? createPortal(pill, pillContainer) : pill)}
    </div>
  )
}

export default TimelineChart
