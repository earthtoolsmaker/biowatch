# Deployments tab revamp — inline media workspace

**Date:** 2026-05-02
**Status:** Design — approved
**Area:** renderer (`src/renderer/src/deployments.jsx`, new `src/renderer/src/deployments/`, extracted parts of `src/renderer/src/media.jsx`); main (`src/main/database/queries/sequences.js`); preload (`src/preload/index.js`)

## Summary

Restructure the Deployments tab so selecting a deployment surfaces its
media (and, eventually, observations, timeline, camera-days, species)
inline. The tab gains a third pane — a "deployment detail" pane at the
bottom — that mounts only when an individual deployment is selected. For
V1 the pane contains a deployment-scoped media gallery (full bbox /
classification editing, same as the Media tab today). The map and list
move from a vertical stack to a horizontal split inside a top row,
keeping all three regions visible without wasting pixels when no
deployment is selected.

## Motivation

Today the Deployments tab is a discovery surface — map of camera
locations, list of deployments with activity timelines — but to actually
look at the *images* a deployment captured, the user must mentally hop
to the Media tab and filter. That round-trip is the workflow the user
spends the most time on (QA: spot-checking classifications for a
specific deployment), and Media's filters don't expose
"this-deployment-only" cleanly.

The fix: bring the media workspace to where the deployment is selected.
Selecting a deployment in the list (or on the map) opens a media pane
underneath, scoped to that deployment, with the same per-image editing
the Media tab supports. Deselecting closes the pane and returns the
top row to full height — pixels stay efficient.

## Goals

- Selecting a deployment opens an inline media workspace for that
  deployment, with the same bbox / classification editing the Media tab
  offers.
- No selection ⇒ top row (map + list) fills the whole tab. Bottom pane
  unmounted.
- Switching deployments swaps the bottom-pane content; layout doesn't
  reset.
- Resizable handles between map↔list and top↔bottom; ratios persist per
  study via `react-resizable-panels`' `autoSaveId`.
- URL search param (`?deploymentID=…`) makes the selection
  deep-linkable, mirroring the Media tab's existing `useSearchParams`
  pattern.
- Reuse the Media tab's `Gallery` (and `ImageModal`, `SequenceCard`,
  `ThumbnailCard`, `GalleryControls`, etc.) by extracting it into a
  shared module. Both tabs render the same code.
- Bottom pane is structured so future sections (timeline graph,
  camera-days, species at location) slot in alongside the gallery.

## Non-goals

- Removing or replacing the Media tab. Media stays as the
  study-wide media surface. Deployments scopes the same UI to one
  deployment.
- Multi-deployment selection. Single deployment only.
- Aggregated media for multi-deployment location groups. Group-header
  rows in the list stay browse-only — selecting a header does not open
  the bottom pane (per design Q6).
- Filtering inside the deployment-scoped gallery (species pickers, date
  range, time-of-day brushing). The pane shows everything for the
  deployment. Filtering can be added later without rework — the
  underlying `getSequences` query already accepts those filters.
- Future bottom-pane sections (timeline graph, camera-days, species at
  location). Designed *for*, not *built*.
- Changes to the existing map (markers, clustering, place mode,
  drag-to-edit lat/lng). All retained as-is.
- Changes to the existing list rows (timeline activity bars, inline
  rename, lat/lng edit, group-header expansion). All retained as-is.

## Visual layout

Two states. The vertical `PanelGroup` chooses between them based on
whether `selectedDeployment` is set to a real deployment row.

### State 1 — no selection (default on tab open)

