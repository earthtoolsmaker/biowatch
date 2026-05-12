# Stub orphan-FK deployments at CamTrap-DP import time — design

**Date:** 2026-05-06
**Status:** Approved (pending implementation plan)

## Goal

Make the CamTrap-DP importer tolerant of datasets where `media.csv` (or
`observations.csv`) references `deploymentID`s that are missing from
`deployments.csv`. Today the import aborts mid-batch with
`SqliteError: FOREIGN KEY constraint failed`, losing the entire study. After
this change, the importer synthesizes minimal stub deployment rows so the FK
holds and the import completes, preserving the orphan media/observation rows.

This is a generic CamTrap-DP parser fix. It happens to unblock
`f0963153-077b-4676-a337-891a06fab52a` (Forest First Mammals, Colombia) on
GBIF, so that dataset can be removed from `GBIF_UNAVAILABLE`. The parser is
shared by GBIF imports, folder-picked CamTrap-DP packages, and any future
CamTrap-DP source.

## Non-goals

- Synthesizing stub `media` rows for observations whose `mediaID` is missing.
  Media rows have file paths, mediatype, EXIF, etc. that cannot be fabricated;
  observations with missing `mediaID` are dropped instead (counted, logged).
- Marking stubs in the data with a flag column, badge, or comment. The schema
  has no `synthesized` column today and the renderer has no UI for surfacing
  one. Stubs are visually distinguishable in normal use only by their NULL
  lat/lon (no map pin).
- Post-import cleanup that deletes "empty" deployments. Zero-detection
  deployments are valid camera-trap data and must not be silently dropped.
- A user-facing prompt or confirmation dialog. The recovery is silent (per
  product decision); awareness is carried by the import-complete toast and the
  warning log only.
- Changes to the LILA, Wildlife Insights, or DeepFaune importers — none of
  them go through this code path.

## Background

### What breaks today

`importCamTrapDatasetWithPath` in `src/main/services/import/parsers/camtrapDP.js`
inserts CSV files in dependency order: deployments → media → observations
(`camtrapDP.js:91-96`). Inserts use a transaction-wrapped bulk inserter
(`createBulkInserter`, `camtrapDP.js:266`) that batches 2000 rows.

The schema FK is in `src/main/database/models.js:47`:

```js
deploymentID: text('deploymentID').references(() => deployments.deploymentID),
```

`PRAGMA foreign_keys = ON` is active in import mode, so the first batch
containing a `media.deploymentID` not present in `deployments` throws
`SqliteError: FOREIGN KEY constraint failed`. `better-sqlite3`'s `transaction`
wrapper rolls back the batch; the exception bubbles to the IPC handler at
`src/main/ipc/import.js:753`, which surfaces "Import failed" to the user.

### Concrete case (Forest First Mammals, Colombia)

Downloaded from `https://ipt.biodiversidad.co/sib/archive.do?r=panthera_camtrap-v2`:

- `deployments.csv` — 88 rows, all with valid IDs (`FFB001A`, `FFB002`, …).
- `media.csv` — 8,349 rows. **1,571 (18.8%)** reference 9 deploymentIDs that
  do not appear in `deployments.csv`:

  | Orphan deploymentID | Orphan media rows |
  | ------------------- | ----------------- |
  | `FFB034`            | 446               |
  | `FFB033`            | 322               |
  | `FFB035`            | 268               |
  | `FFB006A`           | 174               |
  | `FFB032`            | 134               |
  | `Segundo muestreo`  | 95                |
  | `FFB030`            | 53                |
  | `FFB031`            | 45                |
  | `FFP021`            | 34                |

  Eight of the nine match the dataset's normal `FFB###` / `FFP###` naming —
  almost certainly real cameras the curator forgot to register. One
  (`Segundo muestreo`, Spanish for "Second sampling") is a placeholder string
  typed into the deploymentID field by mistake.

