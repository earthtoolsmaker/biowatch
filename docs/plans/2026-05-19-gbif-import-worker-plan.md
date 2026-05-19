# GBIF Import Worker + Chunked Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate UI freeze during large GBIF imports and surface real per-batch progress during the "Linking observations to media" phase.

**Architecture:** Move the synchronous CamtrapDP import into a worker thread (mirroring `src/main/services/merge/worker.js`), and replace the single big `INSERT…SELECT` in `expandObservationsToMedia` with a temp-table + paginated batched-insert loop that emits `onProgress` per batch.

**Tech Stack:** Electron + Node.js `worker_threads`, `better-sqlite3`, `drizzle-orm`, `node:test`.

**Spec:** `docs/specs/2026-05-19-gbif-import-worker-design.md`

---

## Test prerequisites

The project uses `better-sqlite3`, which ships separate native binaries for Node and Electron. Before iterating on individual tests:

```bash
npm run test:rebuild        # rebuild for Node
```

After test iteration, restore the Electron binary:

```bash
npm run test:rebuild-electron
```

`npm test` does both around a full test run (slower). For iteration use `node --test <file>` after rebuilding once.

## Commit cadence

Two feature commits + one docs commit:

1. **Task 1 + Task 2:** `refactor(import): chunk expandObservationsToMedia for progress ticks`
2. **Task 3 + Task 4 + Task 5:** `feat(import): run CamtrapDP import in worker thread`
3. **Task 6:** `docs: note camtrap import worker boundary`

The wrapper and worker entry are treated as boilerplate, mirroring `src/main/services/sequences/runInWorker.js` and `src/main/services/merge/worker.js` — neither is unit-tested in this codebase. The synchronous core (`importCamTrapDatasetWithPath` and `expandObservationsToMedia`) is fully covered by Tasks 1 and 2. Cancellation and end-to-end worker behavior are verified by manual smoke testing (see the self-review checklist).

---

### Task 1: Chunked `expandObservationsToMedia`

Replace the single `INSERT…SELECT` and two pre-flight COUNTs with a temp-table + paginated batched-insert loop. Add an optional `batchSize` parameter so tests can exercise the loop with small data. Wrap the body in `try/finally` to drop the temp table on any exit path.

**Files:**
- Modify: `src/main/services/import/parsers/camtrapDP.js` (function `expandObservationsToMedia`, lines 799–929)
- Create: `test/main/services/import/parsers/expandObservationsToMedia.test.js`

- [ ] **Step 1: Create the unit test file with a failing multi-batch test**

Create `test/main/services/import/parsers/expandObservationsToMedia.test.js`:

