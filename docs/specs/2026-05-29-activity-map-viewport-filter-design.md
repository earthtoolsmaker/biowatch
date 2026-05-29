# Activity tab: map viewport as a spatial filter

**Date:** 2026-05-29
**Status:** Approved design, ready for implementation plan
**Area:** Renderer (`src/renderer/src/activity.jsx`) + Main (`src/main/ipc/`, `src/main/database/queries/`)

## Summary

Add an on-demand geographic (bounding-box) filter to the Activity tab, driven by the
map viewport. The user pans/zooms the Leaflet map, clicks a floating **"Filter to this
area"** button, and the current viewport bounds are snapshotted as a filter. That
bounding box is applied to the **species distribution list**, the **day activity chart**,
and the **time activity chart**.

The map itself keeps showing all markers (it remains a full overview / navigation
surface) with a rectangle overlay marking the snapshotted area. An active-filter chip —
mirroring the existing date-range chip — shows the filter is on and lets the user clear
it.

## Goals

- Let users restrict the three side widgets to a chosen geographic region of the study.
- Keep the interaction cheap: heavy sequence-aware queries (seconds on large studies)
  recompute only when the user explicitly applies/clears the filter — never on every
  pan/zoom frame.
- Reuse existing filter conventions (the `null` sentinel, per-study persistence, the
  active-filter chip, the Reset filters button) so the feature feels native.

## Non-goals

- No polygon / freehand region selection — bounding box only.
- No GIS / R-tree / SpatiaLite extension.
- No new database index (see Performance).
- No filtering of the map's own pie-chart markers — the map stays a full overview.
- Antimeridian-crossing viewports (west > east) are out of scope for v1.

## Behaviour decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| When does the filter apply? | **On demand** — only when the user clicks the button. |
| Filter model | **Snapshot** — bounds frozen on apply; user can pan elsewhere while widgets stay filtered. |
| Trigger UX | **Floating map button + active chip** (consistent with the date-range filter). |
| Map markers under an active filter | **Always show all markers**; draw a rectangle overlay for the snapshotted area. |
| Species distribution list | **Filtered too** (not just the activity charts). |
| Geometry | **Bounding box** (NE/SW corners). |
| Window/map resize | **Filter stays pinned** (snapshot); widgets do not recompute on resize. |

## Architecture

### State & data flow (`activity.jsx`)

A new filter state lives alongside the existing `dateRange`, `chipSelection`/`arc`, and
`selectedSpecies`:

- `areaFilter: { north, south, east, west } | null`
  - `null` is the "no filter" sentinel, matching the `[null, null]` convention used by
    `dateRange`. When `null`, all queries behave exactly as today (zero regression).
- Set by reading Leaflet's `map.getBounds()` when the floating button is clicked.
- Cleared by the chip's ✕ or by the existing **Reset filters** button
  (`handleResetFilters` is extended to also clear `areaFilter`).
- Persisted per-study via a small `useAreaFilter(studyId)` hook (localStorage key
  `areaFilter:${studyId}`), consistent with `useDateRange` / `useSequenceGap`.

`areaFilter` becomes a new input to the relevant query keys and is passed to the queries
below. Because `null` = "include everything", no new `enabled` gating is required — the
queries gate the same way they do today.

### Backend — optional bounding box on the sequence-aware queries

All affected queries gain an **optional trailing `bbox` param** (`{ north, south, east,
west }` or `null`). When `null`, behaviour is identical to today.

| Query | Change |
| --- | --- |
| `getSequenceAwareSpeciesDistribution` | add `bbox` (needed for "filter species list too") |
| `getSequenceAwareTimeseries` | add `bbox` |
| `getSequenceAwareDailyActivity` | add `bbox` |
| `getSequenceAwareHeatmap` | **unchanged** — map shows all markers |

The SQL change is uniform. These queries already `INNER JOIN deployments d`, so the
filter is a conditional clause appended only when `bbox` is provided:

```sql
AND d.latitude  BETWEEN :south AND :north
AND d.longitude BETWEEN :west  AND :east
```

Threading follows the project's IPC pattern: query function → IPC handler
(`src/main/ipc/...`) → preload (`window.api.*`) → React `useQuery`. `getSequenceAware*`
distribution/timeseries/daily-activity handlers and their preload signatures each gain
the optional `bbox` argument.

> Note: `getSequenceAwareSpeciesDistribution` currently takes no spatial filter. The
> species distribution **list** the widget renders is driven by this query (via
> `speciesDistributionData` in `activity.jsx`), so the `bbox` must be threaded here for
> the species list to reflect the filtered area. `getBestImagePerSpecies` (hover
> thumbnails only) is **not** changed.

