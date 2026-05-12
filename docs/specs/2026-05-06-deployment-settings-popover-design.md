# Deployment settings popover

**Date:** 2026-05-06
**Status:** Design — approved
**Area:** renderer (`src/renderer/src/deployments/DeploymentDetailPane.jsx`, new `DeploymentSettingsPopover.jsx`); main (new `deployments:get-stats` IPC handler)

## Summary

Add a small popover, opened from a new gear icon in the `DeploymentDetailPane`
header, that surfaces deployment + camera context for the currently selected
deployment alongside three at-a-glance counts (media, observations, blank
rate). Read-only for v1; row layout chosen so v2 can add inline editing
without restructuring.

## Motivation

When a researcher selects a deployment in the Deployments tab, the bottom
pane shows the media gallery for that deployment but only the editable
location name in its header. Other context — start/end dates, camera
identifiers, total media and observation counts, share of blank captures —
is either invisible or only computable by scrolling/filtering the gallery.

Surfacing this in a single gear-icon popover gives the user fast,
non-disruptive access without leaving the gallery view, and creates a home
for the deployment-edit affordances we will want later (correcting camera
ID, adjusting deployment dates, etc.).

## Goals

- New gear-icon button in the `DeploymentDetailPane` header, sitting
  alongside `LocationPopover` and `SpeciesFilterButton`.
- Dropdown popover (~320px wide) opens beneath the icon; click-outside
  closes it. Same interaction pattern as the adjacent `SpeciesFilterButton`
  popover and `LocationPopover`.
- Three sections: Stats, Camera (conditional), Deployment.
- Stats section renders Media and Observations as tiles plus a derived
  Blank-rate row with a thin progress bar.
- Counts are fetched lazily on first open, cached per
  `(studyId, deploymentID)`.
- Layout designed so future inline editing (v2) drops in without
  structural changes.

## Non-goals

- **Editing.** All fields are read-only in v1. The hover-to-edit
  affordance per row is a planned v2 extension; it is not implemented now.
- **Reuse outside the Deployments tab.** The `ImageModal` and
  `DeploymentLinkPill` (used in Best Captures and elsewhere) are
  separate concerns; this popover is scoped to the deployment-detail
  pane only.
- **New deployment-metadata fields** (height, bait, person, feature
  type). Adding these would require schema changes and is out of scope.
- **`coordinateUncertainty`.** The field is in the schema but
  unpopulated across all 17 surveyed studies; not displayed.

## Survey of existing data

Field-population rates across the 17 studies in the user's local
`biowatch-data/studies/` directory:

| Field                   | Coverage           | Decision                                                                          |
| ----------------------- | ------------------ | --------------------------------------------------------------------------------- |
| `deploymentStart`/`End` | ~94% of studies    | Show; em-dash when null. Duration row hidden if either null.                      |
| `locationID`            | ~100%              | Not displayed (internal grouping key, not user context).                          |
| `locationName`          | ~94%               | Not displayed (already in pane header via `EditableLocationName`).                |
| `latitude`/`longitude`  | ~70%               | Not displayed (already in `LocationPopover`).                                     |
| `cameraModel`           | ~0% (3 rows total) | Show only when populated; whole Camera section hidden if both camera fields null. |
| `cameraID`              | ~25% (3 studies)   | Same — show when populated.                                                       |
| `coordinateUncertainty` | ~0%                | **Dropped** from spec.                                                            |

## Layout

The pane header today (`DeploymentDetailPane.jsx:37–68`):

```
[ Editable location name ]   [📍 LocationPopover] [▽ SpeciesFilter] [× Close]
```

Becomes:

```
[ Editable location name ]   [📍] [▽] [⚙ Settings] [× Close]
```

Gear icon sits between `SpeciesFilterButton` and the close button. 16px
lucide `Settings` icon, same hover treatment as siblings (`p-1
hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700`).

Popover uses the floating-panel pattern already in
`DeploymentDetailPane.jsx:150–183` for the species filter:
`absolute right-0 top-full mt-1 w-80 bg-white border border-gray-200
rounded-lg shadow-lg z-[1100]`. Outside-click closes it via the same
`mousedown` listener pattern.

## Popover content

