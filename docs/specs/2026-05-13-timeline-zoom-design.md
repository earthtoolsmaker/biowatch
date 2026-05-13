# Timeline brush — zoom-on-release + line+dot handles

Status: design
Author: brainstorm (2026-05-13)
Scope: `src/renderer/src/ui/timeseries.jsx` (the `TimelineChart` component shared by the media and activity tabs)

## Problem

The date-range brush on the media and activity tabs is a flat selector: dragging or resizing it only narrows the filter; the chart's x-axis always shows the full data extent. Users can't focus on the selected range, and the brush's handles use a different visual language (5px translucent rectangles) than the recently-redesigned day-activity chart edge handles (vertical line + circle dot).

## Goals

1. Resizing or selecting a range on the brush zooms the chart's x-axis to that range on release.
2. The scroll wheel zooms in or out around the cursor; scrolling all the way out clears the filter.
3. The brush's edge handles match the visual style of the day-activity chart's edge handles.

## Non-goals

- Sub-day (hour-level) filtering. The data is binned per-day; the minimum range is 1 day.
- Smooth interpolated zoom-on-release animation. The chart snaps to the new domain in v1; animation is v2 polish.
- A dedicated "reset zoom" button. Scrolling out to full extent clears the filter; the FilterChartsToggle indicator already shows when a filter is active.
- Modifier-key gestures (Shift-pan, Ctrl-zoom, etc.).
- Changes to the parent prop contract. `dateRange`, `setDateRange`, `timeseriesData`, `selectedSpecies`, `palette` stay identical.

## Model

**Unified viewport == filter.** A single piece of state — the parent's `dateRange = [Date|null, Date|null]` — represents both the date filter (what downstream sequence-aware queries return) and the chart's visible x-axis domain.

- `dateRange === [null, null]` is the cleared state. The chart's `XAxis domain = ['dataMin', 'dataMax']`. No filter is applied downstream.
- `dateRange === [start, end]` with values is the zoomed state. The chart's `XAxis domain = [start, end]`. Downstream queries receive the filter.
- A clearing rule keeps the model honest: if any commit would expand `dateRange` to `≥ [dataMin, dataMax]` within a 12h tolerance, set `[null, null]` instead. This keeps the active-filter indicator correct.

## Gestures

All four gestures map to the same `[start, end]` state. Local `dragState` follows the shape used by `DailyActivityLine`:

```
dragState = { mode: 'edge-start' | 'edge-end' | 'pan' | 'create',
              liveStart: Date, liveEnd: Date }
```

Handles are always present, always docked at the current viewport edges (`dateRange[0]` and `dateRange[1]`, or `dataMin` and `dataMax` when cleared). `dataMin` and `dataMax` mean the first and last entries of `timeseriesData` (the same convention the current `XAxis domain={['dataMin', 'dataMax']}` uses). The handle's *visual position* is always the chart's left or right edge; its *date value* is whichever endpoint of the current range it represents.

| Where you click | At full extent (cleared) | Zoomed in |
|---|---|---|
| Near an edge handle | Narrow from that side → zooms on release | Narrow further from that side |
| Body of chart | Drag-to-select a sub-range → zooms on release | Pan viewport+filter |
| Scroll wheel | Zoom in around cursor | Zoom in/out around cursor |

`actionAt(cursor)` resolves the gesture (and the cursor preview) the same way `DailyActivityLine` does, but with a pixel-based edge tolerance instead of a data-space one (because date ranges vary from days to years and a date-space tolerance is meaningless). Within ~10 screen pixels of an edge line → `edge-start` / `edge-end`; otherwise on body → `pan` (zoomed) or `create` (full extent). The 10px is converted to a date delta per-event via the current chart-rect width: `tolDate = 10 * (end - start) / innerWidth`.

### 1. Edge-handle drag

- Visible at all times. Vertical blue line + centered circle dot, docked at the current viewport edges.
- Mousedown captures the opposite endpoint as fixed.
- Mousemove updates `liveStart` or `liveEnd` from the cursor's x-position (converted to a date via the same chart-rect math as `DailyActivityLine.eventToHour`, adapted to dates).
- Clamps during drag: keep `liveStart < liveEnd` with a minimum gap of 1 day; both endpoints stay within `[dataMin, dataMax]`.
- On mouseup: `setDateRange([liveStart, liveEnd])`, or `[null, null]` if the clearing rule triggers.
- Hover thickens the line 2→3px and grows the dot radius 4→6.

### 2. Body pan (zoomed in only)

- Mousedown on chart body when zoomed in → pan mode.
- Mousemove shifts both `liveStart` and `liveEnd` by the cursor delta (in date space).
- Clamped to data bounds: the pan stops when either endpoint hits `dataMin` or `dataMax`. No wrapping.
- On mouseup: commit.

### 3. Drag-to-create (full extent only)

- Mousedown on chart body when cleared → create mode.
- Live preview rectangle (thin blue stroke + 0.2 fill opacity, matching `DailyActivityLine.liveSegments`) follows the cursor.
- On mouseup with `Math.abs(liveEnd - liveStart) ≥ 1 day`: `setDateRange([min, max])`. Chart zooms.
- On mouseup with effectively zero drag (a click): no-op.

### 4. Scroll-wheel zoom

