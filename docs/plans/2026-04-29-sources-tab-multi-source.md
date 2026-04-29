# Sources Tab Multi-Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local-only "Files" tab with an always-visible "Sources" tab that handles local folders, CamtrapDP packages (local or remote), and LILA datasets uniformly, per `docs/specs/2026-04-29-sources-tab-multi-source-design.md`.

**Architecture:** Backend-first, then frontend. Add a new `getSourcesData` query alongside the existing `getFilesData` so the old tab keeps working until the new one is fully built; remove the old query at the end. Sources are derived at query time — no schema migration. Each source row groups by `media.importFolder`, with deployment-level sub-rows. The LILA parser is patched to populate `importFolder` (currently null).

**Tech Stack:** Node.js + Electron, Drizzle ORM over `better-sqlite3`, `node:test` for tests, React + lucide-react + TailwindCSS in the renderer, TanStack Query for data fetching.

**Starting branch:** `arthur/ui-files-tab-show` (already created and contains the spec commit).

---

## File map

| File | Change |
|---|---|
| `src/main/database/queries/media.js` | Add `getSourcesData(dbPath)`; later remove `getFilesData(dbPath)`. |
| `src/main/database/queries/index.js` | Re-export `getSourcesData`; later remove `getFilesData`. |
| `src/main/database/index.js` | Re-export `getSourcesData`; later remove `getFilesData`. |
| `src/main/ipc/files.js` | Add `sources:get-data` IPC handler; later remove `files:get-data`. |
| `src/preload/index.js` | Add `window.api.getSourcesData(studyId)`; later remove `getFilesData`. |
| `src/main/services/import/parsers/lila.js` | Add `importFolder` to media inserter; set to `dataset.name`. |
| `src/renderer/src/files.jsx` | Renamed (via `git mv`) to `src/renderer/src/sources.jsx`; full rewrite per v11 mockup. |
| `src/renderer/src/study.jsx` | Drop `local/*` gate on tab and route; relabel "Files" → "Sources". |
| `test/main/database/queries.test.js` | Add `describe('getSourcesData')` block; later remove the `describe('getFilesData')` block. |
| `test/integration/import/lila.test.js` | Add a new file with one test asserting `importFolder` is set to `dataset.name`. |
| `docs/architecture.md`, `docs/database-schema.md`, `docs/ipc-api.md`, `docs/import-export.md` | Update wording from "Files" → "Sources"; document the new query/IPC. |

The v11 mockup the renderer rebuilds against is checked in at `.superpowers/brainstorm/69586-1777449135/content/sources-row-v11.html`. The path-row uses `text-overflow: ellipsis` with `direction: rtl` (existing files.jsx pattern).

---

## SourceRow shape (referenced by Tasks 1–5)

This is the contract between `getSourcesData` and `sources.jsx`. Every Task 1.x sub-task adds one field.

```js
/**
 * @typedef {Object} DeploymentRow
 * @property {string} deploymentID
 * @property {string} label              // locationName ?? folderName ?? deploymentID
 * @property {number} imageCount
 * @property {number} videoCount
 * @property {number} observationCount
 * @property {{ runID: string, processed: number, total: number } | null} activeRun
 */

/**
 * @typedef {Object} SourceRow
 * @property {string} importFolder        // grouping key (also displayed as path)
 * @property {boolean} isRemote           // any filePath in this source startsWith('http')
 * @property {number} imageCount
 * @property {number} videoCount
 * @property {number} deploymentCount
 * @property {number} observationCount
 * @property {{ runID: string, modelID: string, modelVersion: string, processed: number, total: number } | null} activeRun
 * @property {{ modelID: string, modelVersion: string } | null} lastModelUsed
 * @property {DeploymentRow[]} deployments
 */
```

---

## Task 1: Add `getSourcesData` query

The query is built incrementally — one TDD cycle per field of `SourceRow`. Each sub-task adds a test that exercises only the new field, then expands the query implementation.

**Files (all sub-tasks):**
- Create / extend: `src/main/database/queries/media.js`
- Test: `test/main/database/queries.test.js`

### Task 1.1: Stub `getSourcesData` returning grouping rows

- [ ] **Step 1: Write the failing test**

In `test/main/database/queries.test.js`, after the existing `describe('getFilesData', …)` block, add:

```js
import { getSourcesData } from '../../../src/main/database/index.js'

describe('getSourcesData', () => {
  test('returns one row per distinct importFolder', async () => {
    await createTestData(testDbPath)

    const result = await getSourcesData(testDbPath)

    assert(Array.isArray(result), 'should return an array')
    assert(result.length >= 1, 'should have at least one source row')
    result.forEach((row) => {
      assert(typeof row.importFolder === 'string', 'importFolder is a string')
    })
  })
})
```

The existing `createTestData` helper inserts media with `importFolder` = the deployment's folderName (verify by reading the helper). If it doesn't set `importFolder`, extend the helper so each inserted media row carries a deterministic `importFolder` value (e.g., `/test/import/${deploymentID}`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="getSourcesData returns one row per distinct importFolder"`
Expected: FAIL with `getSourcesData is not defined` (or similar import error).

- [ ] **Step 3: Add the stub implementation**

In `src/main/database/queries/media.js`, add at the bottom:

```js
/**
 * Get sources data — one row per distinct media.importFolder, with rollup stats.
 * @param {string} dbPath
 * @returns {Promise<Array>} array of SourceRow (see plan)
 */
export async function getSourcesData(dbPath) {
  const startTime = Date.now()
  log.info(`Querying sources data from: ${dbPath}`)

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    const rows = await db
      .select({ importFolder: media.importFolder })
      .from(media)
      .groupBy(media.importFolder)
      .orderBy(media.importFolder)

    const result = rows.map((r) => ({
      importFolder: r.importFolder ?? '',
      isRemote: false,
      imageCount: 0,
      videoCount: 0,
      deploymentCount: 0,
      observationCount: 0,
      activeRun: null,
      lastModelUsed: null,
      deployments: []
    }))

    log.info(`Sources data: ${result.length} sources in ${Date.now() - startTime}ms`)
    return result
  } catch (error) {
    log.error(`Error querying sources data: ${error.message}`)
    throw error
  }
}
```

Then re-export through the chain:

In `src/main/database/queries/index.js`, add `getSourcesData` to the imports and exports:

```js
import { getSourcesData, /* …existing… */ } from './media.js'
// …
export { getSourcesData, /* …existing… */ }
```

In `src/main/database/index.js`, add to the same re-export list (mirror existing pattern; see how `getFilesData` is currently re-exported at line ~231).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern="getSourcesData returns one row per distinct importFolder"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/database/queries/media.js src/main/database/queries/index.js src/main/database/index.js test/main/database/queries.test.js
git commit -m "feat(db): add getSourcesData query stub"
```

