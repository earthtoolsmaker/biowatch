# Media Tab Redesign — Plan 1: Data Layer & IPC

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend query, service, and IPC support the redesigned Media tab needs: a source (`importFolder`) filter, a source-distribution list, per-sequence review status, "needs review" / "low confidence" predicates + counts, and bulk operations (set species, mark blank, mark reviewed).

**Architecture:** Extend the existing two-phase cursor pagination (`src/main/services/sequences/pagination.js`) and its Drizzle SQL layer (`src/main/database/queries/sequences.js`) by threading a new `source` filter through the same `filters` object that already carries `deploymentID`. Add new query functions for source distribution and review-status roll-up, and bulk-mutation functions that reuse the existing `classificationMethod='human'` convention. Surface everything through the existing `sequences:*` / `observations:*` / `media:*` IPC channels.

**Tech Stack:** Node.js ESM, `node --test`, better-sqlite3 via Drizzle ORM, Electron IPC (`ipcMain.handle`), Luxon for dates.

**Spec:** `docs/specs/2026-06-03-media-tab-redesign-design.md` (see "Data Layer", "Review Status", "Quick views").

**Scope note:** This plan is the data foundation only — no renderer/UI work. Plan 2 (Media tab UI) and Plan 3 (URL deep-linking + cross-tab entry points) build on it. **Sort by deployment** is deliberately deferred to a dedicated design step (see "Deferred" at the end) because it interacts with the time-cursor pagination in a non-trivial way; time-direction sort (newest/oldest) is included here as Task 8.

**Conventions to follow (from existing tests):**
- Each query test seeds a temp DB with `createImageDirectoryDatabase(testDbPath)` → `insertDeployments` / `insertMedia` / `insertObservations`, then calls the query with a `dbPath` (string).
- Test files live under `test/main/database/queries/` and `test/main/services/sequences/`, mirror `test/main/database/queries/sequencesDeploymentFilter.test.js`.
- Run a single test file: `node --test test/main/database/queries/<file>.test.js` (no rebuild needed if better-sqlite3 is already built for Node; if you hit a NODE_MODULE_VERSION error run `npm run test:rebuild` once first).
- Commit messages: conventional commits, no co-author/footer.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/main/database/queries/sequences.js` | `getMediaForSequencePagination`, `hasTimestampedMedia` — add `source` filter conditions | Modify |
| `src/main/services/sequences/pagination.js` | Thread `source` through fetch options | Modify |
| `src/main/database/queries/media.js` | `getSourceDistribution`, `getLowConfidenceCount` | Modify |
| `src/main/database/queries/observations.js` | `markObservationsReviewed`, `bulkUpdateClassification`, `bulkMarkBlank`, review-status roll-up helper | Modify |
| `src/main/database/queries/sequences.js` | `getSequenceReviewStatus` (per-sequence reviewed flag) | Modify |
| `src/main/ipc/sequences.js` | pass `source` into options; new `sequences:get-source-distribution` | Modify |
| `src/main/ipc/observations.js` | `observations:bulk-update-classification`, `observations:bulk-mark-reviewed`, `observations:bulk-mark-blank` | Modify |
| `src/main/ipc/media.js` | `media:get-low-confidence-count` | Modify |
| `src/preload/index.js` | expose the new channels on `window.api` | Modify |
| `docs/ipc-api.md`, `docs/database-schema.md` | document new IPC + query behavior | Modify |

---

## Task 1: Source filter — SQL layer (timestamped + null phases)

Add an optional `source` (matches `media.importFolder`) filter to `getMediaForSequencePagination`, mirroring the existing `deploymentID` filter at every condition site (timestamped phase, null phase).

**Files:**
- Modify: `src/main/database/queries/sequences.js` (function `getMediaForSequencePagination` ~line 88; condition sites near lines 310, 448, 510; destructure ~line 95)
- Test: `test/main/database/queries/sequencesSourceFilter.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/main/database/queries/sequencesSourceFilter.test.js`:

```js
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getMediaForSequencePagination,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-sourcefilter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-sourcefilter-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

