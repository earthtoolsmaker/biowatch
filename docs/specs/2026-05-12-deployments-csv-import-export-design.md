# Deployments CSV import/export

**Date:** 2026-05-12
**Status:** Design — pending approval
**Issue:** [#497](https://github.com/earthtoolsmaker/biowatch/issues/497)
**Area:** renderer (new `DeploymentsCsvMenu.jsx`, new `DeploymentsImportPreviewModal.jsx`, edits to `deployments.jsx`); main (new parser, applier, exporter, IPC module)

## Summary

Export the current deployments table as a CSV, edit it externally (Excel,
Google Sheets, vim), and re-import to bulk-update `latitude`, `longitude`,
and `locationName` across many deployments at once. Entry point: a new `⋮`
menu in the timeline header of the Deployments tab, next to
`SparklineToggle`. Import shows a preview-table modal with cell-level
error highlighting before any DB write; apply is a single SQLite
transaction.

## Motivation

Several real-world studies arrive with deployments but no coordinates —
notably the LILA / COCO datasets (Snapshot Kgalagadi, Snapshot Karoo,
Seattle Camera Traps, Nkhotakota, Biome Health Maasai Mara, Idaho Camera
Traps in the local survey). For these, the user must currently open the
Deployments tab and edit lat/lon per row via `LocationPopover`. With 176+
rows, that's untenable.

Bulk CSV editing is the natural escape hatch: export the deployments
table, fill coordinates in a spreadsheet that supports column-fill and
paste, re-import.

Issue #497 also surfaced a secondary desire from contributor `wsyxbcl`:
the same flow can carry `locationName` edits for studies that ship with
generic location names. That round-trip is in scope.

## Goals

- New `⋮` button in the Deployments-tab timeline toolbar, beside
  `SparklineToggle`. Menu items: **Export deployments CSV** and **Import
  deployments CSV…**.
- Export writes all deployments to a CSV with exactly the columns the
  import accepts.
- Import shows a preview-table modal classifying every cell as
  unchanged / change / warning / skipped, with hover tooltips explaining
  each warning. Apply commits in one SQLite transaction.
- `latitude`, `longitude`, `locationName` are editable. Everything else
  is read-only context (or ignored on import).
- Out-of-range coords are skipped per-cell with a warning; the rest of
  the row still applies.
- Unknown `deploymentID` rows are skipped per-row with a warning.

## Non-goals

- **Editing other deployment fields** (`locationID`, `coordinateUncertainty`,
  `cameraID`, `cameraModel`, `deploymentStart`, `deploymentEnd`). The
  schema supports them but v1 keeps scope tight to the coords-and-name
  motivation.
- **Header aliases.** Only the canonical CamtrapDP column names are
  accepted (`deploymentID`, `locationID`, `locationName`, `latitude`,
  `longitude`). Spreadsheets that rename columns must rename back.
- **Creating new deployments** from CSV rows whose `deploymentID` isn't
  in the DB. Those rows are skipped. CSV is for editing existing data,
  not seeding it.
- **Undo.** v1 relies on the preview modal as the safety net. A
  multi-row undo path for deployments doesn't exist yet.
- **Coord-swap auto-detection** (lat ↔ lon). Considered, rejected — too
  easy to mis-fire on real polar data.
- **Optimistic UI patching at apply time.** The post-Apply refetch is
  fast enough; the optimistic logic in `deployments.jsx:onNewLatitude`
  exists only to prevent map-marker snap-back during drag, which doesn't
  apply here.

## Survey of existing data

Local audit across 28 studies (~7,700 deployments, ~5,400 unique
locationIDs):

| Property | Result |
| --- | --- |
| Studies with 0% lat/lon coverage | 6 (all LILA / COCO imports — primary motivation) |
| Studies with 100% `locationID` coverage | 28 / 28 |
| Studies with 100% `locationName` coverage | 28 / 28 |
| locationIDs with intra-group **coord divergence** | 0 |
| locationIDs with intra-group **name divergence** | 0 |
| Studies where many deployments share one locationID | Yes — e.g. MICA Muskrat: 1,539 deployments / 54 locationIDs (~28 per location); GMU8 Leuven: 2,704 / 2,696 (~1 per location, so name propagation is effectively no-op) |

The divergence rows are zero because the only path to it today is
manually dragging one of two co-located markers via `LocationPopover`,
and no one in the surveyed data has done so. This is what justifies
"keep the existing asymmetry, don't add machinery for a case that never
fires" (see [Asymmetry](#coordnames-asymmetry-intentional) below).

## UI

### Entry point

A new `DeploymentsCsvMenu` component renders to the right of
`SparklineToggle` in the timeline header (`deployments.jsx:779`):

```
┌───────────────────────────────────────────────────┐
│ Locations …          [Bars][Line][Heatmap] [⋮]    │
└───────────────────────────────────────────────────┘
                                              │
                  ┌───────────────────────────┴─┐
                  │ ↓ Export deployments CSV…   │
                  │ ↑ Import deployments CSV…   │
                  └─────────────────────────────┘
```

Button is a `lucide` `MoreVertical` 14px icon. Same hover/active
treatment as the SparklineToggle children (`bg-accent`, `text-foreground`).
Dropdown styling matches existing popovers
(`absolute right-0 top-full mt-1 … rounded-lg shadow-lg z-[1100]`).
Outside-click closes; Esc closes.

### Export

Click **Export deployments CSV…** → main shows
`dialog.showSaveDialog` with default filename
`deployments-<study-slug>-<YYYY-MM-DD>.csv`. On confirm, main:

1. Queries every row in `deployments` (no filter), ordered by
   `deploymentID ASC`.
2. Renders CSV with these columns, in this order, using the existing
   `escapeCSV` / `toCSV` helpers in
   `src/main/services/export/exporter.js`:

   ```
   deploymentID,locationID,locationName,latitude,longitude
   ```

3. Writes UTF-8 file with `\n` line endings. Empty DB values become
   empty cells (no `null` / `NaN` strings).

The export includes rows with null coords — that's the workflow:
re-import the same file after filling in the blanks. Synthesized
`biowatch-geo:…` `locationID` values are exported as-is (not stripped),
so the round-trip is byte-stable. Different from CamtrapDP export, which
does strip the prefix for spec compliance.

### Import — file selection

Click **Import deployments CSV…** → main shows `dialog.showOpenDialog`
with `filters: [{ name: 'CSV', extensions: ['csv'] }]`. On confirm,
main parses the file and returns the **preview payload** (see [Preview
payload schema](#preview-payload-schema)). The renderer opens the
preview modal.

If the file is missing a required column (`deploymentID` header not
present), parse aborts before the modal: a toast surfaces
`Required column 'deploymentID' not found in CSV.` No preview is
shown.

### Import — preview modal

A blocking modal occupying ~80% of the viewport. Layout:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Import deployments CSV — sample-edits.csv                            ×  │
│                                                                          │
│  ✔ 23 rows will update     ⚠ 2 cells skipped     ⊝ 1 row unknown ID     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ # │ deploymentID │ locationID │ locationName │ latitude │ longitude│  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │ 1 │ CAM_001      │ LOC_A      │ Ridge South ← │  45.234  │  6.812  │  │
│  │ 2 │ CAM_002      │ LOC_A      │ Ridge South   │  45.241 ← │⚠ 999.0 │  │
│  │ 3 │ CAM_003      │ LOC_A      │ Ridge North ← │ ⚠ —      │  6.815  │  │
│  │ 4 │ ⊝ CAM_NEW    │            │              │  45.0    │  6.0    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Legend:  ← change   ⚠ warning (cell skipped)   ⊝ row skipped           │
│                                                                          │
│                                          [ Cancel ]   [ Apply (23) ]    │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Cell states

| State | Visual | Meaning | Applied? |
| --- | --- | --- | --- |
| `unchanged` | default text color | CSV value equals current DB value | n/a |
| `change` | bold + `←` glyph + green tint (`text-green-700` light / `text-green-300` dark) | CSV value differs and will overwrite | yes |
| `warning` | amber tint (`text-amber-700` / `amber-300`) + `⚠` glyph | parse or validation failure; tooltip on hover | **no — cell skipped, rest of row applies** |
| `readonly` | gray italic | `deploymentID` / `locationID` cells; not editable | n/a (mismatches surfaced as row warning, see below) |

#### Row states

| State | Visual | Meaning | Applied? |
| --- | --- | --- | --- |
| Normal | — | row will participate in update | yes (for `change` cells only) |
| `skipped` | row dimmed (50% opacity), `⊝` in the `#` column | `deploymentID` empty or not found in DB | **no — entire row skipped** |

Skipped rows still render in the table so the user can see what was
ignored. Tooltip on `⊝`: `No deployment with this ID in the study.` Or
for empty: `deploymentID is required.`

#### Hover tooltips

Each warning cell has a tooltip:

- Out-of-range latitude: `Latitude 91.5 is outside [-90, 90]. Cell skipped; other cells in this row still apply.`
- Out-of-range longitude: `Longitude 999.0 is outside [-180, 180]. Cell skipped; other cells in this row still apply.`
- Non-numeric: `'abc' is not a valid number. Cell skipped; other cells in this row still apply.`
- `locationID` mismatch (CSV value differs from DB): `locationID is read-only. Existing value 'LOC_A' will be kept; CSV value 'LOC_B' ignored.`
- Duplicate `deploymentID` in CSV: `Overridden by row N below.` (on the earlier row's changed cells)

#### Summary banner

Three counts above the table:

- `✔ N rows will update` — number of rows with at least one `change` cell.
- `⚠ W cells skipped` — count of `warning` cells across all rows.
- `⊝ M rows unknown ID` — count of `skipped` rows.

`[Apply (N)]` is disabled when `N == 0`. Apply count matches "rows will update."

#### Keyboard

- **Esc** — Cancel.
- **Enter** — does **not** apply. Apply is an explicit click. Bulk
  destructive ops should not be one keystroke away.
- Modal traps focus inside it (`react-focus-lock` or equivalent — same
  pattern already used elsewhere in the app, e.g. `ImageModal`).

#### Virtualization

For studies with thousands of deployments (GMU8 Leuven has 2,704; LILA
Snapshot Serengeti can ship 8K+), the preview table uses TanStack
`useVirtualizer` (already imported in `deployments.jsx`). Skipped rows
are rendered like other rows, just dimmed — they aren't filtered out so
the user can locate them by file position.

## Parse + validate logic

Implemented in a new file
`src/main/services/import/parsers/deploymentsCsv.js`, importable in
isolation (no Electron deps beyond what `csv-parser` already pulls in).

### Algorithm

```
1. Read CSV via existing `csv-parser` stream.
2. Validate header row:
   - If 'deploymentID' missing → hard error, return {error: '...'}.
   - Unknown headers → log + ignore.
3. Build a Map of all current deployments keyed by deploymentID
   (single `db.select` over deployments table).
4. For each CSV row, classify each cell:
   - deploymentID: required, must exist in DB → otherwise row 'skipped'.
   - locationID: if present and differs from DB → cell 'warning' (readonly mismatch).
   - locationName: trim; if empty → 'unchanged'; if matches DB → 'unchanged'; else 'change'.
   - latitude / longitude: empty → 'unchanged'; non-numeric → 'warning';
     out-of-range → 'warning'; matches DB (within epsilon 1e-9) → 'unchanged'; else 'change'.
5. Second pass: detect duplicate deploymentIDs in CSV.
   - All but the last row's 'change' cells become 'warning'.
6. Third pass: detect intra-locationName conflicts within one CSV.
   - If two CSV rows share locationID but disagree on the chosen
     locationName 'change' value, last-row-wins. Earlier rows' name
     cells become 'warning' with tooltip
     "Conflicting names for LOC_A; row N below wins."
7. Build preview payload.
```

### Validation rules (canonical list)

| Rule | Result | Tooltip text |
| --- | --- | --- |
| `deploymentID` cell empty | row skipped | `deploymentID is required.` |
| `deploymentID` not in DB | row skipped | `No deployment with this ID in the study.` |
| `locationID` differs from DB | cell warning | `locationID is read-only.` |
| `latitude` non-numeric | cell warning | `'X' is not a valid number.` |
| `latitude` ∉ [-90, 90] | cell warning | `Latitude X is outside [-90, 90].` |
| `longitude` non-numeric | cell warning | `'X' is not a valid number.` |
| `longitude` ∉ [-180, 180] | cell warning | `Longitude X is outside [-180, 180].` |
| Duplicate `deploymentID` in CSV | earlier row's change cells become warning | `Overridden by row N below.` |
| Intra-locationID `locationName` conflict | earlier rows' name cells become warning | `Conflicting names for LOC_A; row N below wins.` |

### Coord/name asymmetry (intentional)

Coordinates are applied **per deploymentID**; `locationName` is
propagated to **every deployment sharing the resolved `locationID`**.
This matches the existing inline-edit handlers:

- `deployments:set-latitude` / `set-longitude` — update one row.
- `deployments:set-location-name` — updates all rows with the same
  `locationID` (`src/main/ipc/deployments.js:175`).

Per the data audit, no study in the local dataset has
intra-`locationID` coord divergence, so this asymmetry never actually
fires in the wild. Documenting it here so a future maintainer
understands why the CSV path differs by field.

If a CSV did produce divergent coords for one `locationID`, the apply
step writes them as given — same as if the user dragged one of two
co-located markers in the existing UI. No special handling, no banner.

## Preview payload schema

The main process returns this shape from `deployments:parse-csv-for-import`:

```js
{
  filePath: '/abs/path/to/sample.csv',
  fileName: 'sample.csv',
  totalRows: 26,                  // CSV data rows (excludes header)
  applyCount: 23,                 // rows with at least one 'change' cell
  cellWarningCount: 2,            // total warning cells
  rowSkipCount: 1,                // total skipped rows
  rows: [
    {
      rowIndex: 1,                // 1-based, matches what the user sees in the table
      deploymentID: 'CAM_001',
      rowState: 'normal' | 'skipped',
      rowWarning: null,           // free-text reason if skipped
      columns: {
        deploymentID: { csvValue: 'CAM_001', dbValue: 'CAM_001', state: 'readonly' },
        locationID:   { csvValue: 'LOC_A',   dbValue: 'LOC_A',   state: 'readonly' },
        locationName: { csvValue: 'Ridge S', dbValue: 'Ridge',   state: 'change' },
        latitude:     { csvValue: '45.234',  dbValue: 45.234,    state: 'unchanged', appliedValue: 45.234 },
        longitude:    { csvValue: '999.0',   dbValue: 6.812,     state: 'warning', warning: 'Longitude 999.0 is outside [-180, 180].' }
      }
    },
    // ...
  ]
}
```

The renderer is stateless re-validation; it only reads this structure
and renders. The `applyCount`, `cellWarningCount`, `rowSkipCount`
fields drive the summary banner directly.

## Apply phase

After the user clicks **Apply**:

1. Renderer extracts the **apply plan** from the preview payload — an
   array of `{ deploymentID, fields }` where `fields` contains only the
   keys whose cell state is `change`:

   ```js
   [
     { deploymentID: 'CAM_001', fields: { locationName: 'Ridge S' } },
     { deploymentID: 'CAM_002', fields: { latitude: 45.241 } },
     // ...
   ]
   ```

2. Renderer calls `window.api.applyDeploymentsCsvImport(studyId, applyPlan)`.

3. Main process runs `db.transaction(async (tx) => { … })` from
   `src/main/services/import/applyDeploymentsCsv.js`:

   ```js
   for (const row of applyPlan) {
     // Belt-and-suspenders re-validate
     const updates = {}
     if ('latitude' in row.fields) {
       const v = Number(row.fields.latitude)
       if (Number.isFinite(v) && v >= -90 && v <= 90) updates.latitude = v
     }
     if ('longitude' in row.fields) {
       const v = Number(row.fields.longitude)
       if (Number.isFinite(v) && v >= -180 && v <= 180) updates.longitude = v
     }

     if (Object.keys(updates).length > 0) {
       await tx.update(deployments)
         .set(updates)
         .where(eq(deployments.deploymentID, row.deploymentID))
     }

     if ('locationName' in row.fields) {
       const trimmed = row.fields.locationName.trim()
       if (trimmed) {
         // Resolve locationID from current DB row, not from CSV
         const result = await tx
           .select({ locationID: deployments.locationID })
           .from(deployments)
           .where(eq(deployments.deploymentID, row.deploymentID))
         const locationID = result[0]?.locationID
         if (locationID) {
           await tx.update(deployments)
             .set({ locationName: trimmed })
             .where(eq(deployments.locationID, locationID))
         } else {
           await tx.update(deployments)
             .set({ locationName: trimmed })
             .where(eq(deployments.deploymentID, row.deploymentID))
         }
       }
     }
   }
   ```

4. On success, main returns
   `{ success: true, summary: { deploymentsUpdated, locationsNamed } }`.
   Renderer closes the modal and shows a toast:
   `Updated N deployments. M location names propagated.`

5. Renderer invalidates the same React Query caches that single-row
   edits invalidate today (`deployments.jsx:1003–1007`):
   - `['deploymentLocations', studyId]` — Overview map (deduped)
   - `['deploymentsAll', studyId]` — Deployments tab map
   - `['deploymentsActivity', studyId]` — sparkline rows (locationName
     affects section headers via `groupDeploymentsByLocation`)
   - `['heatmapData', studyId]` — Activity tab heatmap

### Why two-call (parse, then apply)

A single round-trip "parse + apply" would let the user see the diff
only after the writes happened. A stateful "stash plan in main, apply
by token" introduces a plan-ID lifecycle and crash-recovery surface
that isn't worth the savings.

The chosen design is **stateless on main**: the renderer hands back the
apply plan it derived from the preview payload, and main re-validates
defensively before writing. Risk of a tampered plan is low — the
re-validation drops out-of-range values, and `deploymentID` mismatches
fall through `update().where()` as no-ops. Cost is one extra walk over
~thousands of small JS objects, well under the noise floor.

## Component & file layout

### New files

| Path | Purpose |
| --- | --- |
| `src/main/services/import/parsers/deploymentsCsv.js` | Pure parse + validate. Reads CSV, queries existing deployments, produces preview payload. No DB writes. |
| `src/main/services/import/applyDeploymentsCsv.js` | Single transactional apply. Re-validates, runs the transaction, returns summary. |
| `src/main/services/export/deploymentsCsv.js` | Export: query all deployments, render to CSV with `toCSV`, prompt save dialog, write file. |
| `src/main/ipc/deploymentsCsv.js` | Three IPC handlers: `deployments:export-csv`, `deployments:parse-csv-for-import`, `deployments:apply-csv-import`. |
| `src/renderer/src/deployments/DeploymentsCsvMenu.jsx` | The `⋮` button + menu. Owns the flow's transient state: file path, preview payload, modal open/close. |
| `src/renderer/src/deployments/DeploymentsImportPreviewModal.jsx` | The preview table modal. Stateless wrt validation — renders the preview payload it receives. |

### Modified files

| Path | Change |
| --- | --- |
| `src/renderer/src/deployments.jsx` | Mount `<DeploymentsCsvMenu studyId={studyId} />` next to `<SparklineToggle />` in the header (`deployments.jsx:778–780`). Wire cache invalidation callbacks. |
| `src/preload/index.js` | Expose `exportDeploymentsCsv(studyId)`, `parseDeploymentsCsvForImport(studyId, filePath)`, `applyDeploymentsCsvImport(studyId, applyPlan)`, and a helper `selectCsvFile()` that wraps `dialog.showOpenDialog`. |
| `src/main/ipc/index.js` | Register the new IPC handler module. |
| `docs/ipc-api.md` | Document the three new handlers. |
| `docs/import-export.md` | Add a "Deployments CSV (locations + names)" section. |
| `docs/data-formats.md` | Document the deployments-CSV column shape. |

### Why a dedicated `DeploymentsCsvMenu`

`deployments.jsx` is ~1,200 lines and already orchestrates the map,
the virtualized list, the URL state, and the sparkline header. Putting
the menu + modal flow state inline would push it well past readable
size. Same rationale used for `DeploymentSettingsPopover` in
[the deployment settings popover spec](./2026-05-06-deployment-settings-popover-design.md).

### Why the modal is a separate component from the menu

The modal carries the heaviest UI (virtualized table, per-cell tooltip
rendering, cell highlighting). Isolating it lets each be tested
independently and lets the modal potentially be reused for future
bulk-edit features.

## Edge cases

- **Empty CSV (header only).** Modal opens with empty table,
  `[Apply (0)]` disabled, banner `0 rows will update`.
- **CSV with only `deploymentID` column (no editable fields).** Every
  row is `unchanged`; `[Apply (0)]` disabled. Same outcome as empty.
- **CSV missing `deploymentID` header.** Hard error at parse time — no
  preview modal; toast `Required column 'deploymentID' not found in CSV.`
- **Duplicate `deploymentID` rows in the CSV.** Last row wins; earlier
  rows' change cells become warning with tooltip "Overridden by row N
  below."
- **CSV from a different study (every deploymentID unknown).** Modal
  opens, all rows show `⊝`, `[Apply (0)]` disabled. Banner: `0 rows
will update, X unknown rows`.
- **Round-trip.** Export → no edits → re-import → all cells classified
  `unchanged`; `[Apply (0)]` disabled. Confirms format is stable.
- **`biowatch-geo:…` synthesized `locationID`.** Round-trip preserves
  them — export emits raw DB values (no `stripSynthLocationID`); import
  treats `locationID` as read-only so synthetic prefixes can't be lost
  or corrupted.
- **Empty cell semantics.** Empty cell = "leave DB value untouched."
  There is no sentinel for "clear" — clearing a coord remains a per-row
  action via `LocationPopover`.
- **`coordinateUncertainty`, `cameraID`, `cameraModel`, deployment
  dates.** Schema-present, CSV-absent in v1. Untouched by import.
- **Intra-`locationID` coord divergence in CSV.** Allowed. Each row's
  coords applied independently. Matches inline-drag behavior, which is
  the only path that produces this state today (and per the data
  audit, no study currently exhibits it).
- **Very large CSV.** Studies with thousands of deployments are
  supported via TanStack virtualizer in the preview table. Parse is
  O(n); single DB query for the existing-deployments Map keeps the
  lookup O(1) per row. No streaming needed at expected sizes (<50K
  rows).
- **Transaction failure.** If the apply transaction throws (constraint
  violation, locked DB), main returns `{ success: false, error }`. The
  modal stays open with an inline error banner; the user can dismiss
  or retry.

## Testing

| Layer | Tests |
| --- | --- |
| `deploymentsCsv.js` parse | Unit tests against fixtures: happy path, empty cells, out-of-range coords, non-numeric coords, unknown deploymentID, duplicate rows, intra-locationID name conflicts, missing `deploymentID` column. |
| `deploymentsCsv.js` export | Unit test that exporting a known DB state produces a CSV byte-for-byte; round-trip test that re-parsing produces an all-`unchanged` payload. |
| `applyDeploymentsCsv.js` | Integration tests against a temp SQLite DB: transaction rollback on synthetic failure (e.g. mocked failing query), name propagation across locationID groups, no-op when plan is empty, defensive re-validation drops out-of-range values. |
| Preview modal | RTL tests: warning cells render `⚠` glyph and tooltip on hover; skipped rows render dimmed; `[Apply]` disables at `applyCount === 0`; Esc cancels; Enter does not apply. |
| E2E (optional, time-permitting) | One Playwright test: export a CSV, modify a cell in fixture, re-import, open preview, click Apply, verify the map marker moved and the cache was invalidated. |

## Open questions

1. **File dialog starting directory.** Filesystem default (no
   per-study memory) for v1. If users complain, cross-session memory
   can be added later.

2. **Dark mode colors.** Reuse existing semantic tokens —
   `text-green-700` / `text-green-300` for change; `text-amber-700` /
   `text-amber-300` for warning; `text-muted-foreground` for skipped.
   No new tokens introduced.

3. **Modal vs. drawer.** Modal chosen for v1: the preview is a
   one-shot decision, not a workspace. If the table grows complex (v2:
   inline cell editing in preview), a side drawer might fit better.

## File touch summary

```
src/main/services/import/parsers/deploymentsCsv.js   (new)
src/main/services/import/applyDeploymentsCsv.js      (new)
src/main/services/export/deploymentsCsv.js           (new)
src/main/ipc/deploymentsCsv.js                       (new)
src/main/ipc/index.js                                (register module)
src/preload/index.js                                 (expose 4 IPC methods)
src/renderer/src/deployments/DeploymentsCsvMenu.jsx              (new)
src/renderer/src/deployments/DeploymentsImportPreviewModal.jsx   (new)
src/renderer/src/deployments.jsx                                 (mount menu)
docs/ipc-api.md                                                  (document handlers)
docs/import-export.md                                            (new section)
docs/data-formats.md                                             (CSV shape)
```
