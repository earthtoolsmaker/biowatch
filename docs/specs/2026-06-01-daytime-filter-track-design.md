# Daytime filter: move selection into a dedicated track

**Date:** 2026-06-01
**Status:** Design — pending review
**Branch:** `worktree-arthur+feat-daytime-filter-track`

## Problem

The daytime filter widget paints the *selected* time range as a blue fill **inside** the plot. Because the default state is "everything selected," the whole chart starts fully blue:

- **Polar mode:** `CircularTimeFilter` overlays a blue pie-sector/disk on top of the activity radar. All chips selected → full blue circle covering the radar.
- **Line mode:** `DailyActivityLine` draws full-height blue `ReferenceArea` bands across the plot.

The blue wash competes with the per-species activity curves — the actual data the user is there to read.

## Goal

Make the activity curves the visual priority. Move the time-window selection indicator **out of the plot area** into a dedicated **track**, and keep that treatment consistent across both chart modes.

## Decisions (settled during brainstorming)

1. **Indicator leaves the plot.** Selection renders in a thin track *outside* the data area:
   - Line mode: a horizontal strip beneath the x-axis.
   - Polar mode: a ring just outside the radar circle.
2. **Selection semantics, not deselection.** Blue marks the **kept** hours. Default (all 24h) = a full blue track. Because the track is outside the plot, a full blue track no longer obscures anything.
3. **The track is the drag surface.** Resize handles and drag-to-move live on the track itself. The plot/circle interior is no longer an interaction target.
4. **Everything else is unchanged.** State model, chips behaviour, commit-on-release, and wrap-around handling all stay. When chips drive the selection the track is a read-only blue readout (drag disabled), exactly as today.

## Current architecture (for reference)

All three components live in `src/renderer/src/ui/clock.jsx`, composed in `src/renderer/src/activity.jsx` (~lines 970–1013):

- `DailyActivityRadar` — polar data viz; `outerRadius = CLOCK_OUTER_RADIUS_PX = 47`.
- `CircularTimeFilter` (default export) — the interactive clock overlaid centered on the radar. Draws the blue arc/sector (`rgb(59 130 246 / 0.15)` fill, `/0.8` stroke) over the selected range, plus start/end handle dots. Suppresses the arc when `isFullDayRange()` so "no filter" ≠ "all selected".
- `DailyActivityLine` — line-mode data viz **and** selection UI in one `ComposedChart`: `ReferenceArea` bands for the selected ranges + draggable `ReferenceLine` handles, with hover-preview cursors and `create`/`pan`/`edge` drag modes.

State in `activity.jsx`:

- `arc: {start, end}` — freeform drag range (default `{0, 24}`).
- `chipSelection: Set` — selected day-period chips (default all).
- `chartShape: 'polar' | 'xy'`.
- `visualRanges` — ranges to display (chip union when chips active, else `arc`).
- `timeRange.ranges` — the actual query filter (empty when all chips selected = no filter).

Drag is disabled when chips drive selection: `onArcChange` is `undefined` and polar `mode='chips'`.

## Proposed changes

### Polar mode — `CircularTimeFilter`

- **Remove** the blue pie-sector and the full-circle fill that overlay the radar (both the `drag` arc and the `chips` sectors).
- **Add a selection ring** as a concentric band *outside* the radar circle. The radar's outer edge stays at radius 47; the ring occupies roughly radius 50–57.
  - Render selected hour ranges as blue arc segments on the ring (light track-gray background ring underneath).
  - Full-day selection → a complete blue ring. No arc-suppression hack — the full ring is the correct, readable "all selected" state, so `isFullDayRange()` suppression is dropped.
  - Multiple disjoint ranges (from chips) → multiple blue arc segments.
- **Grow the SVG** padding/size so the ring and hour labels fit outside the radar without clipping.
- **Move handles and drag onto the ring.** Start/end handle dots sit on the ring; resize/pan/wrap behaviour carries over from the existing angle math (`angleToTime`, the arc-drag delta logic). Commit-on-release unchanged.
- Hour labels (0/6/12/18) and tick marks remain.

### Line mode — `DailyActivityLine`

- **Remove** the full-height `ReferenceArea` selection bands (live and committed) from the plot. The plot keeps only the data `Line`s, grid, and x-axis.
- **Add a track strip** below the x-axis: a light-gray rounded background spanning 0–24, with blue rectangles over the selected ranges. Wrap-around ranges split into two segments (existing `bandToSegments` logic).
- **Move handles and drag onto the strip.** Handle dots sit on the strip; `create` / `pan` / `edge-start` / `edge-end` modes and hover-preview cursors carry over, but hit-testing maps to the strip's geometry instead of the full plot width.
- The `ReferenceLine` handles inside the chart are replaced by handles drawn on the strip.

### Shared / extraction

To keep rendering thin and make the logic testable, extract the pure helpers into a small module (e.g. `src/renderer/src/ui/clockGeometry.js`):

- hour ↔ angle (`angleToTime`, `timeToAngle`) and hour ↔ x-ratio conversions,
- range → renderable segments (wrap-around split),
- drag-action resolution (`actionAt`, `edgeTolFor`, `isInsideBand`).

Rendering components consume these helpers. This is the only structural refactor; no unrelated cleanup.

## Data flow / state

Unchanged. `activity.jsx` still owns `arc`, `chipSelection`, `chartShape`, `visualRanges`, `timeRange`. The components receive the same props (`onChange`/`onArcChange`, `startTime`/`endTime`/`selectedRanges`, `mode`/`chipSectors`) and emit the same commit-on-release `{start, end}`. Downstream queries are untouched.

## Out of scope

- Changing what the filter computes or how queries consume `timeRange.ranges`.
- Restyling the day-period chips, the chart-shape toggle, or the timeline chart.
- Touching `dayPeriods.js` preset ranges.

## Testing & verification

- **Unit:** test the extracted pure helpers in `clockGeometry.js` (angle/x conversions, wrap-around segment splitting, drag-action resolution at boundaries) via `node --test`.
- **Manual:** run the app and verify in both modes:
  - default (all selected) → full blue track, plot/radar fully readable (no blue wash);
  - drag on the track to resize and to pan across midnight;
  - selecting chips paints the correct blue segments and disables track dragging;
  - committing a selection updates the downstream filter exactly as before.
- **Regression:** `npm test` stays green (baseline: 1400 pass, 0 fail).

## Docs to update (per CLAUDE.md)

No IPC/schema/format changes, so the backend docs are unaffected. This is a renderer-only UI change; no `docs/*.md` updates are required beyond this spec.