async function seed() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: {
      deploymentID: 'd1', locationID: 'loc1', locationName: 'Site A',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 1, longitude: 1, cameraID: 'cam1'
    }
  })
  // two sources, distinguished by importFolder
  await insertMedia(manager, {
    'a.jpg': { mediaID: 'a', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'), filePath: '/a.jpg', fileName: 'a.jpg', importFolder: 'ndutu_2024' },
    'b.jpg': { mediaID: 'b', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'), filePath: '/b.jpg', fileName: 'b.jpg', importFolder: 'serengeti_2023' },
    'c-null.jpg': { mediaID: 'c', deploymentID: 'd1', timestamp: null, filePath: '/c.jpg', fileName: 'c.jpg', importFolder: 'ndutu_2024' }
  })
}

describe('getMediaForSequencePagination — source filter', () => {
  test('no source: returns media from all sources (timestamped phase)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: null, batchSize: 100, species: [], dateRange: {}, timeRange: {}
    })
    assert.deepEqual(result.media.map((m) => m.mediaID).sort(), ['a', 'b'])
  })

  test('with source: only matching source (timestamped phase)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: null, batchSize: 100, species: [], dateRange: {}, timeRange: {}, source: 'ndutu_2024'
    })
    assert.deepEqual(result.media.map((m) => m.mediaID).sort(), ['a'])
  })

  test('with source: only matching source (null phase)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: { phase: 'null', offset: 0 }, batchSize: 100, species: [], dateRange: {}, timeRange: {}, source: 'ndutu_2024'
    })
    assert.deepEqual(result.media.map((m) => m.mediaID).sort(), ['c'])
  })

  test('non-existent source: empty, no error', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: null, batchSize: 100, species: [], dateRange: {}, timeRange: {}, source: 'nope'
    })
    assert.deepEqual(result.media, [])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/main/database/queries/sequencesSourceFilter.test.js`
Expected: FAIL — the `source` filter is ignored, so the "only matching source" tests return extra rows.

- [ ] **Step 3: Implement the filter**

In `src/main/database/queries/sequences.js`, add `source = null` to the options destructure (~line 95, alongside `deploymentID = null`). Then at EACH place the code does:

```js
if (deploymentID) {
  timestampedConditions.push(eq(media.deploymentID, deploymentID))
}
```

add directly after it:

```js
if (source) {
  timestampedConditions.push(eq(media.importFolder, source))
}
```

Do the same for the null-phase condition arrays (the `nullConditions.push(eq(media.deploymentID, deploymentID))` sites ~lines 448 and 510). Use the matching local conditions array name at each site.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/main/database/queries/sequencesSourceFilter.test.js`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/main/database/queries/sequences.js test/main/database/queries/sequencesSourceFilter.test.js
git commit -m "feat(sequences): add source (importFolder) filter to pagination query"
```

---

## Task 2: Source filter — hasTimestampedMedia + pagination service + IPC

Thread `source` through `hasTimestampedMedia` and the pagination service so it reaches the SQL layer end-to-end, and accept it from the IPC handler.

**Files:**
- Modify: `src/main/database/queries/sequences.js` (`hasTimestampedMedia` ~line 628)
- Modify: `src/main/services/sequences/pagination.js` (destructure filters ~line 82; pass `source` into `hasTimestampedMedia`, `fetchTimestampedSequences`, `fetchNullTimestampSequences`, `getMediaForSequencePagination` calls)
- Modify: `src/main/ipc/sequences.js` (`sequences:get-paginated` ~line 212)
- Test: `test/main/services/sequences/paginationSourceFilter.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/main/services/sequences/paginationSourceFilter.test.js` (mirror `paginationDeploymentFilter.test.js`):

```js
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import { getPaginatedSequences } from '../../../../src/main/services/sequences/index.js'
import {
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-pag-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-pag-source-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

async function seed() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: {
      deploymentID: 'd1', locationID: 'loc1', locationName: 'Site A',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 1, longitude: 1, cameraID: 'cam1'
    }
  })
  await insertMedia(manager, {
    'a.jpg': { mediaID: 'a', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'), filePath: '/a.jpg', fileName: 'a.jpg', importFolder: 'src1' },
    'b.jpg': { mediaID: 'b', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'), filePath: '/b.jpg', fileName: 'b.jpg', importFolder: 'src2' }
  })
}

describe('getPaginatedSequences — source filter', () => {
  test('source filter narrows to that source only', async () => {
    await seed()
    const result = await getPaginatedSequences(testDbPath, {
      gapSeconds: 60, limit: 20, filters: { source: 'src1' }
    })
    const ids = result.sequences.flatMap((s) => s.items.map((i) => i.mediaID)).sort()
    assert.deepEqual(ids, ['a'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/main/services/sequences/paginationSourceFilter.test.js`
Expected: FAIL — `source` not threaded; both sequences returned.

- [ ] **Step 3: Implement threading**

In `src/main/services/sequences/pagination.js`:
- Add `source = null` to the filters destructure (~line 82): `const { species = [], dateRange = {}, timeRange = {}, deploymentID = null, bbox = null, source = null } = filters`
- Add `source` to the `hasTimestampedMedia(dbPath, { ... })` call (~line 93).
- Add `source` to the options object passed to `fetchTimestampedSequences` (~line 111) and `fetchNullTimestampSequences` (~line 141).
- In `fetchTimestampedSequences`, `fetchMoreForLargeSequence`, and `fetchNullTimestampSequences`, add `source` to the destructure and pass `source` into every `getMediaForSequencePagination(dbPath, { ... })` call.

In `src/main/database/queries/sequences.js` `hasTimestampedMedia` (~line 628): add `source = null` to destructure and `if (source) conditions.push(eq(media.importFolder, source))`.

In `src/main/ipc/sequences.js` `sequences:get-paginated`: no change needed if it forwards `options` verbatim. Verify it passes `options.filters` through untouched; if it explicitly rebuilds `filters`, add `source` to that rebuild.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/main/services/sequences/paginationSourceFilter.test.js`
Expected: PASS.

- [ ] **Step 5: Run the deployment-filter tests to confirm no regression**

Run: `node --test test/main/services/sequences/paginationDeploymentFilter.test.js test/main/database/queries/sequencesDeploymentFilter.test.js`
Expected: PASS (unchanged behavior).

- [ ] **Step 6: Commit**

```bash
git add src/main/database/queries/sequences.js src/main/services/sequences/pagination.js src/main/ipc/sequences.js test/main/services/sequences/paginationSourceFilter.test.js
git commit -m "feat(sequences): thread source filter through pagination service and IPC"
```

---

## Task 3: Source distribution query (sources + counts for the drawer)

Provide the list of import sources with media counts, for the Source picker in the filter drawer. Model after the deployment/species count queries.

**Files:**
- Modify: `src/main/database/queries/media.js` (add `getSourceDistribution`)
- Modify: `src/main/database/index.js` (export it if the file re-exports query functions — follow the existing export pattern for `getBlankMediaCount`)
- Modify: `src/main/ipc/sequences.js` (add `sequences:get-source-distribution`)
- Modify: `src/preload/index.js` (expose `getSourceDistribution`)
- Test: `test/main/database/queries/getSourceDistribution.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/main/database/queries/getSourceDistribution.test.js`:

```js
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getSourceDistribution,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-srcdist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-srcdist-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

describe('getSourceDistribution', () => {
  test('returns each importFolder with its media count, descending', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1', locationID: 'loc1', locationName: 'A',
        deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
        latitude: 1, longitude: 1, cameraID: 'c1'
      }
    })
    await insertMedia(manager, {
      'a.jpg': { mediaID: 'a', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'), filePath: '/a.jpg', fileName: 'a.jpg', importFolder: 'src1' },
      'b.jpg': { mediaID: 'b', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'), filePath: '/b.jpg', fileName: 'b.jpg', importFolder: 'src1' },
      'c.jpg': { mediaID: 'c', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-03T10:00:00Z'), filePath: '/c.jpg', fileName: 'c.jpg', importFolder: 'src2' }
    })
    const result = await getSourceDistribution(testDbPath)
    assert.deepEqual(result, [
      { source: 'src1', count: 2 },
      { source: 'src2', count: 1 }
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/main/database/queries/getSourceDistribution.test.js`
Expected: FAIL — `getSourceDistribution` is not exported.

- [ ] **Step 3: Implement the query**

In `src/main/database/queries/media.js`, add (follow the Drizzle import style already in the file — `getDrizzleDb`, `media`, `sql`, `count`, `desc`, `isNotNull`):

```js
/**
 * List import sources (media.importFolder) with their media counts, descending.
 * Used by the Media tab's Source filter. Rows with a null importFolder are excluded.
 * @param {string} dbPath
 * @returns {Promise<Array<{source: string, count: number}>>}
 */
export async function getSourceDistribution(dbPath) {
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath)
  const rows = await db
    .select({ source: media.importFolder, count: count() })
    .from(media)
    .where(isNotNull(media.importFolder))
    .groupBy(media.importFolder)
    .orderBy(desc(count()))
    .all()
  return rows.map((r) => ({ source: r.source, count: Number(r.count) }))
}
```

Add any missing imports (`count`, `desc`, `isNotNull` from `drizzle-orm`; `getStudyIdFromPath` from `./utils.js`). Re-export `getSourceDistribution` from `src/main/database/index.js` next to the other media query exports.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/main/database/queries/getSourceDistribution.test.js`
Expected: PASS.

- [ ] **Step 5: Wire IPC + preload**

In `src/main/ipc/sequences.js`, add near the other distribution handlers:

```js
ipcMain.handle('sequences:get-source-distribution', async (_, studyId) => {
  const dbPath = getStudyDbPath(studyId) // use whatever path helper the sibling handlers use
  try {
    return { data: await getSourceDistribution(dbPath) }
  } catch (error) {
    log.error('Error getting source distribution:', error)
    return { error: error.message }
  }
})
```

Match the exact dbPath-resolution + return-shape (`{ data }` / `{ error }`) used by `sequences:get-species-distribution` in the same file. Import `getSourceDistribution`.

In `src/preload/index.js`, expose it alongside the sibling `getSpeciesDistribution` mapping:

```js
getSourceDistribution: (studyId) => ipcRenderer.invoke('sequences:get-source-distribution', studyId),
```

- [ ] **Step 6: Commit**

```bash
git add src/main/database/queries/media.js src/main/database/index.js src/main/ipc/sequences.js src/preload/index.js test/main/database/queries/getSourceDistribution.test.js
git commit -m "feat(media): add source distribution query and IPC for the Source filter"
```

---

## Task 4: Per-sequence review status roll-up

Compute whether a sequence is human-reviewed from its observations' `classificationMethod`, and attach `reviewed: boolean` to each sequence in the pagination payload so Grid/Table render it with no extra calls. Rule (per spec default): a sequence is `reviewed` when it has at least one observation and **every** non-null-species observation has `classificationMethod === 'human'`.

**Files:**
- Modify: `src/main/database/queries/sequences.js` (add `getSequenceReviewStatus(dbPath, mediaIDs)` → Map of mediaID→method rollup)
- Modify: `src/main/services/sequences/pagination.js` (after grouping, attach `reviewed` per sequence)
- Test: `test/main/database/queries/getSequenceReviewStatus.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/main/database/queries/getSequenceReviewStatus.test.js`:

```js
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getSequenceReviewStatus,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-revstatus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-revstatus-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

async function seedBase() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: {
      deploymentID: 'd1', locationID: 'loc1', locationName: 'A',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 1, longitude: 1, cameraID: 'c1'
    }
  })
  await insertMedia(manager, {
    'm1.jpg': { mediaID: 'm1', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'), filePath: '/m1.jpg', fileName: 'm1.jpg' },
    'm2.jpg': { mediaID: 'm2', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'), filePath: '/m2.jpg', fileName: 'm2.jpg' }
  })
  return manager
}

describe('getSequenceReviewStatus', () => {
  test('media with all-human observations → reviewed true; any-machine → false', async () => {
    const manager = await seedBase()
    await insertObservations(manager, {
      o1: { observationID: 'o1', mediaID: 'm1', deploymentID: 'd1', scientificName: 'Panthera pardus', observationType: 'animal', classificationMethod: 'human' },
      o2: { observationID: 'o2', mediaID: 'm2', deploymentID: 'd1', scientificName: 'Panthera pardus', observationType: 'animal', classificationMethod: 'machine' }
    })
    const status = await getSequenceReviewStatus(testDbPath, ['m1', 'm2'])
    assert.equal(status.get('m1'), true)
    assert.equal(status.get('m2'), false)
  })

  test('media with no observations → reviewed false', async () => {
    await seedBase()
    const status = await getSequenceReviewStatus(testDbPath, ['m1'])
    assert.equal(status.get('m1'), false)
  })
})
```

> If `insertObservations` requires different/required fields, adjust the seed to match its signature (see `src/main/database/queries/observations.js` `insertObservations` ~line 444). Keep `classificationMethod` as the discriminator.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/main/database/queries/getSequenceReviewStatus.test.js`
Expected: FAIL — `getSequenceReviewStatus` not exported.

- [ ] **Step 3: Implement the roll-up query**

In `src/main/database/queries/sequences.js` add:

```js
/**
 * For each given mediaID, determine whether it is human-reviewed: it has at
 * least one observation and every observation has classificationMethod='human'.
 * @param {string} dbPath
 * @param {string[]} mediaIDs
 * @returns {Promise<Map<string, boolean>>} mediaID -> reviewed
 */
export async function getSequenceReviewStatus(dbPath, mediaIDs) {
  const result = new Map(mediaIDs.map((id) => [id, false]))
  if (mediaIDs.length === 0) return result
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath)
  const rows = await db
    .select({
      mediaID: observations.mediaID,
      total: count(),
      humanCount: sql`SUM(CASE WHEN ${observations.classificationMethod} = 'human' THEN 1 ELSE 0 END)`
    })
    .from(observations)
    .where(inArray(observations.mediaID, mediaIDs))
    .groupBy(observations.mediaID)
    .all()
  for (const r of rows) {
    result.set(r.mediaID, Number(r.total) > 0 && Number(r.humanCount) === Number(r.total))
  }
  return result
}
```

Add imports as needed (`observations` model, `count`, `sql`, `inArray` from `drizzle-orm`). Re-export from `src/main/database/index.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/main/database/queries/getSequenceReviewStatus.test.js`
Expected: PASS.

- [ ] **Step 5: Attach `reviewed` to sequences in the service**

In `src/main/services/sequences/pagination.js`, in `getPaginatedSequences`, after the sequences array is assembled and before the final `return`, collect all mediaIDs, call `getSequenceReviewStatus`, and set `seq.reviewed = items.every((i) => statusMap.get(i.mediaID))`:

```js
import { getSequenceReviewStatus } from '../../database/queries/sequences.js'
// ...after building `sequences`, before returning:
const allMediaIDs = sequences.flatMap((s) => s.items.map((i) => i.mediaID))
const reviewStatus = await getSequenceReviewStatus(dbPath, allMediaIDs)
for (const seq of sequences) {
  seq.reviewed = seq.items.length > 0 && seq.items.every((i) => reviewStatus.get(i.mediaID) === true)
}
```

- [ ] **Step 6: Add a service-level test**

Append to `test/main/services/sequences/paginationSourceFilter.test.js` a test (or create `paginationReviewStatus.test.js`) asserting a sequence whose media are all human-classified comes back with `reviewed === true`. Reuse the seed pattern + `insertObservations`.

- [ ] **Step 7: Run tests**

Run: `node --test test/main/services/sequences/paginationReviewStatus.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/database/queries/sequences.js src/main/database/index.js src/main/services/sequences/pagination.js test/main/database/queries/getSequenceReviewStatus.test.js test/main/services/sequences/paginationReviewStatus.test.js
git commit -m "feat(sequences): attach per-sequence human-review status to pagination payload"
```

---

## Task 5: Bulk "Mark reviewed"

Set `classificationMethod='human'` / `classifiedBy='User'` / `classificationTimestamp=now` on all observations belonging to the given media, WITHOUT changing `scientificName` — captures "AI was right, confirmed".

**Files:**
- Modify: `src/main/database/queries/observations.js` (add `markMediaReviewed(dbPath, mediaIDs)`)
- Modify: `src/main/database/index.js` (export)
- Modify: `src/main/ipc/observations.js` (`observations:bulk-mark-reviewed`)
- Modify: `src/preload/index.js` (expose `bulkMarkReviewed`)
- Test: `test/main/database/markMediaReviewed.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/main/database/markMediaReviewed.test.js`:

```js
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  markMediaReviewed,
  getSequenceReviewStatus,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-markrev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-markrev-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

describe('markMediaReviewed', () => {
  test('flips machine observations to human without changing species', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    await insertDeployments(manager, {
      d1: { deploymentID: 'd1', locationID: 'l1', locationName: 'A',
        deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
        latitude: 1, longitude: 1, cameraID: 'c1' }
    })
    await insertMedia(manager, {
      'm1.jpg': { mediaID: 'm1', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'), filePath: '/m1.jpg', fileName: 'm1.jpg' }
    })
    await insertObservations(manager, {
      o1: { observationID: 'o1', mediaID: 'm1', deploymentID: 'd1', scientificName: 'Panthera pardus', observationType: 'animal', classificationMethod: 'machine' }
    })

    const res = await markMediaReviewed(testDbPath, ['m1'])
    assert.equal(res.updated, 1)

    const status = await getSequenceReviewStatus(testDbPath, ['m1'])
    assert.equal(status.get('m1'), true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/main/database/markMediaReviewed.test.js`
Expected: FAIL — `markMediaReviewed` not exported.

- [ ] **Step 3: Implement**

In `src/main/database/queries/observations.js` add:

```js
/**
 * Mark all observations for the given media as human-reviewed, without changing
 * their species. Sets classificationMethod='human', classifiedBy='User',
 * classificationTimestamp=now. Idempotent.
 * @param {string} dbPath
 * @param {string[]} mediaIDs
 * @returns {Promise<{updated: number}>}
 */
export async function markMediaReviewed(dbPath, mediaIDs) {
  if (!Array.isArray(mediaIDs) || mediaIDs.length === 0) return { updated: 0 }
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath)
  const r = await db
    .update(observations)
    .set({
      classificationMethod: 'human',
      classifiedBy: 'User',
      classificationTimestamp: new Date().toISOString()
    })
    .where(inArray(observations.mediaID, mediaIDs))
  return { updated: r.changes ?? mediaIDs.length }
}
```

Add `inArray` to the `drizzle-orm` import. Re-export from `src/main/database/index.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/main/database/markMediaReviewed.test.js`
Expected: PASS.

- [ ] **Step 5: Wire IPC + preload**

In `src/main/ipc/observations.js` (mirror the existing `observations:update-classification` handler's dbPath resolution + db-close pattern):

```js
ipcMain.handle('observations:bulk-mark-reviewed', async (_, studyId, mediaIDs) => {
  const dbPath = /* same helper the sibling handlers use */
  try {
    return await markMediaReviewed(dbPath, mediaIDs)
  } catch (error) {
    log.error('Error in bulk-mark-reviewed:', error)
    return { error: error.message }
  }
})
```

In `src/preload/index.js`: `bulkMarkReviewed: (studyId, mediaIDs) => ipcRenderer.invoke('observations:bulk-mark-reviewed', studyId, mediaIDs),`

- [ ] **Step 6: Commit**

```bash
git add src/main/database/queries/observations.js src/main/database/index.js src/main/ipc/observations.js src/preload/index.js test/main/database/markMediaReviewed.test.js
git commit -m "feat(observations): add bulk mark-reviewed (human-confirm without relabel)"
```

---

## Task 6: Bulk "Set species" and "Mark blank"

Bulk-apply a species (or blank) to all observations of the given media, reusing the single-observation `updateObservationClassification` semantics (which already set `classificationMethod='human'`).

**Files:**
- Modify: `src/main/database/queries/observations.js` (`bulkSetSpecies(dbPath, mediaIDs, { scientificName, commonName })`, `bulkMarkBlank(dbPath, mediaIDs)`)
- Modify: `src/main/database/index.js` (export)
- Modify: `src/main/ipc/observations.js` (`observations:bulk-update-classification`, `observations:bulk-mark-blank`)
- Modify: `src/preload/index.js` (expose `bulkSetSpecies`, `bulkMarkBlank`)
- Test: `test/main/database/bulkSetSpecies.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/main/database/bulkSetSpecies.test.js`:

```js
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  bulkSetSpecies,
  bulkMarkBlank,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations,
  getMediaBboxes
} from '../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-bulkspecies-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-bulkspecies-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

async function seedTwoMachineObs() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: { deploymentID: 'd1', locationID: 'l1', locationName: 'A',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 1, longitude: 1, cameraID: 'c1' }
  })
  await insertMedia(manager, {
    'm1.jpg': { mediaID: 'm1', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'), filePath: '/m1.jpg', fileName: 'm1.jpg' },
    'm2.jpg': { mediaID: 'm2', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'), filePath: '/m2.jpg', fileName: 'm2.jpg' }
  })
  await insertObservations(manager, {
    o1: { observationID: 'o1', mediaID: 'm1', deploymentID: 'd1', scientificName: 'Genetta genetta', observationType: 'animal', classificationMethod: 'machine' },
    o2: { observationID: 'o2', mediaID: 'm2', deploymentID: 'd1', scientificName: 'Genetta genetta', observationType: 'animal', classificationMethod: 'machine' }
  })
}

describe('bulkSetSpecies', () => {
  test('relabels every observation for the media and marks them human', async () => {
    await seedTwoMachineObs()
    const res = await bulkSetSpecies(testDbPath, ['m1', 'm2'], { scientificName: 'Tragelaphus scriptus' })
    assert.equal(res.updated >= 2, true)
    const obs = await getMediaBboxes(testDbPath, 'm1', true)
    assert.equal(obs[0].scientificName, 'Tragelaphus scriptus')
    assert.equal(obs[0].classificationMethod, 'human')
  })
})

describe('bulkMarkBlank', () => {
  test('sets observationType blank and clears species', async () => {
    await seedTwoMachineObs()
    const res = await bulkMarkBlank(testDbPath, ['m1'])
    assert.equal(res.updated >= 1, true)
    const obs = await getMediaBboxes(testDbPath, 'm1', true)
    assert.equal(obs[0].scientificName, null)
    assert.equal(obs[0].observationType, 'blank')
  })
})
```

> Verify the exact `getMediaBboxes` signature/return shape in `src/main/database/queries/observations.js` (it's used by `media:get-bboxes`); adjust the assertions to the real field names if needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/main/database/bulkSetSpecies.test.js`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

In `src/main/database/queries/observations.js`:

```js
/**
 * Bulk-set the species for all observations of the given media. Marks them
 * human-classified (classificationMethod='human', classifiedBy='User',
 * classificationTimestamp=now, classificationProbability=null) per CamTrap DP.
 */
export async function bulkSetSpecies(dbPath, mediaIDs, { scientificName, commonName = null }) {
  if (!Array.isArray(mediaIDs) || mediaIDs.length === 0) return { updated: 0 }
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath)
  const sci = normalizeScientificName(scientificName)
  const r = await db
    .update(observations)
    .set({
      scientificName: sci || null,
      commonName: sci && typeof commonName === 'string' && commonName.length > 0 ? commonName : null,
      observationType: 'animal',
      classificationMethod: 'human',
      classifiedBy: 'User',
      classificationTimestamp: new Date().toISOString(),
      classificationProbability: null
    })
    .where(inArray(observations.mediaID, mediaIDs))
  return { updated: r.changes ?? mediaIDs.length }
}

/**
 * Bulk-mark the given media as blank: clear species, set observationType='blank',
 * mark human-classified.
 */
export async function bulkMarkBlank(dbPath, mediaIDs) {
  if (!Array.isArray(mediaIDs) || mediaIDs.length === 0) return { updated: 0 }
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath)
  const r = await db
    .update(observations)
    .set({
      scientificName: null,
      commonName: null,
      observationType: 'blank',
      classificationMethod: 'human',
      classifiedBy: 'User',
      classificationTimestamp: new Date().toISOString(),
      classificationProbability: null
    })
    .where(inArray(observations.mediaID, mediaIDs))
  return { updated: r.changes ?? mediaIDs.length }
}
```

Re-export both from `src/main/database/index.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/main/database/bulkSetSpecies.test.js`
Expected: PASS.

- [ ] **Step 5: Wire IPC + preload**

In `src/main/ipc/observations.js` add `observations:bulk-update-classification` (calls `bulkSetSpecies`) and `observations:bulk-mark-blank` (calls `bulkMarkBlank`), matching the sibling handlers' dbPath + error-shape pattern. In `src/preload/index.js`:

```js
bulkSetSpecies: (studyId, mediaIDs, classification) => ipcRenderer.invoke('observations:bulk-update-classification', studyId, mediaIDs, classification),
bulkMarkBlank: (studyId, mediaIDs) => ipcRenderer.invoke('observations:bulk-mark-blank', studyId, mediaIDs),
```

- [ ] **Step 6: Commit**

```bash
git add src/main/database/queries/observations.js src/main/database/index.js src/main/ipc/observations.js src/preload/index.js test/main/database/bulkSetSpecies.test.js
git commit -m "feat(observations): add bulk set-species and mark-blank operations"
```

---

## Task 7: Low-confidence count + quick-view predicate

The "Low confidence" quick view needs (a) a count for the pill and (b) a way to filter the gallery to low-confidence sequences. Define low confidence as `classificationProbability < THRESHOLD` (default 0.5) on a machine classification. Reuse the existing favorites/blank/vehicle filtering machinery for the gallery side via a `filters.lowConfidence` flag if a SQL predicate is straightforward; otherwise expose only the count here and implement the gallery predicate alongside the other quick-view flags.

**Files:**
- Modify: `src/main/database/queries/media.js` (add `getLowConfidenceCount(dbPath, threshold)`)
- Modify: `src/main/database/index.js` (export)
- Modify: `src/main/ipc/media.js` (`media:get-low-confidence-count`)
- Modify: `src/preload/index.js` (expose `getLowConfidenceCount`)
- Test: `test/main/database/queries/getLowConfidenceCount.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/main/database/queries/getLowConfidenceCount.test.js`:

```js
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getLowConfidenceCount,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-lowconf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-lowconf-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

describe('getLowConfidenceCount', () => {
  test('counts distinct media with a machine observation below the threshold', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    await insertDeployments(manager, {
      d1: { deploymentID: 'd1', locationID: 'l1', locationName: 'A',
        deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
        latitude: 1, longitude: 1, cameraID: 'c1' }
    })
    await insertMedia(manager, {
      'm1.jpg': { mediaID: 'm1', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'), filePath: '/m1.jpg', fileName: 'm1.jpg' },
      'm2.jpg': { mediaID: 'm2', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'), filePath: '/m2.jpg', fileName: 'm2.jpg' }
    })
    await insertObservations(manager, {
      o1: { observationID: 'o1', mediaID: 'm1', deploymentID: 'd1', scientificName: 'Genetta genetta', observationType: 'animal', classificationMethod: 'machine', classificationProbability: 0.42 },
      o2: { observationID: 'o2', mediaID: 'm2', deploymentID: 'd1', scientificName: 'Panthera pardus', observationType: 'animal', classificationMethod: 'machine', classificationProbability: 0.91 }
    })
    const count = await getLowConfidenceCount(testDbPath, 0.5)
    assert.equal(count, 1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/main/database/queries/getLowConfidenceCount.test.js`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement**

In `src/main/database/queries/media.js`:

```js
/**
 * Count distinct media that have at least one MACHINE observation whose
 * classificationProbability is below the threshold. Used by the "Low confidence"
 * quick view.
 * @param {string} dbPath
 * @param {number} [threshold=0.5]
 * @returns {Promise<number>}
 */
export async function getLowConfidenceCount(dbPath, threshold = 0.5) {
  const studyId = getStudyIdFromPath(dbPath)
  const db = await getDrizzleDb(studyId, dbPath)
  const row = await db
    .select({ c: sql`COUNT(DISTINCT ${observations.mediaID})` })
    .from(observations)
    .where(
      and(
        eq(observations.classificationMethod, 'machine'),
        isNotNull(observations.classificationProbability),
        lt(observations.classificationProbability, threshold)
      )
    )
    .get()
  return Number(row?.c ?? 0)
}
```

Add imports (`observations` model, `and`, `eq`, `lt`, `isNotNull`, `sql` from `drizzle-orm`). Re-export from `src/main/database/index.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/main/database/queries/getLowConfidenceCount.test.js`
Expected: PASS.

- [ ] **Step 5: Wire IPC + preload**

`src/main/ipc/media.js`: add `media:get-low-confidence-count` mirroring the `media:get-blank-count` handler (dbPath resolution + db close + return shape). `src/preload/index.js`: `getLowConfidenceCount: (studyId, threshold) => ipcRenderer.invoke('media:get-low-confidence-count', studyId, threshold),`

- [ ] **Step 6: Commit**

```bash
git add src/main/database/queries/media.js src/main/database/index.js src/main/ipc/media.js src/preload/index.js test/main/database/queries/getLowConfidenceCount.test.js
git commit -m "feat(media): add low-confidence count for the Low confidence quick view"
```

---

## Task 8: Sort by time direction (newest / oldest)

Add a `sort` option to `getPaginatedSequences` supporting `'newest'` (existing default, time-desc) and `'oldest'` (time-asc). This drives the Grid sort dropdown and the Table "When" header.

**Files:**
- Modify: `src/main/database/queries/sequences.js` (`getMediaForSequencePagination` ordering + cursor comparison)
- Modify: `src/main/services/sequences/pagination.js` (accept `sort`, thread to DB layer)
- Test: `test/main/services/sequences/paginationSort.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/main/services/sequences/paginationSort.test.js`:

```js
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import { getPaginatedSequences } from '../../../../src/main/services/sequences/index.js'
import {
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-pag-sort-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-pag-sort-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

async function seedThreeDays() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: { deploymentID: 'd1', locationID: 'l1', locationName: 'A',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 1, longitude: 1, cameraID: 'c1' }
  })
  // Three media a day apart → with a small gap each is its own sequence
  await insertMedia(manager, {
    'm1.jpg': { mediaID: 'm1', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'), filePath: '/m1.jpg', fileName: 'm1.jpg' },
    'm2.jpg': { mediaID: 'm2', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'), filePath: '/m2.jpg', fileName: 'm2.jpg' },
    'm3.jpg': { mediaID: 'm3', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-03T10:00:00Z'), filePath: '/m3.jpg', fileName: 'm3.jpg' }
  })
}

describe('getPaginatedSequences — sort', () => {
  test('newest (default): most recent sequence first', async () => {
    await seedThreeDays()
    const res = await getPaginatedSequences(testDbPath, { gapSeconds: 1, limit: 20, sort: 'newest' })
    const firstIDs = res.sequences.map((s) => s.items[0].mediaID)
    assert.deepEqual(firstIDs, ['m3', 'm2', 'm1'])
  })

  test('oldest: earliest sequence first', async () => {
    await seedThreeDays()
    const res = await getPaginatedSequences(testDbPath, { gapSeconds: 1, limit: 20, sort: 'oldest' })
    const firstIDs = res.sequences.map((s) => s.items[0].mediaID)
    assert.deepEqual(firstIDs, ['m1', 'm2', 'm3'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/main/services/sequences/paginationSort.test.js`
Expected: FAIL — `oldest` returns the same order as `newest` (sort ignored).

- [ ] **Step 3: Implement**

In `src/main/database/queries/sequences.js` `getMediaForSequencePagination`: accept `sort = 'newest'`. The timestamped-phase query currently orders by `desc(media.timestamp)` (and uses a `<` cursor comparison). When `sort === 'oldest'`, order by `asc(media.timestamp)` and flip the cursor comparison to `>`. Keep the null phase unchanged. Confirm the boundary/cursor fields in `pagination.js` still reference `lastItem.timestamp` correctly under both orders (the grouping there sorts by timestamp ascending internally; verify the "earliest in incomplete" cursor logic holds for `oldest` — if the look-ahead boundary picks the wrong end, gate that selection on `sort`).

In `src/main/services/sequences/pagination.js`: destructure `sort = 'newest'` from `options`, and pass `sort` into every `getMediaForSequencePagination` call and into `fetchTimestampedSequences`/`fetchMoreForLargeSequence`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/main/services/sequences/paginationSort.test.js`
Expected: PASS.

- [ ] **Step 5: Regression — existing pagination tests**

Run: `node --test test/main/services/sequences/pagination.test.js test/main/database/queries/sequencesTimeRange.test.js`
Expected: PASS (default `newest` behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/main/database/queries/sequences.js src/main/services/sequences/pagination.js test/main/services/sequences/paginationSort.test.js
git commit -m "feat(sequences): support newest/oldest sort in pagination"
```

---

## Task 9: Documentation

**Files:**
- Modify: `docs/ipc-api.md` (new channels: `sequences:get-source-distribution`, `observations:bulk-mark-reviewed`, `observations:bulk-update-classification`, `observations:bulk-mark-blank`, `media:get-low-confidence-count`; new `source`/`sort` options on `sequences:get-paginated`; new `reviewed` field on returned sequences)
- Modify: `docs/database-schema.md` (note that `classificationMethod='human'` is the review-status source of truth; document the source/low-confidence/review-status query semantics)

- [ ] **Step 1: Update docs**

Add the new IPC channels with request/response shapes following the existing table/format in `docs/ipc-api.md`. In `docs/database-schema.md`, add a short "Review status" subsection explaining the `classificationMethod` roll-up rule (all observations human ⇒ reviewed) and the low-confidence definition (`machine` + `classificationProbability < 0.5`).

- [ ] **Step 2: Commit**

```bash
git add docs/ipc-api.md docs/database-schema.md
git commit -m "docs: document Media tab data-layer IPC and review-status semantics"
```

---

## Final verification

- [ ] **Run the full main/database + services test suites**

Run: `node --test 'test/main/**/*.test.js'`
Expected: PASS (new tests + no regressions). If you see a NODE_MODULE_VERSION/better-sqlite3 error, run `npm run test:rebuild` first, then re-run.

- [ ] **Confirm the API surface**

`grep -n "getSourceDistribution\|getSequenceReviewStatus\|markMediaReviewed\|bulkSetSpecies\|bulkMarkBlank\|getLowConfidenceCount" src/preload/index.js` — all six should be exposed on `window.api`.

---

## Deferred to a dedicated step (not in this plan)

- **Sort by deployment** — grouping/ordering sequences by deployment name interacts with the time-cursor pagination (the cursor encodes a timestamp, not a deployment key). This needs its own small design (e.g. composite cursor `{deployment, timestamp}` or a deployment-then-time ordering) before implementation. Flagged in the spec's Risks. Pick it up as a focused follow-up once Tasks 1–8 land; the Grid/Table UI in Plan 2 can ship with newest/oldest + the deployment **filter** in the meantime.
- **Quick-view gallery predicates** for needs-review / reviewed / low-confidence as `filters.*` flags on `getPaginatedSequences` (counts are covered here; the gallery-side filtering flags are small additions that Plan 2 can drive — implement them when wiring each quick view, mirroring the existing favorites/blank/vehicle filter flags).

---

## Self-Review Notes

- **Spec coverage:** source filter (Tasks 1–3), source distribution for drawer (Task 3), review status surfaced per sequence (Task 4), Mark reviewed bulk (Task 5), Set species + Mark blank bulk (Task 6), low-confidence count (Task 7), sort newest/oldest (Task 8). Deployment-sort and per-view quick-view filter flags explicitly deferred with rationale.
- **Type consistency:** new functions return documented shapes (`{updated:number}`, `Map<string,boolean>`, `Array<{source,count}>`, `number`); `reviewed` is a boolean on each sequence; IPC handlers use the `{ data } / { error }` convention of their sibling handlers (verify per file).
- **Known verification points called out inline:** exact dbPath helper per IPC file, `insertObservations` required fields, `getMediaBboxes` return shape, and the `oldest`-sort boundary-cursor edge in `pagination.js` — each task tells the engineer to confirm against the real code rather than assuming.
