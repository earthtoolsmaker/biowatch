# Add Source — Merge another study — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the Sources-tab "+ Add images directory" action into "+ Add source" — a wizard that lets the user either pick a folder (existing flow) or merge another local study into the current one. Merge is DB-only, no file copies, no new filesystem artifacts.

**Architecture:** Provenance is encoded entirely in `media.importFolder = "merge:<B-uuid>"` plus PK prefixes (`study:<B-uuid-short>:`) on B's deployment/media/observation IDs. Files referenced by B remain at their original location. A delete-time warning fires when B is a CamtrapDP-downloaded-into-biowatch study that has been merged into others — the only case where B's deletion actually breaks files.

**Tech Stack:** Electron 30, Node 20, better-sqlite3 via Drizzle ORM, React 18, Vitest-style structure but Node's built-in `node --test` runner with `node:assert/strict`. ESM throughout (explicit `./index.js` paths).

**Reference spec:** `docs/specs/2026-05-18-merge-study-as-source-design.md`

---

## File Structure

**New backend module** (`src/main/services/merge/`):
- `helpers.js` — pure ID/path helpers (`getMergeImportFolder`, `getMergePrefix`, `parseMergeUuid`, `isMergedImportFolder`, `prefixRow`).
- `preflight.js` — `mergePreflight(targetId, sourceId)` returning counts; no writes.
- `index.js` — `mergeStudy(targetId, sourceId, reviewed)` orchestration in one SQLite transaction.
- `bDeletion.js` — `getAtRiskMergeBreaks(sourceStudyId)` for the delete-time warning.

**Modified backend:**
- `src/main/database/queries/sources.js` (or wherever `getSourcesData` lives — confirmed during Task 8) — per-row `importerName` resolution.
- `src/main/ipc/study.js:31-49` — `study:delete-database` gains confirmation flow; new `study:merge` and `study:merge-preflight` handlers.
- `src/preload/index.js` — expose `mergeStudy`, `mergePreflight`.

**New frontend** (`src/renderer/src/AddSource/`):
- `TypePicker.jsx` — Step 1 wizard screen.
- `FolderStep.jsx` — Step 2 for the folder path (extracted from today's `AddSourceModal`).
- `StudyPicker.jsx` — Step 2 for the merge path.
- `ReviewStep.jsx` — Step 3 for the merge path.

**Modified frontend:**
- `src/renderer/src/AddSourceModal.jsx` — restructured as the wizard shell.
- `src/renderer/src/sources.jsx:9-13,170,231,294` — button label, `SourceIcon` accepts per-row `importerName`.

**Tests** (`test/main/services/merge/` + `test/renderer/`):
- `test/main/services/merge/helpers.test.js`
- `test/main/services/merge/preflight.test.js`
- `test/integration/merge/mergeStudy.test.js` — full-flow integration tests
- `test/main/services/merge/bDeletion.test.js`
- `test/renderer/sourceImporterResolver.test.js` — pure resolver logic

**Docs to update at end:**
- `docs/architecture.md`
- `docs/data-formats.md`
- `docs/database-schema.md`
- `docs/import-export.md`
- `docs/ipc-api.md`

---

### Test-run commands

For iterative development (fast):
```
npm run test:rebuild
node --test test/main/services/merge/helpers.test.js
# then more node --test invocations as you iterate
npm run test:rebuild-electron   # once, before running the app
```

For full validation:
```
npm test
```

Run lint/format checks before committing where applicable:
```
npm run lint
npm run format
```

---

## Task 1: Pure helpers (`merge/helpers.js`)

**Files:**
- Create: `src/main/services/merge/helpers.js`
- Test: `test/main/services/merge/helpers.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/main/services/merge/helpers.test.js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  getMergeImportFolder,
  getMergePrefix,
  isMergedImportFolder,
  parseMergeUuid,
  prefixRow
} from '../../../../src/main/services/merge/helpers.js'

const UUID = 'b7f2a1c3-1234-4abc-9def-1234567890ab'

describe('merge helpers — importFolder/prefix conventions', () => {
  test('getMergeImportFolder returns the synthetic "merge:<uuid>" string', () => {
    assert.equal(getMergeImportFolder(UUID), `merge:${UUID}`)
  })

  test('getMergePrefix uses the first 8 chars of the UUID', () => {
    assert.equal(getMergePrefix(UUID), 'study:b7f2a1c3:')
  })

  test('isMergedImportFolder recognizes the "merge:" prefix', () => {
    assert.equal(isMergedImportFolder(`merge:${UUID}`), true)
    assert.equal(isMergedImportFolder('/home/user/photos'), false)
    assert.equal(isMergedImportFolder('https://lila.science/x.jpg'), false)
    assert.equal(isMergedImportFolder(''), false)
    assert.equal(isMergedImportFolder(null), false)
  })

  test('parseMergeUuid extracts the full UUID', () => {
    assert.equal(parseMergeUuid(`merge:${UUID}`), UUID)
    assert.equal(parseMergeUuid('/some/path'), null)
    assert.equal(parseMergeUuid(null), null)
  })
})

describe('merge helpers — prefixRow', () => {
  const PREFIX = 'study:b7f2a1c3:'

  test('prefixes the primary key and rewrites listed FK fields', () => {
    const row = {
      observationID: 'obs_42',
      mediaID: 'IMG_42',
      deploymentID: 'CAM_01',
      scientificName: 'Lepus europaeus',
      count: 1
    }
    const out = prefixRow(row, PREFIX, {
      pk: 'observationID',
      fks: ['mediaID', 'deploymentID']
    })
    assert.equal(out.observationID, 'study:b7f2a1c3:obs_42')
    assert.equal(out.mediaID, 'study:b7f2a1c3:IMG_42')
    assert.equal(out.deploymentID, 'study:b7f2a1c3:CAM_01')
    assert.equal(out.scientificName, 'Lepus europaeus')
    assert.equal(out.count, 1)
  })

  test('leaves null FK fields untouched', () => {
    const row = { mediaID: 'M1', deploymentID: null }
    const out = prefixRow(row, PREFIX, { pk: 'mediaID', fks: ['deploymentID'] })
    assert.equal(out.mediaID, 'study:b7f2a1c3:M1')
    assert.equal(out.deploymentID, null)
  })

  test('returns a new object — does not mutate the input', () => {
    const row = { mediaID: 'M1' }
    const out = prefixRow(row, PREFIX, { pk: 'mediaID', fks: [] })
    assert.notEqual(out, row)
    assert.equal(row.mediaID, 'M1')
  })
})
```

- [ ] **Step 2: Run the tests; expect failure**

```
node --test test/main/services/merge/helpers.test.js
```

Expected: failures — `Cannot find module '.../merge/helpers.js'`.

- [ ] **Step 3: Implement the helpers**

```js
// src/main/services/merge/helpers.js

const MERGE_PREFIX = 'merge:'

export function getMergeImportFolder(uuid) {
  return `${MERGE_PREFIX}${uuid}`
}

export function getMergePrefix(uuid) {
  // 8 chars is enough to avoid collisions within a single study's DB
  return `study:${uuid.slice(0, 8)}:`
}

export function isMergedImportFolder(value) {
  return typeof value === 'string' && value.startsWith(MERGE_PREFIX)
}

export function parseMergeUuid(value) {
  if (!isMergedImportFolder(value)) return null
  return value.slice(MERGE_PREFIX.length)
}

/**
 * Returns a copy of `row` with `row[pk]` and each FK in `fks` prefixed.
 * Null FK values are left as-is.
 *
 * @param {object} row
 * @param {string} prefix
 * @param {{ pk: string, fks: string[] }} fields
 * @returns {object}
 */
export function prefixRow(row, prefix, { pk, fks }) {
  const out = { ...row }
  out[pk] = `${prefix}${row[pk]}`
  for (const fk of fks) {
    if (row[fk] != null) out[fk] = `${prefix}${row[fk]}`
  }
  return out
}
```

- [ ] **Step 4: Re-run the tests; expect pass**

```
node --test test/main/services/merge/helpers.test.js
```

Expected: all `pass`.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/merge/helpers.js test/main/services/merge/helpers.test.js
git commit -m "feat(merge): add pure helpers for merge importFolder/PK conventions"
```

---

## Task 2: Merge preflight (`merge/preflight.js`)

**Files:**
- Create: `src/main/services/merge/preflight.js`
- Test: `test/main/services/merge/preflight.test.js`

**Approach:** Open both DBs read-only. Compute counts. Check `filePath` location vs B's biowatch dir. Detect prior merge by checking A's `media` table.

- [ ] **Step 1: Write the failing tests**

```js
// test/main/services/merge/preflight.test.js
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

import { mergePreflight } from '../../../../src/main/services/merge/preflight.js'

let root // <biowatch-data> root for the test
let studiesDir

function newStudy(uuid) {
  const dir = join(studiesDir, uuid)
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'study.db')
  const db = new Database(dbPath)
  // Minimal schema mirroring src/main/database/models.js
  db.exec(`
    CREATE TABLE deployments (deploymentID TEXT PRIMARY KEY, locationID TEXT, locationName TEXT);
    CREATE TABLE media (
      mediaID TEXT PRIMARY KEY,
      deploymentID TEXT,
      filePath TEXT,
      importFolder TEXT
    );
    CREATE TABLE observations (
      observationID TEXT PRIMARY KEY,
      mediaID TEXT,
      deploymentID TEXT
    );
    CREATE TABLE metadata (
      id TEXT PRIMARY KEY, title TEXT, description TEXT, importerName TEXT NOT NULL,
      created TEXT NOT NULL, contributors TEXT, startDate TEXT, endDate TEXT
    );
    CREATE TABLE model_runs (id TEXT PRIMARY KEY, modelID TEXT NOT NULL, modelVersion TEXT NOT NULL, startedAt TEXT NOT NULL, importPath TEXT);
    CREATE TABLE model_outputs (id TEXT PRIMARY KEY, mediaID TEXT, runID TEXT);
  `)
  return { dir, dbPath, db }
}