```js
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  getStudyDatabase,
  closeStudyDatabase,
  deployments,
  media,
  observations
} from '../../../../../src/main/database/index.js'
import { expandObservationsToMedia } from '../../../../../src/main/services/import/parsers/camtrapDP.js'

let testBiowatchDataPath
let studyId
let dbPath

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    // ignore in test env
  }

  testBiowatchDataPath = join(tmpdir(), 'biowatch-expand-test', Date.now().toString() + Math.random())
  mkdirSync(testBiowatchDataPath, { recursive: true })
  studyId = 'test-expand-' + Math.random().toString(36).slice(2)
  dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', studyId), { recursive: true })
})

afterEach(async () => {
  try { await closeStudyDatabase(studyId, dbPath) } catch { /* noop */ }
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seed(db, numMedia, numEventObs) {
  // 1 deployment, numMedia media all within a single 1-hour window,
  // numEventObs event-based observations each covering all media.
  // Pairs = numMedia × numEventObs.
  await db.insert(deployments).values({
    deploymentID: 'd1',
    locationID: 'L1',
    deploymentStart: '2024-01-01T00:00:00Z',
    deploymentEnd: '2024-01-01T01:00:00Z'
  })

  const mediaRows = Array.from({ length: numMedia }, (_, i) => ({
    mediaID: `m${i}`,
    deploymentID: 'd1',
    timestamp: `2024-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`,
    filePath: `/tmp/m${i}.jpg`,
    fileName: `m${i}.jpg`,
    fileMediatype: 'image/jpeg'
  }))
  for (const row of mediaRows) await db.insert(media).values(row)

  for (let i = 0; i < numEventObs; i++) {
    await db.insert(observations).values({
      observationID: `obs-e${i}`,
      mediaID: null,
      deploymentID: 'd1',
      eventID: `event${i}`,
      eventStart: '2024-01-01T00:00:00Z',
      eventEnd: '2024-01-01T01:00:00Z',
      scientificName: 'test species',
      observationType: 'animal'
    })
  }
}

describe('expandObservationsToMedia (chunked)', () => {
  test('emits per-batch progress when pairs > batchSize', async () => {
    const manager = await getStudyDatabase(studyId, dbPath)
    const db = manager.getDb()
    await seed(db, 10, 5)  // 10 × 5 = 50 pairs

    const events = []
    const result = await expandObservationsToMedia(
      db,
      (p) => events.push(p),
      /* batchSize */ 10
    )

    assert.equal(result.created, 50, 'created should equal pairCount')
    assert.equal(result.expanded, 5, 'expanded should equal originalCount')

    // Initial event (insertedRows=0) + at least 5 batch events with insertedRows>0
    const expandingEvents = events.filter((e) => e.phase === 'expanding')
    assert.ok(expandingEvents.length >= 6, `expected ≥6 expanding events, got ${expandingEvents.length}`)

    const insertedSeries = expandingEvents.map((e) => e.insertedRows)
    for (let i = 1; i < insertedSeries.length; i++) {
      assert.ok(insertedSeries[i] >= insertedSeries[i - 1], 'insertedRows must be monotonic non-decreasing')
    }
    assert.equal(insertedSeries[insertedSeries.length - 1], 50, 'final insertedRows should equal pairCount')
  })

  test('returns {0,0} and emits no expanding events when there are no pairs', async () => {
    const manager = await getStudyDatabase(studyId, dbPath)
    const db = manager.getDb()
    // Seed deployment + media but no event-based observations
    await seed(db, 5, 0)

    const events = []
    const result = await expandObservationsToMedia(db, (p) => events.push(p), 10)

    assert.deepEqual(result, { expanded: 0, created: 0 })
    assert.equal(events.filter((e) => e.phase === 'expanding').length, 0)
  })

  test('single batch when pairs ≤ batchSize', async () => {
    const manager = await getStudyDatabase(studyId, dbPath)
    const db = manager.getDb()
    await seed(db, 3, 1)  // 3 pairs

    const events = []
    const result = await expandObservationsToMedia(db, (p) => events.push(p), 100)

    assert.equal(result.created, 3)
    const expandingEvents = events.filter((e) => e.phase === 'expanding')
    // Initial (0) + exactly one batch event
    assert.equal(expandingEvents.length, 2)
    assert.equal(expandingEvents[0].insertedRows, 0)
    assert.equal(expandingEvents[1].insertedRows, 3)
  })

  test('drops the temp table after a successful run', async () => {
    const manager = await getStudyDatabase(studyId, dbPath)
    const db = manager.getDb()
    const sqlite = manager.getSqlite()
    await seed(db, 4, 2)  // 8 pairs

    await expandObservationsToMedia(db, null, 10)

    const tempTables = sqlite.prepare(`SELECT name FROM sqlite_temp_master WHERE type='table'`).all()
    const found = tempTables.find((t) => t.name === '__expansion_pairs')
    assert.equal(found, undefined, '__expansion_pairs temp table should be gone after expansion')
  })
})
```

- [ ] **Step 2: Run the new tests and verify they fail**

```bash
npm run test:rebuild
node --test test/main/services/import/parsers/expandObservationsToMedia.test.js
```

Expected: FAIL. The `monotonic` and `≥6 expanding events` assertions fail because the current implementation emits only 2 events (start and end). Also, the `batchSize` argument is currently ignored.

- [ ] **Step 3: Replace `expandObservationsToMedia` with the chunked implementation**

In `src/main/services/import/parsers/camtrapDP.js`, replace the current `expandObservationsToMedia` function (lines 799–929) with:

