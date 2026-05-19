# GBIF Import — Worker Thread + Chunked Expansion Progress

**Status:** Draft
**Issue:** [#509](https://github.com/earthtoolsmaker/biowatch/issues/509) — "Import: Linking observations to media does not show progress and freeze UI thread"
**Scope:** GBIF (CamtrapDP) only. LILA is out of scope.

## Problem

During GBIF imports, the post-CSV-ingest step `expandObservationsToMedia` (in `src/main/services/import/parsers/camtrapDP.js`) runs on the main process and executes large synchronous SQL statements via `better-sqlite3`. Two user-visible symptoms result:

1. **No progress shown.** The phase emits exactly two progress events — one at the start (`insertedRows: 0`) and one at the end (`insertedRows: pairCount`). Between them the modal sits at "Linking observations to media… 0%" for the duration.
2. **UI thread freezes.** `better-sqlite3` is fully synchronous; while a statement runs, the main process event loop is blocked. IPC stalls, Cancel doesn't respond, and even the start/end progress events arrive coalesced after the freeze.

The CSV-ingest phase of the same import has the same freeze characteristic (smaller per-batch, more frequent). Other heavy-SQL paths in the codebase (merge, sequences, deployments analytics) already run in worker threads precisely to avoid this.

## Goal

Eliminate UI freeze for the entire GBIF import and surface real, tickable progress during the "Linking observations to media" phase.

## Non-goals

- LILA import. Same underlying mechanism applies, but addressed separately.
- Changes to the renderer-side progress modal. Progress payload shape is unchanged.
- Optimising the SQL itself for raw throughput. The chunked rewrite is for progress visibility, not speed.

## Architecture

```
IPC handler (main)                          Worker thread (new)
─────────────────────                       ───────────────────
import:gbif-dataset
  ├─ download (main, AbortSignal)
  ├─ extract  (main, AbortSignal)
  ├─ spawn camtrapDPWorker ──────────────►  receives { camtrapDpDirPath, dbPath, biowatchDataPath, id, options }
  │     ◄──── postMessage {type:'progress'}  runs importCamTrapDatasetWithPath(
  │     ◄──── postMessage {type:'progress'}    ..., onProgress: post → main
  │     ◄──── postMessage {type:'progress'}  )
  │     ◄──── postMessage {type:'result'}
  │  on signal abort: worker.terminate()
  │  on AbortError / failure: cleanupStudy(id) (existing)
  └─ forwards onProgress → sendGbifImportProgress → renderer
```

**Boundary:** download and zip extraction stay on main (already non-blocking I/O). The worker hosts the entire `importCamTrapDatasetWithPath` call — CSV ingest *and* expansion.

**Cancellation:** `worker.terminate()` (mirroring `merge/worker.js`). The existing `cleanupStudy(id)` in the IPC handler's AbortError branch wipes the partial study directory. No need to thread `AbortSignal` through the worker.

**DB-handle isolation:** The IPC handler never opens the study DB itself on the GBIF path (verified). The worker opens it via `getStudyDatabase(id, dbPath)`, runs the import (including metadata insert), and closes on exit. No WAL contention.

## File-level component plan

### New files

#### `src/main/services/import/parsers/camtrapDPWorker.js`

Worker entry point. Mirrors `src/main/services/merge/worker.js`.

```js
import { parentPort, workerData } from 'worker_threads'
import { importCamTrapDatasetWithPath } from './camtrapDP.js'

try {
  const result = await importCamTrapDatasetWithPath(
    workerData.camtrapDpDirPath,
    workerData.biowatchDataPath,
    workerData.id,
    (payload) => parentPort.postMessage({ type: 'progress', payload }),
    workerData.options
  )
  parentPort.postMessage({ type: 'result', result })
} catch (error) {
  parentPort.postMessage({ type: 'error', error: error.message })
}
```

#### `src/main/services/import/runCamtrapImportInWorker.js`

Wrapper that spawns the worker and exposes a Promise-returning API. Routes progress messages, handles abort.

```js
runCamtrapImportInWorker({
  camtrapDpDirPath,    // string
  id,                  // string (study UUID)
  biowatchDataPath,    // string (computed on main via getBiowatchDataPath())
  options,             // { nameOverride, importFolderOverride }
  onProgress,          // (payload) => void   forwarded to sendGbifImportProgress
  signal               // AbortSignal — listener calls worker.terminate() on abort
}) → Promise<{ data, synthesized, dbPath }>
```

Behaviour:
- Spawns `Worker(camtrapDPWorker.js, { workerData: { ... } })`.
- On `{type:'progress'}` → invoke `onProgress(payload)`.
- On `{type:'result'}` → resolve with the payload.
- On `{type:'error'}` → reject with `new Error(error)`.
- On `signal.abort` → call `worker.terminate()`, reject with `new DOMException('Import cancelled', 'AbortError')`. The existing IPC catch block (`import.js:689`) handles AbortError → `cleanupStudy(id)` unchanged.
- On worker `exit` with non-zero code without prior result/error → reject with a generic worker-died error.

### Modified files

#### `src/main/services/import/parsers/camtrapDP.js`

`importCamTrapDataset` and `importCamTrapDatasetWithPath` — **no signature changes**. The worker calls `importCamTrapDatasetWithPath` directly with `biowatchDataPath` from `workerData`.

`expandObservationsToMedia` — replace the single `INSERT … SELECT` and two pre-flight COUNTs with a temp-table + paginated batched-insert loop. Wrap body in `try/finally` to drop the temp table on any exit path. Add an optional third parameter `batchSize = 5000` so tests can exercise the loop with small fixtures. Full code in [Chunked expansion](#chunked-expansion) below.

#### `src/main/ipc/import.js`

Inside the `import:gbif-dataset` handler, at the existing call to `importCamTrapDataset` (around line 624):

```diff
-const { data, synthesized } = await importCamTrapDataset(
-  camtrapDpDirPath, id,
-  (csvProgress) => { sendGbifImportProgress({...}) },
-  { signal, nameOverride: datasetTitle, importFolderOverride: null }
-)
+const { data, synthesized } = await runCamtrapImportInWorker({
+  camtrapDpDirPath,
+  id,
+  biowatchDataPath: getBiowatchDataPath(),
+  options: { nameOverride: datasetTitle, importFolderOverride: null },
+  onProgress: (csvProgress) => { sendGbifImportProgress({...}) },
+  signal
+})
```

The `{ signal }` no longer goes inside `options` (it lives at the wrapper level now). `getBiowatchDataPath` import is added at the top of the file.

### Files NOT touched

- `src/main/services/import/parsers/lila.js` — out of scope.
- `src/main/services/progress.js`, `src/preload/index.js`, `src/renderer/src/import.jsx` — progress payload shape unchanged, no renderer changes.
- `src/main/database/manager.js` — worker opens its own DB handle independently.

## Chunked expansion

Replace `expandObservationsToMedia` with a temp-table + rowid-cursor loop. All SQL stays on Drizzle's `db.run(sql\`\`)` / `db.all(sql\`\`)` to match the function's existing style.

```js
export async function expandObservationsToMedia(db, onProgress = null, batchSize = 5000) {
  // Defensive: clear any stale temp from a prior failed call on this connection.
  await db.run(sql`DROP TABLE IF EXISTS __expansion_pairs`)

  // 1. Materialize the join once into a temp table.
  await db.run(sql`
    CREATE TEMP TABLE __expansion_pairs AS
    SELECT o.observationID AS src_obs,
           m.mediaID,
           o.deploymentID, o.eventID, o.eventStart, o.eventEnd,
           o.scientificName, o.observationType, o.commonName,
           o.classificationProbability, o.count, o.lifeStage, o.age, o.sex,
           o.behavior, o.bboxX, o.bboxY, o.bboxWidth, o.bboxHeight,
           o.detectionConfidence, o.modelOutputID, o.classificationMethod,
           o.classifiedBy, o.classificationTimestamp
    FROM observations o
    INNER JOIN media m
      ON o.deploymentID = m.deploymentID
     AND m.timestamp >= o.eventStart
     AND m.timestamp <= COALESCE(o.eventEnd, o.eventStart)
    WHERE o.mediaID IS NULL
  `)

  try {
    // 2. Single COUNT replaces the two pre-flight COUNTs.
    const [{ pairCount, originalCount }] = await db.all(sql`
      SELECT COUNT(*) AS pairCount,
             COUNT(DISTINCT src_obs) AS originalCount
      FROM __expansion_pairs
    `)

    if (pairCount === 0) {
      log.info('No observation-media pairs found - skipping expansion step')
      return { expanded: 0, created: 0 }
    }

    log.info(`Found ${pairCount} observation-media pairs from ${originalCount} original observations`)

    if (onProgress) {
      onProgress({
        currentFile: 'Linking observations to media...',
        fileIndex: 0, totalFiles: 1,
        totalRows: pairCount, insertedRows: 0,
        phase: 'expanding'
      })
    }

    // 3. Batched INSERTs with rowid cursor.
    let cursor = 0
    let inserted = 0
    while (inserted < pairCount) {
      const result = await db.run(sql`
        INSERT INTO observations (
          observationID, mediaID, deploymentID, eventID, eventStart, eventEnd,
          scientificName, observationType, commonName, classificationProbability, count,
          lifeStage, age, sex, behavior, bboxX, bboxY, bboxWidth, bboxHeight,
          detectionConfidence, modelOutputID, classificationMethod, classifiedBy, classificationTimestamp
        )
        SELECT
          lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
            substr(hex(randomblob(2)),2) || '-' ||
            substr('89ab', abs(random()) % 4 + 1, 1) ||
            substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
          mediaID, deploymentID, eventID, eventStart, eventEnd,
          scientificName, observationType, commonName, classificationProbability, count,
          lifeStage, age, sex, behavior, bboxX, bboxY, bboxWidth, bboxHeight,
          detectionConfidence, modelOutputID, classificationMethod, classifiedBy, classificationTimestamp
        FROM __expansion_pairs
        WHERE rowid > ${cursor}
        ORDER BY rowid
        LIMIT ${batchSize}
      `)
      const batchChanges = Number(result.changes ?? 0)
      if (batchChanges === 0) break  // safety: prevent infinite loop if nothing was inserted
      inserted += batchChanges
      cursor += batchChanges

      if (onProgress) {
        onProgress({
          currentFile: 'Linking observations to media...',
          fileIndex: 0, totalFiles: 1,
          totalRows: pairCount, insertedRows: inserted,
          phase: 'expanding'
        })
      }
    }

    // 4. Delete original event-based observations that were expanded.
    //    Joining against the temp table is cheaper than re-running the full timestamp-range join.
    await db.run(sql`
      DELETE FROM observations
      WHERE mediaID IS NULL
        AND EXISTS (
          SELECT 1 FROM __expansion_pairs p WHERE p.src_obs = observations.observationID
        )
    `)

    log.info(
      `Expanded ${originalCount} event-based observations into ${pairCount} media-linked observations`
    )
    return { expanded: originalCount, created: pairCount }
  } finally {
    // 5. Always drop the temp table — success, error, or anywhere in between.
    await db.run(sql`DROP TABLE IF EXISTS __expansion_pairs`)
  }
}
```

### Why this addresses both symptoms

- **Progress ticks:** `onProgress` fires once per batch, e.g. ~200 events for a 1M-pair dataset at `BATCH_SIZE=5000`. The renderer sees a steadily incrementing `insertedRows / totalRows`.
- **No freeze:** Because the function runs in a worker thread, the main event loop stays free. Progress messages flush to the renderer immediately. The Cancel button is responsive throughout.

### Why `BATCH_SIZE = 5000`

- Large enough that SQLite per-statement overhead (parse, plan, journal) is amortised — INSERT throughput stays near single-statement performance.
- Small enough that, on a typical large dataset (~1M pairs), the user sees ~200 ticks — plenty for a smooth progress bar.
- A single batch worst-case takes well under a second on commodity SSDs, so the worker's response to a kill is near-instant even mid-batch.

### Temp-table cleanup on cancellation

Two independent guarantees, no explicit teardown needed:

1. **SQLite TEMP TABLEs are per-connection.** They live in SQLite's `temp` database, attached only to the connection that created them. When the worker is terminated, its better-sqlite3 handle is force-closed; the temp database and its backing storage (in-memory or an unlinked `etilqs_*` file in OS temp dir) are released by the kernel.
2. **`cleanupStudy(id)` wipes the study directory on abort** (existing behaviour at `import.js:693`). The TEMP table doesn't live in `study.db` so this is belt-and-suspenders, but it means no cross-import state can leak.

The `try/finally` in the function above is purely defensive — it handles the case where `expandObservationsToMedia` is called from a non-worker context in the future and an error fires mid-loop on a long-lived connection.

## Testing strategy

Test runner: `node --test 'test/**/*.test.js'` (built-in). Style: `import { test, beforeEach, afterEach, describe } from 'node:test'` + `import assert from 'node:assert/strict'`. Mirrors existing files like `test/integration/import/camtrapDP-event-expansion.test.js`.

### Unit: chunked expansion

`test/main/services/import/parsers/expandObservationsToMedia.test.js` — new file.

Construct a Drizzle-wrapped better-sqlite3 in-memory DB with the project's schema (use `getStudyDatabase` against a tmpdir path, or mount the migrations directly — pick whichever existing helper the codebase uses; check `test/main/services/import/lila.test.js` for the established pattern).

- **Multiple batches:** Seed 350 event-based observations + matching media (e.g., 1 deployment, 350 media within event window, 1 event observation per media — or fewer observations covering more media each, as long as the JOIN yields ≥ 350 pairs). Call `expandObservationsToMedia(db, onProgress, /* batchSize */ 100)`. Assert:
  - Progress callback fired at least 4 times (initial 0 + ≥3 batches).
  - `insertedRows` is monotonically non-decreasing.
  - Final inserted count equals `pairCount`.
  - Original event-based observations are deleted.
- **No pairs (empty case):** observations without matching media → no inserts, no DELETE, returns `{expanded: 0, created: 0}`.
- **Single batch:** 50 pairs with `batchSize=100` → exactly one batch, one progress tick (post initial).
- **Temp table cleanup:** Inspect `sqlite_temp_master` after a successful call → `__expansion_pairs` is gone.

### Integration: existing event-expansion test extended

`test/integration/import/camtrapDP-event-expansion.test.js` — modify.

Today it asserts the final post-expansion DB state. Add one new `test(...)` inside the same `describe` block that passes an `onProgress` spy into `importCamTrapDatasetWithPath` and asserts that at least one `phase === 'expanding'` event was emitted with a non-zero `insertedRows`. This catches regressions where the chunked loop stops emitting progress.

### Worker wrapper and cancellation: manual smoke, not unit-tested

The wrapper (`runCamtrapImportInWorker.js`) and worker entry (`camtrapDPWorker.js`) are treated as boilerplate, mirroring `src/main/services/sequences/runInWorker.js` and `src/main/services/merge/worker.js` — neither is unit-tested in this codebase. The synchronous core (`importCamTrapDatasetWithPath` and `expandObservationsToMedia`) is fully covered by the unit + integration tests above.

The worker spawn path and AbortSignal → `worker.terminate()` cancellation are verified by manual smoke testing:

1. Launch the app and trigger a GBIF import of a non-trivial dataset (≥10k observations so the linking phase takes more than a second).
2. Confirm progress ticks during "Linking observations to media…", the UI stays responsive, and the Cancel button responds immediately.
3. Cancel mid-linking and confirm the study disappears from the Studies list with no worker-crash entries in the Electron log.

### No new e2e

The existing Electron-launched GBIF flow doesn't need a new e2e test for this change. The worker move is transparent to the renderer (same progress payload shape).

## Rollout / commit cadence

Single PR, three logical commits:

1. **`refactor(import): chunk expandObservationsToMedia for progress ticks`** — pure change to one function + its unit tests. Standalone-mergeable. Already an improvement (progress ticks) even before the worker move; the freeze remains.
2. **`feat(import): run CamtrapDP import in worker thread`** — adds `camtrapDPWorker.js` and `runCamtrapImportInWorker.js`, swaps the IPC handler. Closes the freeze.
3. **`test(import): cancellation and progress streaming for camtrap worker`** — wrapper-level tests including AbortSignal → terminate.

## Documentation updates

Per CLAUDE.md guidance, when this lands the following docs need touching:
- `docs/architecture.md` — note that GBIF import now runs in a worker, parallel to merge.
- `docs/ipc-api.md` — no IPC surface change, but mention the worker boundary in any relevant section.
- `docs/import-export.md` — describe the worker boundary and the chunked expansion step.

## Risks

- **`better-sqlite3` in worker threads.** Already proven by `merge/worker.js` and `sequences/worker.js`. No new ground.
- **Worker startup cost.** ~10–50ms one-time per import. Negligible vs. the multi-second-to-minute import duration.
- **`electron-log` in worker.** `electron-log` works in worker threads (file transport). Already used by `merge/worker.js` indirectly via `merge/index.js` imports. No risk.
- **`getBiowatchDataPath()` not callable from worker** (uses Electron's `app.getPath`). Mitigation: main computes it once via `getBiowatchDataPath()` and passes it through `workerData`. The worker calls `importCamTrapDatasetWithPath` (the explicit-path overload that already exists), bypassing `getBiowatchDataPath` entirely.

## Out of scope follow-ups

- Apply the same worker treatment to LILA imports (`src/main/services/import/parsers/lila.js`). The freeze symptom exists there too during `batchInsert` transactions but is less acute.
- Apply the same treatment to local-folder media import (`src/main/services/import/importer.js`) which also does synchronous bulk inserts on main during initial scan.