- `observations.csv` — 2,258 rows. Clean (zero orphan deploymentIDs, zero
  mediaID references at all — all event-level observations).

The current behavior loses the entire study. The lenient drop-orphan
alternative would silently discard 1,571 wildlife photos including ~1,476
likely-legitimate ones. Stubbing preserves them at the cost of 9 deployments
with NULL location.

## Architecture

A pre-pass over `media.csv` and `observations.csv`, run after
`deployments.csv` finishes inserting and before `media.csv` starts, that
collects orphan `deploymentID`s, derives a time window per orphan from
available timestamps, and inserts synthesized deployment rows.

No schema migration. No renderer changes. One new helper module, one new
hook into `importCamTrapDatasetWithPath`, plus a small extension to the IPC
import-complete payload.

### Synthesized row shape

For each orphan `deploymentID`:

```
deploymentID:           <orphan ID>
locationID:             <orphan ID>          ← reuse deploymentID; required for
                                               grouping (groupDeployments.js:28)
                                               and inline-rename
                                               (deployments.js:188) to work
locationName:           NULL
deploymentStart:        MIN(timestamp) across orphan media + obs eventStart
deploymentEnd:          MAX(timestamp) across orphan media + obs eventEnd
latitude:               NULL
longitude:              NULL
cameraModel:            NULL
cameraID:               NULL
coordinateUncertainty:  NULL
```

`locationID = deploymentID` matches the convention real CamTrap-DP datasets
use when there is no separate location concept (Forest First's `FFB001A`
deployment has `locationID = "FFB001A"`, `locationName = "FFB001A"`).
Without it, the row would render as literal "Unnamed Location" in the
deployments tab and the inline rename IPC would no-op (`UPDATE WHERE
locationID = NULL` matches zero rows in SQLite).

If neither media nor observations carry a parseable timestamp for an orphan
ID (degenerate case), `deploymentStart` and `deploymentEnd` stay NULL — the
recently-merged "deployments without timestamps" handling
(`baeb800`) renders these gracefully.

### New helper — `src/main/services/import/parsers/orphanDeployments.js`

One pure function:

```js
collectOrphanDeployments({
  directoryPath,
  knownDeploymentIDs,   // Set<string> — the IDs just inserted from deployments.csv
  signal,               // AbortSignal
}): Promise<Map<string, { start: string|null, end: string|null, mediaCount: number, obsCount: number }>>
```

Streams `media.csv` and `observations.csv` (when each exists) once, accumulating
per-orphan-ID stats. Memory is bounded by the number of distinct orphan IDs
(usually <100), not row count. CSV streaming uses the same `csv-parser` setup
as `insertCSVData`. Honours `signal.aborted`.

Timestamp parsing: ISO-8601 lex compare is sufficient — CamTrap-DP timestamps
are normalized strings; `MIN`/`MAX` by string ordering yields the same result
as date comparison and is allocation-free.

### Hook in `camtrapDP.js`

Insert order becomes:

1. `deployments.csv` — unchanged.
2. **`collectOrphanDeployments(...)`** — pre-pass over media + observations.
3. **Insert synthesized deployment rows** in one transaction (reusing
   `createBulkInserter` for the `deployments` table).
4. `media.csv` — unchanged.
5. `observations.csv` — unchanged for the deploymentID FK (now satisfied);
   gain a row-level filter that drops observation rows whose `mediaID` is
   non-empty and not in the inserted set, counting drops for the report.

The orphan media/observation rows themselves are inserted normally — the FKs
now resolve.

The pre-existing `expandObservationsToMedia` post-process (`camtrapDP.js:179`)
runs unchanged.

### Reporting

`importCamTrapDatasetWithPath` returns an extended object:

```js
{
  dbPath,
  data: metadataRecord,
  synthesized: {
    deployments: <count>,           // number of stub deployments inserted
    orphanMediaRows: <count>,       // total media rows whose deploymentID was orphan
    orphanObservationRows: <count>, // total obs rows whose deploymentID was orphan
    droppedObservationRows: <count> // obs rows dropped due to missing mediaID
  }
}
```

