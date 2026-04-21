# Video Bounding Boxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render per-frame detector bounding boxes over the video element in the main media modal, synchronized to playback, with the same `0.5` confidence rule used for images — without touching the classification write path.

**Architecture:** Add one new IPC handler that reads `modelOutputs.rawOutput.frames[]`, filters each frame's `detections` using the image-path rule (always keep top, drop others below `0.5`), normalizes bbox coordinates via the existing `transformBboxToCamtrapDP` helper, and returns a flat array `[{ frameNumber, bboxX, bboxY, bboxWidth, bboxHeight, conf }, …]`. In the renderer, inside the existing video branch of the media modal, fetch via React Query, track `<video>.currentTime` (throttled), derive `currentFrameNumber = floor(currentTime * fps)` where `fps` comes from `media.exifData.fps`, filter detections for the current frame, and render an absolutely-positioned SVG overlay with lime `<rect>` elements. Reuse the existing `showBboxes` toggle.

**Tech Stack:** Electron (main + preload + renderer), Drizzle ORM over better-sqlite3, React + React Query, SVG overlay, `node:test` for unit tests.

---

## File Structure

**Create:**
- `src/renderer/src/utils/videoBboxes.js` — pure helpers: `getBboxesForFrame`, `getVideoBounds`.
- `src/renderer/src/ui/VideoBboxOverlay.jsx` — presentational React component that owns nothing stateful: given a `videoRef`, a `containerRef`, a `currentFrameBboxes` array, and a `visible` boolean, it renders the SVG overlay.
- `test/main/database/videoFrameDetections.test.js` — query-layer tests.
- `test/main/ipc/media.videoFrameDetections.test.js` — IPC-layer tests (thin wrapper around the query).
- `test/renderer/videoBboxes.test.js` — pure helper tests.

**Modify:**
- `src/main/database/queries/media.js` — add `getVideoFrameDetections(dbPath, mediaID)`.
- `src/main/database/queries/index.js` — re-export `getVideoFrameDetections`.
- `src/main/database/index.js` — pass-through export (the file re-exports from `./queries/index.js`).
- `src/main/ipc/media.js` — add `ipcMain.handle('media:get-video-frame-detections', …)`.
- `src/preload/index.js` — add `getVideoFrameDetections(studyId, mediaID)` on `api`.
- `src/renderer/src/media.jsx` — wire the query and mount `<VideoBboxOverlay>` inside the existing video branch.

**Design notes influencing decomposition:**
- The IPC handler is trivial (study-db plumbing); the interesting logic lives in the query function. Putting logic in `queries/media.js` mirrors `getMediaBboxes` and keeps the IPC handler testable via the query directly.
- The frame-lookup + letterbox math is pulled out into `videoBboxes.js` so both the component and the tests can exercise it without mounting React.
- `VideoBboxOverlay` is separate from `media.jsx` because `media.jsx` is already ~3500 lines. Adding an SVG-rendering branch there would bloat it further; a dedicated component is the right boundary.

---

## Task 1: Add pure helpers for video bbox overlay

**Files:**
- Create: `src/renderer/src/utils/videoBboxes.js`
- Test: `test/renderer/videoBboxes.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/renderer/videoBboxes.test.js`:

```javascript
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getBboxesForFrame, getVideoBounds } from '../../src/renderer/src/utils/videoBboxes.js'

describe('getBboxesForFrame', () => {
  const detections = [
    { frameNumber: 0, bboxX: 0.1, bboxY: 0.1, bboxWidth: 0.2, bboxHeight: 0.2, conf: 0.9 },
    { frameNumber: 2, bboxX: 0.3, bboxY: 0.3, bboxWidth: 0.1, bboxHeight: 0.1, conf: 0.8 },
    { frameNumber: 2, bboxX: 0.5, bboxY: 0.5, bboxWidth: 0.1, bboxHeight: 0.1, conf: 0.7 },
    { frameNumber: 5, bboxX: 0.6, bboxY: 0.6, bboxWidth: 0.2, bboxHeight: 0.2, conf: 0.95 }
  ]

  test('returns matching detections for exact frame', () => {
    const result = getBboxesForFrame(detections, 2)
    assert.equal(result.length, 2)
    assert.equal(result[0].conf, 0.8)
    assert.equal(result[1].conf, 0.7)
  })

  test('returns empty array when no frame matches', () => {
    assert.deepEqual(getBboxesForFrame(detections, 3), [])
  })

  test('returns single detection when only one matches', () => {
    const result = getBboxesForFrame(detections, 0)
    assert.equal(result.length, 1)
    assert.equal(result[0].frameNumber, 0)
  })

  test('returns empty array for empty input', () => {
    assert.deepEqual(getBboxesForFrame([], 0), [])
  })

  test('handles null/undefined input gracefully', () => {
    assert.deepEqual(getBboxesForFrame(null, 0), [])
    assert.deepEqual(getBboxesForFrame(undefined, 0), [])
  })
})

describe('getVideoBounds', () => {
  function makeVideo(videoWidth, videoHeight) {
    return { videoWidth, videoHeight }
  }
  function makeContainer(width, height) {
    return {
      getBoundingClientRect: () => ({ width, height, left: 0, top: 0 })
    }
  }

  test('returns null when videoElement is missing', () => {
    assert.equal(getVideoBounds(null, makeContainer(100, 100)), null)
  })

  test('returns null when containerElement is missing', () => {
    assert.equal(getVideoBounds(makeVideo(1920, 1080), null), null)
  })

  test('returns null when video dimensions are zero (metadata not loaded)', () => {
    assert.equal(getVideoBounds(makeVideo(0, 0), makeContainer(100, 100)), null)
  })

  test('letterboxes top/bottom when video is wider than container', () => {
    // video 2:1 (1920x960), container 1:1 (800x800)
    // rendered width 800, rendered height 400, offsetY 200
    const bounds = getVideoBounds(makeVideo(1920, 960), makeContainer(800, 800))
    assert.equal(bounds.renderedWidth, 800)
    assert.equal(bounds.renderedHeight, 400)
    assert.equal(bounds.offsetX, 0)
    assert.equal(bounds.offsetY, 200)
  })

  test('letterboxes left/right when video is taller than container', () => {
    // video 1:2 (480x960), container 1:1 (800x800)
    // rendered height 800, rendered width 400, offsetX 200
    const bounds = getVideoBounds(makeVideo(480, 960), makeContainer(800, 800))
    assert.equal(bounds.renderedWidth, 400)
    assert.equal(bounds.renderedHeight, 800)
    assert.equal(bounds.offsetX, 200)
    assert.equal(bounds.offsetY, 0)
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:
```
node --test test/renderer/videoBboxes.test.js
```
Expected: FAIL with "Cannot find module" or similar (file doesn't exist yet).

- [ ] **Step 3: Create the helpers**

Create `src/renderer/src/utils/videoBboxes.js`:

```javascript
/**
 * Pure helpers for the video bbox overlay.
 */