### Frontend — map control, overlay, chip

- **Floating button** overlaid on the map corner (Leaflet control or absolutely
  positioned div over `MapContainer`), styled like the existing layer toggle. Label:
  "Filter to this area." Enabled only when the current viewport differs from the applied
  `areaFilter` by more than a tolerance (see Resize).
- **Rectangle overlay**: when `areaFilter` is set, draw a Leaflet `Rectangle` at those
  bounds so the snapshotted area is visible even after panning away. Drawn in geographic
  coordinates, so Leaflet re-projects it automatically on pan/zoom/resize.
- **Active chip**: reuse the date-filter chip pattern (`areaFilterLabel` like the
  existing `dateFilterLabel`), e.g. "Area filter" with a ✕, wired into the same
  filter-summary row.
- **Reset filters**: `handleResetFilters` extended to clear `areaFilter`.

### Resize behaviour

`areaFilter` is stored as **geographic bounds**, frozen on apply. The visible geographic
extent of the map depends on the container's pixel size at a given zoom, so resizing the
window/map changes what's on screen but must **not** change the filter:

- Widgets do **not** recompute on resize (avoids triggering multi-second heavy queries).
- The rectangle overlay stays glued to the same lat/lng (Leaflet re-projects it),
  rendered larger/smaller as appropriate.
- The floating button's enabled/disabled state uses a **tolerance-based** comparison of
  the current viewport vs. the applied bounds (mirroring the `isFullRange` 1-day
  tolerance for dates), so trivial jitter/sub-pixel reprojection doesn't leave the button
  perpetually enabled with a meaningless diff. After a resize that meaningfully changes
  the visible extent, the button re-enables, inviting an optional re-snapshot — but
  nothing happens unless the user clicks it.

## Performance

The largest real study (gmu8_leuven) has **2,704 deployments** vs **2.7M observations** —
~1,000 observations per deployment. The deployment count is tiny; the observations join
is the cost center.

- **No GIS / R-tree** — built for 100k+ points where spatial pruning is the bottleneck.
  Here a bbox scan over 2,704 deployment rows is sub-5ms regardless, and `loadExtension`
  would complicate the Electron / Linux `afterPack` build for zero payoff.
- **No new index** — ship without a migration. The bbox is one more `AND` inside queries
  that already scan 2.7M observations and join deployments; the deployment-side filter is
  rounding error against that join. Revisit only if profiling on a large study shows the
  deployment scan actually matters. (Defensive option, deferred:
  `CREATE INDEX idx_deployments_lat_lng ON deployments(latitude, longitude)`.)
- **Query-plan verification**: the cheap win is to constrain the observations scan to the
  matching deployments rather than scanning all observations and filtering deployments at
  the end. In practice this is still just the conditional `AND` on the existing
  `INNER JOIN deployments d`; SQLite's planner typically pushes it down. The implementer
  should sanity-check the query plan on gmu8_leuven (e.g. `EXPLAIN QUERY PLAN`) to confirm
  the bbox prunes before the heavy join. No structural rewrite required.

## Testing

- **Unit/integration** (`node --test`): for each of the three newly filtered query
  functions (`getSequenceAwareSpeciesDistribution`, `getSequenceAwareTimeseries`,
  `getSequenceAwareDailyActivity`), assert that:
  1. a `bbox` excludes observations belonging to out-of-bounds deployments, and
  2. a `null` bbox returns the full result (regression guard).
  Use a temp SQLite fixture with deployments at known coordinates.
- **E2E** (Playwright) — stretch / follow-up: apply the area filter, assert the species
  count in the sidebar changes and the chip appears. Scoped as a stretch since map
  interaction in Playwright is fiddly.

## Affected files (anticipated)

- `src/renderer/src/activity.jsx` — `areaFilter` state, query-key wiring, button/overlay/chip, `handleResetFilters`.
- `src/renderer/src/hooks/useAreaFilter.js` — new per-study persistence hook (mirrors `useDateRange`).
- `src/renderer/src/ui/speciesDistribution.jsx` — list reflects the filtered distribution data (data already passed down).
- `src/preload/index.js` — optional `bbox` arg on three `getSequenceAware*` methods.
- `src/main/ipc/sequences.js`, `src/main/ipc/species.js` — pass `bbox` through.
- `src/main/database/queries/species.js` — conditional bbox clause in the three SQL builders.