```
┌──────────────────────────────────────┐
│ STATS                                │
│ ┌────────────┐  ┌────────────┐      │
│ │   1,432    │  │   2,108    │      │
│ │   MEDIA    │  │OBSERVATIONS│      │
│ └────────────┘  └────────────┘      │
│                                      │
│ BLANK RATE              14.8%  (312) │
│ ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░    │
│                                      │
│ CAMERA                               │
│ ID                       CTPC_001_T1 │
│ Model                              — │
│                                      │
│ DEPLOYMENT                           │
│ Start                 2024-08-01 06:14│
│ End                   2024-08-21 18:30│
│ Duration                      20 days │
└──────────────────────────────────────┘
```

### Stats section (always shown)

- **Media** tile and **Observations** tile in a 2-column grid. Light
  gray background (`bg-gray-50`), 1px border, 6px radius, padding ~8px.
  Numbers ~18px / 600 weight; uppercase 10px label below.
- **Blank rate** row beneath the tiles:
  - Label `BLANK RATE` (uppercase, 11px, gray-500) on the left.
  - Right-aligned value: `XX.X%` in foreground color, count in parens
    in lighter gray — `14.8% (312)`.
  - 6px-tall progress bar (gray-200 background, gray-400 fill) under
    the row, width = `blankCount / mediaCount * 100%`.
  - When `mediaCount === 0`: rate row reads `— (0)`, bar is empty.
  - **`blankCount` is media-level** (count of media with no real
    animal/human/vehicle observation), to match the existing
    `BLANK_SENTINEL` count shown in the species-filter popover. See
    Data flow below.
- Counts render `0` for true zeros. While loading, render `—` for all
  three numbers and an empty progress bar.

### Camera section (conditional)

- **Hidden entirely** when both `cameraModel` and `cameraID` are null
  or empty.
- When at least one is set: section header `CAMERA`, then two rows.
  Each row: gray-500 label on the left, foreground value on the right.
  Em-dash (gray-400) for the unset field.
- Order: `ID`, then `Model`. (ID is the more frequently populated and
  user-recognizable field.)

### Deployment section (always shown)

- Section header `DEPLOYMENT`, three rows: `Start`, `End`, `Duration`.
- `Start` / `End`: rendered with the same formatter the app already
  uses for deployment dates (`overview.jsx:138`'s `formatDate` —
  `toLocaleDateString('en-US', { year: 'numeric', month: 'short', day:
'numeric' })` → e.g. `Aug 1, 2024`). Time-of-day is intentionally
  omitted to match existing convention; if camera-trap deployments turn
  out to need minute precision in the popover, switch to
  `toLocaleString()` in a follow-up. Em-dash when the underlying field
  is null.
- `Duration`: derived from start + end, integer days
  (`Math.round((end - start) / 86400000)`). Suffix `day` if 1, else
  `days`. If the rounded difference is 0 (sub-day deployment), show
  `< 1 day`. If either start or end is null, the row is omitted (not
  shown as `—`).

## Component architecture

New file: `src/renderer/src/deployments/DeploymentSettingsPopover.jsx`,
sibling to `LocationPopover.jsx`. Self-contained: button + popover +
data fetch.

```jsx
function DeploymentSettingsPopover({ studyId, deployment }) {
  const [isOpen, setIsOpen] = useState(false)
  // outside-click handler — same shape as SpeciesFilterButton
  // useQuery for stats, enabled: isOpen
  // render button + (isOpen && <PopoverPanel ...>)
}
```

Mounted from `DeploymentDetailPane.jsx` (line 47, in the right-side
button cluster):

```jsx
<LocationPopover ... />
<SpeciesFilterButton ... />
<DeploymentSettingsPopover studyId={studyId} deployment={deployment} />
<button onClick={onClose} ...><X size={16} /></button>
```

### Why a separate file (not inline in `DeploymentDetailPane.jsx`)

`DeploymentDetailPane.jsx` already inlines the `SpeciesFilterButton`
component (262 lines). Adding a third inline component would push the
file past readable size and conflate three distinct concerns.
`LocationPopover` already has its own file; this matches that pattern.

## Data flow

### Inputs already available