### Task 1.2: Image and video counts per source

- [ ] **Step 1: Write the failing test**

Inside `describe('getSourcesData', …)`:

```js
test('counts images and videos per source', async () => {
  await createTestData(testDbPath)

  const result = await getSourcesData(testDbPath)
  const totalImages = result.reduce((s, r) => s + r.imageCount, 0)
  const totalVideos = result.reduce((s, r) => s + r.videoCount, 0)

  // createTestData inserts 5 image rows (fileMediatype='image/jpeg') and 0 video rows
  assert.equal(totalImages, 5, 'totalImages')
  assert.equal(totalVideos, 0, 'totalVideos')
})
```

If `createTestData` doesn't already include video rows, that's fine — this test verifies the image side and that videos default to 0. A later test will exercise videos by inserting one row with `fileMediatype: 'video/mp4'`.

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- --test-name-pattern="counts images and videos per source"`
Expected: FAIL — both counts are 0 because the stub doesn't populate them.

- [ ] **Step 3: Extend the query**

Replace the `getSourcesData` body's `.select(…).from(media).groupBy(…)` chain with:

```js
const rows = await db
  .select({
    importFolder: media.importFolder,
    imageCount:
      sql`COUNT(DISTINCT CASE WHEN ${media.fileMediatype} NOT LIKE 'video/%' THEN ${media.mediaID} END)`.as('imageCount'),
    videoCount:
      sql`COUNT(DISTINCT CASE WHEN ${media.fileMediatype} LIKE 'video/%' THEN ${media.mediaID} END)`.as('videoCount')
  })
  .from(media)
  .groupBy(media.importFolder)
  .orderBy(media.importFolder)