```js
/**
 * Expand event-based observations to create one record per matching media.
 * For observations without mediaID (event-based CamTrap DP datasets):
 * 1. Materialize the (observation × media) join into a TEMP TABLE.
 * 2. Batched INSERT loop over the temp table, emitting progress per batch.
 * 3. DELETE the original event-based observations that were expanded.
 * 4. DROP the temp table.
 *
 * @param {Object} db - Drizzle database instance
 * @param {function|null} onProgress - Optional callback for progress updates
 * @param {number} batchSize - Rows inserted per batch (default 5000)
 * @returns {Promise<{expanded: number, created: number}>}
 */
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
    const countRows = await db.all(sql`
      SELECT COUNT(*) AS pairCount,
             COUNT(DISTINCT src_obs) AS originalCount
      FROM __expansion_pairs
    `)
    const pairCount = Number(countRows[0].pairCount)
    const originalCount = Number(countRows[0].originalCount)

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
    //    Joining against the temp table is cheaper than re-running the timestamp-range join.
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

- [ ] **Step 4: Run the unit tests and verify they pass**

```bash
node --test test/main/services/import/parsers/expandObservationsToMedia.test.js
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Run the existing event-expansion integration tests to verify no regression**

```bash
node --test test/integration/import/camtrapDP-event-expansion.test.js
```

Expected: all 8 existing tests PASS (no change in behavior for end-to-end import — only progress granularity changed).

- [ ] **Step 6: Commit**

```bash
git add src/main/services/import/parsers/camtrapDP.js \
        test/main/services/import/parsers/expandObservationsToMedia.test.js
git commit -m "refactor(import): chunk expandObservationsToMedia for progress ticks"
```

---

### Task 2: Progress-emission integration test for end-to-end import

Extend the existing integration suite with one new test that proves `onProgress` is called with `phase === 'expanding'` and `insertedRows > 0` during a real `importCamTrapDatasetWithPath` run. Guards against regressions where the chunked loop stops emitting progress.

**Files:**
- Modify: `test/integration/import/camtrapDP-event-expansion.test.js` (append one new `test(...)` inside the existing `describe` block)

- [ ] **Step 1: Append a new progress-emission test**

Add the following inside the `describe('CamTrapDP Event-Based Observation Expansion', () => { ... })` block in `test/integration/import/camtrapDP-event-expansion.test.js`:

```js
  test('emits onProgress events during the expanding phase', async () => {
    const studyId = 'test-event-progress'
    const events = []
    await importCamTrapDatasetWithPath(
      testCamTrapDataPath,
      testBiowatchDataPath,
      studyId,
      (p) => events.push(p)
    )

    const expandingEvents = events.filter((e) => e.phase === 'expanding')
    assert.ok(expandingEvents.length >= 2, 'should emit at least initial + one batch event for expanding phase')

    const finalExpanding = expandingEvents[expandingEvents.length - 1]
    assert.ok(finalExpanding.insertedRows > 0, 'final expanding event should report inserted rows')
    assert.equal(
      finalExpanding.insertedRows,
      finalExpanding.totalRows,
      'final insertedRows should equal totalRows'
    )
  })
```

- [ ] **Step 2: Run the integration tests**

```bash
node --test test/integration/import/camtrapDP-event-expansion.test.js
```

Expected: all 9 tests (8 existing + 1 new) PASS.

- [ ] **Step 3: Commit (amend into the previous commit)**

```bash
git add test/integration/import/camtrapDP-event-expansion.test.js
git commit --amend --no-edit
```