`synthesized.deployments === 0` is the common case — fields stay zero, no
behavior change downstream.

The GBIF IPC handler (`src/main/ipc/import.js:656`) and the folder-import
handler each forward `synthesized` to:

- The `complete`-stage progress payload (`sendGbifImportProgress`), so the
  renderer can render a non-blocking toast like _"Imported with N synthesized
  deployments from M orphan media rows."_ Toast UX is the renderer's call;
  this spec only commits to surfacing the counts.
- A `log.warn` line listing each synthesized `deploymentID` and its row counts
  (one log line per stub, capped at e.g. 50 IDs to avoid log flooding on
  pathological datasets).

### Diagnostic logs

- `log.info('Pre-scanning media.csv and observations.csv for orphan deploymentIDs')`
- `log.warn('Synthesized stub deployment <ID> from <N> media rows / <M> obs rows; time window <start>..<end>')` per stub.
- `log.warn('Dropped <N> observation rows referencing missing mediaIDs')` if any.

### Data flow

```
deployments.csv ──insert──▶ deployments table
                                   │
                                   ▼
                       knownDeploymentIDs (Set)
                                   │
        media.csv ─stream─┐        │
                          ▼        ▼
        observations.csv ─stream──▶ collectOrphanDeployments()
                                              │
                                              ▼
                      orphans: Map<id, {start, end, counts}>
                                              │
                                              ▼
                              insert stub deployment rows
                                              │
        media.csv ──insert──▶ media table  ◀──┘  (FKs now resolve)
        observations.csv ──insert──▶ observations table
```

### GBIF blacklist removal

After this change, remove `f0963153-077b-4676-a337-891a06fab52a` (Forest First
Mammals) from `GBIF_UNAVAILABLE` in `src/shared/gbifTitles.js:27`. The other
five entries remain (different failure modes — no CAMTRAP_DP endpoint or
Cloudflare bot challenge — which this spec does not address).

While here: also remove `13101e81-bc62-4553-9fd9-c5c8eb3fb9ab` (Norwegian
Alpine Tundra Rodents). Manual verification on 2026-05-06 shows the
`https://ipt.nina.no/archive.do?r=rodent_2025` endpoint now returns HTTP 200
(the 403 noted in the comment is stale).

## Testing

New file: **`test/main/services/import/parsers/orphanDeployments.test.js`**
(unit tests for `collectOrphanDeployments`).

Pure unit tests, no DB. Cases:

- Empty deployments set + empty media → empty result.
- All media reference known deployments → empty result.
- Mixed: some orphan, some valid → only orphan IDs in result, with correct
  per-ID `mediaCount` and `start`/`end` from min/max timestamp.
- Observation eventStart/End contributes when no media row covers an orphan ID.
- Observation eventStart/End extends the window beyond media's bounds when
  both contribute to the same orphan.
- Orphan ID with all-empty timestamps → entry exists, `start`/`end` are NULL.
- `signal.aborted` mid-stream → rejects with `AbortError`.

New file: **`test/main/services/import/parsers/camtrapDP-orphan.test.js`**
(integration test for the parser end-to-end).

Uses real SQLite (in-memory or temp file). Fixture: a tiny synthetic
CamTrap-DP folder with:

- 2 valid deployments
- 5 media rows, 2 referencing a third "missing" deploymentID
- 2 observations referencing the same missing deploymentID
- 1 observation referencing a non-existent mediaID

Assertions after `importCamTrapDatasetWithPath`:

- `deployments` table has 3 rows (2 real + 1 stub).
- Stub row has `locationID = deploymentID`, `locationName = NULL`, `latitude
= NULL`, `longitude = NULL`.
- Stub `deploymentStart` / `deploymentEnd` match expected min/max from the
  fixture.
