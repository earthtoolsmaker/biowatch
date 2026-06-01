# Daytime Filter Selection Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the daytime-filter selection indicator out of the plot into a dedicated track (a ring outside the polar radar, a strip below the line chart) so the activity curves are the visual priority.

**Architecture:** Extract the pure geometry/range helpers from `clock.jsx` into a testable `clockGeometry.js` module, then rewrite the selection rendering in `CircularTimeFilter` (polar ring) and `DailyActivityLine` (under-axis strip) to consume them. Selection semantics stay "blue = kept"; default all-selected = a full blue track. State in `activity.jsx` is unchanged.

**Tech Stack:** React, Recharts (`RadarChart`/`ComposedChart`), inline SVG, Tailwind. Tests via `node:test`.

**Spec:** `docs/specs/2026-06-01-daytime-filter-track-design.md`

---

## File Structure

- **Create** `src/renderer/src/ui/clockGeometry.js` — pure helpers: `timeToAngle`, `angleToTime`, `isInsideBand`, `edgeTolFor`, `bandToSegments`, `rangesToSegments`, `resolveAction`. No React, no DOM.
- **Create** `test/renderer/ui/clockGeometry.test.js` — unit tests for the helpers.
- **Modify** `src/renderer/src/ui/clock.jsx` — `CircularTimeFilter` (polar ring) and `DailyActivityLine` (under-axis strip) consume the helpers; remove the in-plot blue fills.
- **Untouched** `src/renderer/src/activity.jsx` — same props/state; verified by manual run.

Note: `dayPeriods.js` already owns the chip/arc → ranges helpers (`chipsToRanges`, `arcToRanges`, `mergeChipRanges`). `clockGeometry.js` is strictly the rendering/interaction geometry, kept separate.

---

## Task 1: Extract pure geometry/interaction helpers (TDD)

**Files:**
- Create: `src/renderer/src/ui/clockGeometry.js`
- Test: `test/renderer/ui/clockGeometry.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/renderer/ui/clockGeometry.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  timeToAngle,
  angleToTime,
  isInsideBand,
  edgeTolFor,
  bandToSegments,
  rangesToSegments,
  resolveAction
} from '../../../src/renderer/src/ui/clockGeometry.js'

describe('timeToAngle / angleToTime', () => {
  test('0h is 0deg, 6h is 90deg, 18h is 270deg', () => {
    assert.equal(timeToAngle(0), 0)
    assert.equal(timeToAngle(6), 90)
    assert.equal(timeToAngle(18), 270)
  })
  test('24h wraps to 0deg', () => {
    assert.equal(timeToAngle(24), 0)
  })
  test('angleToTime inverts within [0,360)', () => {
    assert.equal(angleToTime(0), 0)
    assert.equal(angleToTime(90), 6)
    assert.equal(angleToTime(270), 18)
  })
})

describe('isInsideBand', () => {
  test('non-wrap band: strictly between start and end', () => {
    assert.equal(isInsideBand(10, { start: 8, end: 18 }), true)
    assert.equal(isInsideBand(8, { start: 8, end: 18 }), false)
    assert.equal(isInsideBand(20, { start: 8, end: 18 }), false)
  })
  test('wrap band (start > end): outside the gap', () => {
    assert.equal(isInsideBand(23, { start: 21, end: 5 }), true)
    assert.equal(isInsideBand(3, { start: 21, end: 5 }), true)
    assert.equal(isInsideBand(12, { start: 21, end: 5 }), false)
  })
})

describe('edgeTolFor', () => {
  test('clamps to [1, 2]', () => {
    assert.equal(edgeTolFor(1.5), 1) // 0.5 -> floored at 1
    assert.equal(edgeTolFor(6), 2) // 2 -> capped at 2
    assert.equal(edgeTolFor(4.5), 1.5) // 1.5 in range
  })
})

describe('bandToSegments', () => {
  test('empty band (start === end) yields nothing', () => {
    assert.deepEqual(bandToSegments({ start: 7, end: 7 }), [])
  })
  test('non-wrap band yields one segment', () => {
    assert.deepEqual(bandToSegments({ start: 7, end: 18 }), [[7, 18]])
  })
  test('wrap band splits at midnight', () => {
    assert.deepEqual(bandToSegments({ start: 21, end: 5 }), [
      [21, 24],
      [0, 5]
    ])
  })
})

describe('rangesToSegments', () => {
  test('flattens multiple ranges, splitting wrap-arounds', () => {
    assert.deepEqual(
      rangesToSegments([
        { start: 5, end: 8 },
        { start: 21, end: 5 }
      ]),
      [
        [5, 8],
        [21, 24],
        [0, 5]
      ]
    )
  })
  test('full-day range yields a single full segment', () => {
    assert.deepEqual(rangesToSegments([{ start: 0, end: 24 }]), [[0, 24]])
  })
})

describe('resolveAction', () => {
  test('no single band -> create', () => {
    assert.equal(resolveAction(10, []), 'create')
    assert.equal(resolveAction(10, [{ start: 5, end: 8 }, { start: 18, end: 21 }]), 'create')
  })
  test('near end edge -> edge-end', () => {
    assert.equal(resolveAction(17.5, [{ start: 8, end: 18 }]), 'edge-end')
  })
  test('near start edge -> edge-start', () => {
    assert.equal(resolveAction(8.5, [{ start: 8, end: 18 }]), 'edge-start')
  })
  test('inside band, away from edges -> pan', () => {
    assert.equal(resolveAction(13, [{ start: 8, end: 18 }]), 'pan')
  })
  test('outside band -> create', () => {
    assert.equal(resolveAction(2, [{ start: 8, end: 18 }]), 'create')
  })
  test('wrap band is panned, not edge-slid', () => {
    assert.equal(resolveAction(23, [{ start: 21, end: 5 }]), 'pan')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/renderer/ui/clockGeometry.test.js`