```
┌──────────────────────────────────────────────────────────────┐
│ ┌──────────────┬───────────────────────────────────────────┐ │
│ │              │ Deployments + activity timeline           │ │
│ │   Map        │ ─────────────────────────────────────     │ │
│ │  (markers,   │ ▢ Camera 1   ●●●●●●●●●●●●●●●●●            │ │
│ │  clusters)   │ ▢ Camera 2   ●●○○○○○○●●●●●○○○             │ │
│ │              │ ▼ Group A (3)●●●●●●●●●●●●●●●●●            │ │
│ │  ~38%        │   ▢ Camera 3 …                            │ │
│ │              │   ▢ Camera 4 …                            │ │
│ │              │ ▢ Camera 5   ●●●●●●●●●●○○○○○○             │ │
│ │              │  ~62%                                      │ │
│ └──────────────┴───────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

Top row fills 100% of tab height. Map left ~38%, list right ~62%
(timeline activity bars need width). Inner split is resizable.

### State 2 — deployment selected

```
┌──────────────────────────────────────────────────────────────┐
│ ┌──────────────┬───────────────────────────────────────────┐ │
│ │   Map        │ Deployments + timeline (compact)          │ │
│ │  (sel. pin   │ ▢ Camera 1   …                            │ │
│ │   active)    │ ■ Camera 2   …  ← selected                │ │
│ │  ~38%        │ ▢ Camera 3   …                            │ │
│ │              │  ~62%                                      │ │ ~38% top
│ ├──────────────┴───────────────────────────────────────────┤ │
│ │ Camera 2 — media                                       ✕ │ │
│ │ [thumb][thumb][thumb][thumb][thumb][thumb][thumb][thumb] │ │
│ │ [thumb][thumb][thumb][thumb][thumb][thumb][thumb][thumb] │ │ ~62% bottom
│ │ [thumb][thumb][thumb][thumb][thumb][thumb][thumb][thumb] │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

When a deployment becomes the selection, the outer vertical
`PanelGroup` reflows to a 38/62 default (favoring media for the QA
workflow). Both splits remain resizable; ratios persist per study.

### Selecting a group header

Group headers (multi-deployment locations) keep their existing
expand/collapse behavior. The bottom pane stays unmounted — the user
must select an individual deployment under the group for media to
appear.

## Components & responsibilities

### `Deployments` (`src/renderer/src/deployments.jsx`)

Existing orchestrator. Changes:

- Drop the current vertical `Panel` layout (map top / list bottom).
- New layout: a vertical `PanelGroup` (`autoSaveId="deployments-v2"`)
  whose children depend on `selectedDeployment`:
  - When no deployment is selected, the group has one `Panel` —
    a horizontal `PanelGroup` (`autoSaveId="deployments-v2-top"`)
    containing the map and the list.
  - When a deployment is selected, the group has the same top `Panel`
    plus a second `Panel` rendering `<DeploymentDetailPane>`.
- `selectedDeployment` is mirrored to the URL via `useSearchParams`
  (`?deploymentID=…`). The orchestrator hydrates state from the URL on
  mount.
- ✕ on the bottom pane, Esc, and re-clicking the selected list row all
  clear `selectedDeployment` (and the URL param).
