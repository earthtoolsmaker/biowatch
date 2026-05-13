# Day-period presets and chart-shape toggle

**Date:** 2026-05-13
**Status:** Design — approved
**Area:** renderer (`src/renderer/src/ui/clock.jsx`, `src/renderer/src/media.jsx`, `src/renderer/src/activity.jsx`); main (`src/main/database/queries/sequences.js`, `src/main/database/queries/species.js`)

## Summary

Add four preset day-period chips (Dawn, Day, Dusk, Night) next to the
existing polar clock in the Media and Activity tabs, and add a Polar / X–Y
toggle so the same hourly-bin data can be viewed as either the existing
radar or a line chart over a 24-hour x-axis. Chips are multi-select: the
filter is the union of their hour ranges, and combinations like Dawn + Dusk
yield crepuscular without a dedicated chip. The polar's freeform drag
handles are hidden while any chip is selected; deselecting all chips
restores the single-arc drag mode automatically.

## Motivation

Today the only way to scope a "time of day" in the Media or Activity tab
is to drag the blue arc on the polar clock — discoverable but slow, and
the result is always one continuous start→end window. Wildlife
researchers think in named periods (nocturnal, diurnal, crepuscular) far
more than in arbitrary hour ranges, so the dominant filtering operation
takes more interaction than it should.

A second gap: the polar radar is one of two conventional shapes for
camera-trap activity plots. The other is an x–y plot of activity against
hour-of-day, with shaded night bands — the standard output of the R
`activity` and `overlap` packages. The chart-shape choice is reader
preference, not data: both are renderings of the same hourly bins.

## Goals

- Four preset chips with lucide icons (Sunrise, Sun, Sunset, Moon) above
  the polar clock card. No labels, no static range text — tooltip on
  hover only.
- Multi-select: each chip toggles its sector independently. The active
  filter is the union of selected sectors.
- Selected sectors render as one or more highlighted arcs on the polar
  clock and as shaded bands on the x–y chart.
- Polar / X–Y chart-shape toggle in the top-right of the card. State is
  per-card, persisted in component state (resets on tab switch).
- The freeform drag handles on the polar clock keep working when no chip
  is selected. Grabbing a handle while chips are active clears all
  chips and reverts to a single drag-defined arc.
- Applies symmetrically to both Media (`media.jsx`) and Activity
  (`activity.jsx`) tabs — they already share the clock components.

## Non-goals

- No "All day" / reset chip. Clicking the active chip again deselects
  it; with no chips selected and the drag-arc at full range, the filter
  is off (current behavior).
- No solar-position computation. Preset hour windows are fixed
  (latitude-independent). Real sunrise/sunset times are out of scope.
- No Crepuscular chip. The combination Dawn + Dusk covers it.
- No Custom chip. Users who want a non-preset range can fall back to the
  drag-arc.
- No smoothed kernel-density curve for the x–y view. Plot the hourly
  bins directly as a line.
- No persistence of chip selection or chart-shape across study switches
  or app restarts.

## Preset definitions

Clean partition of 24 hours, no overlap. Hours are in local clock time,
matching the existing `strftime('%H', media.timestamp)` filter.

| Chip   | Icon (lucide) | Range            |
|--------|---------------|------------------|
| Dawn   | `Sunrise`     | 05:00 → 08:00    |
| Day    | `Sun`         | 08:00 → 18:00    |
| Dusk   | `Sunset`      | 18:00 → 21:00    |
| Night  | `Moon`        | 21:00 → 05:00    |

The four together exactly tile a day (selecting all four = no filter).

## Data model

Today the time-of-day filter is `{ start: number, end: number }` —
a single half-open `[start, end)` window in hours, with the wrap-around
case (`start > end`) handled by an OR'd SQL fragment in
`src/main/database/queries/sequences.js`.

The chip selection naturally produces *zero or more* hour ranges.
Generalize the model to:

```js
// shape passed from renderer to main:
timeRange: {
  ranges: [
    { start: 5, end: 8 },    // Dawn
    { start: 18, end: 21 },  // Dusk
  ]
}
```

- Empty `ranges` (or `ranges` absent) means "no filter" — equivalent to
  today's behavior when the drag-arc covers a full day.
- A single range with `start > end` means a midnight-wrapping window
  (the existing case for Night, or for a user-dragged arc that crosses
  midnight). The query layer expands it into an OR'd pair as it does
  today.
- Multiple ranges: build the per-range condition as today, then OR them
  all together.

The renderer keeps a `chipSelection` set (subset of `{dawn, day, dusk,
night}`) and a separate `arc` (the `{start, end}` shape from the drag
handles). Whichever is "active" supplies `ranges` to the IPC payload:

- chipSelection non-empty → `ranges = chipSelection.map(chip => PRESETS[chip])`
- otherwise → `ranges = isFullDay(arc) ? [] : [arc]`