(This keeps Task 1 + Task 2 as a single `refactor(import): chunk expandObservationsToMedia for progress ticks` commit, matching the spec's commit plan.)

---

### Task 3: Create the worker entry point and register in vite config

Add the worker file and wire it into the electron-vite build so it lands beside the main bundle at runtime (same pattern as `merge-worker.js`).

**Files:**
- Create: `src/main/services/import/parsers/camtrapDPWorker.js`
- Modify: `electron.vite.config.mjs:14-19` (rollup inputs)

- [ ] **Step 1: Create the worker entry point**

Create `src/main/services/import/parsers/camtrapDPWorker.js`:

```js
/**
 * Worker thread entry point for the CamtrapDP / GBIF import.
 *
 * Running the import in a worker isolates `better-sqlite3`'s synchronous
 * transactions from the main process event loop. While the import runs,
 * main stays responsive to IPC (cancel, other UI actions), and progress
 * messages flush to the renderer in real time.
 *
 * Posts back `{ type: 'progress' | 'result' | 'error', ... }` messages.
 */
import { parentPort, workerData } from 'worker_threads'
import { importCamTrapDatasetWithPath } from './camtrapDP.js'

async function run() {
  const result = await importCamTrapDatasetWithPath(
    workerData.camtrapDpDirPath,
    workerData.biowatchDataPath,
    workerData.id,
    (payload) => parentPort.postMessage({ type: 'progress', payload }),
    workerData.options || {}
  )
  return result
}

run()
  .then((result) => parentPort.postMessage({ type: 'result', result }))
  .catch((error) => parentPort.postMessage({ type: 'error', error: error.message }))
```

- [ ] **Step 2: Register the worker as a rollup input**

In `electron.vite.config.mjs`, modify the `rollupOptions.input` object (lines 14–19) to add `'camtrap-import-worker'`:

```js
        input: {
          index: resolve('src/main/index.js'),
          'sequences-worker': resolve('src/main/services/sequences/worker.js'),
          'merge-worker': resolve('src/main/services/merge/worker.js'),
          'merge-preflight-worker': resolve('src/main/services/merge/preflightWorker.js'),
          'camtrap-import-worker': resolve('src/main/services/import/parsers/camtrapDPWorker.js')
        },
```

- [ ] **Step 3: Verify the build succeeds**

```bash
npm run build
```

Expected: build completes without errors. Verify the worker file is emitted by checking the build output:

```bash
ls out/main/camtrap-import-worker.js
```

Expected: file exists.

(No commit yet — the worker isn't called from anywhere. Task 5 wires it up and Task 4 tests it.)

---

### Task 4: `runCamtrapImportInWorker` wrapper

Add the main-side wrapper that spawns the worker, routes messages, and handles abort. Mirrors `src/main/services/sequences/runInWorker.js` — hardcodes the bundle-layout worker path; treated as boilerplate (not unit-tested, consistent with the codebase's other worker wrappers).

**Files:**
- Create: `src/main/services/import/runCamtrapImportInWorker.js`

- [ ] **Step 1: Implement the wrapper**

Create `src/main/services/import/runCamtrapImportInWorker.js`:

```js
/**
 * Spawn the CamtrapDP / GBIF import worker and route its messages.
 *
 * Mirrors src/main/services/sequences/runInWorker.js. The bundled worker
 * file lands at `out/main/camtrap-import-worker.js` (see the rollup input
 * registered in electron.vite.config.mjs), which is the same directory the
 * main bundle resolves __dirname to at runtime.
 */
import { join } from 'path'
import { Worker } from 'worker_threads'

import log from '../logger.js'

/**
 * @param {Object} args
 * @param {string} args.camtrapDpDirPath
 * @param {string} args.id
 * @param {string} args.biowatchDataPath
 * @param {Object} args.options - { nameOverride, importFolderOverride }
 * @param {function} args.onProgress - Called with progress payloads.
 * @param {AbortSignal} [args.signal] - Aborting terminates the worker.
 * @returns {Promise<{data, synthesized, dbPath}>}
 */
export function runCamtrapImportInWorker({
  camtrapDpDirPath,
  id,
  biowatchDataPath,
  options,
  onProgress,
  signal
}) {
  return new Promise((resolve, reject) => {
    const workerPath = join(__dirname, 'camtrap-import-worker.js')
    log.info(`camtrap-import worker: spawning from ${workerPath} for study ${id}`)
    const worker = new Worker(workerPath, {
      workerData: {
        camtrapDpDirPath,
        biowatchDataPath,
        id,
        options
      }
    })

    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }

    const onAbort = async () => {
      log.info(`camtrap-import worker: abort signal received for study ${id}, terminating`)
      try { await worker.terminate() } catch { /* noop */ }
      finish(reject, Object.assign(new Error('Import cancelled'), { name: 'AbortError' }))
    }

    if (signal) {
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }

    worker.on('message', (msg) => {
      if (msg.type === 'progress') {
        try { onProgress?.(msg.payload) } catch (err) { log.warn('onProgress threw:', err.message) }
      } else if (msg.type === 'result') {
        finish(resolve, msg.result)
      } else if (msg.type === 'error') {
        log.error('camtrap-import worker reported error:', msg.error)
        finish(reject, new Error(msg.error))
      }
    })
    worker.on('error', (err) => {
      log.error('camtrap-import worker error event:', err)
      finish(reject, err)
    })
    worker.on('exit', (code) => {
      if (!settled) {
        finish(reject, new Error(`camtrap-import worker exited with code ${code}`))
      }
    })
  })
}
```

- [ ] **Step 2: Verify the file parses (no test wired up yet)**

```bash
node --check src/main/services/import/runCamtrapImportInWorker.js
```

Expected: no output (success). Syntax-only check; the wrapper isn't called from anywhere until Task 5.

- [ ] **Step 3: Hold the commit**

Don't commit yet. Task 5 wires this into the IPC handler, and we want Tasks 3 + 4 + 5 in one `feat(import): run CamtrapDP import in worker thread` commit.

---

### Task 5: Swap the GBIF IPC handler to use the wrapper

Replace the direct `importCamTrapDataset` call inside `import:gbif-dataset` with a call to `runCamtrapImportInWorker`. Move the signal out of `options` (it's a wrapper-level concern now). Add the necessary imports.

**Files:**
- Modify: `src/main/ipc/import.js` (handler at lines ~470, call site at ~624)

- [ ] **Step 1: Add the wrapper and `getBiowatchDataPath` imports**

At the top of `src/main/ipc/import.js`, near the other imports from `../services/...`, add:

```js
import { runCamtrapImportInWorker } from '../services/import/runCamtrapImportInWorker.js'
import { getBiowatchDataPath } from '../services/paths.js'
```

(Skip the `getBiowatchDataPath` import if it's already imported in this file. Verify with: `grep -n "getBiowatchDataPath" src/main/ipc/import.js` before adding.)

- [ ] **Step 2: Replace the `importCamTrapDataset` call site**

In `src/main/ipc/import.js`, locate the call to `importCamTrapDataset` inside the `import:gbif-dataset` handler (around line 624). Replace it with the wrapper call:

Before:
```js
const { data, synthesized } = await importCamTrapDataset(
  camtrapDpDirPath,
  id,
  (csvProgress) => {
    sendGbifImportProgress({
      stage: 'importing_csvs',
      stageIndex: 3,
      totalStages: 4,
      stageName: `Importing ${csvProgress.currentFile}...`,
      datasetKey,
      datasetTitle,
      csvProgress: {
        currentFile: csvProgress.currentFile,
        fileIndex: csvProgress.fileIndex,
        totalFiles: csvProgress.totalFiles,
        insertedRows: csvProgress.insertedRows || 0,
        totalRows: csvProgress.totalRows || 0,
        phase: csvProgress.phase
      }
    })
  },
  { signal, nameOverride: datasetTitle, importFolderOverride: null }
)
```

After:
```js
const { data, synthesized } = await runCamtrapImportInWorker({
  camtrapDpDirPath,
  id,
  biowatchDataPath: getBiowatchDataPath(),
  options: { nameOverride: datasetTitle, importFolderOverride: null },
  onProgress: (csvProgress) => {
    sendGbifImportProgress({
      stage: 'importing_csvs',
      stageIndex: 3,
      totalStages: 4,
      stageName: `Importing ${csvProgress.currentFile}...`,
      datasetKey,
      datasetTitle,
      csvProgress: {
        currentFile: csvProgress.currentFile,
        fileIndex: csvProgress.fileIndex,
        totalFiles: csvProgress.totalFiles,
        insertedRows: csvProgress.insertedRows || 0,
        totalRows: csvProgress.totalRows || 0,
        phase: csvProgress.phase
      }
    })
  },
  signal
})
```

Key changes: `signal` moves out of `options` into the wrapper's top-level `signal` field; `biowatchDataPath` is computed on main and passed down; `onProgress` replaces the positional `onProgress` arg.

- [ ] **Step 3: Remove the now-unused `importCamTrapDataset` import if applicable**

Run:

```bash
grep -n "importCamTrapDataset[^W]" src/main/ipc/import.js
```

If only the `import` line at the top matches (no other call sites), remove `importCamTrapDataset` from the import list. Keep the `LILA_DATASETS` import and any other parser imports intact.

- [ ] **Step 4: Run the full test suite**

```bash
node --test 'test/**/*.test.js'
```

Expected: all tests PASS, including the new `camtrap-worker.test.js` and `expandObservationsToMedia.test.js`. The existing integration tests (`camtrapDP-event-expansion.test.js`, etc.) still call the parser directly and should be unaffected.

- [ ] **Step 5: Commit Tasks 3 + 4 + 5 together**

```bash
git add src/main/services/import/parsers/camtrapDPWorker.js \
        src/main/services/import/runCamtrapImportInWorker.js \
        electron.vite.config.mjs \
        src/main/ipc/import.js
git commit -m "feat(import): run CamtrapDP import in worker thread"
```

---

### Task 6: Documentation updates

Per `CLAUDE.md`, update the docs that describe IPC architecture and import flow.

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/ipc-api.md`
- Modify: `docs/import-export.md`

- [ ] **Step 1: Update `docs/architecture.md`**

Find the section that lists worker threads (search for "worker" — should mention sequences-worker, merge-worker, merge-preflight-worker). Add `camtrap-import-worker` to that list with a one-line description:

> - `camtrap-import-worker` — runs the CamtrapDP / GBIF import (CSV ingest + observation expansion) off the main process so large imports don't freeze the UI.

If there is a "Data flow" or "Import pipeline" diagram or section, update it to show the worker boundary for GBIF imports (download/extract on main → worker spawns → DB writes in worker → result back to main → cleanup on main).

- [ ] **Step 2: Update `docs/ipc-api.md`**

Find the `import:gbif-dataset` handler entry. Note (briefly — one sentence) that the heavy import work runs in a worker (`camtrap-import-worker`) and that cancellation via `import:cancel-gbif` triggers `worker.terminate()` followed by `cleanupStudy`.

- [ ] **Step 3: Update `docs/import-export.md`**

In the GBIF import section, add a short subsection ("Worker thread") explaining:
- The CamtrapDP import (CSV ingest + `expandObservationsToMedia`) runs in `camtrap-import-worker`.
- The wrapper at `src/main/services/import/runCamtrapImportInWorker.js` is the main-side entry.
- The expansion step batches inserts (`batchSize=5000`) into a temp table and emits per-batch progress.
- Cancellation is `worker.terminate()` + `cleanupStudy(id)`.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md docs/ipc-api.md docs/import-export.md
git commit -m "docs: note camtrap import worker boundary"
```

---

## Self-review checklist (run before declaring done)

- [ ] `npm test` all green (rebuilds better-sqlite3 for Node, runs the suite, rebuilds back for Electron).
- [ ] `npm run build` succeeds and `out/main/camtrap-import-worker.js` is emitted (`ls out/main/camtrap-import-worker.js`).
- [ ] `git log --oneline main..HEAD` shows the three commits in the expected order:
  - `refactor(import): chunk expandObservationsToMedia for progress ticks`
  - `feat(import): run CamtrapDP import in worker thread`
  - `docs: note camtrap import worker boundary`

### Manual smoke test (required — exercises the worker spawn + cancellation paths)

The wrapper and worker entry are not unit-tested (matching the codebase convention for `runInWorker.js` and `merge/worker.js`). Verify them by hand:

- [ ] Launch the app: `npm run dev`.
- [ ] Trigger a GBIF import of a non-trivial dataset (~10k+ observations — e.g., any dataset where the linking phase takes more than a second). UK or Belgian camera-trap datasets on GBIF work well.
- [ ] During the "Linking observations to media…" phase, verify:
  - Progress percentage ticks up smoothly (not stuck at 0% then jumping to 100%).
  - The Cancel button responds immediately when clicked (does not wait for the phase to finish).
  - Other UI interactions (clicking other tabs, scrolling) remain responsive throughout the import.
- [ ] Run a second import and click Cancel partway through the linking phase. Verify:
  - The study disappears from the Studies list (cleanup ran).
  - No `out of memory` or worker-crash entries appear in the Electron log (`~/.config/biowatch/logs/main.log` on Linux, equivalent on macOS/Windows).