- Selecting a group-header row does NOT set `selectedDeployment` (it
  only toggles the group's `expandedGroups` state, as today). The
  bottom pane stays unmounted.

### `DeploymentDetailPane` (new, `src/renderer/src/deployments/DeploymentDetailPane.jsx`)

Container for the bottom pane. Header strip with the deployment's name
(or `locationID` fallback) and a ✕ close button. Body slot for V1
contains a single child — `DeploymentMediaGallery`. Structured so
future sections (timeline graph, camera-days, species at location) can
be added as sibling children inside the body without restructuring.

### `DeploymentMediaGallery` (new, `src/renderer/src/media/DeploymentMediaGallery.jsx`)

Thin wrapper around the extracted shared `Gallery` component. Pins the
filter inputs:

- `species: []` (sequences query treats an empty array as "no species
  filter — all media", verified in
  `src/main/database/queries/sequences.js`)
- `dateRange: [null, null]`
- `timeRange: { start: 0, end: 24 }`
- `includeNullTimestamps: true`
- `speciesReady: true` (Gallery uses this gate to wait for the Media
  tab's species cascade; the deployment-scoped wrapper has no such
  cascade, so it ships ready)
- `deploymentID: <selected>`

These are passed into `Gallery` via the same prop surface the Media
tab uses. The deployment-scoped gallery is the same component the
Media tab renders — just with `deploymentID` set and the filter UI
hidden.

### `Gallery` extraction from `media.jsx`

Move `Gallery`, `SequenceCard`, `ThumbnailCard`, `ImageModal`,
`GalleryControls`, `ThumbnailBboxOverlay`, `DrawingOverlay`, and any
helpers used solely by them into a new shared module
(`src/renderer/src/media/Gallery/` or similar — exact filename layout
decided in implementation). The Media tab keeps its outer shell (the
`Activity` default export, species filter, timeline brush, daily
activity radar) and re-imports `Gallery` from the new location.

`Gallery` accepts the existing props (`species`, `dateRange`,
`timeRange`, `includeNullTimestamps`, `speciesReady`) plus a new
optional `deploymentID`. When `deploymentID` is present the
`useInfiniteQuery` queryKey includes it, and it's threaded into the
`getSequences` call's `filters`.

## Data flow

```
Deployments (orchestrator)
  ├─ selectedDeployment  ←→  ?deploymentID=… (useSearchParams)
  ├─ deploymentsList     ←  useQuery(['deploymentsAll', studyId])
  ├─ activity (timeline) ←  useQuery(['deploymentsActivity', studyId, periodCount])
  │
  └─ <PanelGroup direction="vertical" autoSaveId="deployments-v2">
       │
       ├─ <Panel> (top row, always present)
       │    └─ <PanelGroup direction="horizontal" autoSaveId="deployments-v2-top">
       │         ├─ <Panel> — <LocationMap …/>      (existing)
       │         └─ <Panel> — <LocationsList …/>    (existing)
       │
       └─ <Panel> (bottom, mounted only when selectedDeployment is a real deployment)
            └─ <DeploymentDetailPane deployment={selectedDeployment} onClose={…}>
                 └─ <DeploymentMediaGallery
                      studyId={studyId}
                      deploymentID={selectedDeployment.deploymentID}
                    />
                     └─ <Gallery deploymentID={…} …/>
                          └─ useInfiniteQuery(['sequences', studyId, gap, deploymentID, …])
                               → window.api.getSequences(studyId, { …, filters: { deploymentID } })
```

Key flows:

- **Selecting a deployment** (list row click, map marker click): the
  existing `setSelectedLocation` becomes a thin wrapper that calls
  `setSearchParams({ deploymentID: location.deploymentID })`. The
  orchestrator reads the param back, derives `selectedDeployment` from
  it, and mounts the bottom pane. Map markers always represent a
  single deployment (the un-deduped `getAllDeployments` query — one
  marker per deployment), so a marker click always mounts the pane.
- **Selecting a group header** (list-only — group headers don't exist
  on the map): existing `toggleGroup` runs unchanged. The handler does
  NOT call the wrapped `setSelectedLocation`, so no URL param is
  written and the bottom pane stays unmounted.
- **Closing**: ✕ / Esc / re-clicking the selected list row clear the
  search param. Bottom pane unmounts.
- **Switching deployments while open**: `deploymentID` in the queryKey
  changes; `useInfiniteQuery` refetches the new deployment's
  sequences. Pane stays mounted; header label updates.
- **Coordinate edits / renames** (existing handlers): unchanged. Their
  cache invalidations cover only the deployment-list / activity /
  heatmap caches — they don't touch the new `getSequences` cache,
  which is keyed by `deploymentID`.

## IPC & query changes

`getSequences` already accepts a `filters` object with `species`,
`dateRange`, `timeRange`. We add an optional `deploymentID` to it.

### Preload (`src/preload/index.js`)

`getSequences(studyId, options)` keeps its signature. The `options`
object's `filters` field gains an optional `deploymentID` property.

### Main query (`src/main/database/queries/sequences.js`)

The cursor-paginated query gains one additional `WHERE` clause,
slotted into the existing `and(...)` next to species/date/time:

```js
filters.deploymentID
  ? eq(media.deploymentID, filters.deploymentID)
  : undefined
```

Confirm `media.deploymentID` is indexed (it is — used elsewhere for
sequence grouping). If not, add an index in a migration.

### Renderer (`Gallery`)

When `deploymentID` is present, include it in the `useInfiniteQuery`
queryKey so distinct deployments cache separately:

```js
queryKey: ['sequences', studyId, sequenceGap, deploymentID,
           JSON.stringify(species),
           dateRange[0]?.toISOString(), dateRange[1]?.toISOString(),
           timeRange.start, timeRange.end, includeNullTimestamps]
```

Activity tab callers pass no `deploymentID` — the existing query path
is unchanged.

## Edge cases

- **No media for the deployment** — show the existing `Gallery` empty
  state. Bottom pane stays mounted; user can deselect normally.
- **Import in progress** — the existing `refetchInterval` pattern
  (5s when `importStatus.isRunning`) carries through; sequences
  populate as media flow in.
- **Invalid `?deploymentID=…`** (deployment was deleted, wrong study,
  etc.) — orchestrator strips the param when the ID isn't present in
  the loaded `deploymentsList`. Bottom pane doesn't mount; no error.
- **Switching study while a deployment is selected** — `studyId`
  changes via the parent `study.jsx` route; the orchestrator's
  `useEffect`/queryKey derivations naturally clear
  `selectedDeployment` and the param.
- **Activity tab also uses `getSequences`** — adding `deploymentID` is
  purely additive. Activity callers continue to omit it. Verified by
  the existing sequences-IPC tests.
- **Group-header row was "selected" by an older URL param** — defensive
  check on hydration: if the param refers to a `locationID` rather than
  a `deploymentID`, treat as no selection.

## Testing

- **Unit (sequences query):** add cases for `filters.deploymentID` —
  with no filter (existing behavior preserved); with a valid ID (only
  matching media); with a non-existent ID (empty result, no error).
- **Unit (orchestrator):** selecting a group-header row does not mount
  the bottom pane; selecting a deployment does; ✕ / Esc / toggle clear
  the selection and the URL param; URL hydration on mount picks the
  right deployment when valid, drops it when not.
- **Manual:** resize handles persist across reload (`autoSaveId`);
  deep-link via `?deploymentID=…` mounts the bottom pane on tab open;
  switching deployments while open swaps content without resetting
  pane heights; place mode (drag-to-set-coords) still works while a
  deployment is selected.

## Docs to update (per `CLAUDE.md`)

- `docs/ipc-api.md` — note the optional `filters.deploymentID` on
  `getSequences`.
- `docs/architecture.md` — note the new `DeploymentDetailPane` and the
  shared `Gallery` extraction in the renderer's component tree.

## Iterations beyond v1

Landed during the implementation cycle on top of the v1 spec above.
None of these change the architecture or non-goals; they're additive
polish on the detail-pane chrome.

- **Inline rename in the detail-pane header.** The deployment name is
  rendered via `EditableLocationName` (extracted from `deployments.jsx`)
  so users can rename a deployment from the same place they see its
  media. New shared file: `src/renderer/src/deployments/EditableLocationName.jsx`.
- **Species filter popover.** A filter button next to ✕ opens a popover
  listing species observed at this deployment (one row per species:
  common name + scientific name + media count). Click rows to toggle;
  selection threads into `Gallery`'s `species` prop. Hovering a row
  opens the project's `SpeciesTooltipContent` card. New IPC
  `deployments:get-species` and DB query `getSpeciesForDeployment`.
- **"No observations" (blanks) row.** The species filter popover
  appends a synthetic row at the bottom for media at the deployment
  with no observations. Reuses the existing `BLANK_SENTINEL` convention
  — the sequences-paginated query already special-cases it on input,
  so the popover passes it straight through.
- **Top-row swap.** Map and list swapped horizontally — list on the
  left (~62%), map on the right (~38%). The list timeline uses width
  productively; the map's geography reads at any size.
- **Subtle open/close animation.** 180ms fade-in + slide-up when the
  detail pane mounts; 150ms fade-out via deferred unmount. Doesn't
  retrigger on deployment-to-deployment swaps because the inner
  `DeploymentDetailPane` keeps its own `key={deploymentID}` for state
  isolation.
- **Map polish.** `rounded-xl` + `shadow-md` chrome matching the
  Overview tab; `max-h-[500px]` cap so the map doesn't stretch on tall
  windows; `ImageModal` z-index raised to `z-[9999]` so it sits above
  Leaflet's map controls.
- **`embedded` prop on `Gallery`.** When set (true for
  `DeploymentMediaGallery`), the controls bar and outer `bg-white
  rounded border` chrome are dropped — the detail pane provides the
  surrounding shell instead.