Expected: FAIL — `Cannot find module .../clockGeometry.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/ui/clockGeometry.js`:

```js
/**
 * Pure geometry + interaction helpers for the daytime-filter charts.
 * No React, no DOM — unit-tested in test/renderer/ui/clockGeometry.test.js.
 *
 * Hours are 24h clock values; bands are {start, end} half-open ranges where
 * start > end means the band wraps midnight (e.g. night 21 -> 5).
 */

// Clock angle in degrees, measured clockwise from 0h at the top.
export const timeToAngle = (time) => (time * 15) % 360

// Inverse of timeToAngle for an angle already normalized to [0, 360).
export const angleToTime = (angle) => (angle / 15) % 24

// Whether `cursor` (hours) falls strictly inside a possibly-wrapping band.
export const isInsideBand = (cursor, band) => {
  if (band.start < band.end) return cursor > band.start && cursor < band.end
  return cursor > band.start || cursor < band.end
}

// Edge grab-zone half-width (hours): at least 1h so short bands are
// targetable, capped at 2h so it never takes over a wide band.
export const edgeTolFor = (width) => Math.max(1, Math.min(2, width / 3))

// Split one band into renderable [start, end] segments, breaking a
// wrap-around band into two pieces at midnight.
export const bandToSegments = (band) => {
  if (band.start === band.end) return []
  if (band.start < band.end) return [[band.start, band.end]]
  return [
    [band.start, 24],
    [0, band.end]
  ]
}

// Flatten an array of bands into renderable segments.
export const rangesToSegments = (ranges) => ranges.flatMap(bandToSegments)

// Decide what a click/drag at `cursor` (hours) should do, given the current
// selection. Only a single non-wrap band supports edge-resize; everything
// else is pan (inside) or create (outside / multi-band / empty).
export const resolveAction = (cursor, ranges) => {
  if (ranges.length !== 1) return 'create'
  const { start, end } = ranges[0]
  const isWrap = start >= end
  const width = isWrap ? 24 - start + end : end - start
  const tol = edgeTolFor(width)
  if (!isWrap && cursor >= end - tol && cursor <= end + tol) return 'edge-end'
  if (!isWrap && cursor >= start - tol && cursor <= start + tol) return 'edge-start'
  if (isInsideBand(cursor, { start, end })) return 'pan'
  return 'create'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/renderer/ui/clockGeometry.test.js`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/ui/clockGeometry.js test/renderer/ui/clockGeometry.test.js