- `wheel` listener on the chart wrapper with `e.preventDefault()` (only when the wheel falls inside the wrapper).
- Factor: `Math.exp(-e.deltaY * 0.0015)` — ~10% per mouse wheel tick, ~5% per touchpad pinch increment.
- Direction: `deltaY < 0` (scroll up / two-finger up on touchpad) = zoom in.
- Anchor: the date under the cursor stays put. New range:
  ```
  anchorDate = pixelToDate(cursorX)
  newStart = anchorDate - (anchorDate - start) * factor
  newEnd   = anchorDate + (end - anchorDate) * factor
  ```
  where `start` and `end` are the current viewport endpoints (`dataMin` / `dataMax` when cleared).
- Zoom-in clamp: minimum range 1 day. Further scroll-in is a no-op.
- Zoom-out clamp: if the resulting range ≥ full data extent (within 12h tolerance), commit `[null, null]`.
- Throttle: coalesce wheel commits with `requestAnimationFrame` (≤ ~60/sec). Local state updates per-event; the commit to the parent is rAF-throttled.
- At full extent (cleared): scroll-up zooms in (creates a filter), scroll-down is a no-op.

## Visual

**Handles.** Identical to `DailyActivityLine`:
- Vertical line, full chart-plot height, `stroke="rgb(59 130 246)"`, strokeWidth `2` idle / `3` hover.
- Centered circle dot: `r=4` idle / `r=6` hover, `fill="rgb(59 130 246)"`, `stroke="white"`, strokeWidth `1`.
- Implemented as Recharts `ReferenceLine` with a custom `label.content` returning a `<circle>` — same pattern as `clock.jsx` lines 696-744.

**Brush body fill.** None. The translucent blue rectangle is removed entirely. The visible x-axis range communicates the filter state.

**Live drag preview** (create + edge + pan during drag). Render exactly like `DailyActivityLine.liveSegments`:
- `fill="rgb(59 130 246)"`, `fillOpacity={0.2}`, `stroke="rgb(59 130 246)"`, `strokeOpacity={0.7}`, `strokeWidth={1}`.
- Appears only while `dragState !== null`; replaced by handles + zoomed chart on commit.

**Cursor.** Inline style on the wrapper with `[&_*]:!cursor-[inherit]` so Recharts' SVG defaults don't override:
- `crosshair` — full extent, hovering chart body
- `move` — zoomed, hovering chart body (or during pan drag)
- `ew-resize` — near an edge handle (or during edge drag)
- `default` otherwise

## Implementation outline

Port `TimelineChart` from the current Recharts `Customized` + `Rectangle` approach to the native-mousedown + container-ref pattern used by `DailyActivityLine`. Concretely:

1. Wrap the chart in a `containerRef` div with `onMouseDown`, `onMouseMove`, `onMouseLeave`, `onWheel`. Document-level `mousemove` and `mouseup` listeners during active drag (matching `clock.jsx` lines 581-605).
2. Helper `eventToDate(e, { clamp = true })` mirroring `eventToHour` — converts a pointer event to a `Date` accounting for the chart's left/right margin.
3. `actionAt(cursor)` resolves the gesture (and cursor) based on the current `dateRange` and cursor position.
4. The chart's `XAxis domain` is derived: `dateRange[0] != null && dateRange[1] != null ? [dateRange[0], dateRange[1]] : ['dataMin', 'dataMax']`.
5. Two `ReferenceLine` handles render whenever the chart has data, at the current viewport edges. Their `label.content` renders the circle dot.
6. Live drag preview renders a `ReferenceArea` while `dragState !== null`.
7. Wheel handler uses rAF coalescing to call `setDateRange` at most once per frame.
8. Preserve the existing `dragging` ref guard in `timeseries.jsx:36-39` so external `dateRange` prop changes during a drag don't clobber in-flight state.

## Edge cases

- **Empty data** (`timeseriesData.length === 0`): no handles, no listeners attached, chart renders empty (current behavior preserved).
- **Single day of data** (`dataMin === dataMax`): handles render but every drag is a no-op due to the 1-day min-range clamp. Acceptable degenerate state.
- **External `dateRange` change mid-drag**: ignored (existing `dragging`/`resizing` ref guard preserved).
- **Two charts on screen** (media tab has the timeline + day-activity polar/x-y): each chart's wrapper handles its own wheel; no cross-talk.
- **Drag continues outside the chart**: handled by document-level mousemove/mouseup, same as `DailyActivityLine`.
- **Text selection during drag**: prevented by `select-none` on the wrapper and `e.preventDefault()` on mousedown.

## Test plan

- Manual: with a multi-month dataset on the media tab —
  - Drag an edge handle inward → chart zooms to the new range on release; filter chip shows active state.
  - Scroll up over the chart → zooms in around cursor; date under cursor stays put.
  - Scroll all the way out → filter clears; `dateRange === [null, null]`; FilterChartsToggle dot disappears.
  - Drag chart body while zoomed → viewport+filter pans; stops at data edges.
  - Drag chart body at full extent → live preview rectangle; release commits.
  - Switch to the activity tab → same gestures work; map markers update with the filter.
- Edge: single-day dataset, empty dataset, very large dataset (~1 year of daily bins) — chart remains responsive during scroll-wheel zoom.

## Out of scope (v2 candidates)

- Smooth interpolated zoom-on-release (rAF lerp over ~200ms).
- Hour-level / sub-day filtering.
- Modifier-key gestures.
- Visible "Reset zoom" button.