/**
 * Filter the flat detections array to those matching a given frame number.
 *
 * @param {Array<{frameNumber: number}>|null|undefined} detections
 * @param {number} frameNumber
 * @returns {Array}
 */
export function getBboxesForFrame(detections, frameNumber) {
  if (!detections || detections.length === 0) return []
  return detections.filter((d) => d.frameNumber === frameNumber)
}

/**
 * Compute the rendered bounds of a <video> element inside a container
 * that uses object-contain letterboxing.
 *
 * Mirrors getImageBounds() in bboxCoordinates.js but reads videoWidth/videoHeight.
 *
 * @param {{videoWidth: number, videoHeight: number}|null|undefined} videoElement
 * @param {{getBoundingClientRect: () => DOMRect}|null|undefined} containerElement
 * @returns {{offsetX: number, offsetY: number, renderedWidth: number, renderedHeight: number, containerRect: DOMRect}|null}
 */
export function getVideoBounds(videoElement, containerElement) {
  if (!videoElement || !containerElement) return null

  const containerRect = containerElement.getBoundingClientRect()
  const natW = videoElement.videoWidth
  const natH = videoElement.videoHeight
  if (!natW || !natH) return null

  const containerAspect = containerRect.width / containerRect.height
  const mediaAspect = natW / natH

  let renderedWidth, renderedHeight, offsetX, offsetY

  if (mediaAspect > containerAspect) {
    renderedWidth = containerRect.width
    renderedHeight = containerRect.width / mediaAspect
    offsetX = 0
    offsetY = (containerRect.height - renderedHeight) / 2
  } else {
    renderedHeight = containerRect.height
    renderedWidth = containerRect.height * mediaAspect
    offsetX = (containerRect.width - renderedWidth) / 2
    offsetY = 0
  }

  return { offsetX, offsetY, renderedWidth, renderedHeight, containerRect }
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:
```
node --test test/renderer/videoBboxes.test.js
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/videoBboxes.js test/renderer/videoBboxes.test.js
git commit -m "feat(renderer): add pure helpers for video bbox overlay"
```

---

## Task 2: Add `getVideoFrameDetections` query function

**Files:**
- Modify: `src/main/database/queries/media.js` (add function at end of file)
- Modify: `src/main/database/queries/index.js` (re-export)
- Modify: `src/main/database/index.js` (pass-through re-export)
- Test: `test/main/database/videoFrameDetections.test.js`

The query reads the `modelOutputs` row for a given `mediaID`, applies the image-path confidence filter per frame (always keep top, drop others below `0.5`), normalizes coords via the existing `transformBboxToCamtrapDP`, and returns a flat array.

- [ ] **Step 1: Write failing tests**

Create `test/main/database/videoFrameDetections.test.js`:

```javascript
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import crypto from 'crypto'

import {
  createImageDirectoryDatabase,
  insertMedia,
  getStudyIdFromPath,
  getVideoFrameDetections,
  getDrizzleDb,
  modelRuns,
  modelOutputs
} from '../../../src/main/database/index.js'

let testBiowatchDataPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    const log = electronLog.default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // electron-log not available — ignore
  }

  testStudyId = `test-video-bboxes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-video-bboxes-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })

  await createImageDirectoryDatabase(testDbPath, 'local')
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function insertVideoModelOutput(mediaID, frames, modelID = 'speciesnet', modelVersion = '4.0.1a') {
  const studyId = getStudyIdFromPath(testDbPath)
  const db = await getDrizzleDb(studyId, testDbPath)

  const runID = crypto.randomUUID()
  await db.insert(modelRuns).values({
    id: runID,
    modelID,
    modelVersion,
    startedAt: new Date().toISOString(),
    status: 'completed'
  })

  await db.insert(modelOutputs).values({
    id: crypto.randomUUID(),
    mediaID,
    runID,
    rawOutput: { frames }
  })
}

