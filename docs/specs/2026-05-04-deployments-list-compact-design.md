# Deployments list — compact rows, sections, popover lat/lon

**Date:** 2026-05-04
**Status:** Design — pending review
**Area:** renderer (`src/renderer/src/deployments.jsx`, `src/renderer/src/deployments/`)
**Builds on:** [2026-05-02 deployments-tab-revamp](2026-05-02-deployments-tab-revamp-design.md) (the bottom detail pane is already shipped)

## Summary

Refine the Deployments tab's list, grouping, and lat/lon editing without
touching the map, the detail pane structure, or the activity-bucketing
backend. Rows shrink from ~88px to ~40px. The activity timeline becomes
a small bar sparkline with a per-study toggle to switch between bars,
line, or heatmap. Co-located deployments live under always-expanded
section headers (no more collapse). Lat/lon editing leaves the row
entirely and becomes a popover triggered from a 📍 button in the detail
pane header, with a paste-friendly combined coordinate field.

## Motivation

The current list optimizes for "edit lat/lon and rename in place." That
workload is rare. The dominant workflow — confirmed in brainstorming —
is: scan to spot interesting deployments, then drill in via the detail
pane. The list rows are sized for the rare workload (88px to fit two
inputs and a place-on-map button), making the common workload
(scanning) cramped.

Three concrete frictions fall out of that mismatch:

1. **Rows feel large.** Two-line layout with always-visible lat/lon
   inputs takes ~88px per deployment.
2. **Grouped clusters feel strange.** Expand/collapse causes reflow;
   sort splits multi-deploy groups from singletons; visual distinction
   between a group header and a singleton row is subtle; clicking a map
   marker resolves to "select a deployment AND expand its group."
3. **Lat/lon inputs are fiddly.** Two `max-w-20` (~80px) number inputs
   side-by-side. Pasting `48.7384, -121.4521` requires manually
   splitting. The form takes prominent space on every row even when
   coords are correct and the user is just scanning.

## Goals

- Compact list rows (~40px) that prioritize scanning and selection.
- Preserve the per-row activity signal — the only cross-deployment
  scan aid the list provides — but in a smaller form.
- Eliminate the reflow caused by group expand/collapse.
- Make the map↔list selection contract unambiguous: marker = one
  deployment, row = one deployment, section header = the whole
  co-located group.
- Move lat/lon editing into the detail pane behind a button, freeing
  rows of editing chrome.
- Make pasting coordinates a one-step action.

## Non-goals

- Backend / query changes. The `deploymentsActivity` query in the
  sequences worker stays as-is; the bucketed count data drives all
  three sparkline renderers.
- Map changes. Markers, clustering, place mode, drag-to-edit, fly-to,
  layer persistence — all retained.
- Detail pane structure. Same header → media gallery layout;
  this design adds one icon button to the header and a popover.
- Section collapse / expand. Sections ship always-expanded. If real
  studies feel cluttered, collapsibility is a follow-up — see Future
  work.
- Multi-select, bulk lat/lon edit, CSV upload of coordinates.
  Out of scope.
- Keyboard shortcut to open the lat/lon popover. Out of scope —
  trivial follow-up if needed.
- Mini map preview inside the lat/lon popover. The big map next to the
  list is already showing the deployment; a second map duplicates work.

## Design

### List rows

40px rows, single line. Three regions:

```
┌─────────────────────────┬────────────────────────────┬──────┐
│ name (~200px, ellipsis) │ activity sparkline (flex)  │ N obs│
└─────────────────────────┴────────────────────────────┴──────┘
```

- **Name:** `EditableLocationName` (existing component, unchanged
  semantically). Click-to-rename behavior preserved.
- **Activity sparkline:** ~22px tall, full available width. Renders
  whichever variant is active for the study (see _Sparkline toggle_).
- **Total count:** right-aligned, tabular-numbers, secondary text
  color. Sourced from the existing per-deployment activity sum.
- **No lat/lon inputs in the row.**
- **No place-on-map button in the row.**
- **Selection state:** existing blue-50 background + left-border
  treatment, applied to the 40px box.

### Always-expanded section grouping

Co-located deployments (those sharing a `locationID`) live under a
section header. Singletons sit at the top level with no header.