- `media` table has all 5 rows.
- `observations` table has 2 rows (the missing-mediaID one was dropped).
- Returned `synthesized` has `{ deployments: 1, orphanMediaRows: 2,
orphanObservationRows: 2, droppedObservationRows: 1 }`.

Existing CamTrap-DP parser tests: re-run unchanged, must still pass (the
no-orphan path is unchanged).

## Edge cases & accepted trade-offs

- **`Segundo muestreo`-style garbage IDs** become first-class deployment rows
  in the UI, indistinguishable from real-but-incomplete deployments except for
  their absence from the map. Accepted: no programmatic heuristic catches
  curator typos without false positives, and the cost (one extra row to
  manually delete) is small.
- **Stub `locationID` collision**: if the curator coincidentally has a real
  `locationID` equal to an orphan `deploymentID`, the stub row joins that
  location group. Extremely unlikely (CamTrap-DP `deploymentID` is per-camera-
  per-deployment-window; `locationID` is a site name). Accepted.
- **Memory**: pre-pass holds one entry per distinct orphan ID. Pathological
  case is a totally broken dataset where every media row points to a unique
  missing ID — bounded by total media row count, but practical datasets stay
  under ~100 distinct orphans. Streaming, not loading, the CSVs.
- **Two-pass cost on media.csv**: media.csv is now read twice (once for orphan
  detection, once for insert). For Forest First's 8,349 rows the overhead is
  negligible; for million-row datasets it adds a few seconds. Acceptable.
  Optimisation (single-pass, defer FK enforcement to commit time, then check)
  is possible but materially more complex; not worth it now.
- **`PRAGMA foreign_keys` semantics**: SQLite supports `PRAGMA defer_foreign_keys`
  to defer FK checks to commit. Considered and rejected: the current "fail
  early at the offending row" behaviour is useful for non-CamTrap-DP code
  paths and the pre-pass approach keeps validation explicit and reportable.
- **Observation rows with missing `mediaID`** are dropped, not stub-mediated.
  Synthesizing media rows would require fabricating `filePath`, `fileName`,
  `fileMediatype`, etc., which silently produces unusable records. Drop +
  count + log is the honest behaviour.

## Documentation updates

- **`docs/import-export.md`** — under the CamTrap-DP section, add a paragraph
  noting that the importer auto-recovers from datasets whose `media.csv` /
  `observations.csv` reference unknown `deploymentID`s by synthesizing minimal
  stub deployments with NULL location and a time window derived from the
  referencing rows. Surface the import-complete report fields.
- **`docs/data-formats.md`** — note that synthesized stub deployments are
  written with `locationID = deploymentID` and otherwise NULL non-temporal
  fields.
- **`docs/troubleshooting.md`** — replace any "FOREIGN KEY constraint failed
  on CamTrap import" entry with the new behaviour, or add one if absent.

No changes needed to `database-schema.md` (no schema change), `ipc-api.md`
(payload extension is additive — existing `complete` shape is a superset),
`architecture.md`, or `development.md`.

## Out of scope (explicitly)

- Backfilling existing study databases that were imported with rows already
  silently lost or with imports that previously aborted. Re-importing the
  dataset is sufficient.
- A renderer "synthesized" badge or filter on the deployments tab.
- The other five GBIF blacklist entries: Snapshot Japan 2023 (Cloudflare
  challenge), Wet Tropics QLD / Wombat Burrows / VIC-NSW Gigafire (only
  `DWC_ARCHIVE` endpoints, no CAMTRAP_DP). Each is a separate failure mode
  needing its own design.
- Synthesizing stub `media` rows.
- Replacing the FK-on bulk insert with a deferred-FK / IGNORE / UPSERT model.
- Restructuring import errors to be partial-success rather than all-or-nothing
  (this fix preserves the all-or-nothing model; either the import succeeds
  with a stub-deployment report, or it fails for a different reason).