git commit -m "feat(activity): extract pure clock geometry/interaction helpers"
```

---

## Task 2: Polar mode — selection ring outside the radar

**Files:**
- Modify: `src/renderer/src/ui/clock.jsx` (the `CircularTimeFilter` component, lines ~22–337)

Replace the in-radar blue pie/disk fill with a ring rendered *outside* the radar circle. Selected ranges are blue stroked arcs on the ring; handles and drag move to the ring; the `isFullDayRange` arc-suppression is removed (a full blue ring is the correct "all selected" state).

- [ ] **Step 1: Add ring constants and an arc-path helper**

At the top of `clock.jsx`, just below the existing `CLOCK_OUTER_RADIUS_PX` constant, add:

```js
// Selection ring sits just OUTSIDE the radar circle so it never covers the
// activity blob. Radii are in the same px space as CLOCK_OUTER_RADIUS_PX.
const RING_GAP = 4 // gap between radar edge and ring
const RING_WIDTH = 7 // stroke thickness of the ring
const RING_MID = CLOCK_OUTER_RADIUS_PX + RING_GAP + RING_WIDTH / 2
const RING_OUTER = CLOCK_OUTER_RADIUS_PX + RING_GAP + RING_WIDTH
```

Update the import at the top of the file to pull in the helpers:

```js
import { timeToAngle, angleToTime, rangesToSegments } from './clockGeometry.js'
```

- [ ] **Step 2: Rewrite `CircularTimeFilter` to draw the ring**

Replace the whole `CircularTimeFilter` component (from `const CircularTimeFilter = ({` through its closing `}` before `// New component for species daily activity visualization`) with:

```jsx
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

  const padding = 16 // room for hour labels outside the ring
  const svgSize = RING_OUTER * 2 + padding * 2
  const center = { x: RING_OUTER + padding, y: RING_OUTER + padding }
  const labelOffset = RING_OUTER + 9

  // Sync local state when parent updates bounds externally. Does NOT fire
  // onChange continuously — that happens only on pointer release.
  useEffect(() => {
    setStart(startTime)
    setEnd(endTime)
  }, [startTime, endTime])

  const interactive = mode !== 'chips'
  // Ranges to paint as blue arcs: the live drag band, or the chip sectors.
  const ranges = interactive ? [{ start, end }] : chipSectors
  const segments = rangesToSegments(ranges)
  const isFullRing = segments.length === 1 && segments[0][0] === 0 && segments[0][1] === 24

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
    let sweep = (((endHour - startHour) % 24) + 24) % 24
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingStart, isDraggingEnd, isDraggingArc, lastDragPosition])

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
        <text x={center.x} y={center.y - labelOffset} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="var(--color-muted-foreground)">0h</text>
        <text x={center.x + labelOffset} y={center.y} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="var(--color-muted-foreground)">6h</text>
        <text x={center.x} y={center.y + labelOffset} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="var(--color-muted-foreground)">12h</text>
        <text x={center.x - labelOffset} y={center.y} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="var(--color-muted-foreground)">18h</text>

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
            <circle cx={startCoord.x} cy={startCoord.y} r="5" fill="rgb(59 130 246)" stroke="white" strokeWidth="1.5" cursor="pointer" onMouseDown={handleMouseDown('start')} />
            <circle cx={endCoord.x} cy={endCoord.y} r="5" fill="rgb(59 130 246)" stroke="white" strokeWidth="1.5" cursor="pointer" onMouseDown={handleMouseDown('end')} />
          </>
        )}
      </svg>
    </div>
  )
}
```

- [ ] **Step 2b: Remove now-dead code**

The old component used `radius`, `angleToCoordinates`, `timeToAngle`/`angleToTime` (local), `isFullDayRange`, `createArc`, and the 24 tick-mark `<line>`s. These are all gone in the rewrite above (the local `timeToAngle`/`angleToTime` are replaced by the imported ones, ticks are dropped in favour of the ring). Confirm none of these identifiers remain in `CircularTimeFilter` after the replace.

- [ ] **Step 3: Lint and build**

Run: `npm run lint`
Expected: no errors in `clock.jsx`.

Run: `npx electron-vite build` (or `npm run build` if defined)
Expected: build succeeds.

- [ ] **Step 4: Manual verification**

Run the app (`npm run dev`), open a study with temporal data, show the activity filter charts in **polar** mode:
- Default (all chips selected): radar blob is fully visible; a **full blue ring** sits outside it; no blue wash over the data.
- Deselect chips so the mode becomes interactive; a blue **arc** marks the selected window, with two draggable handles on the ring.
- Drag a handle → the arc resizes; drag the arc → the window pans (including across 0h); release → downstream species/timeline data updates.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/ui/clock.jsx
git commit -m "feat(activity): polar selection ring outside the activity radar"
```

---

## Task 3: Line mode — selection track strip below the x-axis

**Files:**
- Modify: `src/renderer/src/ui/clock.jsx` (the `DailyActivityLine` component, lines ~406–763)

Remove the full-height `ReferenceArea` bands and in-chart `ReferenceLine` handles. Add a track strip beneath the axis that shows blue selected segments and hosts the handles + drag.

- [ ] **Step 1: Import helpers and drop the inline duplicates**

Ensure the top-of-file import (added in Task 2) also covers the line helpers:

```js
import {
  timeToAngle,
  angleToTime,
  rangesToSegments,
  bandToSegments,
  isInsideBand,
  edgeTolFor,
  resolveAction
} from './clockGeometry.js'
```

Inside `DailyActivityLine`, delete the inline `isInsideBand`, `edgeTolFor`, `actionAt`, `bandToSegments`, and the `selectedBands` builder loop — they are replaced by the imported helpers (`resolveAction` subsumes `actionAt`; `rangesToSegments` subsumes the `selectedBands` loop).

- [ ] **Step 2: Rewrite `DailyActivityLine`**

Replace the whole `DailyActivityLine` component (from `const DailyActivityLine = ({` through its closing `}` before `// Export all components`) with:

```jsx
const DailyActivityLine = ({
  activityData,
  selectedSpecies,
  palette,
  selectedRanges = [],
  onArcChange
}) => {
  const hasSingleBand = selectedRanges.length === 1
  const isWrapBand = hasSingleBand && selectedRanges[0].start >= selectedRanges[0].end
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
      const width = isWrapBand ? 24 - start + end : end - start
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
          className="relative h-2.5 rounded-full bg-muted"
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
          {dragEnabled && handleStartX !== null && (
            <div
              className="absolute top-1/2 rounded-full bg-blue-500 border border-white"
              style={{
                left: pct(handleStartX),
                width: hoveredEdge === 'start' ? 12 : 9,
                height: hoveredEdge === 'start' ? 12 : 9,
                transform: 'translate(-50%, -50%)'
              }}
            />
          )}
          {dragEnabled && handleEndX !== null && handleEndX !== handleStartX && (
            <div
              className="absolute top-1/2 rounded-full bg-blue-500 border border-white"
              style={{
                left: pct(handleEndX),
                width: hoveredEdge === 'end' ? 12 : 9,
                height: hoveredEdge === 'end' ? 12 : 9,
                transform: 'translate(-50%, -50%)'
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Remove now-unused imports**

`ReferenceArea` and `ReferenceLine` are no longer used. Remove them from the `recharts` import at the top of `clock.jsx`. Run `npm run lint` to confirm no unused-import warnings remain.

- [ ] **Step 4: Lint and build**

Run: `npm run lint`
Expected: no errors/unused warnings in `clock.jsx`.

Run: `npx electron-vite build`
Expected: build succeeds.

- [ ] **Step 5: Manual verification**

Run the app, switch the activity filter to **line** mode:
- Default (all selected): only the species lines + axis in the plot — no blue wash; the strip below is a **full blue bar**.
- Deselect chips → interactive: drag on the strip to create a window; drag a handle to resize; drag the middle to pan (wraps past midnight); cursor changes (crosshair/ew-resize/move); release commits and updates downstream data.
- Selecting chips again paints the correct blue segment(s) on the strip and disables strip dragging.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/ui/clock.jsx
git commit -m "feat(activity): line-mode selection track strip below the axis"
```

---

## Task 4: Full regression + cross-mode verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — baseline 1400 + the new `clockGeometry` tests, 0 failures.

- [ ] **Step 2: Cross-mode manual check**

Run the app and confirm parity between modes:
- Toggle polar ↔ line with a partial selection active → the same window is shown as a ring arc and as a strip segment.
- A wrap-around night selection (e.g. 21→5) renders correctly in both (ring arc crossing 0h; two strip segments).
- Switching studies / tabs resets to all-selected (full blue track) in both modes.

- [ ] **Step 3: Final lint/format**

Run: `npm run lint && npm run format:check`
Expected: clean. If `format:check` flags `clock.jsx`/`clockGeometry.js`, run `npm run format` and amend the relevant commit.

---

## Self-Review Notes

- **Spec coverage:** ring outside radar (Task 2), strip below axis (Task 3), selection semantics / full blue track (Tasks 2–3 default state), track-as-drag-surface (Tasks 2–3 handlers on ring/strip), helper extraction + unit tests (Task 1), regression (Task 4). All spec sections map to a task.
- **No activity.jsx change:** props/state contract is unchanged; the rewritten components keep the same prop names (`onChange`/`onArcChange`, `startTime`/`endTime`, `selectedRanges`, `mode`, `chipSectors`) and the same commit-on-release `{start, end}` shape. Verified by manual run in Task 4.
- **Type/name consistency:** helper names (`timeToAngle`, `angleToTime`, `isInsideBand`, `edgeTolFor`, `bandToSegments`, `rangesToSegments`, `resolveAction`) are identical across the test, the module, and both component rewrites.