This keeps the data model symmetric across both interaction modes and
avoids special-casing the chip path on the backend.

## Interaction rules

- **Click a chip with no chip currently selected**: that chip becomes
  active. The drag-arc state is preserved (not reset) but the arc and
  handles are no longer rendered while chips are active. Polar shows
  one highlighted arc for that chip.
- **Click another chip while one is selected**: toggles that chip on
  (additive). Polar shows two arcs.
- **Click an active chip**: deselects it. If that was the last selected
  chip, drag-arc mode returns automatically (handles re-appear at
  whatever the previous arc position was, default full-day if never
  set).
- **Drag-arc interactivity**: visible and interactive only when no chip
  is selected. While any chip is selected, the drag arc and handles are
  not rendered at all (so there's no ambiguity about where they sit
  relative to the chip-driven sectors).
- **Drag-arc behavior with no chips selected**: unchanged from today —
  start/end commit on pointer release.

The polar clock renders the chip-driven sectors as non-interactive
`<path>` elements when chips are active. When chips are inactive, the
existing drag arc and handles render as today.

## X–Y chart

A second component, `DailyActivityLine`, renders the same hourly-bin
data the radar consumes (`activityData`, an array of 24 hour buckets
with one numeric value per species). Implementation:

- Recharts `LineChart` with hour on the x-axis (0–23) and activity on
  the y-axis. One `<Line>` per selected species, color matching the
  radar palette, no dots.
- Shaded "off-period" bands behind the lines, derived from the inverse
  of the active `ranges` set. With no chips selected, no shading.
- X-axis labels at 0, 6, 12, 18, 24. Y-axis hidden (matches the radar's
  no-axis aesthetic).
- Same `margin` and `ResponsiveContainer` setup as the radar so the
  charts swap in place inside the existing 130px row.

Chart-shape toggle is a small two-button group in the top-right of the
clock card, lucide icons only (`PieChart` for polar, `LineChart` for
x–y). The active button uses the same `bg-foreground text-background`
pattern as elsewhere in the app.

## Components affected

- `src/renderer/src/ui/clock.jsx`
  - Add `DayPeriodChips` component: four `<Button>` toggles using
    lucide icons. Props: `selection: Set<string>`, `onChange`.
  - Add `DailyActivityLine` component: x–y twin of the existing
    `DailyActivityRadar`, same data shape and props.
  - Modify `CircularTimeFilter` to accept a `chipSectors` prop (array
    of `{start, end}` ranges to render as static highlighted arcs) and
    a `mode: 'drag' | 'chips'` prop. In `'chips'` mode, the drag arc
    and handles are not rendered.
  - Add a small `ChartShapeToggle` component (two icon buttons).
  - Export the new components.
- `src/renderer/src/media.jsx`, `src/renderer/src/activity.jsx`
  - Replace today's `timeRange: {start, end}` state with `chipSelection:
    Set<string>` and `arc: {start, end}`.
  - Compute `ranges` from those two pieces and pass to query hooks.
  - Add `chartShape: 'polar' | 'xy'` state per tab.
  - Render the chips above the existing clock card (same
    `w-[140px]` column), the `ChartShapeToggle` in the top-right of
    that column, and conditionally render either the radar or the line
    chart inside.
- `src/main/database/queries/sequences.js`,
  `src/main/database/queries/species.js`
  - Replace the `timeRange.start / timeRange.end` branches with a
    single loop over `timeRange.ranges`. Each range produces the same
    `>= start AND < end` (or wrap-around OR) fragment as today; the
    fragments are combined with OR. Empty `ranges` means no time
    filter.
  - Backwards compatibility: if a caller still passes `timeRange:
    {start, end}`, normalize to `ranges: [{start, end}]` at the top of
    the query function so the change is internal-only.
- `src/preload/index.js`
  - No signature change — `timeRange` is already an opaque object.

## Testing plan

- Unit tests for the renderer-side selection-to-`ranges` derivation:
  every subset of `{dawn, day, dusk, night}`, plus the four
  drag-arc-active states (full day, normal range, midnight-wrapping,
  zero-width).
- Query-layer tests for `getSequenceCounts` and equivalents in
  `species.js`: assert that single-range, multi-range, and wrap-around
  inputs produce the expected SQL. Use the existing in-memory SQLite
  fixture pattern.
- Manual verification in both Media and Activity tabs:
  - Toggle each chip individually, then in pairs (especially Dawn +
    Dusk for the crepuscular case), then all four (= no filter).
  - Deselect all chips and confirm the drag arc and handles return,
    in their previous position.
  - Switch chart-shape on each tab; confirm the data is identical and
    the shaded bands match the chip selection.
  - Confirm the existing filter-charts row toggle still collapses the
    full row (chips + clock + chart) cleanly.

## Open questions

- None blocking. (Latitude-aware sunrise/sunset, persistence, and a
  Crepuscular shortcut are explicitly deferred.)