async function insertVideoMedia(mediaID = 'media-1') {
  await insertMedia(testDbPath, [
    {
      mediaID,
      filePath: `/tmp/${mediaID}.mp4`,
      fileName: `${mediaID}.mp4`,
      fileMediatype: 'video/mp4',
      folderName: 'deploy-1',
      importFolder: '/tmp'
    }
  ])
}

function speciesnetFrame(frameNumber, detections) {
  return {
    filepath: '/tmp/x.mp4',
    prediction: 'animal;Mammalia;Carnivora;Ursidae;Ursus;arctos;brown bear',
    model_version: '4.0.1a',
    prediction_score: 0.8,
    frame_number: frameNumber,
    metadata: { fps: 30, duration: 5 },
    detections
  }
}

describe('getVideoFrameDetections', () => {
  test('returns empty array when no modelOutputs row exists', async () => {
    await insertVideoMedia('m1')
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    assert.deepEqual(result, [])
  })

  test('returns empty array when media does not exist', async () => {
    const result = await getVideoFrameDetections(testDbPath, 'does-not-exist')
    assert.deepEqual(result, [])
  })

  test('returns empty array when rawOutput.frames is empty', async () => {
    await insertVideoMedia('m1')
    await insertVideoModelOutput('m1', [])
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    assert.deepEqual(result, [])
  })

  test('applies threshold: always keeps top, drops others below 0.5', async () => {
    await insertVideoMedia('m1')
    await insertVideoModelOutput('m1', [
      speciesnetFrame(0, [
        { bbox: [0.1, 0.1, 0.2, 0.2], conf: 0.4 },
        { bbox: [0.3, 0.3, 0.1, 0.1], conf: 0.3 },
        { bbox: [0.5, 0.5, 0.1, 0.1], conf: 0.2 }
      ]),
      speciesnetFrame(1, [
        { bbox: [0.1, 0.1, 0.2, 0.2], conf: 0.9 },
        { bbox: [0.3, 0.3, 0.1, 0.1], conf: 0.6 },
        { bbox: [0.5, 0.5, 0.1, 0.1], conf: 0.4 }
      ])
    ])
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    // Frame 0: top only (0.4) — no others ≥ 0.5.
    // Frame 1: top (0.9) + 0.6 (≥ 0.5). 0.4 dropped.
    assert.equal(result.length, 3)

    const frame0 = result.filter((d) => d.frameNumber === 0)
    assert.equal(frame0.length, 1)
    assert.equal(frame0[0].conf, 0.4)

    const frame1 = result.filter((d) => d.frameNumber === 1).sort((a, b) => b.conf - a.conf)
    assert.equal(frame1.length, 2)
    assert.equal(frame1[0].conf, 0.9)
    assert.equal(frame1[1].conf, 0.6)
  })

  test('preserves ascending frameNumber ordering', async () => {
    await insertVideoMedia('m1')
    await insertVideoModelOutput('m1', [
      speciesnetFrame(5, [{ bbox: [0, 0, 0.1, 0.1], conf: 0.9 }]),
      speciesnetFrame(0, [{ bbox: [0, 0, 0.1, 0.1], conf: 0.9 }]),
      speciesnetFrame(2, [{ bbox: [0, 0, 0.1, 0.1], conf: 0.9 }])
    ])
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    assert.deepEqual(result.map((d) => d.frameNumber), [0, 2, 5])
  })

  test('normalizes SpeciesNet bbox (already top-left) correctly', async () => {
    await insertVideoMedia('m1')
    await insertVideoModelOutput(
      'm1',
      [speciesnetFrame(0, [{ bbox: [0.1, 0.2, 0.3, 0.4], conf: 0.9 }])],
      'speciesnet',
      '4.0.1a'
    )
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    assert.equal(result.length, 1)
    assert.equal(result[0].bboxX, 0.1)
    assert.equal(result[0].bboxY, 0.2)
    assert.equal(result[0].bboxWidth, 0.3)
    assert.equal(result[0].bboxHeight, 0.4)
  })

  test('normalizes DeepFaune xywhn (center format) to top-left', async () => {
    await insertVideoMedia('m1')
    // Center (0.5, 0.5), width 0.2, height 0.4 → top-left (0.4, 0.3), w 0.2, h 0.4
    await insertVideoModelOutput(
      'm1',
      [
        {
          filepath: '/tmp/x.mp4',
          prediction: 'chamois',
          model_version: '1.3',
          prediction_score: 0.8,
          frame_number: 0,
          metadata: { fps: 30, duration: 5 },
          detections: [{ xywhn: [0.5, 0.5, 0.2, 0.4], conf: 0.9 }]
        }
      ],
      'deepfaune',
      '1.3'
    )
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    assert.equal(result.length, 1)
    assert.ok(Math.abs(result[0].bboxX - 0.4) < 1e-9)
    assert.ok(Math.abs(result[0].bboxY - 0.3) < 1e-9)
    assert.equal(result[0].bboxWidth, 0.2)
    assert.equal(result[0].bboxHeight, 0.4)
  })

  test('skips detections with malformed bbox data', async () => {
    await insertVideoMedia('m1')
    await insertVideoModelOutput('m1', [
      speciesnetFrame(0, [
        { bbox: [0.1, 0.1, 0.2, 0.2], conf: 0.9 },
        { bbox: null, conf: 0.8 }, // malformed — transform returns null
        { conf: 0.7 } // missing bbox entirely
      ])
    ])
    const result = await getVideoFrameDetections(testDbPath, 'm1')
    // Only the top valid detection survives.
    assert.equal(result.length, 1)
    assert.equal(result[0].conf, 0.9)
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:
```
npm run test:rebuild && node --test test/main/database/videoFrameDetections.test.js
```
Expected: FAIL — `getVideoFrameDetections is not a function` (or import error).

- [ ] **Step 3: Add the query function**

Append to `src/main/database/queries/media.js`:

```javascript
/**
 * Get per-frame detector bboxes for a video, sourced from modelOutputs.rawOutput.frames.
 *
 * Applies the same confidence filter as the image write path:
 * - Always keep the highest-confidence detection per frame.
 * - Keep additional detections only if conf >= DETECTION_CONFIDENCE_THRESHOLD.
 *
 * Returns a flat array of { frameNumber, bboxX, bboxY, bboxWidth, bboxHeight, conf }
 * sorted by frameNumber ascending.
 *
 * @param {string} dbPath - Path to the SQLite database
 * @param {string} mediaID - The media ID to get frame detections for
 * @returns {Promise<Array>}
 */
export async function getVideoFrameDetections(dbPath, mediaID) {
  const DETECTION_CONFIDENCE_THRESHOLD = 0.5
  const startTime = Date.now()

  try {
    const studyId = getStudyIdFromPath(dbPath)
    const db = await getDrizzleDb(studyId, dbPath)

    const rows = await db
      .select({ rawOutput: modelOutputs.rawOutput })
      .from(modelOutputs)
      .where(eq(modelOutputs.mediaID, mediaID))
      .limit(1)

    if (rows.length === 0) return []

    const rawOutput = rows[0].rawOutput
    const frames = rawOutput?.frames
    if (!Array.isArray(frames) || frames.length === 0) return []

    const modelType = detectModelType(frames[0])

    const result = []
    for (const frame of frames) {
      const frameNumber = frame?.frame_number
      const detections = frame?.detections
      if (typeof frameNumber !== 'number' || !Array.isArray(detections) || detections.length === 0) {
        continue
      }

      // Sort by conf desc. Always keep the top; keep others only if >= threshold.
      const sorted = [...detections].sort((a, b) => (b?.conf ?? 0) - (a?.conf ?? 0))
      const kept = sorted.filter((d, i) => i === 0 || (d?.conf ?? 0) >= DETECTION_CONFIDENCE_THRESHOLD)

      for (const detection of kept) {
        const bbox = transformBboxToCamtrapDP(detection, modelType)
        if (!bbox) continue
        result.push({
          frameNumber,
          bboxX: bbox.bboxX,
          bboxY: bbox.bboxY,
          bboxWidth: bbox.bboxWidth,
          bboxHeight: bbox.bboxHeight,
          conf: detection.conf
        })
      }
    }

    result.sort((a, b) => a.frameNumber - b.frameNumber)

    const elapsedTime = Date.now() - startTime
    log.info(
      `Retrieved ${result.length} video frame detections for media ${mediaID} in ${elapsedTime}ms`
    )
    return result
  } catch (error) {
    log.error(`Error querying video frame detections: ${error.message}`)
    throw error
  }
}
```

Add the missing imports at the top of `src/main/database/queries/media.js`. Find the existing import block at lines 1-9 and replace it with:

```javascript
/**
 * Media-related database queries
 */

import { getDrizzleDb, media, observations, modelRuns, modelOutputs } from '../index.js'
import { eq, and, desc, count, sql, isNotNull, inArray, isNull } from 'drizzle-orm'
import { DateTime } from 'luxon'
import log from 'electron-log'
import { getStudyIdFromPath, formatToMatchOriginal } from './utils.js'
import { transformBboxToCamtrapDP, detectModelType } from '../../utils/bbox.js'
```

- [ ] **Step 4: Re-export from the queries index**

Modify `src/main/database/queries/index.js`. Find the Media section (around line 33-43):

```javascript
// Media
export {
  getFilesData,
  getMediaBboxes,
  getMediaBboxesBatch,
  checkMediaHaveBboxes,
  updateMediaTimestamp,
  insertMedia,
  updateMediaFavorite,
  countMediaWithNullTimestamps
} from './media.js'
```

Replace with:

```javascript
// Media
export {
  getFilesData,
  getMediaBboxes,
  getMediaBboxesBatch,
  checkMediaHaveBboxes,
  getVideoFrameDetections,
  updateMediaTimestamp,
  insertMedia,
  updateMediaFavorite,
  countMediaWithNullTimestamps
} from './media.js'
```

- [ ] **Step 5: Verify the top-level re-export**

`src/main/database/index.js` currently does `export * from './queries/index.js'` (verify by reading the file). If so, no change is needed here. If it uses an explicit list, add `getVideoFrameDetections` alongside `getMediaBboxes`. Also ensure `modelRuns` and `modelOutputs` are exported from `src/main/database/index.js` for the test — if not, add them.

Check with:
```
grep -n "modelRuns\|modelOutputs\|getMediaBboxes\|export \*" src/main/database/index.js
```

If the file re-exports tables and queries via explicit lists and is missing `modelRuns` / `modelOutputs`, add them:

```javascript
export { modelRuns, modelOutputs } from './models.js'
```

(next to existing table exports).

- [ ] **Step 6: Run tests and verify they pass**

Run:
```
node --test test/main/database/videoFrameDetections.test.js
```
Expected: all tests pass.

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run:
```
npm run test
```
Expected: all tests pass. (On failure, inspect output — do not mark complete.)

- [ ] **Step 8: Commit**

```bash
git add src/main/database/queries/media.js src/main/database/queries/index.js src/main/database/index.js test/main/database/videoFrameDetections.test.js
git commit -m "feat(db): add getVideoFrameDetections query"
```

---

## Task 3: Add IPC handler and preload bridge

**Files:**
- Modify: `src/main/ipc/media.js`
- Modify: `src/preload/index.js`
- Test: `test/main/ipc/media.videoFrameDetections.test.js`

The IPC handler is a thin wrapper around `getVideoFrameDetections` — its only job is to resolve `studyId → dbPath` and forward the call. We still test it end-to-end (via direct function call, not Electron IPC) so the plumbing is covered.

- [ ] **Step 1: Write the IPC handler test**

Create `test/main/ipc/media.videoFrameDetections.test.js`:

```javascript
import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import crypto from 'crypto'

import {
  createImageDirectoryDatabase,
  insertMedia,
  getStudyIdFromPath,
  getVideoFrameDetections,
  getDrizzleDb,
  modelRuns,
  modelOutputs
} from '../../../src/main/database/index.js'

// The IPC handler itself is registered against Electron's ipcMain (not importable
// cleanly in a node:test context). We cover its logic by testing the query function
// and by confirming the handler body's contract: { data } on success, { error } on failure.
// This test guards the shape expected by preload/renderer consumers.

let testBiowatchDataPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const log = (await import('electron-log')).default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // ignore
  }

  testStudyId = `test-ipc-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-ipc-video-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
  await createImageDirectoryDatabase(testDbPath, 'local')
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

describe('IPC media:get-video-frame-detections contract', () => {
  test('returns shape { data: [...] } for a valid video with detections', async () => {
    await insertMedia(testDbPath, [
      {
        mediaID: 'm1',
        filePath: '/tmp/m1.mp4',
        fileName: 'm1.mp4',
        fileMediatype: 'video/mp4',
        folderName: 'deploy-1',
        importFolder: '/tmp'
      }
    ])

    const studyId = getStudyIdFromPath(testDbPath)
    const db = await getDrizzleDb(studyId, testDbPath)
    const runID = crypto.randomUUID()
    await db.insert(modelRuns).values({
      id: runID,
      modelID: 'speciesnet',
      modelVersion: '4.0.1a',
      startedAt: new Date().toISOString(),
      status: 'completed'
    })
    await db.insert(modelOutputs).values({
      id: crypto.randomUUID(),
      mediaID: 'm1',
      runID,
      rawOutput: {
        frames: [
          {
            filepath: '/tmp/m1.mp4',
            prediction: 'animal;Mammalia;Carnivora;Ursidae;Ursus;arctos;brown bear',
            model_version: '4.0.1a',
            frame_number: 0,
            prediction_score: 0.9,
            metadata: { fps: 30, duration: 5 },
            detections: [{ bbox: [0.1, 0.1, 0.2, 0.2], conf: 0.9 }]
          }
        ]
      }
    })

    // Mirror the handler body: wrap query, return { data } or { error }.
    const responseShape = await (async () => {
      try {
        const data = await getVideoFrameDetections(testDbPath, 'm1')
        return { data }
      } catch (error) {
        return { error: error.message }
      }
    })()

    assert.ok('data' in responseShape, 'response has data field')
    assert.equal(responseShape.data.length, 1)
    assert.equal(responseShape.data[0].frameNumber, 0)
    assert.equal(responseShape.data[0].bboxX, 0.1)
  })

  test('returns shape { data: [] } for a video without a modelOutputs row', async () => {
    await insertMedia(testDbPath, [
      {
        mediaID: 'm2',
        filePath: '/tmp/m2.mp4',
        fileName: 'm2.mp4',
        fileMediatype: 'video/mp4',
        folderName: 'deploy-1',
        importFolder: '/tmp'
      }
    ])

    const responseShape = await (async () => {
      try {
        const data = await getVideoFrameDetections(testDbPath, 'm2')
        return { data }
      } catch (error) {
        return { error: error.message }
      }
    })()

    assert.deepEqual(responseShape, { data: [] })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```
node --test test/main/ipc/media.videoFrameDetections.test.js
```
Expected: FAIL — the import of `getVideoFrameDetections` already exists from Task 2, so if Task 2 was committed this might pass. That's fine; this test acts as a contract guard. If Task 2 is not yet merged, it will fail at import.

- [ ] **Step 3: Add the IPC handler**

Modify `src/main/ipc/media.js`. Find the import block at lines 5-18:

```javascript
import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import {
  getMediaBboxes,
  getMediaBboxesBatch,
  checkMediaHaveBboxes,
  getBestMedia,
  updateMediaTimestamp,
  updateMediaFavorite,
  countMediaWithNullTimestamps,
  closeStudyDatabase
} from '../database/index.js'
```

Replace with:

```javascript
import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync } from 'fs'
import { getStudyDatabasePath } from '../services/paths.js'
import {
  getMediaBboxes,
  getMediaBboxesBatch,
  checkMediaHaveBboxes,
  getVideoFrameDetections,
  getBestMedia,
  updateMediaTimestamp,
  updateMediaFavorite,
  countMediaWithNullTimestamps,
  closeStudyDatabase
} from '../database/index.js'
```

Then, after the existing `media:have-bboxes` handler block (around line 74), insert the new handler:

```javascript
  // Get per-frame detector bboxes for a video (from modelOutputs.rawOutput.frames)
  ipcMain.handle('media:get-video-frame-detections', async (_, studyId, mediaID) => {
    try {
      const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
      if (!dbPath || !existsSync(dbPath)) {
        log.warn(`Database not found for study ID: ${studyId}`)
        return { error: 'Database not found for this study' }
      }

      const detections = await getVideoFrameDetections(dbPath, mediaID)
      return { data: detections }
    } catch (error) {
      log.error('Error getting video frame detections:', error)
      return { error: error.message }
    }
  })
```

- [ ] **Step 4: Add the preload bridge**

Modify `src/preload/index.js`. Find the `getMediaBboxesBatch` block at lines 62-64:

```javascript
  getMediaBboxesBatch: async (studyId, mediaIDs) => {
    return await electronAPI.ipcRenderer.invoke('media:get-bboxes-batch', studyId, mediaIDs)
  },
```

Insert directly after that block (before `checkMediaHaveBboxes`):

```javascript
  getVideoFrameDetections: async (studyId, mediaID) => {
    return await electronAPI.ipcRenderer.invoke('media:get-video-frame-detections', studyId, mediaID)
  },
```

- [ ] **Step 5: Run the IPC test and verify it passes**

Run:
```
node --test test/main/ipc/media.videoFrameDetections.test.js
```
Expected: all tests pass.

- [ ] **Step 6: Run the full test suite**

Run:
```
npm run test
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/media.js src/preload/index.js test/main/ipc/media.videoFrameDetections.test.js
git commit -m "feat(ipc): expose getVideoFrameDetections via IPC + preload"
```

---

## Task 4: Build the `VideoBboxOverlay` component

**Files:**
- Create: `src/renderer/src/ui/VideoBboxOverlay.jsx`

The overlay is a presentational component — no data fetching, no playback-time tracking. It receives the set of bboxes to render for the current frame as a prop. The parent (media modal) owns time tracking and the React Query call; this keeps the component cheap to mount and easy to reason about.

Because the renderer is only exercised manually for this task (no jsdom is configured for rendering tests), we don't add a unit test here — the underlying logic is already covered by `videoBboxes.test.js`.

- [ ] **Step 1: Create the component**

Create `src/renderer/src/ui/VideoBboxOverlay.jsx`:

```javascript
import { useEffect, useState } from 'react'

/**
 * Presentational bbox overlay for a <video> element.
 *
 * Draws an absolutely-positioned SVG above the video, with one <rect> per
 * detection in currentFrameBboxes. Rectangles are positioned in normalized
 * (0-1) coordinates relative to the rendered video area (letterbox-aware).
 *
 * Does no data fetching and no time tracking — the parent owns both.
 *
 * Props:
 * - videoRef: React ref to the <video> element
 * - containerRef: React ref to the element wrapping the video (defines the overlay bounds)
 * - currentFrameBboxes: Array<{ frameNumber, bboxX, bboxY, bboxWidth, bboxHeight, conf }>
 * - visible: boolean — gate rendering (ties to the existing showBboxes toggle)
 */
export default function VideoBboxOverlay({ videoRef, containerRef, currentFrameBboxes, visible }) {
  const [metadataReady, setMetadataReady] = useState(false)
  const [, forceRerender] = useState(0)

  // Track video metadata readiness so videoWidth/videoHeight are non-zero before drawing.
  useEffect(() => {
    const el = videoRef?.current
    if (!el) return

    if (el.videoWidth > 0 && el.videoHeight > 0) {
      setMetadataReady(true)
      return
    }

    const handleLoaded = () => setMetadataReady(true)
    el.addEventListener('loadedmetadata', handleLoaded)
    return () => el.removeEventListener('loadedmetadata', handleLoaded)
  }, [videoRef])

  // Re-render on window resize so letterboxing math stays correct.
  useEffect(() => {
    const handleResize = () => forceRerender((n) => n + 1)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (!visible || !metadataReady || !currentFrameBboxes || currentFrameBboxes.length === 0) {
    return null
  }

  const videoEl = videoRef.current
  const containerEl = containerRef.current
  if (!videoEl || !containerEl) return null

  // Letterbox-aware bounds. Inlined to avoid a runtime import cycle; same math as getVideoBounds.
  const containerRect = containerEl.getBoundingClientRect()
  const natW = videoEl.videoWidth
  const natH = videoEl.videoHeight
  if (!natW || !natH || !containerRect.width || !containerRect.height) return null

  const containerAspect = containerRect.width / containerRect.height
  const mediaAspect = natW / natH

  let renderedWidth, renderedHeight, offsetX, offsetY
  if (mediaAspect > containerAspect) {
    renderedWidth = containerRect.width
    renderedHeight = containerRect.width / mediaAspect
    offsetX = 0
    offsetY = (containerRect.height - renderedHeight) / 2
  } else {
    renderedHeight = containerRect.height
    renderedWidth = containerRect.height * mediaAspect
    offsetX = (containerRect.width - renderedWidth) / 2
    offsetY = 0
  }

  return (
    <svg
      className="pointer-events-none absolute inset-0 w-full h-full"
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
    >
      {currentFrameBboxes.map((bbox, index) => {
        const x = offsetX + bbox.bboxX * renderedWidth
        const y = offsetY + bbox.bboxY * renderedHeight
        const w = bbox.bboxWidth * renderedWidth
        const h = bbox.bboxHeight * renderedHeight
        return (
          <rect
            key={`${bbox.frameNumber}-${index}`}
            x={x}
            y={y}
            width={w}
            height={h}
            fill="transparent"
            stroke="#84cc16"
            strokeWidth={2}
          />
        )
      })}
    </svg>
  )
}
```

- [ ] **Step 2: Verify the component parses (no runtime check yet — wired in Task 5)**

Run:
```
npx eslint src/renderer/src/ui/VideoBboxOverlay.jsx
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/VideoBboxOverlay.jsx
git commit -m "feat(renderer): add VideoBboxOverlay presentational component"
```

---

## Task 5: Wire the overlay into the media modal

**Files:**
- Modify: `src/renderer/src/media.jsx`

The video branch sits around line 2057 inside the media modal component. We need to:
1. Import `VideoBboxOverlay` and add a `useQuery` that fetches frame detections when `isVideo`.
2. Add a `videoRef`, a `videoContainerRef`, and `currentTime` state updated (throttled) via `onTimeUpdate`.
3. Wrap the existing `<video>` element in a relatively-positioned container, and mount `<VideoBboxOverlay>` alongside it.
4. Gate the overlay on the existing `showBboxes` state (already declared at `media.jsx:1055`).

- [ ] **Step 1: Add import at the top of `media.jsx`**

Find the import block near the top of `src/renderer/src/media.jsx`. Locate the line that currently imports from `./ui/BboxLabel` or a similar neighbouring UI component. Add alongside:

```javascript
import VideoBboxOverlay from './ui/VideoBboxOverlay.jsx'
```

(The exact sibling-import to place it next to depends on current ordering — group it with other `./ui/*` imports.)

- [ ] **Step 2: Add refs and playback-time state inside the modal component**

In the component that contains the video branch at `media.jsx:2057` (it's the same component that declares `showBboxes` at line 1055 and the video transcoding state), add near the other `useRef` declarations:

```javascript
  const videoRef = useRef(null)
  const videoContainerRef = useRef(null)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const lastVideoTimeUpdateRef = useRef(0)
```

Reset playback state when the media changes. Inside the existing effect that resets video-related state on `media?.mediaID` / `media?.favorite` change (around `media.jsx:1067` where `videoError` is reset), add:

```javascript
    setVideoCurrentTime(0)
    lastVideoTimeUpdateRef.current = 0
```

- [ ] **Step 3: Fetch frame detections with React Query**

Place this hook near the existing `useQuery` for `mediaBboxes` (around `media.jsx:1326`):

```javascript
  // Fetch per-frame video detections (empty for images or videos without classification)
  const { data: videoFrameDetections = [] } = useQuery({
    queryKey: ['videoFrameDetections', studyId, media?.mediaID],
    queryFn: async () => {
      const response = await window.api.getVideoFrameDetections(studyId, media.mediaID)
      return response.data || []
    },
    enabled: isOpen && isVideo && !!media?.mediaID && !!studyId,
    staleTime: Infinity
  })
```

- [ ] **Step 4: Derive the current frame's detections**

Place this directly after the `useQuery` above:

```javascript
  const videoFps = media?.exifData?.fps || 1
  const currentFrameNumber = Math.floor(videoCurrentTime * videoFps)
  const currentFrameBboxes = useMemo(
    () => videoFrameDetections.filter((d) => d.frameNumber === currentFrameNumber),
    [videoFrameDetections, currentFrameNumber]
  )
```

Ensure `useMemo` is imported from `react` at the top of the file — if it isn't already in the `react` import, extend it. Do the same for `useRef` if missing.

- [ ] **Step 5: Attach refs and onTimeUpdate to the existing `<video>` element**

Find the `<video>` element around `media.jsx:2057`. It currently looks roughly like:

```javascript
                <video
                  key={transcodedUrl || media.filePath}
                  src={(() => { ... })()}
                  className="max-w-full max-h-[calc(90vh-152px)] w-auto h-auto object-contain"
                  controls
                  autoPlay
                  onLoadStart={...}
                  onLoadedData={...}
                  onCanPlay={...}
                  onError={...}
                />
```

Wrap it in a relative container holding both the video and the overlay. Replace the `<video ... />` element (and only that element) with:

```javascript
                <div ref={videoContainerRef} className="relative">
                  <video
                    ref={videoRef}
                    key={transcodedUrl || media.filePath}
                    src={(() => {
                      const videoSrc = transcodedUrl || constructImageUrl(media.filePath)
                      console.log('=== VIDEO ELEMENT ===')
                      console.log('transcodeState:', transcodeState)
                      console.log('transcodedUrl:', transcodedUrl)
                      console.log('media.filePath:', media.filePath)
                      console.log('Final video src:', videoSrc)
                      return videoSrc
                    })()}
                    className="max-w-full max-h-[calc(90vh-152px)] w-auto h-auto object-contain"
                    controls
                    autoPlay
                    onLoadStart={(e) => {
                      console.log('Video onLoadStart:', e.target.src)
                    }}
                    onLoadedData={(e) => {
                      console.log('Video onLoadedData:', e.target.src, 'duration:', e.target.duration)
                    }}
                    onCanPlay={(e) => {
                      console.log('Video onCanPlay:', e.target.src)
                    }}
                    onTimeUpdate={(e) => {
                      const now = performance.now()
                      if (now - lastVideoTimeUpdateRef.current < 250) return
                      lastVideoTimeUpdateRef.current = now
                      setVideoCurrentTime(e.target.currentTime)
                    }}
                    onSeeked={(e) => {
                      // Force an immediate update after seeking so boxes jump with the scrubber.
                      lastVideoTimeUpdateRef.current = 0
                      setVideoCurrentTime(e.target.currentTime)
                    }}
                    onError={(e) => {
                      console.error('Video onError:', e.target.src)
                      console.error('Video error details:', e.target.error)
                      if (transcodeState === 'idle' || transcodeState === 'ready') {
                        setVideoError(true)
                      }
                    }}
                  />
                  <VideoBboxOverlay
                    videoRef={videoRef}
                    containerRef={videoContainerRef}
                    currentFrameBboxes={currentFrameBboxes}
                    visible={showBboxes}
                  />
                </div>
```

Note the three changes from the original:
- Added `ref={videoRef}` to the `<video>` element.
- Added `onTimeUpdate` (throttled to 250ms) and `onSeeked` handlers.
- Wrapped in `<div ref={videoContainerRef} className="relative">…</div>` containing both the video and `<VideoBboxOverlay>`.

- [ ] **Step 6: Run the dev server and manually verify**

Run:
```
npm run dev
```

Test checklist (use any classified video in your local dataset — if none, classify a short video first with the SpeciesNet or DeepFaune flow):

- Open a classified video from the media tab. Boxes appear over the video and update with playback.
- Seek forward and backward using the native scrubber. Boxes follow.
- Toggle the `showBboxes` button (top-right of the modal, shortcut `B`). Boxes hide; toggle back. Boxes reappear.
- Open an un-classified video (or a video with no passing detections). No boxes appear, no errors in the DevTools console.
- Open a video still transcoding (e.g., `.mkv` or `.avi`). Boxes appear only after the transcode completes; no errors during the transcode phase.
- Resize the window during playback. Boxes stay aligned with the letterboxed video.

If any of these fail, stop and diagnose before committing.

- [ ] **Step 7: Run linter**

Run:
```
npm run lint
```
Expected: no errors on the files you modified. (Pre-existing warnings elsewhere can be ignored.)

- [ ] **Step 8: Run the full test suite**

Run:
```
npm run test
```
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "feat(renderer): render per-frame bboxes over videos in media modal"
```

---

## Self-review summary

- **Spec coverage:**
  - Goals 1 (overlay in main media modal) → Task 5.
  - Goal 2 (sync via `floor(currentTime * fps)`) → Task 5 Step 4.
  - Goal 3 (top-kept + 0.5 filter) → Task 2 Step 3.
  - Goal 4 (reuse `showBboxes`, lime) → Task 4 (`#84cc16`) + Task 5 (`visible={showBboxes}`).
  - Goal 5 (no write-path changes) → enforced by not touching `prediction.js`.
  - Edge cases (missing row, missing frames, missing fps, frame out of range, transcoding, metadata not loaded, seek): covered in Task 2 tests + Task 4 `metadataReady` gate + Task 5 `enabled` flag + Task 5 `onSeeked`.
  - Testing requirements (IPC unit tests, frame-lookup pure helper tests, manual PR checklist): Task 1 (pure helpers), Task 2 (query), Task 3 (IPC contract), Task 5 Step 6 (manual checklist).
- **Placeholder scan:** no TBDs, no "handle appropriately", no "similar to Task N" — each task's code is complete and standalone.
- **Type/name consistency:** `frameNumber`, `bboxX/Y/Width/Height`, `conf`, `videoFrameDetections`, `currentFrameBboxes`, `videoRef`, `videoContainerRef`, `showBboxes` match across Tasks 1–5.

---

## Out of scope (follow-up PRs per spec)

- Investigate gating `insertVideoPredictions` classification aggregation on detector confidence.
- Extend overlay to `BestMediaCarousel` video viewer.
- Per-model detector threshold lookup via `modelOutputs → runs → model`.
- Optional bbox labels (detector class / confidence).