```
┌─ East Meadow Cam 01      ▁▂▄▃▅▆▃▂▄▁     1,128 ─┐  ← singleton row
├─ North Ridge Cam 03  [3] ▂▃▅▇▆▄▅▆▄▃▂   5,837 ─┤  ← section header
│   ▸ 2023 deployment       ▂▃▅█▆▃▄▆▄▂▁    2,341 │  ← child row
│   ▸ 2024 deployment       ▂▃▄▆▄▃▄▅▃▂▂    1,892 │
│   ▸ 2025 deployment       ▂▃▄▅▃▂▃▄▃▂▁    1,604 │
└─ South Bluff Cam 07      ▁▁▁▁▁▁▁▁▁▁▁       62 ─┘
```

- **Header height:** ~36px. Background `bg-gray-100`, border-bottom,
  bold name + count badge, _aggregated_ sparkline (muted color, e.g.
  `bg-slate-300` instead of `#77b7ff`), total count.
- **Child rows:** 40px, indented ~30px from the left, lighter
  background tint to reinforce visual grouping.
- **No chevron, no toggle.** Sections are always expanded.
- **Sort:** alphabetical by location name across the whole list —
  sections are interleaved with singletons. This is a behavior change
  from today, where multi-deploy groups always sort first.

### Sparkline toggle

Three rendering variants for the per-row activity timeline. All consume
the same `periods[]` array currently produced by `getDeploymentsActivity`.