The pane receives the full `deployment` row as a prop. That gives us
`deploymentStart`, `deploymentEnd`, `cameraModel`, `cameraID`,
`locationID`, `locationName`, `latitude`, `longitude` — no new fetch
required for the metadata sections.

### New IPC handler: `deployments:get-stats`

Signature:

```js
ipcMain.handle('deployments:get-stats', async (_event, studyId, deploymentID) => {
  // returns { mediaCount, observationCount, blankCount }
})
```

Implementation: three counts run concurrently with `Promise.all`:

- **`mediaCount`** — `SELECT COUNT(*) FROM media WHERE deploymentID = ?`.
  New small query helper (e.g.
  `getMediaCountForDeployment(dbPath, deploymentID)`) added to
  `src/main/database/queries/deployments.js`.
- **`observationCount`** — `SELECT COUNT(*) FROM observations WHERE
deploymentID = ?`. New small query helper (e.g.
  `getObservationCountForDeployment(dbPath, deploymentID)`) in the
  same file.
- **`blankCount`** — reuse the existing
  `getBlankMediaCountForDeployment(dbPath, deploymentID)` already in
  `src/main/database/queries/deployments.js:183`. This counts **media**
  with no real (non-blank, non-vehicle) observation — the same
  definition the species-filter popover uses for `BLANK_SENTINEL`.

Indexes available — `idx_media_deploymentID`,
`idx_observations_deploymentID`, and `idx_observations_blank_cover`
(`mediaID, scientificName, observationType` — a covering index for
the blank-media subquery). `EXPLAIN QUERY PLAN` confirms the blank
subquery uses `idx_observations_blank_cover`. Measured directly: all
three counts together return in ~10–20 ms on the largest sampled
deployment (10,518 media inside a 4.6 GB study DB with ~1.9M
observations). No caching or precomputation needed.

Preload exposure: `window.api.getDeploymentStats(studyId, deploymentID)`
in `src/preload/index.js`, following the existing
`getDeploymentSpecies` pattern.

### Renderer fetch

```js
const { data: stats } = useQuery({
  queryKey: ['deploymentStats', studyId, deploymentID],
  queryFn: async () => {
    const response = await window.api.getDeploymentStats(studyId, deploymentID)
    if (response.error) throw new Error(response.error)
    return response.data
  },
  enabled: isOpen && !!studyId && !!deploymentID,
  staleTime: Infinity
})
```

Same pattern as `SpeciesFilterButton` — lazy on first open, cached for
the lifetime of the React Query cache. Counts only change on import,
which already invalidates broader caches.

## Edge cases

- **Empty deployment (zero media, zero observations).** Tiles show `0`,
  blank-rate row shows `— (0)`, bar empty. Camera section hidden if
  empty. Deployment section shown normally.
- **`BLANK_SENTINEL` in renderer code.** The sentinel is a
  renderer-only marker (`src/shared/constants.js:10`) — the database
  stores actual blank-media as media rows with no qualifying
  observation. The popover's `blankCount` comes from
  `getBlankMediaCountForDeployment`, so the sentinel never enters
  the path.
- **Deployment with only start, no end (open-ended deployment).**
  Start row shows the date, End row shows `—`, Duration row omitted.
- **Studies that have neither dates nor coords (e.g.,
  `ca9faf6c…`).** Stats still render. Camera section hidden. Deployment
  section shows three em-dashes (Duration row omitted).

## Future-editability hook

In v2, each row in the Camera and Deployment sections gains a hover
affordance to edit its value, matching `EditableLocationName`'s
inline-input pattern. The current row layout (gray label left, value
right) accommodates this without restructuring — only the value cell
swaps to an input on edit.

## File touch list

- `src/renderer/src/deployments/DeploymentDetailPane.jsx` — import and
  mount `DeploymentSettingsPopover` in the header button cluster.
- `src/renderer/src/deployments/DeploymentSettingsPopover.jsx` — **new**.
- `src/main/ipc/deployments.js` — register
  `deployments:get-stats` handler.
- `src/preload/index.js` — expose `getDeploymentStats(studyId,
deploymentID)`.
- `docs/ipc-api.md` — document the new handler.
- `docs/database-schema.md` — no schema change; only update if we
  document the queries.