beforeEach(() => {
  root = join(tmpdir(), 'biowatch-merge-pf-' + Date.now() + '-' + Math.random())
  studiesDir = join(root, 'studies')
  mkdirSync(studiesDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('mergePreflight', () => {
  test('counts are correct, ownedByBiowatchCount is 0 for folder-style B', () => {
    const A = newStudy('aaaaaaaa-1111-4111-9111-111111111111')
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222')
    B.db
      .prepare('INSERT INTO deployments (deploymentID, locationID) VALUES (?, ?)')
      .run('CAM_01', 'CAM_01')
    B.db
      .prepare(
        'INSERT INTO media (mediaID, deploymentID, filePath, importFolder) VALUES (?, ?, ?, ?)'
      )
      .run('m1', 'CAM_01', '/home/user/photos/CAM_01/a.jpg', '/home/user/photos')
    B.db
      .prepare(
        'INSERT INTO observations (observationID, mediaID, deploymentID) VALUES (?, ?, ?)'
      )
      .run('o1', 'm1', 'CAM_01')
    A.db.close()
    B.db.close()

    const out = mergePreflight({
      biowatchDataPath: root,
      targetStudyId: 'aaaaaaaa-1111-4111-9111-111111111111',
      sourceStudyId: 'bbbbbbbb-2222-4222-9222-222222222222'
    })
    assert.equal(out.deploymentCount, 1)
    assert.equal(out.mediaCount, 1)
    assert.equal(out.observationCount, 1)
    assert.equal(out.ownedByBiowatchCount, 0)
    assert.equal(out.alreadyMerged, false)
    assert.equal(out.renameCount, 1) // one deployment to prefix
  })

  test('ownedByBiowatchCount counts media inside <biowatch-data>/studies/<B-uuid>/', () => {
    const A = newStudy('aaaaaaaa-1111-4111-9111-111111111111')
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222')
    const insideBPath = join(B.dir, 'media', 'a.jpg')
    mkdirSync(join(B.dir, 'media'), { recursive: true })
    writeFileSync(insideBPath, 'fake-jpeg')
    B.db
      .prepare('INSERT INTO deployments (deploymentID) VALUES (?)')
      .run('CAM_01')
    B.db
      .prepare('INSERT INTO media (mediaID, deploymentID, filePath, importFolder) VALUES (?, ?, ?, ?)')
      .run('m1', 'CAM_01', insideBPath, B.dir)
    B.db
      .prepare('INSERT INTO media (mediaID, deploymentID, filePath, importFolder) VALUES (?, ?, ?, ?)')
      .run('m2', 'CAM_01', '/external/x.jpg', '/external')
    A.db.close()
    B.db.close()
    const out = mergePreflight({
      biowatchDataPath: root,
      targetStudyId: 'aaaaaaaa-1111-4111-9111-111111111111',
      sourceStudyId: 'bbbbbbbb-2222-4222-9222-222222222222'
    })
    assert.equal(out.ownedByBiowatchCount, 1)
  })

  test('alreadyMerged flips when A already has B as a merged source', () => {
    const A = newStudy('aaaaaaaa-1111-4111-9111-111111111111')
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222')
    A.db
      .prepare('INSERT INTO media (mediaID, filePath, importFolder) VALUES (?, ?, ?)')
      .run('x', '/y/z', 'merge:bbbbbbbb-2222-4222-9222-222222222222')
    A.db.close()
    B.db.close()
    const out = mergePreflight({
      biowatchDataPath: root,
      targetStudyId: 'aaaaaaaa-1111-4111-9111-111111111111',
      sourceStudyId: 'bbbbbbbb-2222-4222-9222-222222222222'
    })
    assert.equal(out.alreadyMerged, true)
  })

  test('missingFileCount counts local files that are not on disk; URLs skip the check', () => {
    const A = newStudy('aaaaaaaa-1111-4111-9111-111111111111')
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222')
    B.db.prepare('INSERT INTO media (mediaID, filePath) VALUES (?, ?)').run('m1', '/nowhere/missing.jpg')
    B.db.prepare('INSERT INTO media (mediaID, filePath) VALUES (?, ?)').run('m2', 'https://lila.science/x.jpg')
    A.db.close()
    B.db.close()
    const out = mergePreflight({
      biowatchDataPath: root,
      targetStudyId: 'aaaaaaaa-1111-4111-9111-111111111111',
      sourceStudyId: 'bbbbbbbb-2222-4222-9222-222222222222'
    })
    assert.equal(out.missingFileCount, 1)
  })
})
```

- [ ] **Step 2: Run the tests; expect failure (module missing)**

```
node --test test/main/services/merge/preflight.test.js
```

- [ ] **Step 3: Implement preflight**

```js
// src/main/services/merge/preflight.js
import { existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'

import { getMergeImportFolder } from './helpers.js'

const URL_RE = /^https?:\/\//i

function studyDbPath(biowatchDataPath, studyId) {
  return join(biowatchDataPath, 'studies', studyId, 'study.db')
}

/**
 * Pure read-only pre-flight for `mergeStudy`.
 *
 * @param {object} args
 * @param {string} args.biowatchDataPath - absolute path of the biowatch data dir
 * @param {string} args.targetStudyId - A
 * @param {string} args.sourceStudyId - B
 * @returns {{
 *   deploymentCount: number,
 *   mediaCount: number,
 *   observationCount: number,
 *   ownedByBiowatchCount: number,
 *   missingFileCount: number,
 *   renameCount: number,
 *   alreadyMerged: boolean
 * }}
 */
export function mergePreflight({ biowatchDataPath, targetStudyId, sourceStudyId }) {
  const aDb = new Database(studyDbPath(biowatchDataPath, targetStudyId), { readonly: true })
  const bDb = new Database(studyDbPath(biowatchDataPath, sourceStudyId), { readonly: true })
  try {
    const mergeKey = getMergeImportFolder(sourceStudyId)
    const alreadyMerged =
      !!aDb.prepare('SELECT 1 FROM media WHERE importFolder = ? LIMIT 1').get(mergeKey)

    const deploymentCount = bDb.prepare('SELECT COUNT(*) AS n FROM deployments').get().n
    const mediaCount = bDb.prepare('SELECT COUNT(*) AS n FROM media').get().n
    const observationCount = bDb.prepare('SELECT COUNT(*) AS n FROM observations').get().n
    const renameCount = deploymentCount

    const bStudyRoot = join(biowatchDataPath, 'studies', sourceStudyId) + '/'
    const ownedByBiowatchCount = bDb
      .prepare(
        `SELECT COUNT(*) AS n FROM media
         WHERE filePath IS NOT NULL AND substr(filePath, 1, ?) = ?`
      )
      .get(bStudyRoot.length, bStudyRoot).n

    // Missing-file count: only for local paths.
    let missingFileCount = 0
    const mediaRows = bDb.prepare('SELECT filePath FROM media').all()
    for (const { filePath } of mediaRows) {
      if (!filePath || URL_RE.test(filePath)) continue
      if (!existsSync(filePath)) missingFileCount++
    }

    return {
      deploymentCount,
      mediaCount,
      observationCount,
      ownedByBiowatchCount,
      missingFileCount,
      renameCount,
      alreadyMerged
    }
  } finally {
    aDb.close()
    bDb.close()
  }
}
```

- [ ] **Step 4: Re-run the tests; expect pass**

```
node --test test/main/services/merge/preflight.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/merge/preflight.js test/main/services/merge/preflight.test.js
git commit -m "feat(merge): pre-flight counts for the merge wizard"
```

---

## Task 3: B-deletion at-risk predicate (`merge/bDeletion.js`)

**Files:**
- Create: `src/main/services/merge/bDeletion.js`
- Test: `test/main/services/merge/bDeletion.test.js`

**Approach:** Scan every local study's `media` table for rows whose `importFolder = 'merge:<B-uuid>'` AND `filePath` is inside B's biowatch dir. Returns dependent studies + counts.

- [ ] **Step 1: Write the failing tests**

```js
// test/main/services/merge/bDeletion.test.js
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

import { getAtRiskMergeBreaks } from '../../../../src/main/services/merge/bDeletion.js'

let root, studiesDir

function newStudy(uuid, title) {
  const dir = join(studiesDir, uuid)
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'study.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE media (mediaID TEXT PRIMARY KEY, filePath TEXT, importFolder TEXT);
    CREATE TABLE metadata (id TEXT PRIMARY KEY, title TEXT, importerName TEXT NOT NULL, created TEXT NOT NULL);
  `)
  db.prepare('INSERT INTO metadata (id, title, importerName, created) VALUES (?, ?, ?, ?)').run(
    uuid,
    title,
    'local/images',
    new Date().toISOString()
  )
  return { uuid, dir, dbPath, db }
}

beforeEach(() => {
  root = join(tmpdir(), 'biowatch-bdel-' + Date.now() + '-' + Math.random())
  studiesDir = join(root, 'studies')
  mkdirSync(studiesDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('getAtRiskMergeBreaks', () => {
  test('returns [] when B has not been merged anywhere', () => {
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222', 'B')
    newStudy('aaaaaaaa-1111-4111-9111-111111111111', 'A')
    B.db.close()
    const out = getAtRiskMergeBreaks({ biowatchDataPath: root, sourceStudyId: B.uuid })
    assert.deepEqual(out, [])
  })

  test('returns [] when B has been merged but no filePaths point inside B', () => {
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222', 'B')
    const A = newStudy('aaaaaaaa-1111-4111-9111-111111111111', 'A')
    A.db
      .prepare('INSERT INTO media (mediaID, filePath, importFolder) VALUES (?, ?, ?)')
      .run('m1', '/external/x.jpg', `merge:${B.uuid}`)
    A.db.close()
    B.db.close()
    const out = getAtRiskMergeBreaks({ biowatchDataPath: root, sourceStudyId: B.uuid })
    assert.deepEqual(out, [])
  })

  test('returns the dependent study + broken count when filePaths point inside B', () => {
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222', 'B')
    const A = newStudy('aaaaaaaa-1111-4111-9111-111111111111', 'A')
    const insideB = join(B.dir, 'pkg', 'a.jpg')
    A.db
      .prepare('INSERT INTO media (mediaID, filePath, importFolder) VALUES (?, ?, ?)')
      .run('m1', insideB, `merge:${B.uuid}`)
    A.db.close()
    B.db.close()
    const out = getAtRiskMergeBreaks({ biowatchDataPath: root, sourceStudyId: B.uuid })
    assert.deepEqual(out, [
      { studyId: 'aaaaaaaa-1111-4111-9111-111111111111', title: 'A', brokenMediaCount: 1 }
    ])
  })

  test('skips the source study itself', () => {
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222', 'B')
    B.db
      .prepare('INSERT INTO media (mediaID, filePath, importFolder) VALUES (?, ?, ?)')
      .run('m1', join(B.dir, 'x.jpg'), `merge:${B.uuid}`)
    B.db.close()
    const out = getAtRiskMergeBreaks({ biowatchDataPath: root, sourceStudyId: B.uuid })
    assert.deepEqual(out, [])
  })
})
```

- [ ] **Step 2: Run; expect failure**

```
node --test test/main/services/merge/bDeletion.test.js
```

- [ ] **Step 3: Implement**

```js
// src/main/services/merge/bDeletion.js
import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'

import { getMergeImportFolder } from './helpers.js'

/**
 * Return the list of local studies that would lose access to files
 * if `sourceStudyId` is deleted. Empty list means the deletion is safe.
 *
 * @param {{ biowatchDataPath: string, sourceStudyId: string }} args
 * @returns {Array<{ studyId: string, title: string, brokenMediaCount: number }>}
 */
export function getAtRiskMergeBreaks({ biowatchDataPath, sourceStudyId }) {
  const studiesRoot = join(biowatchDataPath, 'studies')
  if (!existsSync(studiesRoot)) return []
  const mergeKey = getMergeImportFolder(sourceStudyId)
  const bStudyRoot = join(studiesRoot, sourceStudyId) + '/'
  const out = []
  for (const studyId of readdirSync(studiesRoot)) {
    if (studyId === sourceStudyId) continue
    const dbPath = join(studiesRoot, studyId, 'study.db')
    if (!existsSync(dbPath)) continue
    const db = new Database(dbPath, { readonly: true })
    try {
      const brokenMediaCount = db
        .prepare(
          `SELECT COUNT(*) AS n FROM media
           WHERE importFolder = ?
             AND filePath IS NOT NULL
             AND substr(filePath, 1, ?) = ?`
        )
        .get(mergeKey, bStudyRoot.length, bStudyRoot).n
      if (brokenMediaCount > 0) {
        const meta = db.prepare('SELECT title FROM metadata LIMIT 1').get()
        out.push({ studyId, title: meta?.title || studyId, brokenMediaCount })
      }
    } finally {
      db.close()
    }
  }
  return out
}
```

- [ ] **Step 4: Run; expect pass**

```
node --test test/main/services/merge/bDeletion.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/merge/bDeletion.js test/main/services/merge/bDeletion.test.js
git commit -m "feat(merge): detect at-risk dependents for B-deletion warning"
```

---

## Task 4: Merge orchestration (`merge/index.js`)

**Files:**
- Create: `src/main/services/merge/index.js`
- Test: `test/integration/merge/mergeStudy.test.js`

**Approach:** Open B read-only, A writable. One transaction on A. Insert deployments/media/modelRuns/modelOutputs/observations with PK prefixing. UPDATE A's metadata. No file ops.

Read the spec's Data flow section before implementing — the row insertion order and FK rewrites are load-bearing.

- [ ] **Step 1: Write the failing integration test**

```js
// test/integration/merge/mergeStudy.test.js
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

import { mergeStudy } from '../../../src/main/services/merge/index.js'

let root, studiesDir
const A_UUID = 'aaaaaaaa-1111-4111-9111-111111111111'
const B_UUID = 'bbbbbbbb-2222-4222-9222-222222222222'

function bootstrapStudy(uuid, { title, importerName, contributors }) {
  const dir = join(studiesDir, uuid)
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'study.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE deployments (
      deploymentID TEXT PRIMARY KEY, locationID TEXT, locationName TEXT,
      deploymentStart TEXT, deploymentEnd TEXT, latitude REAL, longitude REAL,
      cameraModel TEXT, cameraID TEXT, coordinateUncertainty INTEGER
    );
    CREATE TABLE media (
      mediaID TEXT PRIMARY KEY,
      deploymentID TEXT REFERENCES deployments(deploymentID),
      timestamp TEXT, filePath TEXT, fileName TEXT,
      importFolder TEXT, folderName TEXT, fileMediatype TEXT,
      exifData TEXT, favorite INTEGER
    );
    CREATE TABLE model_runs (
      id TEXT PRIMARY KEY, modelID TEXT NOT NULL, modelVersion TEXT NOT NULL,
      startedAt TEXT NOT NULL, status TEXT, importPath TEXT, options TEXT
    );
    CREATE TABLE model_outputs (
      id TEXT PRIMARY KEY,
      mediaID TEXT NOT NULL REFERENCES media(mediaID),
      runID TEXT NOT NULL REFERENCES model_runs(id),
      rawOutput TEXT,
      UNIQUE (mediaID, runID)
    );
    CREATE TABLE observations (
      observationID TEXT PRIMARY KEY,
      mediaID TEXT REFERENCES media(mediaID),
      deploymentID TEXT REFERENCES deployments(deploymentID),
      modelOutputID TEXT REFERENCES model_outputs(id),
      eventID TEXT, eventStart TEXT, eventEnd TEXT,
      scientificName TEXT, observationType TEXT, commonName TEXT,
      classificationProbability REAL, count INTEGER,
      lifeStage TEXT, age TEXT, sex TEXT, behavior TEXT,
      bboxX REAL, bboxY REAL, bboxWidth REAL, bboxHeight REAL,
      detectionConfidence REAL,
      classificationMethod TEXT, classifiedBy TEXT, classificationTimestamp TEXT
    );
    CREATE TABLE metadata (
      id TEXT PRIMARY KEY, name TEXT, title TEXT, description TEXT,
      created TEXT NOT NULL, importerName TEXT NOT NULL,
      contributors TEXT, updatedAt TEXT, startDate TEXT, endDate TEXT,
      sequenceGap INTEGER
    );
  `)
  db.prepare(
    `INSERT INTO metadata (id, title, importerName, created, contributors, startDate, endDate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uuid,
    title,
    importerName,
    '2026-01-01T00:00:00Z',
    JSON.stringify(contributors || []),
    null,
    null
  )
  return { uuid, dir, dbPath, db }
}

beforeEach(() => {
  root = join(tmpdir(), 'biowatch-mergeint-' + Date.now() + '-' + Math.random())
  studiesDir = join(root, 'studies')
  mkdirSync(studiesDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('mergeStudy', () => {
  test('inserts B rows into A with prefixed PKs, importFolder set, files unchanged', () => {
    const A = bootstrapStudy(A_UUID, {
      title: 'A',
      importerName: 'local/images',
      contributors: [{ title: 'Alice', email: 'alice@x', role: 'contact' }]
    })
    const B = bootstrapStudy(B_UUID, {
      title: 'B',
      importerName: 'camtrap/datapackage',
      contributors: [{ title: 'Bob', email: 'bob@x', role: 'contributor' }]
    })

    B.db.prepare('INSERT INTO deployments (deploymentID, locationID) VALUES (?, ?)').run(
      'CAM_01',
      'CAM_01'
    )
    B.db
      .prepare(
        `INSERT INTO media (mediaID, deploymentID, filePath, importFolder)
         VALUES (?, ?, ?, ?)`
      )
      .run('IMG1', 'CAM_01', '/external/IMG1.jpg', '/external')
    B.db
      .prepare(
        `INSERT INTO observations (observationID, mediaID, deploymentID, scientificName)
         VALUES (?, ?, ?, ?)`
      )
      .run('obs1', 'IMG1', 'CAM_01', 'Lepus europaeus')

    A.db.close()
    B.db.close()

    const result = mergeStudy({
      biowatchDataPath: root,
      targetStudyId: A_UUID,
      sourceStudyId: B_UUID,
      reviewed: {
        description: 'merged',
        contributorEmails: ['alice@x', 'bob@x']
      }
    })

    assert.equal(result.success, true)
    assert.equal(result.alreadyMerged, undefined)

    // Verify A's DB now contains B's data with the prefix.
    const a = new Database(A.dbPath, { readonly: true })
    try {
      const dep = a.prepare('SELECT * FROM deployments').all()
      assert.equal(dep.length, 1)
      assert.equal(dep[0].deploymentID, 'study:bbbbbbbb:CAM_01')
      assert.equal(dep[0].locationID, 'CAM_01')

      const med = a.prepare('SELECT * FROM media').all()
      assert.equal(med.length, 1)
      assert.equal(med[0].mediaID, 'study:bbbbbbbb:IMG1')
      assert.equal(med[0].deploymentID, 'study:bbbbbbbb:CAM_01')
      assert.equal(med[0].filePath, '/external/IMG1.jpg') // unchanged
      assert.equal(med[0].importFolder, `merge:${B_UUID}`)

      const obs = a.prepare('SELECT * FROM observations').all()
      assert.equal(obs.length, 1)
      assert.equal(obs[0].observationID, 'study:bbbbbbbb:obs1')
      assert.equal(obs[0].mediaID, 'study:bbbbbbbb:IMG1')
      assert.equal(obs[0].deploymentID, 'study:bbbbbbbb:CAM_01')

      const meta = a.prepare('SELECT * FROM metadata').get()
      assert.equal(meta.description, 'merged')
      const contributors = JSON.parse(meta.contributors)
      assert.equal(contributors.length, 2)
      assert.ok(contributors.find((c) => c.email === 'alice@x'))
      assert.ok(contributors.find((c) => c.email === 'bob@x'))
    } finally {
      a.close()
    }
  })

  test('returns { alreadyMerged: true } on second merge of same B', () => {
    const A = bootstrapStudy(A_UUID, { title: 'A', importerName: 'local/images' })
    const B = bootstrapStudy(B_UUID, { title: 'B', importerName: 'local/images' })
    B.db.prepare('INSERT INTO deployments (deploymentID) VALUES (?)').run('CAM_01')
    B.db
      .prepare('INSERT INTO media (mediaID, deploymentID, filePath) VALUES (?, ?, ?)')
      .run('IMG1', 'CAM_01', '/external/a.jpg')
    A.db.close()
    B.db.close()

    const first = mergeStudy({
      biowatchDataPath: root,
      targetStudyId: A_UUID,
      sourceStudyId: B_UUID,
      reviewed: { description: '', contributorEmails: [] }
    })
    assert.equal(first.success, true)

    const second = mergeStudy({
      biowatchDataPath: root,
      targetStudyId: A_UUID,
      sourceStudyId: B_UUID,
      reviewed: { description: '', contributorEmails: [] }
    })
    assert.equal(second.success, true)
    assert.equal(second.alreadyMerged, true)
  })

  test('refuses self-merge', () => {
    const A = bootstrapStudy(A_UUID, { title: 'A', importerName: 'local/images' })
    A.db.close()
    assert.throws(
      () =>
        mergeStudy({
          biowatchDataPath: root,
          targetStudyId: A_UUID,
          sourceStudyId: A_UUID,
          reviewed: { description: '', contributorEmails: [] }
        }),
      /self-merge/i
    )
  })

  test('skips media whose local files are missing, plus their dependent observations', () => {
    const A = bootstrapStudy(A_UUID, { title: 'A', importerName: 'local/images' })
    const B = bootstrapStudy(B_UUID, { title: 'B', importerName: 'local/images' })
    const existing = join(B.dir, 'x.jpg')
    writeFileSync(existing, 'x')
    B.db.prepare('INSERT INTO deployments (deploymentID) VALUES (?)').run('CAM_01')
    B.db
      .prepare('INSERT INTO media (mediaID, deploymentID, filePath) VALUES (?, ?, ?)')
      .run('OK', 'CAM_01', existing)
    B.db
      .prepare('INSERT INTO media (mediaID, deploymentID, filePath) VALUES (?, ?, ?)')
      .run('GONE', 'CAM_01', '/nowhere/missing.jpg')
    B.db
      .prepare('INSERT INTO observations (observationID, mediaID) VALUES (?, ?)')
      .run('o1', 'OK')
    B.db
      .prepare('INSERT INTO observations (observationID, mediaID) VALUES (?, ?)')
      .run('o2', 'GONE')
    A.db.close()
    B.db.close()

    const result = mergeStudy({
      biowatchDataPath: root,
      targetStudyId: A_UUID,
      sourceStudyId: B_UUID,
      reviewed: { description: '', contributorEmails: [] }
    })
    assert.equal(result.success, true)
    assert.equal(result.missingFileCount, 1)

    const a = new Database(A.dbPath, { readonly: true })
    try {
      assert.equal(a.prepare('SELECT COUNT(*) AS n FROM media').get().n, 1)
      assert.equal(a.prepare('SELECT COUNT(*) AS n FROM observations').get().n, 1)
    } finally {
      a.close()
    }
  })

  test('merges date ranges: min of starts, max of ends', () => {
    const A = bootstrapStudy(A_UUID, { title: 'A', importerName: 'local/images' })
    const B = bootstrapStudy(B_UUID, { title: 'B', importerName: 'local/images' })
    new Database(A.dbPath).exec(
      `UPDATE metadata SET startDate = '2023-05-01T00:00:00Z', endDate = '2023-08-31T00:00:00Z'`
    )
    new Database(B.dbPath).exec(
      `UPDATE metadata SET startDate = '2023-04-12T00:00:00Z', endDate = '2023-09-30T00:00:00Z'`
    )
    A.db.close()
    B.db.close()
    mergeStudy({
      biowatchDataPath: root,
      targetStudyId: A_UUID,
      sourceStudyId: B_UUID,
      reviewed: { description: '', contributorEmails: [] }
    })
    const a = new Database(A.dbPath, { readonly: true })
    try {
      const m = a.prepare('SELECT startDate, endDate FROM metadata').get()
      assert.equal(m.startDate, '2023-04-12T00:00:00Z')
      assert.equal(m.endDate, '2023-09-30T00:00:00Z')
    } finally {
      a.close()
    }
  })
})
```

- [ ] **Step 2: Run; expect failure**

```
npm run test:rebuild
node --test test/integration/merge/mergeStudy.test.js
```

- [ ] **Step 3: Implement merge orchestration**

```js
// src/main/services/merge/index.js
import { existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'

import { getMergeImportFolder, getMergePrefix, prefixRow } from './helpers.js'

const URL_RE = /^https?:\/\//i

function studyDbPath(biowatchDataPath, studyId) {
  return join(biowatchDataPath, 'studies', studyId, 'study.db')
}

/**
 * Merge source study `B` into target study `A`. Rows only — no file operations.
 *
 * @param {object} args
 * @param {string} args.biowatchDataPath
 * @param {string} args.targetStudyId
 * @param {string} args.sourceStudyId
 * @param {{ description: string, contributorEmails: string[] }} args.reviewed
 * @returns {{ success: true, missingFileCount: number } | { success: true, alreadyMerged: true } | { success: false, error: string }}
 */
export function mergeStudy({ biowatchDataPath, targetStudyId, sourceStudyId, reviewed }) {
  if (targetStudyId === sourceStudyId) {
    throw new Error('Cannot self-merge a study with itself')
  }
  const mergeKey = getMergeImportFolder(sourceStudyId)
  const prefix = getMergePrefix(sourceStudyId)

  const aDb = new Database(studyDbPath(biowatchDataPath, targetStudyId))
  const bDb = new Database(studyDbPath(biowatchDataPath, sourceStudyId), { readonly: true })

  try {
    // 1. Already-merged check.
    const exists = aDb.prepare('SELECT 1 FROM media WHERE importFolder = ? LIMIT 1').get(mergeKey)
    if (exists) return { success: true, alreadyMerged: true }

    // 2. Pre-compute missingMediaIDs (skip URLs).
    const missingMediaIDs = new Set()
    for (const { mediaID, filePath } of bDb.prepare('SELECT mediaID, filePath FROM media').all()) {
      if (!filePath || URL_RE.test(filePath)) continue
      if (!existsSync(filePath)) missingMediaIDs.add(mediaID)
    }

    // 3. Read everything from B.
    const bDeployments = bDb.prepare('SELECT * FROM deployments').all()
    const bMedia = bDb.prepare('SELECT * FROM media').all()
    const bModelRuns = bDb.prepare('SELECT * FROM model_runs').all()
    const bModelOutputs = bDb.prepare('SELECT * FROM model_outputs').all()
    const bObservations = bDb.prepare('SELECT * FROM observations').all()
    const bMeta = bDb.prepare('SELECT * FROM metadata').get()
    const aMeta = aDb.prepare('SELECT * FROM metadata').get()

    // 4. Write everything to A in one transaction.
    const txn = aDb.transaction(() => {
      for (const d of bDeployments) {
        const row = prefixRow(d, prefix, { pk: 'deploymentID', fks: [] })
        insertRow(aDb, 'deployments', row)
      }
      for (const m of bMedia) {
        if (missingMediaIDs.has(m.mediaID)) continue
        const row = prefixRow(m, prefix, { pk: 'mediaID', fks: ['deploymentID'] })
        row.importFolder = mergeKey
        insertRow(aDb, 'media', row)
      }
      for (const r of bModelRuns) {
        const row = { ...r, importPath: mergeKey }
        insertRow(aDb, 'model_runs', row)
      }
      for (const o of bModelOutputs) {
        if (missingMediaIDs.has(o.mediaID)) continue
        const row = prefixRow(o, prefix, { pk: 'id', fks: ['mediaID'] })
        // The PK of model_outputs is a UUID — don't actually prefix it. Undo.
        row.id = o.id
        insertRow(aDb, 'model_outputs', row)
      }
      for (const obs of bObservations) {
        if (missingMediaIDs.has(obs.mediaID)) continue
        const row = prefixRow(obs, prefix, {
          pk: 'observationID',
          fks: ['mediaID', 'deploymentID']
        })
        insertRow(aDb, 'observations', row)
      }

      // Metadata update.
      const newContribs = mergeContributors(
        safeParseArray(aMeta.contributors),
        safeParseArray(bMeta.contributors),
        reviewed.contributorEmails
      )
      const newStart = minISO(aMeta.startDate, bMeta.startDate)
      const newEnd = maxISO(aMeta.endDate, bMeta.endDate)
      aDb
        .prepare(
          `UPDATE metadata SET description = ?, contributors = ?,
                                startDate = COALESCE(?, startDate),
                                endDate = COALESCE(?, endDate),
                                updatedAt = ?`
        )
        .run(
          reviewed.description,
          JSON.stringify(newContribs),
          newStart,
          newEnd,
          new Date().toISOString()
        )
    })
    txn()

    return { success: true, missingFileCount: missingMediaIDs.size }
  } finally {
    aDb.close()
    bDb.close()
  }
}

function insertRow(db, table, row) {
  const cols = Object.keys(row)
  const placeholders = cols.map(() => '?').join(', ')
  const values = cols.map((c) => row[c])
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...values)
}

function safeParseArray(v) {
  if (!v) return []
  if (Array.isArray(v)) return v
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mergeContributors(aList, bList, keepEmails) {
  const byEmail = new Map()
  for (const c of [...aList, ...bList]) {
    const key = (c.email || '').toLowerCase()
    if (key && !byEmail.has(key)) byEmail.set(key, c)
  }
  if (!keepEmails || keepEmails.length === 0) return [...byEmail.values()]
  const keep = new Set(keepEmails.map((e) => e.toLowerCase()))
  return [...byEmail.values()].filter((c) => keep.has((c.email || '').toLowerCase()))
}

function minISO(a, b) {
  if (!a) return b ?? null
  if (!b) return a
  return a < b ? a : b
}

function maxISO(a, b) {
  if (!a) return b ?? null
  if (!b) return a
  return a > b ? a : b
}
```

- [ ] **Step 4: Run; expect pass**

```
node --test test/integration/merge/mergeStudy.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/merge/index.js test/integration/merge/mergeStudy.test.js
git commit -m "feat(merge): orchestrate B-into-A DB transaction"
```

---

## Task 5: Per-row `importerName` resolver (renderer-side pure function)

**Files:**
- Create: `src/renderer/src/sources/sourceImporterResolver.js`
- Test: `test/renderer/sourceImporterResolver.test.js`

**Purpose:** Pure function the renderer uses to pick an icon/label per source row.

- [ ] **Step 1: Write the failing tests**

```js
// test/renderer/sourceImporterResolver.test.js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { resolveSourceDisplay } from '../../src/renderer/src/sources/sourceImporterResolver.js'

const studies = [
  { id: 'b7f2a1c3-2222-4222-9222-222222222222', title: 'Yosemite 2023', importerName: 'camtrap/datapackage' }
]

describe('resolveSourceDisplay', () => {
  test('non-merge folder source falls back to study-level importerName', () => {
    const result = resolveSourceDisplay({
      importFolder: '/home/user/photos',
      studyImporterName: 'local/images',
      sampleFilePath: '/home/user/photos/a.jpg',
      studies
    })
    assert.equal(result.importerName, 'local/images')
    assert.equal(result.displayLabel, undefined)
  })

  test('http filePath bumps importerName to lila/coco', () => {
    const result = resolveSourceDisplay({
      importFolder: 'Snapshot Serengeti',
      studyImporterName: 'lila/coco',
      sampleFilePath: 'https://lila.science/x.jpg',
      studies
    })
    assert.equal(result.importerName, 'lila/coco')
  })

  test('merge: prefix resolves to B title and importerName', () => {
    const result = resolveSourceDisplay({
      importFolder: 'merge:b7f2a1c3-2222-4222-9222-222222222222',
      studyImporterName: 'local/images',
      sampleFilePath: '/whatever',
      studies
    })
    assert.equal(result.importerName, 'camtrap/datapackage')
    assert.equal(result.displayLabel, 'Yosemite 2023')
  })

  test('merge: prefix with missing B falls back to "Merged source"', () => {
    const result = resolveSourceDisplay({
      importFolder: 'merge:00000000-0000-0000-0000-000000000000',
      studyImporterName: 'local/images',
      sampleFilePath: '/whatever',
      studies
    })
    assert.equal(result.importerName, 'local/images') // study fallback
    assert.equal(result.displayLabel, 'Merged source')
  })

  test('merge: prefix with missing B but URL filePaths falls back to lila/coco', () => {
    const result = resolveSourceDisplay({
      importFolder: 'merge:00000000-0000-0000-0000-000000000000',
      studyImporterName: 'local/images',
      sampleFilePath: 'https://lila.science/x.jpg',
      studies
    })
    assert.equal(result.importerName, 'lila/coco')
    assert.equal(result.displayLabel, 'Merged source')
  })
})
```

- [ ] **Step 2: Run; expect failure**

```
node --test test/renderer/sourceImporterResolver.test.js
```

- [ ] **Step 3: Implement**

```js
// src/renderer/src/sources/sourceImporterResolver.js

const MERGE_PREFIX = 'merge:'

function isUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s)
}

/**
 * Resolve a source row's effective importerName + optional displayLabel.
 *
 * @param {object} args
 * @param {string} args.importFolder
 * @param {string} args.studyImporterName
 * @param {string} [args.sampleFilePath]
 * @param {Array<{ id: string, title: string, importerName: string }>} args.studies
 * @returns {{ importerName: string, displayLabel?: string }}
 */
export function resolveSourceDisplay({ importFolder, studyImporterName, sampleFilePath, studies }) {
  if (typeof importFolder === 'string' && importFolder.startsWith(MERGE_PREFIX)) {
    const uuid = importFolder.slice(MERGE_PREFIX.length)
    const b = (studies || []).find((s) => s.id === uuid)
    if (b) return { importerName: b.importerName, displayLabel: b.title }
    if (isUrl(sampleFilePath)) return { importerName: 'lila/coco', displayLabel: 'Merged source' }
    return { importerName: studyImporterName, displayLabel: 'Merged source' }
  }
  if (isUrl(sampleFilePath)) return { importerName: 'lila/coco' }
  return { importerName: studyImporterName }
}
```

- [ ] **Step 4: Run; expect pass**

```
node --test test/renderer/sourceImporterResolver.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/sources/sourceImporterResolver.js test/renderer/sourceImporterResolver.test.js
git commit -m "feat(sources): pure resolver for per-row importerName"
```

---

## Task 6: IPC handlers (`study:merge-preflight`, `study:merge`)

**Files:**
- Modify: `src/main/ipc/study.js` (currently at lines 1-46 — read first)

- [ ] **Step 1: Read the existing handler file**

```
# Read the current contents of:
src/main/ipc/study.js
```

This file already wires `studies:list` (`studies:list`) and `study:delete-database`. We add two new handlers next to them and resolve `biowatchDataPath` via `app.getPath('userData') + '/biowatch-data'` (or wherever the file already computes that).

- [ ] **Step 2: Add the merge handlers**

In `src/main/ipc/study.js`, near the existing handlers:

```js
import { mergePreflight } from '../services/merge/preflight.js'
import { mergeStudy } from '../services/merge/index.js'
import { app } from 'electron'
import { join } from 'path'

function getBiowatchDataPath() {
  return join(app.getPath('userData'), 'biowatch-data')
}

ipcMain.handle('study:merge-preflight', async (_event, targetStudyId, sourceStudyId) => {
  try {
    return mergePreflight({
      biowatchDataPath: getBiowatchDataPath(),
      targetStudyId,
      sourceStudyId
    })
  } catch (err) {
    log.error('study:merge-preflight failed', err)
    return { error: err.message }
  }
})

ipcMain.handle('study:merge', async (_event, targetStudyId, sourceStudyId, reviewed) => {
  try {
    const out = mergeStudy({
      biowatchDataPath: getBiowatchDataPath(),
      targetStudyId,
      sourceStudyId,
      reviewed: reviewed || { description: '', contributorEmails: [] }
    })
    // Notify the Sources tab to re-query.
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('merge:complete', { studyId: targetStudyId }))
    return out
  } catch (err) {
    log.error('study:merge failed', err)
    return { success: false, error: err.message }
  }
})
```

(If `BrowserWindow` or `log` is not already imported in the file, add them at the top: `import { BrowserWindow } from 'electron'` and `import log from '../services/logger.js'` per the project's convention.)

- [ ] **Step 3: Smoke-test the handlers in dev**

```
npm run dev
# In the app's DevTools console (renderer):
await window.api.mergePreflight('<some-study-A-uuid>', '<some-study-B-uuid>')
```

Expected: a JSON object with the count fields. If the studies don't exist, expect `{ error: "..." }`.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/study.js
git commit -m "feat(ipc): study:merge and study:merge-preflight handlers"
```

---

## Task 7: B-deletion confirmation in `study:delete-database`

**Files:**
- Modify: `src/main/ipc/study.js:31-49` (the existing `study:delete-database` handler)

- [ ] **Step 1: Update the handler**

Inside `src/main/ipc/study.js`, change the existing `study:delete-database` handler to take a second `options` argument and check at-risk dependents first:

```js
import { getAtRiskMergeBreaks } from '../services/merge/bDeletion.js'

ipcMain.handle('study:delete-database', async (event, studyId, options = {}) => {
  try {
    const force = options.force === true
    if (!force) {
      const dependentBreaks = getAtRiskMergeBreaks({
        biowatchDataPath: getBiowatchDataPath(),
        sourceStudyId: studyId
      })
      if (dependentBreaks.length > 0) {
        return { needsConfirm: true, dependentBreaks }
      }
    }
    // … existing deletion logic continues unchanged …
  } catch (err) {
    // … existing error handling …
  }
})
```

The renderer signature for callers becomes `window.api.deleteStudyDatabase(studyId, { force: true })`.

- [ ] **Step 2: Add an integration test**

`test/integration/merge/bDeletionFlow.test.js` — exercise the at-risk predicate through the handler-equivalent path. (You can call `getAtRiskMergeBreaks` directly given the handler is a thin wrapper, but keep one test that verifies the full return shape.)

```js
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

import { getAtRiskMergeBreaks } from '../../../src/main/services/merge/bDeletion.js'

let root
const A_UUID = 'aaaaaaaa-1111-4111-9111-111111111111'
const B_UUID = 'bbbbbbbb-2222-4222-9222-222222222222'

beforeEach(() => {
  root = join(tmpdir(), 'biowatch-bdel-int-' + Date.now() + '-' + Math.random())
  mkdirSync(join(root, 'studies'), { recursive: true })
})
afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('B-deletion flow', () => {
  test('warning fires with dependent count when files would be at risk', () => {
    const bDir = join(root, 'studies', B_UUID)
    const aDir = join(root, 'studies', A_UUID)
    mkdirSync(bDir, { recursive: true })
    mkdirSync(aDir, { recursive: true })
    for (const dir of [aDir, bDir]) {
      const db = new Database(join(dir, 'study.db'))
      db.exec(`
        CREATE TABLE media (mediaID TEXT PRIMARY KEY, filePath TEXT, importFolder TEXT);
        CREATE TABLE metadata (id TEXT PRIMARY KEY, title TEXT, importerName TEXT NOT NULL, created TEXT NOT NULL);
      `)
      db.prepare('INSERT INTO metadata (id, title, importerName, created) VALUES (?, ?, ?, ?)').run(
        dir === aDir ? A_UUID : B_UUID,
        dir === aDir ? 'A' : 'B',
        'local/images',
        new Date().toISOString()
      )
      db.close()
    }
    const a = new Database(join(aDir, 'study.db'))
    a.prepare('INSERT INTO media (mediaID, filePath, importFolder) VALUES (?, ?, ?)').run(
      'm1',
      join(bDir, 'pkg', 'x.jpg'),
      `merge:${B_UUID}`
    )
    a.close()

    const out = getAtRiskMergeBreaks({ biowatchDataPath: root, sourceStudyId: B_UUID })
    assert.deepEqual(out, [{ studyId: A_UUID, title: 'A', brokenMediaCount: 1 }])
  })
})
```

- [ ] **Step 3: Run; expect pass**

```
node --test test/integration/merge/bDeletionFlow.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/study.js test/integration/merge/bDeletionFlow.test.js
git commit -m "feat(ipc): scope B-deletion confirmation to file-breakage risk"
```

---

## Task 8: Preload exposure

**Files:**
- Modify: `src/preload/index.js`

- [ ] **Step 1: Read the file and find the existing `api` object**

```
# Read src/preload/index.js to locate the existing window.api shape.
```

- [ ] **Step 2: Expose the new methods**

Add (alongside existing entries like `getStudies`, `deleteStudyDatabase`, etc.):

```js
mergePreflight: (targetStudyId, sourceStudyId) =>
  ipcRenderer.invoke('study:merge-preflight', targetStudyId, sourceStudyId),

mergeStudy: (targetStudyId, sourceStudyId, reviewed) =>
  ipcRenderer.invoke('study:merge', targetStudyId, sourceStudyId, reviewed),

onMergeComplete: (cb) => {
  const handler = (_e, payload) => cb(payload)
  ipcRenderer.on('merge:complete', handler)
  return () => ipcRenderer.off('merge:complete', handler)
}
```

Also update `deleteStudyDatabase` to take options:

```js
// before:
// deleteStudyDatabase: (studyId) => ipcRenderer.invoke('study:delete-database', studyId)
// after:
deleteStudyDatabase: (studyId, options) =>
  ipcRenderer.invoke('study:delete-database', studyId, options)
```

- [ ] **Step 3: Smoke check**

```
npm run dev
# In renderer DevTools:
typeof window.api.mergePreflight  // 'function'
typeof window.api.mergeStudy      // 'function'
typeof window.api.onMergeComplete // 'function'
```

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.js
git commit -m "feat(preload): expose mergePreflight, mergeStudy, onMergeComplete"
```

---

## Task 9: `getSourcesData` augmentation (per-row importerName)

**Files:**
- Modify: the `getSourcesData` query (locate first via `grep -rn 'getSourcesData' src/main/database/`)

This task is a server-side wrapper, not new tests — the renderer already has `sourceImporterResolver` covered. The same logic runs server-side so the IPC payload carries the per-row `importerName` and `displayLabel`. Why server-side? `getStudies()` is async on the renderer; having the IPC do the lookup avoids an extra round-trip.

- [ ] **Step 1: Locate `getSourcesData`**

```
grep -rn 'export.*getSourcesData\|function getSourcesData' src/main/
```

Read the file. Add an augmentation step at the end before returning rows.

- [ ] **Step 2: Implement augmentation**

Inside `getSourcesData`, after the existing rows are computed:

```js
import { resolveSourceDisplay } from '../../renderer/src/sources/sourceImporterResolver.js'
// NOTE: This is a pure ESM module with no React imports — safe to import in main.
import { listStudies } from '../services/study.js' // adjust to actual export name

// at the end of getSourcesData(studyId, db) after `rows` is computed:
const studies = await listStudies()
const studyMeta = await getStudyMetadata(db) // returns row from `metadata` table
return rows.map((row) => {
  const display = resolveSourceDisplay({
    importFolder: row.importFolder,
    studyImporterName: studyMeta.importerName,
    sampleFilePath: row.sampleFilePath || null,
    studies
  })
  return { ...row, importerName: display.importerName, displayLabel: display.displayLabel }
})
```

Adapt names to what already exists in the function. If `rows` doesn't already include a `sampleFilePath`, fetch one per source group as part of the same query (`SELECT MIN(filePath) FROM media WHERE importFolder = ? GROUP BY ...`) — or omit and accept the small inaccuracy when B is missing AND its merged source contains URL media. The latter is fine for v1.

- [ ] **Step 3: Add an integration test** if `getSourcesData` already has tests; otherwise rely on the resolver's unit tests + manual E2E.

- [ ] **Step 4: Commit**

```bash
git add src/main/database/queries/<file>.js
git commit -m "feat(sources): per-row importerName + displayLabel in getSourcesData"
```

---

## Task 10: Sources tab — button label + per-row icon

**Files:**
- Modify: `src/renderer/src/sources.jsx:9-13` (SourceIcon), `:170` (call site), `:231` (default export signature), `:294` (button text)

- [ ] **Step 1: Update `SourceIcon` to accept a per-row importerName**

In `sources.jsx`, change:

```jsx
function SourceIcon({ importerName }) {
  if (importerName === 'lila/coco') return <Globe size={20} className="text-muted-foreground" />
  if (importerName === 'camtrap/datapackage')
    return <Package size={20} className="text-muted-foreground" />
  return <Folder size={20} className="text-muted-foreground" />
}
```

— no change to signature, but now the **caller** passes `source.importerName` instead of the study-level prop:

```jsx
// in SourceRow:
<SourceIcon importerName={source.importerName || importerName} />
```

Fallback to the study-level prop preserves behavior when `source.importerName` is absent.

- [ ] **Step 2: Use `source.displayLabel` if present**

In `SourceRow`, when computing `label`:

```js
const label = source.displayLabel
  ? source.displayLabel
  : (!hasImportFolder
      ? studyName || 'Imported dataset'
      : isPathLike
        ? basenameOf(source.importFolder) || source.importFolder
        : source.importFolder)
```

Also skip the path-style subtitle when the importFolder starts with `merge:` (it's not a path):

```js
const isPathLike =
  hasImportFolder &&
  !source.importFolder.startsWith('merge:') &&
  (source.importFolder.startsWith('/') ||
    source.importFolder.startsWith('http') ||
    source.importFolder.includes('\\'))
```

- [ ] **Step 3: Rename the button**

Change line ~294 in `sources.jsx`:

```jsx
+ Add source
```

- [ ] **Step 4: Manual smoke**

```
npm run dev
# Open any study, go to Sources tab. The button text should now read "+ Add source".
# Icons on existing rows should still match what they showed before.
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/sources.jsx
git commit -m "feat(sources): per-row icon + Add source button"
```

---

## Task 11: Wizard shell — restructure `AddSourceModal.jsx`

**Files:**
- Modify: `src/renderer/src/AddSourceModal.jsx`
- Create: `src/renderer/src/AddSource/TypePicker.jsx`
- Create: `src/renderer/src/AddSource/FolderStep.jsx`

The goal: extract today's folder form into `FolderStep.jsx` (no behavior change) and prepend a TypePicker step.

- [ ] **Step 1: Create `TypePicker.jsx`**

```jsx
// src/renderer/src/AddSource/TypePicker.jsx
import { FolderOpen, Layers } from 'lucide-react'

export default function TypePicker({ selected, onSelect, onCancel, onNext }) {
  return (
    <>
      <header className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 className="text-base font-medium text-foreground">
          Add source <span className="text-muted-foreground text-sm">— Step 1 of 2</span>
        </h3>
      </header>
      <div className="px-5 py-4 space-y-3">
        <p className="text-sm text-muted-foreground">What would you like to add?</p>
        <Card
          icon={<FolderOpen size={20} />}
          title="Images directory"
          subtitle="Scan a local folder of images with an ML model"
          active={selected === 'folder'}
          onClick={() => onSelect('folder')}
        />
        <Card
          icon={<Layers size={20} />}
          title="Another study"
          subtitle="Merge data from a study already in this app"
          active={selected === 'merge'}
          onClick={() => onSelect('merge')}
        />
      </div>
      <footer className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted">
        <button className="px-3 py-1.5 rounded-md border border-border bg-card text-sm" onClick={onCancel}>Cancel</button>
        <button
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
          disabled={!selected}
          onClick={onNext}
        >
          Next →
        </button>
      </footer>
    </>
  )
}

function Card({ icon, title, subtitle, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-md border text-left ${
        active ? 'border-primary bg-primary/10' : 'border-border bg-card'
      }`}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  )
}
```

- [ ] **Step 2: Move today's folder form into `FolderStep.jsx`**

Extract everything currently inside `AddSourceModal`'s render (Model select, Country select, Folder picker, Cancel/Import footer) into:

```jsx
// src/renderer/src/AddSource/FolderStep.jsx
// (Body of today's modal verbatim, accepting all the same props.)
// Header is now "Add source — Step 2 of 2" with a Back button.
```

Keep all behavior identical to today.

- [ ] **Step 3: Rewrite `AddSourceModal.jsx` as a step controller**

```jsx
// src/renderer/src/AddSourceModal.jsx
import { useState, useEffect } from 'react'
import TypePicker from './AddSource/TypePicker.jsx'
import FolderStep from './AddSource/FolderStep.jsx'
import StudyPicker from './AddSource/StudyPicker.jsx' // Task 12
import ReviewStep from './AddSource/ReviewStep.jsx'   // Task 13

export default function AddSourceModal({ isOpen, studyId, onClose, onImported }) {
  const [step, setStep] = useState('type')        // 'type' | 'folder' | 'study-pick' | 'review'
  const [type, setType] = useState(null)          // 'folder' | 'merge'
  const [pickedStudy, setPickedStudy] = useState(null)

  useEffect(() => {
    if (!isOpen) {
      setStep('type')
      setType(null)
      setPickedStudy(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleNextFromType = () => {
    if (type === 'folder') setStep('folder')
    else if (type === 'merge') setStep('study-pick')
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-[480px] max-w-[92vw] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {step === 'type' && (
          <TypePicker selected={type} onSelect={setType} onCancel={onClose} onNext={handleNextFromType} />
        )}
        {step === 'folder' && (
          <FolderStep studyId={studyId} onBack={() => setStep('type')} onClose={onClose} onImported={onImported} />
        )}
        {step === 'study-pick' && (
          <StudyPicker
            currentStudyId={studyId}
            onBack={() => setStep('type')}
            onCancel={onClose}
            onPicked={(study) => { setPickedStudy(study); setStep('review') }}
          />
        )}
        {step === 'review' && pickedStudy && (
          <ReviewStep
            targetStudyId={studyId}
            sourceStudy={pickedStudy}
            onBack={() => setStep('study-pick')}
            onCancel={onClose}
            onMerged={() => { onImported?.(); onClose() }}
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Smoke**

```
npm run dev
# Sources tab → "+ Add source" → see the Step 1 picker.
# Picking Images directory → see the existing form unchanged in Step 2.
# Picking Another study → see a placeholder (StudyPicker / ReviewStep land in Tasks 12-13).
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/AddSourceModal.jsx src/renderer/src/AddSource/TypePicker.jsx src/renderer/src/AddSource/FolderStep.jsx
git commit -m "feat(wizard): restructure AddSourceModal as a 2-step wizard"
```

---

## Task 12: `StudyPicker.jsx`

**Files:**
- Create: `src/renderer/src/AddSource/StudyPicker.jsx`

- [ ] **Step 1: Implement**

```jsx
// src/renderer/src/AddSource/StudyPicker.jsx
import { useEffect, useState } from 'react'
import { Folder, Package, Globe } from 'lucide-react'

const ICON = {
  'camtrap/datapackage': Package,
  'lila/coco': Globe,
}

export default function StudyPicker({ currentStudyId, onBack, onCancel, onPicked }) {
  const [studies, setStudies] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [mergedSet, setMergedSet] = useState(new Set())

  useEffect(() => {
    let cancelled = false
    window.api.getStudies().then((list) => {
      if (cancelled) return
      setStudies((list || []).filter((s) => s.id !== currentStudyId))
    })
    // Identify already-merged studies by running preflight per candidate.
    // Cheap because we filter first by title match later; v1 just calls
    // preflight when the modal opens. For very large local libraries we
    // could lazy-call on row hover instead.
    return () => { cancelled = true }
  }, [currentStudyId])

  useEffect(() => {
    let cancelled = false
    if (studies.length === 0) return
    Promise.all(
      studies.map((s) =>
        window.api.mergePreflight(currentStudyId, s.id).then((pf) => ({ id: s.id, pf }))
      )
    ).then((results) => {
      if (cancelled) return
      setMergedSet(new Set(results.filter((r) => r.pf?.alreadyMerged).map((r) => r.id)))
    })
    return () => { cancelled = true }
  }, [studies, currentStudyId])

  const visible = studies.filter((s) => (s.title || '').toLowerCase().includes(search.toLowerCase()))

  return (
    <>
      <header className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 className="text-base font-medium">
          Add source <span className="text-muted-foreground text-sm">— Step 2 of 3</span>
        </h3>
      </header>
      <div className="px-5 py-4 space-y-2">
        <input
          className="w-full px-3 py-1.5 rounded-md bg-muted border border-border text-sm"
          placeholder="Search studies by title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="border border-border rounded-md max-h-72 overflow-y-auto">
          {visible.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">No studies match.</div>
          )}
          {visible.map((s) => {
            const Icon = ICON[s.importerName] || Folder
            const merged = mergedSet.has(s.id)
            return (
              <button
                key={s.id}
                type="button"
                disabled={merged}
                onClick={() => setSelected(s)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left border-b border-border last:border-none
                  ${selected?.id === s.id ? 'bg-primary/10' : 'hover:bg-muted'}
                  ${merged ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Icon size={16} className="text-muted-foreground" />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{s.title || s.id}</span>
                  <span className="block text-xs text-muted-foreground">{s.importerName}</span>
                </span>
                {merged && <span className="text-[10px] uppercase text-muted-foreground">Already merged</span>}
              </button>
            )
          })}
        </div>
      </div>
      <footer className="flex justify-between items-center px-5 py-3 border-t border-border bg-muted">
        <button onClick={onBack} className="text-sm text-muted-foreground">← Back</button>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 rounded-md border border-border bg-card text-sm" onClick={onCancel}>Cancel</button>
          <button
            disabled={!selected}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            onClick={() => onPicked(selected)}
          >
            Next →
          </button>
        </div>
      </footer>
    </>
  )
}
```

- [ ] **Step 2: Manual smoke**

```
npm run dev
# +Add source → "Another study" → see studies list with appropriate disabled rows.
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/AddSource/StudyPicker.jsx
git commit -m "feat(wizard): study picker for merge path"
```

---

## Task 13: `ReviewStep.jsx`

**Files:**
- Create: `src/renderer/src/AddSource/ReviewStep.jsx`

- [ ] **Step 1: Implement**

```jsx
// src/renderer/src/AddSource/ReviewStep.jsx
import { useEffect, useMemo, useState } from 'react'

export default function ReviewStep({ targetStudyId, sourceStudy, onBack, onCancel, onMerged }) {
  const [preflight, setPreflight] = useState(null)
  const [targetMeta, setTargetMeta] = useState(null)
  const [description, setDescription] = useState('')
  const [contributors, setContributors] = useState([]) // [{title,email,role,origin: 'A'|'B'|'AB',checked}]
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.api.mergePreflight(targetStudyId, sourceStudy.id),
      window.api.getStudyMetadata(targetStudyId), // existing or add via Task 9 if missing
      window.api.getStudyMetadata(sourceStudy.id)
    ]).then(([pf, a, b]) => {
      if (cancelled) return
      setPreflight(pf)
      setTargetMeta(a)
      const merged = `${a?.description || ''}\n\n---\n\n## Merged from ${sourceStudy.title || sourceStudy.id}\n\n${b?.description || ''}`
      setDescription(merged)
      setContributors(buildContributors(a?.contributors, b?.contributors))
    })
    return () => { cancelled = true }
  }, [targetStudyId, sourceStudy.id])

  const canMerge = !!preflight && !preflight.alreadyMerged && !submitting

  const handleMerge = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const reviewed = {
        description,
        contributorEmails: contributors.filter((c) => c.checked).map((c) => c.email)
      }
      const result = await window.api.mergeStudy(targetStudyId, sourceStudy.id, reviewed)
      if (!result.success) throw new Error(result.error || 'Merge failed')
      onMerged?.()
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  return (
    <>
      <header className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 className="text-base font-medium">
          Add source <span className="text-muted-foreground text-sm">— Step 3 of 3</span>
        </h3>
      </header>
      <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
        {!preflight ? (
          <p className="text-sm text-muted-foreground">Computing pre-flight…</p>
        ) : (
          <>
            <div className="bg-muted rounded-md p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">From</span><b>{sourceStudy.title || sourceStudy.id}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Into</span><b>{targetMeta?.title || targetStudyId}</b></div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Adding</span>
                <span>{preflight.deploymentCount} deployments · {preflight.mediaCount} media · {preflight.observationCount} observations</span>
              </div>
            </div>

            {preflight.ownedByBiowatchCount > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {preflight.ownedByBiowatchCount} files in {sourceStudy.title || 'this study'} live inside biowatch's own storage. They will remain available after the merge, but deleting the source study later will make them unavailable here. You'll be warned at delete time.
              </p>
            )}
            {preflight.renameCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {preflight.renameCount} deployment IDs from the source will be renamed (e.g., <code>CAM_01 → study:{sourceStudy.id.slice(0, 8)}:CAM_01</code>) to avoid collisions. Informational — IDs are internal.
              </p>
            )}

            <label className="block">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Description</span>
              <textarea
                className="w-full mt-1 px-3 py-2 rounded-md bg-muted border border-border text-sm font-mono"
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Contributors</div>
              <div className="border border-border rounded-md divide-y divide-border">
                {contributors.map((c, i) => (
                  <label key={c.email + i} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={c.checked}
                      onChange={(e) =>
                        setContributors((prev) =>
                          prev.map((p, idx) => (idx === i ? { ...p, checked: e.target.checked } : p))
                        )
                      }
                    />
                    <span className="flex-1">
                      {c.title || c.email}
                      <span className="text-muted-foreground"> · {c.role}</span>
                    </span>
                    <span className="text-[10px] uppercase text-muted-foreground">{c.origin}</span>
                  </label>
                ))}
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {error}
              </div>
            )}
          </>
        )}
      </div>
      <footer className="flex justify-between items-center px-5 py-3 border-t border-border bg-muted">
        <button onClick={onBack} className="text-sm text-muted-foreground" disabled={submitting}>← Back</button>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 rounded-md border border-border bg-card text-sm" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button
            disabled={!canMerge}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            onClick={handleMerge}
          >
            {submitting ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </footer>
    </>
  )
}

function buildContributors(aJson, bJson) {
  const aArr = safeParse(aJson)
  const bArr = safeParse(bJson)
  const byEmail = new Map()
  for (const c of aArr) {
    if (c.email) byEmail.set(c.email.toLowerCase(), { ...c, origin: 'A only', checked: true })
  }
  for (const c of bArr) {
    if (!c.email) continue
    const key = c.email.toLowerCase()
    if (byEmail.has(key)) byEmail.get(key).origin = 'A + B'
    else byEmail.set(key, { ...c, origin: 'B only', checked: true })
  }
  return [...byEmail.values()]
}

function safeParse(s) {
  if (!s) return []
  if (Array.isArray(s)) return s
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
```

- [ ] **Step 2: Add `getStudyMetadata` IPC if it doesn't already exist**

Check: `grep -rn 'getStudyMetadata\|study:get-metadata' src/main/ipc src/preload`. If absent, add a handler in `src/main/ipc/study.js` that opens the study DB and returns the row from `metadata`; expose via preload as `getStudyMetadata`.

- [ ] **Step 3: Manual smoke**

```
npm run dev
# +Add source → Another study → pick one → review screen renders with summary, prefilled description, contributors.
# Click Merge → modal closes; Sources tab shows the new merged row.
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/AddSource/ReviewStep.jsx
# Plus the new metadata IPC if added.
git commit -m "feat(wizard): merge review step with metadata reconciliation"
```

---

## Task 14: B-deletion confirmation in the renderer

**Files:**
- Modify: wherever the study delete button is wired (find via `grep -rn 'deleteStudyDatabase' src/renderer`)

- [ ] **Step 1: Update the call site**

Today the call looks like `await window.api.deleteStudyDatabase(studyId)`. Replace with:

```js
const result = await window.api.deleteStudyDatabase(studyId)
if (result?.needsConfirm) {
  const lines = result.dependentBreaks.map(
    (d) => `• ${d.title} — ${d.brokenMediaCount} media will become unavailable`
  )
  const ok = window.confirm(
    `${studyTitle} has been merged into ${result.dependentBreaks.length} other ${
      result.dependentBreaks.length === 1 ? 'study' : 'studies'
    }:\n${lines.join('\n')}\nDelete anyway?`
  )
  if (!ok) return
  await window.api.deleteStudyDatabase(studyId, { force: true })
}
```

You can replace `window.confirm` with the project's confirmation modal pattern if one exists (search for an existing `ConfirmModal` component before falling back to `window.confirm`).

- [ ] **Step 2: Manual smoke**

```
npm run dev
# Create A, create B as a CamtrapDP-imported-into-biowatch study, merge B into A.
# Try to delete B → expect confirmation dialog listing A.
# Cancel → B still exists. Confirm → B deleted; A's merged source now has broken filePaths visible as "unavailable" in views.
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/<file>.jsx
git commit -m "feat(study-delete): confirm before deleting a study that backs merged sources"
```

---

## Task 15: Documentation updates

**Files:**
- Modify: `docs/architecture.md`, `docs/data-formats.md`, `docs/database-schema.md`, `docs/import-export.md`, `docs/ipc-api.md`

- [ ] **Step 1: Update each doc with a short section**

For each doc, add or amend a short paragraph reflecting the merge convention:
- **architecture.md** — under "Studies & sources": "A study's Sources tab can also include merged sources, encoded as `media.importFolder = 'merge:<source-study-uuid>'`. The renderer special-cases this string to resolve the source row's title and icon from the source study."
- **data-formats.md** — note that the `merge:` importFolder convention is biowatch-internal and not exported to Camtrap DP.
- **database-schema.md** — describe `media.importFolder` values: real path / dataset name / URL / `merge:<uuid>`. Note PK prefix `study:<uuid-short>:` used for merged deployments / media / observations.
- **import-export.md** — add a "Merging studies" subsection that summarizes the no-copy approach and the B-deletion warning.
- **ipc-api.md** — document `mergeStudy`, `mergePreflight`, `onMergeComplete`, and the updated `deleteStudyDatabase` signature.

- [ ] **Step 2: Commit**

```bash
git add docs/architecture.md docs/data-formats.md docs/database-schema.md docs/import-export.md docs/ipc-api.md
git commit -m "docs: describe merge-study-as-source convention and IPCs"
```

---

## Task 16: Full validation

- [ ] **Step 1: Run the full test suite**

```
npm test
```

Expected: all tests pass, including the new merge tests.

- [ ] **Step 2: Manual E2E walk-through**

Cover each scenario:

1. **Folder→folder merge.** Create A from a local folder. Create B from a different local folder. Merge B into A. Confirm:
   - Sources tab in A shows a new row with B's title and Folder icon.
   - Counts match the spec's pre-flight values.
   - Re-opening "+ Add source → Another study" lists B with "Already merged" badge.
2. **CamtrapDP-into-biowatch merge.** Import a Camtrap DP from GBIF into B. Merge B into A. Confirm:
   - The review screen shows the "files inside biowatch's own storage" notice.
   - After merge, attempt to delete B → confirmation dialog fires listing A and the affected media count.
3. **LILA merge.** Merge a LILA-imported B into A. Confirm:
   - The merged row in A shows the Globe icon (resolved from B's importerName).
   - Delete B → no confirmation dialog (URLs aren't at risk).
4. **External CamtrapDP merge.** Merge a CamtrapDP imported from an external drive. Delete B → no confirmation dialog.

- [ ] **Step 3: Run lint/format**

```
npm run format:check
```

Fix any flagged files with `npm run format`.

---

## Self-review notes

Worked through the plan against the spec; coverage check:

- ✅ Wizard 3 steps (type / study / review) — Tasks 11–13.
- ✅ `merge:<B-uuid>` importFolder, PK prefix `study:<B-uuid-short>:` — Tasks 1, 4.
- ✅ `mergePreflight` returns the documented payload — Task 2.
- ✅ `mergeStudy` DB transaction, FK rewrites, contributor merge, date range — Task 4.
- ✅ Idempotency / `alreadyMerged` — Tasks 2, 4.
- ✅ Per-row icon + label resolution + path-detection skip for `merge:` — Tasks 5, 9, 10.
- ✅ B-deletion warning scoped to at-risk files — Tasks 3, 7.
- ✅ Preload exposure — Task 8.
- ✅ Renderer call-site update for delete — Task 14.
- ✅ Documentation — Task 15.

**Not implemented** (out of scope per spec): source-scoped deployment matching, un-merge, multi-merge, model-run homogenization. These are documented in the spec's *Known limitations*.