- **Bars (default):** column chart, ~24 buckets, `min-height: 1px` so
  empty buckets stay visible as a baseline. Color `#77b7ff` (current
  circles' color).
- **Line:** SVG path with a 15% opacity area fill underneath. Smooth.
- **Heatmap:** strip of equal-width cells, color intensity scales with
  count using a 5-step ramp from `#dbeafe` (zero) to `#1d4ed8` (peak).

Toggle UI: three icon buttons in the timeline header bar
(`<header>` at line 872 of `deployments.jsx`), right-aligned with a
small left-padding gap so the existing date markers stay distributed
across the remaining width. Selection persisted in `localStorage` under
`deploymentsSparkline:${studyId}`, mirroring the existing
`mapLayer:${studyId}` pattern.

### Map ↔ list selection contract

| User action                               | Result                                                                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Click deployment row (singleton or child) | Select that deployment. Detail pane mounts.                                                                                                                          |
| Click section header                      | Fly map to bounds of that location's deployments. **Does not change the current deployment selection** — if a deployment is open in the detail pane, the pane stays. |
| Click marker                              | Select that one deployment. Scroll list to its row. Detail pane mounts.                                                                                              |
| Click cluster icon                        | Existing Leaflet behavior (zoom in).                                                                                                                                 |
| Click already-selected row                | Deselect (existing toggle-off, closes pane).                                                                                                                         |

Section-header click producing a `flyTo(bounds)` is new. It uses
`L.latLngBounds(...)` over the children's coordinates and a small
padding. No URL state changes — the section header is purely a
"navigate the map to this location group" affordance.

### Lat/lon popover

A 📍 icon button is added to the detail pane header, between the
existing species filter and the close button. Default state: button
visible, no popover.

When clicked: a ~300px-wide popover anchors below the button. Contents
top-to-bottom:

1. **Combined coordinate field** (`type="text"`). Placeholder:
   `Paste lat, lon`. On change, attempts to parse `^\s*(-?\d+\.?\d*)
[,\s]+\s*(-?\d+\.?\d*)\s*$`. On match, writes both halves into the
   inputs below; on no match, leaves them alone but doesn't error.
2. **Two number inputs** — `Latitude` and `Longitude`, with proper
   labels above each input. `step="0.00001"`, `min/max` for the valid
   ranges. Editing either input updates the combined field.
3. **Place on map** primary button (top-right of the popover, next to
   the "Location" heading). On click: closes the popover and sets
   `isPlaceMode = true` for the existing place-mode flow.

A "Clear" button was scoped out — see _Future work_. The IPC's
`setDeploymentLatitude` / `setDeploymentLongitude` handlers
`parseFloat(null) → NaN` rather than persist `NULL`, so a clean clear
requires null-guard fixes that are out of scope here.

Closes on Esc, click-outside, or successful "Place on map" engagement.
Any input change auto-saves on blur (same debounce-style as today's
inline inputs).

The existing `MapPin` icon button on every row is removed.

## Components / file plan

New files:

- `src/renderer/src/deployments/SparklineToggle.jsx` — three icon
  buttons + localStorage persistence; emits a `'bars' | 'line' |
'heatmap'` value.
- `src/renderer/src/deployments/Sparkline.jsx` — single component that
  takes `periods[]`, `mode`, `percentile90Count` and renders any of the
  three variants. Memoized.
- `src/renderer/src/deployments/LocationPopover.jsx` — Radix Popover
  wrapping the lat/lon form. Owns the combined-field parsing.
- `src/renderer/src/deployments/SectionHeader.jsx` — gray section row
  with name + badge + aggregated sparkline + total. No collapse state.

Modified:

- `src/renderer/src/deployments.jsx` — `LocationsList` rebuilt around
  always-expanded sections; `DeploymentRow` shrinks to 40px and loses
  its lat/lon inputs and place button; `LocationGroupHeader` is
  replaced by `SectionHeader`; the virtualizer's `estimateSize` updates
  to 40 / 36; `groupDeploymentsByLocation` no longer pushes singletons
  to the bottom — it returns one alphabetical sequence interleaving
  group entries and singletons.
- `src/renderer/src/deployments/DeploymentDetailPane.jsx` — header
  gains a 📍 button (left of the filter icon) that opens
  `LocationPopover`.

Deleted:

- The inline lat/lon `<input>`s and `MapPin` button block in
  `DeploymentRow` (lines ~472–510 today).

## Data flow

No new IPC handlers, no new queries. The popover uses the existing
`window.api.setDeploymentLatitude` / `setDeploymentLongitude` handlers,
called from the detail pane via the existing `onNewLatitude` /
`onNewLongitude` callbacks already threaded through `Deployments`.

The aggregated sparkline on a section header sums per-bucket counts
across the section's child deployments. This is **distinct from** the
"never sum bbox counts across sequences" rule (which applies to
within-sequence per-frame counts where bursts repeat the same
animals). Different deployments at one location are different temporal
samples — summing observation counts across them is correct.

## Error handling

- Invalid coordinate paste: silently ignored (the combined field's
  parser leaves the inputs unchanged on no-match). No error toast,
  no red border — pasting "TBD" or "(no GPS)" is a common mistake
  and shouldn't yell at the user.
- Out-of-range numeric input: same as today (browser-level
  `min`/`max` on the number input plus the existing IPC validation).
- Network failure during save: same behavior as today (caught in the
  existing `try/catch` around `setDeploymentLatitude`/`setDeploymentLongitude`,
  logged via `logger.js`).

## Testing

- **Unit:** parser for the combined coordinate field — happy paths
  (`48.7, -121.4`, `48.7 -121.4`, `48.7, -121.4 `), edge cases
  (negative-only, decimals only, invalid strings).
- **Manual / dev server:**
  - List with 0, 1, 5, 50, 200 deployments — rows render at 40px,
    virtualizer scrolls smoothly.
  - Sparkline toggle — switch through bars/line/heatmap, refresh,
    confirm persisted choice.
  - Section grouping — singletons + multi-deploy locations,
    alphabetical interleaving, no reflow on any interaction.
  - Map↔list — click marker, click row, click section header (flies
    to bounds, no pane), click already-selected row (deselects).
  - Lat/lon popover — open via 📍, paste `48.7384, -121.4521`,
    confirm split, edit one input, confirm combined field updates,
    place on map, clear.
- **Existing tests:** `npm test` should pass — no backend changes, so
  the sequences-worker / queries tests are unaffected.

## Future work

- **Section collapse.** If real studies with many co-located groups
  feel too long, add a chevron + per-section collapse + persisted
  state, plus a global "Collapse all / Expand all" button. State key:
  `deploymentsCollapsedSections:${studyId}` → JSON array of locationIDs.
- **Hover crosshair on the timeline.** A thin vertical line + date
  label in the header that follows the cursor across the sparkline
  area, snapped to the bucket the cursor is in, with a dimmer
  highlight on every row's bar at that index. Lifts a `hoverPercent`
  (0..1) state to `LocationsList`; rows emit `onMouseMove` /
  `onMouseLeave` to update it; the header renders a positioned overlay.
- **Clear coordinates.** A "Clear" affordance in the lat/lon popover
  that nullifies the deployment's latitude/longitude. Requires null
  guards in `setDeploymentLatitude` / `setDeploymentLongitude` (both
  the IPC handlers and the renderer's `onNewLatitude` /
  `onNewLongitude` wrappers, which currently `parseFloat(null) → NaN`
  and would corrupt the SQLite row).
- **Keyboard shortcut.** `L` (or another) to open the lat/lon popover
  while a deployment is selected.
- **Bulk lat/lon edit.** Multi-select rows, paste a CSV or a list of
  pinned coords from a different study.

## Open questions

None remaining. Brainstorm log: `.superpowers/brainstorm/316757-1777897412/`.