const result = rows.map((r) => ({
  importFolder: r.importFolder ?? '',
  isRemote: false,
  imageCount: Number(r.imageCount),
  videoCount: Number(r.videoCount),
  deploymentCount: 0,
  observationCount: 0,
  activeRun: null,
  lastModelUsed: null,
  deployments: []
}))
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- --test-name-pattern="counts images and videos per source"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/database/queries/media.js test/main/database/queries.test.js
git commit -m "feat(db): getSourcesData counts images and videos"
```

### Task 1.3: Deployment count per source

- [ ] **Step 1: Write the failing test**

```js
test('counts distinct deployments per source', async () => {
  await createTestData(testDbPath)

  const result = await getSourcesData(testDbPath)
  const totalDeployments = result.reduce((s, r) => s + r.deploymentCount, 0)

  // createTestData inserts 3 deployments
  assert.equal(totalDeployments, 3, 'totalDeployments')
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- --test-name-pattern="counts distinct deployments per source"`

- [ ] **Step 3: Add `deploymentCount` to the SQL select**

Add to the `.select({...})` object:

```js
deploymentCount:
  sql`COUNT(DISTINCT ${media.deploymentID})`.as('deploymentCount')
```

And in the result mapper, replace `deploymentCount: 0` with `deploymentCount: Number(r.deploymentCount)`.

- [ ] **Step 4: Run, verify PASS**
- [ ] **Step 5: Commit**

```bash
git add src/main/database/queries/media.js test/main/database/queries.test.js
git commit -m "feat(db): getSourcesData counts deployments per source"
```

### Task 1.4: Observation count per source

- [ ] **Step 1: Write the failing test**

```js
test('counts observations per source', async () => {
  await createTestData(testDbPath)

  const result = await getSourcesData(testDbPath)
  const totalObservations = result.reduce((s, r) => s + r.observationCount, 0)

  // createTestData inserts 5 observations
  assert.equal(totalObservations, 5, 'totalObservations')
})
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Add a left-join through observations**

Replace the entire `.select({…}).from(…).groupBy(…)` with:

```js
const rows = await db
  .select({
    importFolder: media.importFolder,
    imageCount:
      sql`COUNT(DISTINCT CASE WHEN ${media.fileMediatype} NOT LIKE 'video/%' THEN ${media.mediaID} END)`.as('imageCount'),
    videoCount:
      sql`COUNT(DISTINCT CASE WHEN ${media.fileMediatype} LIKE 'video/%' THEN ${media.mediaID} END)`.as('videoCount'),
    deploymentCount:
      sql`COUNT(DISTINCT ${media.deploymentID})`.as('deploymentCount'),
    observationCount:
      sql`COUNT(${observations.observationID})`.as('observationCount')
  })
  .from(media)
  .leftJoin(observations, eq(media.mediaID, observations.mediaID))
  .groupBy(media.importFolder)
  .orderBy(media.importFolder)
```

(`observations` is already imported at the top of `media.js`.)

In the result mapper, replace `observationCount: 0` with `observationCount: Number(r.observationCount)`.

- [ ] **Step 4: Run, verify PASS**
- [ ] **Step 5: Commit**

```bash
git add src/main/database/queries/media.js test/main/database/queries.test.js
git commit -m "feat(db): getSourcesData counts observations per source"
```

### Task 1.5: `isRemote` flag

- [ ] **Step 1: Write the failing test**

```js
test('marks isRemote=true when any filePath is an http URL', async () => {
  // Build a fresh DB with one local source and one remote source
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: { deploymentID: 'd1', locationID: 'l1', locationName: 'Local' },
    d2: { deploymentID: 'd2', locationID: 'l2', locationName: 'Remote' }
  })
  await insertMedia(manager, {
    'a.jpg': { mediaID: 'm1', deploymentID: 'd1', filePath: '/local/a.jpg', fileName: 'a.jpg', importFolder: '/local', folderName: 'local' },
    'b.jpg': { mediaID: 'm2', deploymentID: 'd2', filePath: 'https://example.com/b.jpg', fileName: 'b.jpg', importFolder: 'remote-dataset', folderName: null }
  })

  const result = await getSourcesData(testDbPath)
  const local = result.find((r) => r.importFolder === '/local')
  const remote = result.find((r) => r.importFolder === 'remote-dataset')

  assert.equal(local.isRemote, false, 'local source')
  assert.equal(remote.isRemote, true, 'remote source')
})
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Add `isRemote` aggregation**

Add to the `.select({…})`:

```js
isRemote: sql`MAX(CASE WHEN ${media.filePath} LIKE 'http%' THEN 1 ELSE 0 END)`.as('isRemote')
```

In the result mapper, replace `isRemote: false` with `isRemote: Number(r.isRemote) === 1`.

- [ ] **Step 4: Run, verify PASS**
- [ ] **Step 5: Commit**

```bash
git add src/main/database/queries/media.js test/main/database/queries.test.js
git commit -m "feat(db): getSourcesData detects remote sources via filePath"
```

### Task 1.6: Per-deployment sub-rows

- [ ] **Step 1: Write the failing test**

```js
test('returns deployment rows under each source', async () => {
  await createTestData(testDbPath)

  const result = await getSourcesData(testDbPath)
  const totalDeploymentRows = result.reduce((s, r) => s + r.deployments.length, 0)
  assert.equal(totalDeploymentRows, 3, 'one deployment row per deployment')

  result.forEach((source) => {
    source.deployments.forEach((d) => {
      assert(typeof d.deploymentID === 'string', 'deploymentID')
      assert(typeof d.label === 'string', 'label')
      assert(typeof d.imageCount === 'number', 'imageCount')
      assert(typeof d.videoCount === 'number', 'videoCount')
      assert(typeof d.observationCount === 'number', 'observationCount')
    })
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Add a second query and merge**

After the existing `rows = await db.select({…})…` query in `getSourcesData`, add a second query for per-deployment rollups, then merge:

```js
const deploymentRows = await db
  .select({
    importFolder: media.importFolder,
    deploymentID: media.deploymentID,
    folderName: media.folderName,
    locationName: deployments.locationName,
    imageCount:
      sql`COUNT(DISTINCT CASE WHEN ${media.fileMediatype} NOT LIKE 'video/%' THEN ${media.mediaID} END)`.as('imageCount'),
    videoCount:
      sql`COUNT(DISTINCT CASE WHEN ${media.fileMediatype} LIKE 'video/%' THEN ${media.mediaID} END)`.as('videoCount'),
    observationCount:
      sql`COUNT(${observations.observationID})`.as('observationCount')
  })
  .from(media)
  .leftJoin(deployments, eq(media.deploymentID, deployments.deploymentID))
  .leftJoin(observations, eq(media.mediaID, observations.mediaID))
  .groupBy(media.importFolder, media.deploymentID)
  .orderBy(media.importFolder, media.deploymentID)

// `deployments` is already imported in media.js — verify the import line at the top includes it.
```

Then in the result mapper, attach deployments per source:

```js
const deploymentsByFolder = new Map()
for (const d of deploymentRows) {
  if (!deploymentsByFolder.has(d.importFolder)) deploymentsByFolder.set(d.importFolder, [])
  deploymentsByFolder.get(d.importFolder).push({
    deploymentID: d.deploymentID,
    label: d.locationName ?? d.folderName ?? d.deploymentID,
    imageCount: Number(d.imageCount),
    videoCount: Number(d.videoCount),
    observationCount: Number(d.observationCount),
    activeRun: null
  })
}

const result = rows.map((r) => ({
  importFolder: r.importFolder ?? '',
  isRemote: Number(r.isRemote) === 1,
  imageCount: Number(r.imageCount),
  videoCount: Number(r.videoCount),
  deploymentCount: Number(r.deploymentCount),
  observationCount: Number(r.observationCount),
  activeRun: null,
  lastModelUsed: null,
  deployments: deploymentsByFolder.get(r.importFolder) ?? []
}))
```

Verify the top-of-file imports include `deployments`. The existing line is:

```js
import { getDrizzleDb, media, observations, modelRuns, modelOutputs } from '../index.js'
```

Add `deployments`:

```js
import { getDrizzleDb, media, observations, modelRuns, modelOutputs, deployments } from '../index.js'
```

- [ ] **Step 4: Run, verify PASS**
- [ ] **Step 5: Commit**

```bash
git add src/main/database/queries/media.js test/main/database/queries.test.js
git commit -m "feat(db): getSourcesData returns deployment sub-rows"
```

### Task 1.7: `lastModelUsed`

- [ ] **Step 1: Write the failing test**

```js
test('returns lastModelUsed when a model_run exists', async () => {
  // createTestData already inserts a model_run touching the media.
  // Verify by inspecting the helper — if it doesn't, extend it to insert one
  // model_run with modelID='speciesnet', modelVersion='4.0.1a' and at least one model_output.
  await createTestData(testDbPath)

  const result = await getSourcesData(testDbPath)
  const sourceWithModel = result.find((r) => r.lastModelUsed !== null)

  assert(sourceWithModel, 'at least one source should have lastModelUsed')
  assert.equal(sourceWithModel.lastModelUsed.modelID, 'speciesnet')
  assert.equal(sourceWithModel.lastModelUsed.modelVersion, '4.0.1a')
})
```

If `createTestData` does not insert model_runs / model_outputs, extend it (helper at top of `queries.test.js`). Add inserts using the existing manager pattern:

```js
const db = manager.getDb()
const runID = 'run-test-1'
db.insert(modelRuns).values({
  id: runID,
  modelID: 'speciesnet',
  modelVersion: '4.0.1a',
  startedAt: new Date().toISOString(),
  status: 'completed'
}).run()
db.insert(modelOutputs).values({
  id: 'mo-1',
  mediaID: 'media-001',  // adjust to a real mediaID inserted by createTestData
  runID,
  rawOutput: {}
}).run()
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Add a third query for lastModelUsed**

Add after the deployment-rows query:

```js
const lastModelRows = await db
  .select({
    importFolder: media.importFolder,
    modelID: modelRuns.modelID,
    modelVersion: modelRuns.modelVersion,
    startedAt: modelRuns.startedAt
  })
  .from(modelOutputs)
  .innerJoin(media, eq(modelOutputs.mediaID, media.mediaID))
  .innerJoin(modelRuns, eq(modelOutputs.runID, modelRuns.id))
  .orderBy(media.importFolder, desc(modelRuns.startedAt))

const lastModelByFolder = new Map()
for (const row of lastModelRows) {
  if (!lastModelByFolder.has(row.importFolder)) {
    lastModelByFolder.set(row.importFolder, {
      modelID: row.modelID,
      modelVersion: row.modelVersion
    })
  }
}
```

(Iterating in `startedAt DESC` order and keeping only the first match per folder gives "most recent run for this source".)

In the result mapper, replace `lastModelUsed: null` with `lastModelUsed: lastModelByFolder.get(r.importFolder) ?? null`.

Note: `desc` is already imported at the top of `media.js`.

- [ ] **Step 4: Run, verify PASS**
- [ ] **Step 5: Commit**

```bash
git add src/main/database/queries/media.js test/main/database/queries.test.js
git commit -m "feat(db): getSourcesData returns lastModelUsed"
```

### Task 1.8: `activeRun`

- [ ] **Step 1: Write the failing test**

```js
test('returns activeRun when a model_run is currently running', async () => {
  await createTestData(testDbPath)

  // Insert a running model_run targeting this source's importFolder
  const manager = await createImageDirectoryDatabase(testDbPath)
  const db = manager.getDb()
  const importFolder = '/test/import/loc001'  // value used by createTestData
  db.insert(modelRuns).values({
    id: 'run-active-1',
    modelID: 'deepfaune',
    modelVersion: '1.3',
    startedAt: new Date().toISOString(),
    status: 'running',
    importPath: importFolder
  }).run()

  const result = await getSourcesData(testDbPath)
  const source = result.find((r) => r.importFolder === importFolder)

  assert(source.activeRun, 'should have activeRun')
  assert.equal(source.activeRun.modelID, 'deepfaune')
  assert.equal(source.activeRun.modelVersion, '1.3')
  assert.equal(source.activeRun.runID, 'run-active-1')
  assert(typeof source.activeRun.processed === 'number')
  assert(typeof source.activeRun.total === 'number')
})
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Detect active run by `status='running'` AND `importPath` match**

Add another query before building the result:

```js
const activeRunRows = await db
  .select({
    importFolder: modelRuns.importPath,
    runID: modelRuns.id,
    modelID: modelRuns.modelID,
    modelVersion: modelRuns.modelVersion
  })
  .from(modelRuns)
  .where(eq(modelRuns.status, 'running'))

const activeRunByFolder = new Map()
for (const r of activeRunRows) {
  if (r.importFolder) activeRunByFolder.set(r.importFolder, r)
}
```

Then for each source row, compute `processed`/`total` using the already-fetched data. `total` = `imageCount + videoCount`. `processed` requires counting outputs for the active run scoped to this source's media — add a fourth lightweight query:

```js
const activeFolders = Array.from(activeRunByFolder.keys())
const processedByFolder = new Map()
if (activeFolders.length > 0) {
  const processedRows = await db
    .select({
      importFolder: media.importFolder,
      processed: sql`COUNT(DISTINCT ${modelOutputs.mediaID})`.as('processed')
    })
    .from(modelOutputs)
    .innerJoin(media, eq(modelOutputs.mediaID, media.mediaID))
    .innerJoin(modelRuns, eq(modelOutputs.runID, modelRuns.id))
    .where(and(eq(modelRuns.status, 'running'), inArray(media.importFolder, activeFolders)))
    .groupBy(media.importFolder)

  for (const row of processedRows) {
    processedByFolder.set(row.importFolder, Number(row.processed))
  }
}
```

(`and` and `inArray` are already imported at top of `media.js`.)

Update the result mapper:

```js
const activeRun = activeRunByFolder.get(r.importFolder)
const finalActive = activeRun
  ? {
      runID: activeRun.runID,
      modelID: activeRun.modelID,
      modelVersion: activeRun.modelVersion,
      processed: processedByFolder.get(r.importFolder) ?? 0,
      total: Number(r.imageCount) + Number(r.videoCount)
    }
  : null

return {
  // …existing fields…
  activeRun: finalActive,
  // …
}
```

Per-deployment activeRun: similarly compute by adding a `deploymentID` GROUP BY to the processed query. To keep this task bite-sized, leave deployment-level `activeRun` as `null` for now and rely on the source-level bar; revisit if the v11 mockup demands per-deployment in-flight rendering. (The v11 mockup does show per-deployment in-flight; if we want exact behavior, extend the processed query to also group by `deploymentID` and key into `processedByDeployment`. **For the first cut, source-level only.**)

- [ ] **Step 4: Run, verify PASS**
- [ ] **Step 5: Commit**

```bash
git add src/main/database/queries/media.js test/main/database/queries.test.js
git commit -m "feat(db): getSourcesData returns activeRun for in-flight model_runs"
```

---

## Task 2: Wire IPC + preload for `getSourcesData`

### Task 2.1: Add IPC handler

**Files:**
- Modify: `src/main/ipc/files.js`

- [ ] **Step 1: Add the import for `getSourcesData`**

In `src/main/ipc/files.js`, change line 9 from:

```js
import { getFilesData } from '../database/index.js'
```

to:

```js
import { getFilesData, getSourcesData } from '../database/index.js'
```

- [ ] **Step 2: Add the new handler inside `registerFilesIPCHandlers`**

Inside the existing `registerFilesIPCHandlers` function, after the `files:get-data` block, add:

```js
ipcMain.handle('sources:get-data', async (_, studyId) => {
  try {
    const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
    if (!dbPath || !existsSync(dbPath)) {
      log.warn(`Database not found for study ID: ${studyId}`)
      return { error: 'Database not found for this study' }
    }

    const sourcesData = await getSourcesData(dbPath)
    return { data: sourcesData }
  } catch (error) {
    log.error('Error getting sources data:', error)
    return { error: error.message }
  }
})
```

(This is a copy of the `files:get-data` handler with the channel name and query function swapped.)

- [ ] **Step 3: Lint**

Run: `npx eslint src/main/ipc/files.js`
Expected: no warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/files.js
git commit -m "feat(ipc): add sources:get-data handler"
```

### Task 2.2: Add preload binding

**Files:**
- Modify: `src/preload/index.js`

- [ ] **Step 1: Add the binding**

Below the existing `getFilesData` binding (line ~232), add:

```js
getSourcesData: async (studyId) => {
  return await electronAPI.ipcRenderer.invoke('sources:get-data', studyId)
},
```

- [ ] **Step 2: Lint**

Run: `npx eslint src/preload/index.js`

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.js
git commit -m "feat(preload): expose getSourcesData on window.api"
```

---

## Task 3: LILA parser sets `importFolder`

The end-to-end LILA importer (`importLilaDatasetWithPath`) requires network access to download dataset metadata, which is unsuitable for unit tests. Instead, extract the image→media-row mapping into a pure helper and test it directly.

**Files:**
- Modify: `src/main/services/import/parsers/lila.js`
- Test: `test/main/services/import/lila.test.js` (new file)

### Task 3.1: Extract `transformCOCOToMedia` is already a pure helper — test it

The existing `transformCOCOToMedia(images, imageBaseUrl)` (lila.js:1055) is already pure. We will:

1. Extend its signature to take the full `dataset` object (so it can stamp `importFolder = dataset.name`).
2. Update its two call sites accordingly.
3. Apply the same logic to the streaming inserter (`insertMediaFromJsonl`, lila.js:1530).
4. Write a unit test against the pure helper.

- [ ] **Step 1: Write the failing test**

Create `test/main/services/import/lila.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { transformCOCOToMedia } from '../../../../src/main/services/import/parsers/lila.js'

describe('LILA transformCOCOToMedia', () => {
  test('stamps every media row with importFolder = dataset.name', () => {
    const images = [
      { id: 1, file_name: 'a.jpg', location: 'L1', datetime: '2024-01-01T00:00:00Z' },
      { id: 2, file_name: 'b.jpg', location: 'L2', datetime: '2024-01-02T00:00:00Z' }
    ]
    const dataset = {
      name: 'Snapshot Serengeti',
      imageBaseUrl: 'https://example.com/snapshot-serengeti/'
    }

    const rows = transformCOCOToMedia(images, dataset)

    assert.equal(rows.length, 2)
    rows.forEach((r) => {
      assert.equal(r.importFolder, 'Snapshot Serengeti')
    })
    assert.equal(rows[0].mediaID, '1')
    assert.equal(rows[0].filePath, 'https://example.com/snapshot-serengeti/a.jpg')
  })
})
```

Note the **changed signature**: `transformCOCOToMedia(images, dataset)` — second arg is now the whole dataset object instead of just `imageBaseUrl`.

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- --test-reporter=spec test/main/services/import/lila.test.js`
Expected: FAIL — either an export error (if `transformCOCOToMedia` isn't exported yet) or a value mismatch (`importFolder` undefined).

- [ ] **Step 3: Patch `lila.js`**

In `src/main/services/import/parsers/lila.js`:

(a) Change `transformCOCOToMedia` signature and body to use the full dataset object, and `export` it:

```js
export function transformCOCOToMedia(images, dataset) {
  return images.map((img) => ({
    mediaID: String(img.id),
    deploymentID: img.location ? String(img.location) : null,
    timestamp: transformDateField(img.datetime),
    filePath: `${dataset.imageBaseUrl}${img.file_name}`,
    fileName: img.file_name,
    fileMediatype: getMediaTypeFromFileName(img.file_name),
    exifData: null,
    favorite: false,
    importFolder: dataset.name
  }))
}
```

(b) Update its call sites. `grep -n "transformCOCOToMedia(" src/main/services/import/parsers/lila.js` to find them and pass `dataset` instead of `dataset.imageBaseUrl`.

(c) Patch the streaming path. In `insertMediaFromJsonl` (line 1530), update `mediaColumns`:

```js
const mediaColumns = [
  'mediaID',
  'deploymentID',
  'timestamp',
  'filePath',
  'fileName',
  'fileMediatype',
  'exifData',
  'favorite',
  'importFolder'
]
```

And the map (line ~1559):

```js
const mediaData = images.map((img) => ({
  mediaID: String(img.id),
  deploymentID: img.location ? String(img.location) : null,
  timestamp: img.datetime || null,
  filePath: `${dataset.imageBaseUrl}${img.file_name}`,
  fileName: img.file_name,
  fileMediatype: getMediaTypeFromFileName(img.file_name),
  exifData: null,
  favorite: false,
  importFolder: dataset.name
}))
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- --test-reporter=spec test/main/services/import/lila.test.js`
Expected: PASS.

Also run the full suite to ensure no regression in other LILA-touching tests:

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/import/parsers/lila.js test/main/services/import/lila.test.js
git commit -m "feat(import/lila): set media.importFolder to dataset name"
```

---

## Task 4: Always show the tab + relabel

**Files:**
- Modify: `src/renderer/src/study.jsx`

### Task 4.1: Drop the local-only gate and rename to "Sources"

- [ ] **Step 1: Locate the conditionals**

In `src/renderer/src/study.jsx`, two places guard the Files tab on `study?.importerName?.startsWith('local/')`:

- The `<Tab>` in the nav (around line 188).
- The `<Route path="files">` (around line 234).

Also note the global `isImportActive` derivation (around line 153) which uses the same prefix check.

- [ ] **Step 2: Remove both Files-tab guards and relabel**

```jsx
// nav: replace
{study?.importerName?.startsWith('local/') && (
  <Tab to={`/study/${id}/files`} icon={FolderOpen} compact={isImportActive}>
    Files
  </Tab>
)}
// with:
<Tab to={`/study/${id}/sources`} icon={FolderOpen} compact={isImportActive}>
  Sources
</Tab>
```

```jsx
// route: replace
{study?.importerName?.startsWith('local/') && (
  <Route
    path="files"
    element={
      <ErrorBoundary FallbackComponent={ErrorFallback} key={'files'}>
        <Files studyId={id} />
      </ErrorBoundary>
    }
  />
)}
// with:
<Route
  path="sources"
  element={
    <ErrorBoundary FallbackComponent={ErrorFallback} key={'sources'}>
      <Sources studyId={id} />
    </ErrorBoundary>
  }
/>
```

Also rename the import:

```jsx
import Sources from './sources'   // was: import Files from './files'
```

(The actual `sources.jsx` file is created/renamed in Task 5; until that task runs, this leaves a dangling import. To keep tasks decoupled, do **Task 5 first**, then come back to Task 4. If you keep this order: temporarily leave the `import Files from './files'` and the `<Files />` JSX, only changing the gate and route path/label, and finish the relabel after Task 5.)

**Recommended ordering:** Task 5 → Task 4 (rename import as the final renderer wiring step).

- [ ] **Step 3: Manual smoke check**

Start the dev app, open any study (especially a LILA study and a CamtrapDP study), confirm the Sources tab is visible.

Run: `npm run dev`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/study.jsx
git commit -m "feat(study): always show Sources tab; rename Files → Sources"
```

---

## Task 5: Rewrite the Sources component per v11

**Files:**
- Move: `src/renderer/src/files.jsx` → `src/renderer/src/sources.jsx`
- Modify: the new file (full rewrite)

### Task 5.1: Rename the file and stub the new component

- [ ] **Step 1: Move with git**

```bash
git mv src/renderer/src/files.jsx src/renderer/src/sources.jsx
```

- [ ] **Step 2: Replace contents with a fetching stub**

Open `src/renderer/src/sources.jsx` and replace its contents with:

```jsx
import { useParams } from 'react-router'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useImportStatus } from '@renderer/hooks/import'

export default function Sources({ studyId, importerName }) {
  const { id } = useParams()
  const actualStudyId = studyId || id
  const queryClient = useQueryClient()
  const { importStatus } = useImportStatus(actualStudyId)

  const { data: sources = [], isLoading, error } = useQuery({
    queryKey: ['sourcesData', actualStudyId, importStatus?.isRunning],
    queryFn: async () => {
      const response = await window.api.getSourcesData(actualStudyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    refetchInterval: () => (importStatus?.isRunning ? 3000 : false),
    enabled: !!actualStudyId
  })

  if (isLoading) return <div className="p-4 text-gray-500">Loading sources…</div>
  if (error) return <div className="p-4 text-red-500">Error: {error.message}</div>
  if (sources.length === 0) return <div className="p-4 text-gray-500">No sources</div>

  return (
    <div className="px-8 py-3 h-full overflow-y-auto">
      <pre>{JSON.stringify({ importerName, sources }, null, 2)}</pre>
    </div>
  )
}
```

(`importerName` is accepted as a prop now so Task 5.2 can use it for icon selection and Task 5.3 can use it for the Add-source disabled state. This is intentionally placeholder UI — we wire data first, polish next.)

- [ ] **Step 2b: Update `study.jsx` to pass `importerName`**

In `src/renderer/src/study.jsx`, update the Sources route's element:

```jsx
<Route
  path="sources"
  element={
    <ErrorBoundary FallbackComponent={ErrorFallback} key={'sources'}>
      <Sources studyId={id} importerName={study?.importerName} />
    </ErrorBoundary>
  }
/>
```

- [ ] **Step 3: Update the import in study.jsx (Task 4)** — see ordering note in Task 4.

- [ ] **Step 4: Smoke check**

Run: `npm run dev` and open any study's Sources tab. Confirm the JSON dump renders source data with all fields populated.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/sources.jsx src/renderer/src/study.jsx
git commit -m "feat(renderer): scaffold Sources component fetching getSourcesData"
```

### Task 5.2: Build the row layout matching v11

- [ ] **Step 1: Replace the `<pre>` dump with the full row markup**

Reference: `.superpowers/brainstorm/69586-1777449135/content/sources-row-v11.html` for visual semantics. Translate to React + Tailwind. Use `lucide-react` for icons (already a dependency — see `study.jsx` imports). Match `deployments.jsx` style: flat list, single bottom borders, `hover:bg-gray-50`, no card outlines.

```jsx
import { useState } from 'react'
import { useParams } from 'react-router'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useImportStatus } from '@renderer/hooks/import'
import { Folder, Globe, Package, ChevronDown, ChevronRight, Info, Check } from 'lucide-react'

function SourceIcon({ importerName }) {
  if (importerName === 'lila/coco') return <Globe size={20} className="text-gray-400" />
  if (importerName === 'camtrap/datapackage') return <Package size={20} className="text-gray-400" />
  return <Folder size={20} className="text-gray-400" />
}

function StatusCell({ row }) {
  if (row.activeRun) {
    const pct = row.activeRun.total > 0
      ? Math.min((row.activeRun.processed / row.activeRun.total) * 100, 100)
      : 0
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-xs text-gray-500 tabular-nums">
          {row.activeRun.processed.toLocaleString()} / {row.activeRun.total.toLocaleString()}
        </span>
        <div className="w-[140px] h-1 bg-gray-200 rounded">
          <div className="h-full bg-blue-500 rounded transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }
  if (row.observationCount > 0) {
    return (
      <span
        className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-emerald-500 text-white"
        title={`${row.observationCount.toLocaleString()} observations`}
      >
        <Check size={11} strokeWidth={3} />
      </span>
    )
  }
  return null
}

function MediaCounts({ imageCount, videoCount, deploymentCount }) {
  const parts = []
  if (imageCount > 0) parts.push(<><strong className="text-gray-900">{imageCount.toLocaleString()}</strong> images</>)
  if (videoCount > 0) parts.push(<><strong className="text-gray-900">{videoCount.toLocaleString()}</strong> videos</>)
  if (deploymentCount > 0) parts.push(`${deploymentCount} deployment${deploymentCount !== 1 ? 's' : ''}`)
  return (
    <div className="text-xs text-gray-500 tabular-nums">
      {parts.flatMap((p, i) => i === 0 ? [p] : [' · ', p])}
    </div>
  )
}

function SourceRow({ source, importerName, expanded, onToggle }) {
  const canExpand = source.deployments.length > 0
  return (
    <>
      <div
        className="flex items-center gap-4 px-2 py-4 border-b border-gray-200 hover:bg-gray-50 cursor-pointer"
        onClick={canExpand ? onToggle : undefined}
      >
        <div className="w-5 text-gray-500">
          {canExpand ? (expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : null}
        </div>
        <div className="w-[22px] flex justify-center"><SourceIcon importerName={importerName} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <span className="truncate">{source.importFolder || '(unnamed source)'}</span>
            <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
              {source.isRemote ? 'Remote' : 'Local'}
            </span>
            {source.lastModelUsed && (
              <span title={`Last model: ${source.lastModelUsed.modelID} ${source.lastModelUsed.modelVersion}`} className="text-gray-400">
                <Info size={13} />
              </span>
            )}
          </div>
          <div
            className="text-xs text-gray-400 font-mono mt-0.5 truncate"
            style={{ direction: 'rtl', textAlign: 'left' }}
            title={source.importFolder}
          >
            {'‎' + (source.importFolder || '')}
          </div>
        </div>
        <MediaCounts imageCount={source.imageCount} videoCount={source.videoCount} deploymentCount={source.deploymentCount} />
        <div className="w-[200px] flex justify-end">
          <StatusCell row={source} />
        </div>
      </div>
      {expanded && source.deployments.map((d) => (
        <div key={d.deploymentID} className="ml-14 flex items-center gap-4 px-2 py-3 border-b border-gray-100 hover:bg-gray-50">
          <div className="flex-1 min-w-0 text-sm text-gray-700 truncate">{d.label}</div>
          <MediaCounts imageCount={d.imageCount} videoCount={d.videoCount} deploymentCount={0} />
          <div className="w-[200px] flex justify-end">
            <StatusCell row={d} />
          </div>
        </div>
      ))}
    </>
  )
}

export default function Sources({ studyId, importerName }) {
  const { id } = useParams()
  const actualStudyId = studyId || id
  const queryClient = useQueryClient()
  const { importStatus } = useImportStatus(actualStudyId)
  const [expanded, setExpanded] = useState({})

  const { data: sources = [], isLoading, error } = useQuery({
    queryKey: ['sourcesData', actualStudyId, importStatus?.isRunning],
    queryFn: async () => {
      const response = await window.api.getSourcesData(actualStudyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    refetchInterval: () => (importStatus?.isRunning ? 3000 : false),
    enabled: !!actualStudyId
  })

  if (isLoading) return <div className="p-4 text-gray-500">Loading sources…</div>
  if (error) return <div className="p-4 text-red-500">Error: {error.message}</div>

  const totalMedia = sources.reduce((s, r) => s + r.imageCount + r.videoCount, 0)

  const handleAddSource = async () => {
    await window.api.selectMoreImagesDirectory(actualStudyId)
    queryClient.invalidateQueries({ queryKey: ['importStatus', actualStudyId] })
    queryClient.invalidateQueries({ queryKey: ['sourcesData', actualStudyId] })
  }

  return (
    <div className="px-8 py-3 h-full overflow-y-auto">
      <header className="flex items-center justify-between pb-3">
        <div className="text-sm text-gray-500">
          {sources.length} source{sources.length !== 1 ? 's' : ''} · {totalMedia.toLocaleString()} media files
        </div>
        <button
          onClick={handleAddSource}
          className="border border-gray-200 bg-white px-3 py-1.5 rounded-md text-sm hover:bg-gray-50"
        >
          + Add source
        </button>
      </header>
      <div>
        {sources.map((source) => (
          <SourceRow
            key={source.importFolder}
            source={source}
            importerName={importerName}
            expanded={!!expanded[source.importFolder]}
            onToggle={() => setExpanded((e) => ({ ...e, [source.importFolder]: !e[source.importFolder] }))}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Manual UI verification**

Run `npm run dev`. Visit:

- A `local/ml_run` study (verify per-deployment expand works, Add source button is enabled)
- A `lila/coco` study (verify the row renders with the dataset name as label, Remote badge shows, no deployments expand if zero)
- A `camtrap/datapackage` study, both local and (if available) GBIF-sourced (verify Local/Remote badge by URL detection)
- A study with an active model_run (verify the in-flight bar appears with correct fill = processed/total)

Capture any visual mismatches against the v11 mockup, fix inline.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/sources.jsx
git commit -m "feat(renderer): rebuild Sources tab UI per v11 mockup"
```

### Task 5.3: Disable "Add source" for source types that don't support it

`importerName` is already wired in from Task 5.1. This task just adds the disabled-state logic to the button.

- [ ] **Step 1: Add `canAddSource` derivation and apply to the button**

In `src/renderer/src/sources.jsx`, inside the `Sources` component before the `return`:

```jsx
const canAddSource =
  importerName?.startsWith('local/') ||
  importerName === 'wildlife/folder' ||
  importerName === 'camtrap/datapackage'
```

Replace the existing button JSX with:

```jsx
<button
  onClick={handleAddSource}
  disabled={!canAddSource}
  className={`border border-gray-200 bg-white px-3 py-1.5 rounded-md text-sm ${canAddSource ? 'hover:bg-gray-50' : 'opacity-50 cursor-not-allowed'}`}
>
  + Add source
</button>
```

- [ ] **Step 2: Manual check** — verify the button is disabled on a LILA study and enabled on a `local/ml_run` or `camtrap/datapackage` study.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/sources.jsx
git commit -m "feat(sources): disable Add source for source types without an importer"
```

---

## Task 6: Remove the old `getFilesData` plumbing

Once the new tab is live and verified, the old query and IPC have no remaining callers — remove them.

**Files:**
- Modify: `src/main/database/queries/media.js`, `src/main/database/queries/index.js`, `src/main/database/index.js`
- Modify: `src/main/ipc/files.js`
- Modify: `src/preload/index.js`
- Modify: `test/main/database/queries.test.js`

### Task 6.1: Verify there are no remaining callers

- [ ] **Step 1: grep**

```bash
grep -rn "getFilesData\|files:get-data\|filesData" src/ test/
```

Expected output: only the definitions in `media.js`, `queries/index.js`, `database/index.js`, `ipc/files.js`, `preload/index.js`, and the old test block. **No renderer references.** If anything else turns up, stop and reconcile before deletion.

### Task 6.2: Delete the old query, IPC, preload, and test

- [ ] **Step 1: Remove `getFilesData` from `src/main/database/queries/media.js`**

Delete the function (around line 17–65) and its JSDoc.

- [ ] **Step 2: Remove from re-exports**

In `src/main/database/queries/index.js` and `src/main/database/index.js`, remove `getFilesData` from the import lists and export lists.

- [ ] **Step 3: Remove the IPC handler**

In `src/main/ipc/files.js`, remove the `ipcMain.handle('files:get-data', …)` block.

- [ ] **Step 4: Remove the preload binding**

In `src/preload/index.js`, remove the `getFilesData` block (lines 232–234).

- [ ] **Step 5: Remove the old test block**

In `test/main/database/queries.test.js`, remove the entire `describe('getFilesData', …)` block. Remove `getFilesData` from the test file's imports.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Manual smoke**

Run: `npm run dev` — verify the Sources tab still works.

- [ ] **Step 8: Commit**

```bash
git add src/main/database/queries/media.js src/main/database/queries/index.js src/main/database/index.js src/main/ipc/files.js src/preload/index.js test/main/database/queries.test.js
git commit -m "refactor: remove getFilesData (replaced by getSourcesData)"
```

---

## Task 7: Documentation updates

**Files:**
- Modify: `docs/architecture.md`, `docs/database-schema.md`, `docs/ipc-api.md`, `docs/import-export.md`

### Task 7.1: Update each doc

- [ ] **Step 1: Locate "Files tab" / "getFilesData" / "files:get-data" mentions**

```bash
grep -rn "Files tab\|getFilesData\|files:get-data\|filesData" docs/
```

- [ ] **Step 2: For each match, replace with the Sources equivalent**

- "Files tab" → "Sources tab"
- "getFilesData" → "getSourcesData"
- "files:get-data" → "sources:get-data"
- Add (or update) the SourceRow shape description in `docs/ipc-api.md` and `docs/architecture.md`.

In `docs/import-export.md`, add a sentence under the LILA importer subsection noting that LILA imports now set `media.importFolder = dataset.name`.

In `docs/database-schema.md`, no schema change is required — but if it lists indices used by tab queries, add a note that the Sources tab uses `idx_media_importFolder`-style aggregations grouping by `media.importFolder`.

- [ ] **Step 3: Skim CLAUDE.md docs section for any additional doc references and update accordingly.**

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: rename Files tab → Sources tab; document new query and IPC"
```

---

## Task 8: Final verification

### Task 8.1: Full run

- [ ] **Step 1: All tests**

Run: `npm test`
Expected: all tests pass (no regressions, new `getSourcesData` and LILA tests included).

- [ ] **Step 2: Lint**

Run: `npx eslint src/`
Expected: no new warnings/errors.

- [ ] **Step 3: Manual UI smoke matrix**

Open `npm run dev` and verify:

| Scenario | Expected |
|---|---|
| `local/ml_run` study with multiple Add Folder runs | Multiple source rows, Add source enabled, expand reveals deployments |
| `local/ml_run` study with active model_run | In-flight bar on the source row whose `importFolder` matches `modelRuns.importPath` |
| `camtrap/datapackage` study (local files) | Single source row, Local badge, Add source enabled |
| `camtrap/datapackage` study with remote URLs | Single source row, Remote badge, expand may be empty if deployment metadata is sparse |
| `lila/coco` study | Single source row labelled with dataset name, Remote badge, Add source disabled |
| Study with no observations on any media | Empty status column, no ✓, no progress bar |
| Study with completed model run | ✓ pill on each source whose media has at least one observation; tooltip shows count |

- [ ] **Step 4: Open the PR**

Push the branch and open a PR referencing the spec:

```bash
git push -u origin arthur/ui-files-tab-show
GH_TOKEN="" gh pr create --title "feat: Sources tab (multi-source, always visible)" --body "$(cat <<'EOF'
## Summary
- Replaces the local-only Files tab with an always-visible Sources tab supporting local folders, CamtrapDP packages, and LILA datasets.
- Adds new \`getSourcesData\` query; removes \`getFilesData\`.
- LILA parser now sets \`media.importFolder\` to the dataset name.

Spec: docs/specs/2026-04-29-sources-tab-multi-source-design.md

## Test plan
- [ ] All existing tests pass (\`npm test\`)
- [ ] New \`getSourcesData\` integration tests pass
- [ ] New LILA \`importFolder\` test passes
- [ ] Manual UI smoke matrix from the implementation plan
EOF
)"
```

---

## Self-review checklist (filled by plan author)

**Spec coverage:**

- D1 (tab name): Task 4.1 ✓
- D2 (always show): Task 4.1 ✓
- D3 (source = importFolder, no schema change): Tasks 1.1–1.8 ✓
- D4 (GBIF as plain CamtrapDP): no separate task — implicit, no GBIF-specific code added ✓
- D5 (per-row content: icon, name, badge, path, counts, status, info-i): Task 5.2 ✓
- D6 (three status states): Task 5.2 — `StatusCell` ✓
- D7 (global header widget unchanged): no task — explicitly not modified ✓
- D8 (sub-rows = deployments, indented only): Task 5.2 ✓
- D9 (header summary + Add source button, disabled per type): Tasks 5.2 + 5.3 ✓
- D10 (synthesis stays for now): no task — explicit non-change ✓
- LILA parser fix: Task 3 ✓

**Placeholder scan:** no "TODO", "TBD", "fill in" in any task. Code blocks present in every code step.

**Type consistency:** the `SourceRow` shape declared up front is used identically across Tasks 1.1–1.8 and Task 5.2. The `DeploymentRow` shape used in Task 1.6 matches the consumer in Task 5.2.

**Open implementation questions from the spec carry forward:**

- Per-deployment `activeRun` is deferred to a follow-up sub-task within Task 1.8 (only source-level on first cut).
- LILA `folderName` is left null — Task 3 sets `importFolder` only; sub-rows for LILA derive labels from `deployments.locationName`.
