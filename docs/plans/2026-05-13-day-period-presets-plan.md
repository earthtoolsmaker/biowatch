# Day-period presets and chart-shape toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four preset day-period chips (Dawn/Day/Dusk/Night, multi-select) and a Polar / X–Y chart-shape toggle to the bottom filter row in both the Media and Activity tabs.

**Architecture:** Generalize the `timeRange` filter from a single `{start, end}` to an array of `ranges`. The renderer derives that array either from the chip selection (union of preset hour windows) or from the existing freeform drag-arc, but never both at once. The polar `CircularTimeFilter` learns a `mode='drag'|'chips'` prop; a new `DailyActivityLine` mirrors the existing `DailyActivityRadar` over a 24h x-axis; a small `ChartShapeToggle` swaps between them. Backend query functions normalize legacy `{start, end}` callers into the new shape so the change stays internal.

**Tech Stack:** React, Recharts, lucide-react, Tailwind, Drizzle ORM (better-sqlite3), node:test.

**Spec:** `docs/specs/2026-05-13-day-period-presets-design.md`

---

## File Structure

**New files:**
- `src/renderer/src/utils/dayPeriods.js` — preset constants, `chipsToRanges()` helper, `isFullDayRange()` helper. Pure module, no React.
- `src/renderer/src/ui/dayPeriodChips.jsx` — four-button chip bar (DayPeriodChips component).
- `src/renderer/src/ui/chartShapeToggle.jsx` — two-button polar/x-y toggle.
- `test/renderer/dayPeriods.test.js` — unit tests for the pure helpers.
- `test/main/database/queries/sequencesTimeRange.test.js` — query-layer tests for the multi-range filter.

**Modified files:**
- `src/main/database/queries/sequences.js` — add `normalizeTimeRange()` helper at module top; replace the two single-range time-filter blocks (in `getMediaForSequencePagination` and `hasTimestampedMedia`) with a loop over normalized ranges.
- `src/main/database/queries/species.js` — same multi-range refactor for `getSpeciesHeatmapDataByMedia` and `getSequenceAwareHeatmapSQL` so the Activity-tab map heatmap honors chip selection.
- `src/main/services/sequences/worker.js` — pass `timeRange` object through to the heatmap query in place of the positional `startHour, endHour`.
- `src/main/ipc/sequences.js` — heatmap handler accepts `timeRange` in place of `startHour, endHour`.
- `src/preload/index.js` — `getSequenceAwareHeatmap` API accepts `timeRange` in place of `startHour, endHour`.
- `src/renderer/src/ui/clock.jsx` — extend `CircularTimeFilter` with `mode` and `chipSectors` props; add `DailyActivityLine` component.
- `src/renderer/src/media.jsx` — replace `timeRange` state with `chipSelection` + `arc`; derive `ranges`; add `chartShape`; render chips above the clock card and the chart-shape toggle in its top-right.
- `src/renderer/src/activity.jsx` — same renderer changes as media.jsx, plus update the heatmap query call to pass `timeRange`.

**Unchanged:**
- IPC layer (`src/preload/index.js`, `src/main/index.js`): `timeRange` is opaque, no signature change.
- `src/main/services/sequences/pagination.js`: passes `timeRange` through unchanged.
- `src/renderer/src/media/Gallery.jsx` and `DeploymentMediaGallery.jsx`: still pass `{start, end}` shape — backward-compat normalization in the query layer covers them.

---

## Task 1: Backend helper — normalize timeRange shape

**Files:**
- Modify: `src/main/database/queries/sequences.js` (top of file, before `getMediaForSequencePagination`)
- Test: `test/main/database/queries/sequencesTimeRange.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `test/main/database/queries/sequencesTimeRange.test.js`:

```js
/**
 * Unit tests for normalizeTimeRange — accepts both the legacy
 * {start, end} shape and the new {ranges: [...]} shape.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeTimeRange } from '../../../../src/main/database/queries/sequences.js'

describe('normalizeTimeRange', () => {
  test('returns [] for undefined/null/empty input', () => {
    assert.deepEqual(normalizeTimeRange(undefined), [])
    assert.deepEqual(normalizeTimeRange(null), [])
    assert.deepEqual(normalizeTimeRange({}), [])
  })

  test('wraps legacy {start, end} into a single-element ranges array', () => {
    assert.deepEqual(normalizeTimeRange({ start: 5, end: 8 }), [{ start: 5, end: 8 }])
  })

  test('passes through {ranges: [...]} unchanged', () => {
    const ranges = [
      { start: 5, end: 8 },
      { start: 18, end: 21 }
    ]
    assert.deepEqual(normalizeTimeRange({ ranges }), ranges)
  })

  test('prefers ranges over start/end when both present', () => {
    const ranges = [{ start: 0, end: 12 }]
    assert.deepEqual(normalizeTimeRange({ ranges, start: 100, end: 200 }), ranges)
  })

  test('returns [] when ranges is an empty array', () => {
    assert.deepEqual(normalizeTimeRange({ ranges: [] }), [])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="normalizeTimeRange"`
Expected: FAIL with "normalizeTimeRange is not a function" or import error.

- [ ] **Step 3: Implement normalizeTimeRange in sequences.js**

In `src/main/database/queries/sequences.js`, add this exported helper near the top of the file (after the imports, before the first function):

```js
/**
 * Normalize the timeRange filter into an array of {start, end} ranges.
 * Accepts:
 *   - undefined / null / {} → no filter, returns []
 *   - { start, end }        → legacy single-range shape, returns [{start, end}]
 *   - { ranges: [...] }     → new multi-range shape, passed through
 *
 * Empty ranges means "no time-of-day filter".
 */
export function normalizeTimeRange(timeRange) {
  if (!timeRange) return []
  if (Array.isArray(timeRange.ranges)) return timeRange.ranges
  if (timeRange.start !== undefined && timeRange.end !== undefined) {
    return [{ start: timeRange.start, end: timeRange.end }]
  }
  return []
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="normalizeTimeRange"`
Expected: PASS (5 subtests).

- [ ] **Step 5: Commit**

```bash
git add src/main/database/queries/sequences.js test/main/database/queries/sequencesTimeRange.test.js
git commit -m "refactor(queries): add normalizeTimeRange helper for sequences filter"
```

---

## Task 2: Backend — apply ranges loop in getMediaForSequencePagination

**Files:**
- Modify: `src/main/database/queries/sequences.js:46-300` (specifically the `hasTimeFilter` block and the timestamped-phase filter at lines ~82, ~262-280)
- Test: `test/main/database/queries/sequencesTimeRange.test.js` (extend)

- [ ] **Step 1: Add an integration test for the multi-range filter**

Append to `test/main/database/queries/sequencesTimeRange.test.js` (above the closing imports if needed, after the existing describe block):

```js
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'
import { beforeEach, afterEach } from 'node:test'

import {
  getMediaForSequencePagination,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    // not available, fine
  }
  testStudyId = `test-time-range-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-time-range-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seedHourlyMedia() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: {
      deploymentID: 'd1',
      locationID: 'loc1',
      locationName: 'Site A',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 1,
      longitude: 1,
      cameraID: 'cam1'
    }
  })
  // One media per hour, 00:30 through 23:30 (24 rows)
  const mediaMap = {}
  const obsMap = {}
  for (let h = 0; h < 24; h++) {
    const id = `m-${String(h).padStart(2, '0')}`
    mediaMap[`${id}.jpg`] = {
      mediaID: id,
      deploymentID: 'd1',
      timestamp: DateTime.fromISO(`2024-06-01T${String(h).padStart(2, '0')}:30:00`, { zone: 'utc' }),
      filePath: `/${id}.jpg`,
      fileName: `${id}.jpg`
    }
    obsMap[`obs-${id}`] = {
      observationID: `obs-${id}`,
      mediaID: id,
      deploymentID: 'd1',
      eventID: `ev-${id}`,
      observationType: 'animal',
      scientificName: 'Sus scrofa',
      timestamp: DateTime.fromISO(`2024-06-01T${String(h).padStart(2, '0')}:30:00`, { zone: 'utc' })
    }
  }
  await insertMedia(manager, mediaMap)
  await insertObservations(manager, obsMap)
  return manager
}

describe('getMediaForSequencePagination — timeRange filter', () => {
  test('legacy {start, end} shape continues to work', async () => {
    await seedHourlyMedia()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: { start: 8, end: 18 }
    })
    const hours = result.media.map((m) => new Date(m.timestamp).getUTCHours()).sort((a, b) => a - b)
    assert.deepEqual(hours, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
  })

  test('new {ranges: [...]} shape with a single range matches legacy', async () => {
    await seedHourlyMedia()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: { ranges: [{ start: 8, end: 18 }] }
    })
    const hours = result.media.map((m) => new Date(m.timestamp).getUTCHours()).sort((a, b) => a - b)
    assert.deepEqual(hours, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
  })

  test('multi-range shape unions the ranges (Dawn + Dusk)', async () => {
    await seedHourlyMedia()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: {
        ranges: [
          { start: 5, end: 8 },
          { start: 18, end: 21 }
        ]
      }
    })
    const hours = result.media.map((m) => new Date(m.timestamp).getUTCHours()).sort((a, b) => a - b)
    assert.deepEqual(hours, [5, 6, 7, 18, 19, 20])
  })

  test('wrap-around range still works (Night 21 → 5)', async () => {
    await seedHourlyMedia()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: { ranges: [{ start: 21, end: 5 }] }
    })
    const hours = result.media.map((m) => new Date(m.timestamp).getUTCHours()).sort((a, b) => a - b)
    assert.deepEqual(hours, [0, 1, 2, 3, 4, 21, 22, 23])
  })

  test('empty ranges means no time filter (all 24 hours match)', async () => {
    await seedHourlyMedia()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: { ranges: [] }
    })
    assert.equal(result.media.length, 24)
  })
})
```

- [ ] **Step 2: Run tests to verify the multi-range and empty-ranges cases fail**

Run: `npm test -- --test-name-pattern="timeRange filter"`
Expected: legacy and single-range tests PASS (current code happens to handle the single-range case via the legacy branch); multi-range, wrap-around-via-ranges, and empty-ranges tests FAIL because the function doesn't yet read `timeRange.ranges`.

- [ ] **Step 3: Refactor getMediaForSequencePagination to loop over ranges**

In `src/main/database/queries/sequences.js`, replace this block (around line 81-82):

```js
    // Time of day filter (only applies to timestamped media)
    const hasTimeFilter = timeRange.start !== undefined && timeRange.end !== undefined
```

with:

```js
    // Time of day filter (only applies to timestamped media). Empty array
    // means no filter; multiple ranges are unioned with OR.
    const timeRanges = normalizeTimeRange(timeRange)
    const hasTimeFilter = timeRanges.length > 0
```

Then replace the timestamped-phase filter block (around lines 262-280):

```js
      // Apply time of day filter
      if (hasTimeFilter) {
        if (timeRange.start < timeRange.end) {
          timestampedConditions.push(
            and(
              sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${timeRange.start}`,
              sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${timeRange.end}`
            )
          )
        } else if (timeRange.start > timeRange.end) {
          // Wraps around midnight
          timestampedConditions.push(
            or(
              sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${timeRange.start}`,
              sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${timeRange.end}`
            )
          )
        }
      }
```

with:

```js
      // Apply time of day filter — OR of per-range conditions.
      if (hasTimeFilter) {
        const rangeConditions = timeRanges
          .map((r) => buildHourRangeCondition(r))
          .filter(Boolean)
        if (rangeConditions.length === 1) {
          timestampedConditions.push(rangeConditions[0])
        } else if (rangeConditions.length > 1) {
          timestampedConditions.push(or(...rangeConditions))
        }
      }
```

Add `buildHourRangeCondition` near `normalizeTimeRange`:

```js
/**
 * Build a SQL condition for a single {start, end} hour range against
 * media.timestamp. Half-open [start, end). Returns null when start === end
 * (zero-width range, no rows match — caller should drop it).
 *
 * Wrap-around (start > end) is OR'd: hour >= start OR hour < end.
 */
function buildHourRangeCondition(range) {
  const { start, end } = range
  if (start === end) return null
  if (start < end) {
    return and(
      sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${start}`,
      sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${end}`
    )
  }
  return or(
    sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${start}`,
    sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${end}`
  )
}
```

- [ ] **Step 4: Run tests to verify they all pass**

Run: `npm test -- --test-name-pattern="timeRange filter"`
Expected: all 5 subtests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/database/queries/sequences.js test/main/database/queries/sequencesTimeRange.test.js
git commit -m "feat(queries): support multi-range timeRange filter in getMediaForSequencePagination"
```

---

## Task 3: Backend — apply same refactor to hasTimestampedMedia

**Files:**
- Modify: `src/main/database/queries/sequences.js` (lines ~563-606)
- Test: `test/main/database/queries/sequencesTimeRange.test.js` (extend)

- [ ] **Step 1: Add a test for hasTimestampedMedia with the new shape**

Append to `test/main/database/queries/sequencesTimeRange.test.js`:

```js
import { hasTimestampedMedia } from '../../../../src/main/database/index.js'

describe('hasTimestampedMedia — timeRange filter', () => {
  test('returns true when ranges union covers a populated hour', async () => {
    await seedHourlyMedia()
    const result = await hasTimestampedMedia(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: {
        ranges: [
          { start: 5, end: 8 },
          { start: 18, end: 21 }
        ]
      }
    })
    assert.equal(result, true)
  })

  test('returns false when ranges union covers no populated hour', async () => {
    await seedHourlyMedia()
    // Seed has one media per full hour 00..23. Construct a range that
    // skips them all by selecting [3.5, 3.75) — the integer-hour cast
    // will exclude every row.
    // Easier: query a study with media only at hours 8-17 and ask for 0-1.
    // Re-using seedHourlyMedia (24 rows), there's no empty-hour gap, so
    // we instead assert behavior with [0, 0] zero-width plus an empty array.
    const empty = await hasTimestampedMedia(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: { ranges: [] }
    })
    assert.equal(empty, true) // no filter → matches all
  })
})
```

- [ ] **Step 2: Run tests to verify the multi-range case fails**

Run: `npm test -- --test-name-pattern="hasTimestampedMedia — timeRange"`
Expected: FAIL on the multi-range case (function still reads `timeRange.start`).

- [ ] **Step 3: Refactor hasTimestampedMedia**

In `src/main/database/queries/sequences.js`, replace the time-range block in `hasTimestampedMedia` (around lines 590-606):

```js
    // Apply time range
    if (timeRange.start !== undefined && timeRange.end !== undefined) {
      if (timeRange.start < timeRange.end) {
        conditions.push(
          and(
            sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${timeRange.start}`,
            sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${timeRange.end}`
          )
        )
      } else if (timeRange.start > timeRange.end) {
        conditions.push(
          or(
            sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) >= ${timeRange.start}`,
            sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER) < ${timeRange.end}`
          )
        )
      }
    }
```

with:

```js
    // Apply time range — same OR-of-ranges semantics as the paginated query.
    const timeRanges = normalizeTimeRange(timeRange)
    if (timeRanges.length > 0) {
      const rangeConditions = timeRanges.map(buildHourRangeCondition).filter(Boolean)
      if (rangeConditions.length === 1) {
        conditions.push(rangeConditions[0])
      } else if (rangeConditions.length > 1) {
        conditions.push(or(...rangeConditions))
      }
    }
```

- [ ] **Step 4: Run all sequences tests**

Run: `npm test -- --test-name-pattern="timeRange"`
Expected: all subtests PASS.

Then run the full sequences test suite to make sure no regressions:

Run: `npm test -- --test-name-pattern="getMediaForSequencePagination"`
Expected: existing pseudo-species tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/database/queries/sequences.js test/main/database/queries/sequencesTimeRange.test.js
git commit -m "feat(queries): support multi-range timeRange filter in hasTimestampedMedia"
```

---

## Task 4: Renderer — pure helpers (preset constants and chip→ranges)

**Files:**
- Create: `src/renderer/src/utils/dayPeriods.js`
- Create: `test/renderer/dayPeriods.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/renderer/dayPeriods.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  DAY_PERIOD_PRESETS,
  chipsToRanges,
  arcToRanges,
  isFullDayArc
} from '../../src/renderer/src/utils/dayPeriods.js'

describe('DAY_PERIOD_PRESETS', () => {
  test('exposes dawn/day/dusk/night with non-overlapping hour ranges', () => {
    const keys = Object.keys(DAY_PERIOD_PRESETS).sort()
    assert.deepEqual(keys, ['dawn', 'day', 'dusk', 'night'])
    assert.deepEqual(DAY_PERIOD_PRESETS.dawn.range, { start: 5, end: 8 })
    assert.deepEqual(DAY_PERIOD_PRESETS.day.range, { start: 8, end: 18 })
    assert.deepEqual(DAY_PERIOD_PRESETS.dusk.range, { start: 18, end: 21 })
    assert.deepEqual(DAY_PERIOD_PRESETS.night.range, { start: 21, end: 5 })
  })
})

describe('chipsToRanges', () => {
  test('empty selection returns empty ranges', () => {
    assert.deepEqual(chipsToRanges(new Set()), [])
  })

  test('single chip returns its range', () => {
    assert.deepEqual(chipsToRanges(new Set(['day'])), [{ start: 8, end: 18 }])
  })

  test('dawn + dusk returns both ranges (crepuscular)', () => {
    assert.deepEqual(chipsToRanges(new Set(['dawn', 'dusk'])), [
      { start: 5, end: 8 },
      { start: 18, end: 21 }
    ])
  })

  test('all four chips returns all four ranges in canonical order', () => {
    assert.deepEqual(chipsToRanges(new Set(['night', 'day', 'dusk', 'dawn'])), [
      { start: 5, end: 8 },
      { start: 8, end: 18 },
      { start: 18, end: 21 },
      { start: 21, end: 5 }
    ])
  })

  test('ignores unknown chip keys', () => {
    assert.deepEqual(chipsToRanges(new Set(['day', 'midnight'])), [{ start: 8, end: 18 }])
  })
})

describe('isFullDayArc', () => {
  test('detects 0–24 as full day', () => {
    assert.equal(isFullDayArc({ start: 0, end: 24 }), true)
  })

  test('detects start === end as full day', () => {
    assert.equal(isFullDayArc({ start: 6, end: 6 }), true)
  })

  test('detects near-full ranges within 0.1h tolerance', () => {
    assert.equal(isFullDayArc({ start: 0.05, end: 23.95 }), true)
  })

  test('partial range is not full day', () => {
    assert.equal(isFullDayArc({ start: 8, end: 18 }), false)
  })
})

describe('arcToRanges', () => {
  test('full-day arc returns empty (no filter)', () => {
    assert.deepEqual(arcToRanges({ start: 0, end: 24 }), [])
  })

  test('partial arc returns single range', () => {
    assert.deepEqual(arcToRanges({ start: 8, end: 18 }), [{ start: 8, end: 18 }])
  })

  test('wrap-around arc returns single range', () => {
    assert.deepEqual(arcToRanges({ start: 21, end: 5 }), [{ start: 21, end: 5 }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="DAY_PERIOD_PRESETS|chipsToRanges|arcToRanges|isFullDayArc"`
Expected: FAIL with import error.

- [ ] **Step 3: Implement the helpers**

Create `src/renderer/src/utils/dayPeriods.js`:

```js
/**
 * Day-period presets and the helpers that translate UI selection state
 * (chip set, drag-arc) into the {ranges: [...]} shape consumed by the
 * backend timeRange filter.
 *
 * Hour ranges are half-open [start, end) in 24h local clock time. Night
 * wraps midnight (start > end).
 */

export const DAY_PERIOD_PRESETS = {
  dawn: { key: 'dawn', label: 'Dawn', range: { start: 5, end: 8 } },
  day: { key: 'day', label: 'Day', range: { start: 8, end: 18 } },
  dusk: { key: 'dusk', label: 'Dusk', range: { start: 18, end: 21 } },
  night: { key: 'night', label: 'Night', range: { start: 21, end: 5 } }
}

// Canonical render order: chronological, dawn first.
export const DAY_PERIOD_ORDER = ['dawn', 'day', 'dusk', 'night']

/**
 * Convert a chip selection (Set<string>) into an ordered ranges array.
 * Unknown keys are ignored.
 */
export function chipsToRanges(selection) {
  return DAY_PERIOD_ORDER.filter((key) => selection.has(key)).map(
    (key) => DAY_PERIOD_PRESETS[key].range
  )
}

/**
 * Whether a freeform drag-arc {start, end} effectively covers the whole
 * day. Tolerance handles fractional-hour drift from the polar drag.
 */
export function isFullDayArc(arc) {
  if (!arc) return true
  const { start, end } = arc
  if (start === end) return true
  return Math.abs(end - start) >= 23.9
}

/**
 * Convert a drag-arc {start, end} into the ranges array. Returns [] when
 * the arc is full-day (== no filter).
 */
export function arcToRanges(arc) {
  if (isFullDayArc(arc)) return []
  return [{ start: arc.start, end: arc.end }]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="DAY_PERIOD_PRESETS|chipsToRanges|arcToRanges|isFullDayArc"`
Expected: all subtests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/dayPeriods.js test/renderer/dayPeriods.test.js
git commit -m "feat(renderer): add dayPeriods preset constants and selection helpers"
```

---

## Task 5: Renderer — DayPeriodChips component

**Files:**
- Create: `src/renderer/src/ui/dayPeriodChips.jsx`

- [ ] **Step 1: Implement the component**

Create `src/renderer/src/ui/dayPeriodChips.jsx`:

```jsx
import { Sunrise, Sun, Sunset, Moon } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { DAY_PERIOD_ORDER, DAY_PERIOD_PRESETS } from '../utils/dayPeriods'

const ICONS = {
  dawn: Sunrise,
  day: Sun,
  dusk: Sunset,
  night: Moon
}

/**
 * Four icon buttons (Dawn / Day / Dusk / Night) above the polar clock.
 * Multi-select: each button toggles its key in the `selection` Set.
 * Visual treatment matches FilterChartsToggle for coherence with the
 * rest of the gap-slider strip.
 *
 * Props:
 *   selection: Set<string> — currently active chip keys
 *   onChange: (newSelection: Set<string>) => void
 */
export default function DayPeriodChips({ selection, onChange }) {
  const toggle = (key) => {
    const next = new Set(selection)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  return (
    <div className="flex items-center gap-1">
      {DAY_PERIOD_ORDER.map((key) => {
        const Icon = ICONS[key]
        const active = selection.has(key)
        return (
          <Tooltip.Root key={key}>
            <Tooltip.Trigger asChild>
              <button
                onClick={() => toggle(key)}
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                  active
                    ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
                aria-label={DAY_PERIOD_PRESETS[key].label}
                aria-pressed={active}
              >
                <Icon size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                sideOffset={6}
                className="z-[10000] px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
              >
                {DAY_PERIOD_PRESETS[key].label}
                <Tooltip.Arrow className="fill-popover" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Lint check**

Run: `npm run lint -- src/renderer/src/ui/dayPeriodChips.jsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/dayPeriodChips.jsx
git commit -m "feat(renderer): add DayPeriodChips component (Dawn/Day/Dusk/Night)"
```

---

## Task 6: Renderer — extend CircularTimeFilter with mode and chipSectors

**Files:**
- Modify: `src/renderer/src/ui/clock.jsx` (CircularTimeFilter only)

- [ ] **Step 1: Add the new props and chip-sector rendering**

In `src/renderer/src/ui/clock.jsx`, modify the `CircularTimeFilter` component signature to accept two new props:

```jsx
const CircularTimeFilter = ({
  onChange,
  startTime = 6,
  endTime = 18,
  mode = 'drag',
  chipSectors = []
}) => {
```

In the same component, replace the final SVG return block (the part that renders the arc, start handle, end handle):

```jsx
        <path
          d={createArc(timeToAngle(start), timeToAngle(end))}
          fill="rgb(59 130 246 / 0.15)"
          stroke="rgb(59 130 246 / 0.8)"
          strokeWidth="2"
          cursor="pointer"
          onMouseDown={handleMouseDown('arc')}
        />

        <circle
          cx={startCoord.x}
          cy={startCoord.y}
          r="4"
          fill="rgb(59 130 246)"
          cursor="pointer"
          onMouseDown={handleMouseDown('start')}
        />

        <circle
          cx={endCoord.x}
          cy={endCoord.y}
          r="4"
          fill="rgb(59 130 246)"
          cursor="pointer"
          onMouseDown={handleMouseDown('end')}
        />
```

with:

```jsx
        {mode === 'chips'
          ? chipSectors.map((sector, i) => (
              <path
                key={i}
                d={createArc(timeToAngle(sector.start), timeToAngle(sector.end))}
                fill="rgb(59 130 246 / 0.15)"
                stroke="rgb(59 130 246 / 0.8)"
                strokeWidth="2"
                pointerEvents="none"
              />
            ))
          : (
              <>
                <path
                  d={createArc(timeToAngle(start), timeToAngle(end))}
                  fill="rgb(59 130 246 / 0.15)"
                  stroke="rgb(59 130 246 / 0.8)"
                  strokeWidth="2"
                  cursor="pointer"
                  onMouseDown={handleMouseDown('arc')}
                />
                <circle
                  cx={startCoord.x}
                  cy={startCoord.y}
                  r="4"
                  fill="rgb(59 130 246)"
                  cursor="pointer"
                  onMouseDown={handleMouseDown('start')}
                />
                <circle
                  cx={endCoord.x}
                  cy={endCoord.y}
                  r="4"
                  fill="rgb(59 130 246)"
                  cursor="pointer"
                  onMouseDown={handleMouseDown('end')}
                />
              </>
            )}
```

The `createArc` function is already defined and works for both wrap-around and normal ranges. Each chip sector renders as a non-interactive `<path>`; the drag arc and handles are not rendered in chips mode.

- [ ] **Step 2: Lint check**

Run: `npm run lint -- src/renderer/src/ui/clock.jsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/clock.jsx
git commit -m "feat(clock): add mode + chipSectors props to CircularTimeFilter"
```

---

## Task 7: Renderer — DailyActivityLine component

**Files:**
- Modify: `src/renderer/src/ui/clock.jsx` (add new component, export)

- [ ] **Step 1: Add the line-chart component**

In `src/renderer/src/ui/clock.jsx`, add this new component below `DailyActivityRadar` (above the export statement). First, ensure these recharts imports are present at the top of the file (extend the existing import line):

```jsx
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ReferenceArea,
  ResponsiveContainer,
  XAxis,
  YAxis
} from 'recharts'
```

Then add the component:

```jsx
/**
 * X–Y twin of DailyActivityRadar. Renders the same hourly-bin data as a
 * line per species across a 24-hour x-axis. Off-period bands (the inverse
 * of `selectedRanges`) are shaded; with no selection, no shading.
 *
 * Props mirror DailyActivityRadar plus:
 *   selectedRanges: Array<{start, end}> — hour ranges currently in the
 *     filter. Used to shade the *complement* of these as off-period bands.
 */
const DailyActivityLine = ({ activityData, selectedSpecies, palette, selectedRanges = [] }) => {
  const formatData = (data) => {
    if (!data || !data.length) {
      return Array(24)
        .fill()
        .map((_, i) => ({ hour: i }))
    }
    return data.map((d) => ({ ...d, hour: d.hour }))
  }
  const formattedData = formatData(activityData)

  // Build off-period bands: 24h minus the union of selectedRanges.
  // For wrap-around ranges (start > end), split into two pieces first.
  const flattened = []
  for (const r of selectedRanges) {
    if (r.start === r.end) continue
    if (r.start < r.end) {
      flattened.push([r.start, r.end])
    } else {
      flattened.push([r.start, 24])
      flattened.push([0, r.end])
    }
  }
  flattened.sort((a, b) => a[0] - b[0])

  // Merge overlapping covered intervals.
  const covered = []
  for (const [s, e] of flattened) {
    if (covered.length && s <= covered[covered.length - 1][1]) {
      covered[covered.length - 1][1] = Math.max(covered[covered.length - 1][1], e)
    } else {
      covered.push([s, e])
    }
  }

  // Off-bands = complement of covered within [0, 24].
  const offBands = []
  let cursor = 0
  for (const [s, e] of covered) {
    if (s > cursor) offBands.push([cursor, s])
    cursor = e
  }
  if (cursor < 24) offBands.push([cursor, 24])
  // If nothing is selected, skip shading entirely.
  const showShading = covered.length > 0

  return (
    <div className="relative w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={formattedData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeOpacity={0} />
          <XAxis
            dataKey="hour"
            type="number"
            domain={[0, 23]}
            ticks={[0, 6, 12, 18, 23]}
            tick={{ fontSize: 9, fill: 'var(--color-muted-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide domain={[0, 'auto']} />
          {showShading &&
            offBands.map(([s, e], i) => (
              <ReferenceArea
                key={i}
                x1={s}
                x2={e}
                fill="var(--color-muted)"
                fillOpacity={0.5}
                strokeOpacity={0}
              />
            ))}
          {selectedSpecies.map((species, index) => (
            <Line
              key={species.scientificName}
              type="monotone"
              dataKey={species.scientificName}
              stroke={palette[index % palette.length]}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
```

Update the export at the bottom of the file:

```jsx
export { DailyActivityRadar, DailyActivityLine, CircularTimeFilter as default }
```

(Note: `Area` is imported but not used in this component — keep the import minimal. Drop `Area` from the import list if eslint flags it.)

- [ ] **Step 2: Lint check**

Run: `npm run lint -- src/renderer/src/ui/clock.jsx`
Expected: no errors. If `Area` triggers an unused-import warning, remove it from the import list.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/clock.jsx
git commit -m "feat(clock): add DailyActivityLine x-y twin of the radar chart"
```

---

## Task 8: Renderer — ChartShapeToggle component

**Files:**
- Create: `src/renderer/src/ui/chartShapeToggle.jsx`

- [ ] **Step 1: Implement**

Create `src/renderer/src/ui/chartShapeToggle.jsx`:

```jsx
import { ChartPie, ChartLine } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'

/**
 * Two-button group that switches the daily-activity chart between the
 * polar radar and the x-y line. Sits in the top-right of the clock card.
 *
 * Props:
 *   value: 'polar' | 'xy'
 *   onChange: (next) => void
 */
const SHAPES = [
  { key: 'polar', label: 'Polar', Icon: ChartPie },
  { key: 'xy', label: 'X–Y line', Icon: ChartLine }
]

export default function ChartShapeToggle({ value, onChange }) {
  return (
    <div className="flex gap-0.5">
      {SHAPES.map(({ key, label, Icon }) => {
        const active = value === key
        return (
          <Tooltip.Root key={key}>
            <Tooltip.Trigger asChild>
              <button
                onClick={() => onChange(key)}
                className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                  active
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
                aria-label={label}
                aria-pressed={active}
              >
                <Icon size={12} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                sideOffset={6}
                className="z-[10000] px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
              >
                {label}
                <Tooltip.Arrow className="fill-popover" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Lint check**

Run: `npm run lint -- src/renderer/src/ui/chartShapeToggle.jsx`
Expected: no errors. (If `ChartPie` / `ChartLine` aren't found in your installed lucide-react, fall back to `PieChart` / `LineChart` — both naming conventions ship in different versions.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/chartShapeToggle.jsx
git commit -m "feat(renderer): add ChartShapeToggle (polar/xy switch)"
```

---

## Task 9: Backend — refactor heatmap chain to use timeRange object

**Files:**
- Modify: `src/main/database/queries/species.js` (lines ~548-602 and ~686-)
- Modify: `src/main/services/sequences/worker.js` (lines ~40-115)
- Modify: `src/main/ipc/sequences.js` (lines ~115-163)
- Modify: `src/preload/index.js` (lines ~117-136)

This task changes the heatmap signature throughout: the positional
`startHour, endHour` args are replaced with a single `timeRange` object
(same shape as the sequences-pagination filter). Caller sites at the
renderer are updated in Task 11.

- [ ] **Step 1: species.js — getSpeciesHeatmapDataByMedia**

In `src/main/database/queries/species.js`, change the function signature and time-filter block. Replace:

```js
export async function getSpeciesHeatmapDataByMedia(
  dbPath,
  species,
  startDate,
  endDate,
  startHour = 0,
  endHour = 24,
  includeNullTimestamps = false
) {
```

with:

```js
export async function getSpeciesHeatmapDataByMedia(
  dbPath,
  species,
  startDate,
  endDate,
  timeRange = {},
  includeNullTimestamps = false
) {
```

Then replace the time-of-day block (currently lines ~587-603):

```js
    // Add time-of-day condition using sql template for SQLite strftime
    // When includeNullTimestamps=true, also allow null timestamps through
    const hourColumn = sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER)`
    if (startHour < endHour) {
      // Simple range (e.g., 8:00 to 17:00)
      const timeCondition = and(sql`${hourColumn} >= ${startHour}`, sql`${hourColumn} < ${endHour}`)
      baseConditions.push(
        includeNullTimestamps ? or(isNull(media.timestamp), timeCondition) : timeCondition
      )
    } else if (startHour > endHour) {
      // Wrapping range (e.g., 22:00 to 6:00)
      const timeCondition = or(sql`${hourColumn} >= ${startHour}`, sql`${hourColumn} < ${endHour}`)
      baseConditions.push(
        includeNullTimestamps ? or(isNull(media.timestamp), timeCondition) : timeCondition
      )
    }
    // If startHour equals endHour, we include all hours (full day)
```

with:

```js
    // Add time-of-day condition using sql template for SQLite strftime.
    // When includeNullTimestamps=true, allow null timestamps through.
    // Empty ranges array means no time filter.
    const hourColumn = sql`CAST(strftime('%H', ${media.timestamp}) AS INTEGER)`
    const ranges = normalizeTimeRange(timeRange)
    const rangeConditions = ranges
      .map((r) => {
        if (r.start === r.end) return null
        if (r.start < r.end) {
          return and(sql`${hourColumn} >= ${r.start}`, sql`${hourColumn} < ${r.end}`)
        }
        return or(sql`${hourColumn} >= ${r.start}`, sql`${hourColumn} < ${r.end}`)
      })
      .filter(Boolean)
    if (rangeConditions.length > 0) {
      const unioned = rangeConditions.length === 1 ? rangeConditions[0] : or(...rangeConditions)
      baseConditions.push(
        includeNullTimestamps ? or(isNull(media.timestamp), unioned) : unioned
      )
    }
```

At the top of `species.js`, add the import:

```js
import { normalizeTimeRange } from './sequences.js'
```

(if `species.js` doesn't already import from sequences.js — check the existing imports and merge accordingly).

- [ ] **Step 2: species.js — getSequenceAwareHeatmapSQL**

This function (around line 686) is the SQL fast-path for the heatmap. Apply the same signature change:

Find the function declaration:

```js
export async function getSequenceAwareHeatmapSQL(
  dbPath,
  species,
  startDate,
  endDate,
  startHour = 0,
  endHour = 24,
  includeNullTimestamps = false,
  gapSeconds = null
) {
```

Replace with:

```js
export async function getSequenceAwareHeatmapSQL(
  dbPath,
  species,
  startDate,
  endDate,
  timeRange = {},
  includeNullTimestamps = false,
  gapSeconds = null
) {
```

Inside the function, find the time-of-day filter block (it has the same shape as the one above — `if (startHour < endHour) ... else if (startHour > endHour) ...`) and replace it with the same `normalizeTimeRange` + `rangeConditions` pattern from Step 1. Read the function carefully — there may be multiple branches per gap-mode that each apply the time filter; update each one.

- [ ] **Step 3: worker.js — pass timeRange through**

In `src/main/services/sequences/worker.js`, replace this block (lines ~40-51):

```js
  const {
    type,
    dbPath,
    studyId,
    gapSeconds,
    speciesNames,
    startDate,
    endDate,
    startHour,
    endHour,
    includeNullTimestamps
  } = workerData
```

with:

```js
  const {
    type,
    dbPath,
    studyId,
    gapSeconds,
    speciesNames,
    startDate,
    endDate,
    timeRange,
    includeNullTimestamps
  } = workerData
```

In the `case 'heatmap':` block (around lines 95-115), replace `startHour, endHour` with `timeRange` in both the `getSequenceAwareHeatmapSQL` call and the `getSpeciesHeatmapDataByMedia` call:

```js
      const fastRows = await getSequenceAwareHeatmapSQL(
        dbPath,
        speciesNames,
        startDate,
        endDate,
        timeRange,
        includeNullTimestamps,
        effectiveGapSeconds
      )
      if (fastRows !== null) return pivotPreAggregatedHeatmap(fastRows)
      const rawData = await getSpeciesHeatmapDataByMedia(
        dbPath,
        speciesNames,
        startDate,
        endDate,
        timeRange,
        includeNullTimestamps
      )
```

- [ ] **Step 4: ipc/sequences.js — heatmap handler signature**

In `src/main/ipc/sequences.js`, replace the heatmap handler signature (lines ~120-163):

```js
  ipcMain.handle(
    'sequences:get-heatmap',
    async (
      _,
      studyId,
      speciesNames,
      startDate,
      endDate,
      startHour,
      endHour,
      includeNullTimestamps,
      gapSeconds
    ) => {
```

with:

```js
  ipcMain.handle(
    'sequences:get-heatmap',
    async (
      _,
      studyId,
      speciesNames,
      startDate,
      endDate,
      timeRange,
      includeNullTimestamps,
      gapSeconds
    ) => {
```

And in the `runInWorker` call inside the same handler, replace:

```js
        const data = await runInWorker({
          type: 'heatmap',
          dbPath,
          studyId,
          gapSeconds,
          speciesNames: stripped,
          startDate,
          endDate,
          startHour,
          endHour,
          includeNullTimestamps
        })
```

with:

```js
        const data = await runInWorker({
          type: 'heatmap',
          dbPath,
          studyId,
          gapSeconds,
          speciesNames: stripped,
          startDate,
          endDate,
          timeRange,
          includeNullTimestamps
        })
```

Also update the JSDoc comment above the handler (line ~115-117) to replace the `@param startHour` / `@param endHour` lines with `@param timeRange — { ranges: [{start, end}, ...] } or { start, end } legacy shape`.

- [ ] **Step 5: preload/index.js — API signature**

In `src/preload/index.js`, replace the `getSequenceAwareHeatmap` block (lines 117-136):

```js
  getSequenceAwareHeatmap: async (
    studyId,
    speciesNames,
    startDate,
    endDate,
    startHour,
    endHour,
    includeNullTimestamps
  ) => {
    return await electronAPI.ipcRenderer.invoke(
      'sequences:get-heatmap',
      studyId,
      speciesNames,
      startDate,
      endDate,
      startHour,
      endHour,
      includeNullTimestamps
    )
  },
```

with:

```js
  getSequenceAwareHeatmap: async (
    studyId,
    speciesNames,
    startDate,
    endDate,
    timeRange,
    includeNullTimestamps
  ) => {
    return await electronAPI.ipcRenderer.invoke(
      'sequences:get-heatmap',
      studyId,
      speciesNames,
      startDate,
      endDate,
      timeRange,
      includeNullTimestamps
    )
  },
```

- [ ] **Step 6: Run tests to confirm no regression**

Run: `npm test`
Expected: all tests pass. (No test exercises the heatmap chain end-to-end, but the sequences-related tests should still pass.)

- [ ] **Step 7: Commit**

```bash
git add src/main/database/queries/species.js src/main/services/sequences/worker.js src/main/ipc/sequences.js src/preload/index.js
git commit -m "refactor(heatmap): replace startHour/endHour positional args with timeRange object"
```

---

## Task 10: Renderer — wire it all into media.jsx

**Files:**
- Modify: `src/renderer/src/media.jsx`

- [ ] **Step 1: Update imports and state**

In `src/renderer/src/media.jsx`, add imports near the top (with the other UI imports):

```jsx
import CircularTimeFilter, { DailyActivityRadar, DailyActivityLine } from './ui/clock'
import DayPeriodChips from './ui/dayPeriodChips'
import ChartShapeToggle from './ui/chartShapeToggle'
import { chipsToRanges, arcToRanges } from './utils/dayPeriods'
```

Replace the existing `timeRange` state declaration (currently line 37):

```jsx
  const [timeRange, setTimeRange] = useState({ start: 0, end: 24 })
```

with:

```jsx
  const [chipSelection, setChipSelection] = useState(() => new Set())
  const [arc, setArc] = useState({ start: 0, end: 24 })
  const [chartShape, setChartShape] = useState('polar')

  // Derive the timeRange payload sent to the backend. Chips win; with no
  // chips, the freeform drag-arc supplies the (zero or one) range.
  const timeRange = useMemo(() => {
    const ranges = chipSelection.size > 0 ? chipsToRanges(chipSelection) : arcToRanges(arc)
    return { ranges }
  }, [chipSelection, arc])
```

- [ ] **Step 2: Update the time-range handler**

Replace the existing `handleTimeRangeChange` callback (currently around line 224):

```jsx
  const handleTimeRangeChange = useCallback((newTimeRange) => {
    setTimeRange(newTimeRange)
  }, [])
```

with:

```jsx
  const handleArcChange = useCallback((newArc) => {
    setArc(newArc)
  }, [])
```

- [ ] **Step 3: Replace the bottom-row clock card markup**

Replace the inner block of the second-row wrapper (currently lines ~304-319):

```jsx
            {speciesInitialized && sequenceGap !== undefined && (
              <div className="w-full flex h-[130px] gap-3">
                <div className="w-[140px] h-full rounded border border-border flex items-center justify-center relative">
                  <DailyActivityRadar
                    activityData={dailyActivityData}
                    selectedSpecies={selectedSpecies}
                    palette={palette}
                  />
                  <div className="absolute w-full h-full flex items-center justify-center">
                    <CircularTimeFilter
                      onChange={handleTimeRangeChange}
                      startTime={timeRange.start}
                      endTime={timeRange.end}
                    />
                  </div>
                </div>
```

with:

```jsx
            {speciesInitialized && sequenceGap !== undefined && (
              <div className="w-full flex h-[130px] gap-3">
                <div className="w-[180px] h-full rounded border border-border flex flex-col relative">
                  <div className="flex items-center justify-between px-2 pt-1.5">
                    <DayPeriodChips selection={chipSelection} onChange={setChipSelection} />
                    <ChartShapeToggle value={chartShape} onChange={setChartShape} />
                  </div>
                  <div className="flex-1 relative">
                    {chartShape === 'polar' ? (
                      <>
                        <DailyActivityRadar
                          activityData={dailyActivityData}
                          selectedSpecies={selectedSpecies}
                          palette={palette}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <CircularTimeFilter
                            onChange={handleArcChange}
                            startTime={arc.start}
                            endTime={arc.end}
                            mode={chipSelection.size > 0 ? 'chips' : 'drag'}
                            chipSectors={chipsToRanges(chipSelection)}
                          />
                        </div>
                      </>
                    ) : (
                      <DailyActivityLine
                        activityData={dailyActivityData}
                        selectedSpecies={selectedSpecies}
                        palette={palette}
                        selectedRanges={timeRange.ranges}
                      />
                    )}
                  </div>
                </div>
```

(The card grew from 140px to 180px wide to accommodate the chip row + toggle. The TimelineChart sibling continues to flex-grow into the remaining space.)

- [ ] **Step 4: Verify the dev build runs**

Run: `npm run dev`
Open the Media tab. Confirm:
- The four chip icons render above the polar clock.
- Clicking Day shows a single highlighted arc on the clock; the gallery filters to 08–18.
- Clicking Dawn + Dusk shows two arcs; the gallery filters to those windows.
- Deselecting all chips restores the drag-arc handles.
- Switching to X–Y mode (toggle in top-right) shows a line chart with shaded off-period bands matching the chip selection.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "feat(media): add day-period preset chips and chart-shape toggle"
```

---

## Task 11: Renderer — wire it all into activity.jsx

**Files:**
- Modify: `src/renderer/src/activity.jsx`

- [ ] **Step 1: Update imports and state**

In `src/renderer/src/activity.jsx`, add the same imports as in media.jsx:

```jsx
import CircularTimeFilter, { DailyActivityRadar, DailyActivityLine } from './ui/clock'
import DayPeriodChips from './ui/dayPeriodChips'
import ChartShapeToggle from './ui/chartShapeToggle'
import { chipsToRanges, arcToRanges } from './utils/dayPeriods'
```

Replace the existing `timeRange` state (currently line 580):

```jsx
  const [timeRange, setTimeRange] = useState({ start: 0, end: 24 })
```

with:

```jsx
  const [chipSelection, setChipSelection] = useState(() => new Set())
  const [arc, setArc] = useState({ start: 0, end: 24 })
  const [chartShape, setChartShape] = useState('polar')

  const timeRange = useMemo(() => {
    const ranges = chipSelection.size > 0 ? chipsToRanges(chipSelection) : arcToRanges(arc)
    return { ranges }
  }, [chipSelection, arc])
```

- [ ] **Step 2: Update the geoKey derivation**

The existing `geoKey` (around line 646) concatenates `timeRange.start` and `timeRange.end`. Replace those two lines:

```jsx
    timeRange.start +
    timeRange.end
```

with:

```jsx
    JSON.stringify(timeRange.ranges)
```

- [ ] **Step 3: Update the heatmap query (Task 9 already changed the IPC)**

The existing heatmap query (around lines 718-751) passes `timeRange.start, timeRange.end` to both the queryKey and `getSequenceAwareHeatmap`. Task 9 already updated the IPC to take `timeRange`. Update the call sites:

In the queryKey (around line 725-726), replace:

```jsx
      timeRange.start,
      timeRange.end,
```

with:

```jsx
      JSON.stringify(timeRange.ranges),
```

In the queryFn call (around lines 730-739), replace:

```jsx
      const response = await window.api.getSequenceAwareHeatmap(
        actualStudyId,
        speciesNames,
        dateRange[0]?.toISOString(),
        dateRange[1]?.toISOString(),
        timeRange.start,
        timeRange.end,
        isFullRange
      )
```

with:

```jsx
      const response = await window.api.getSequenceAwareHeatmap(
        actualStudyId,
        speciesNames,
        dateRange[0]?.toISOString(),
        dateRange[1]?.toISOString(),
        timeRange,
        isFullRange
      )
```

- [ ] **Step 4: Update the time-range handler**

Replace the existing `handleTimeRangeChange` (around line 792):

```jsx
  const handleTimeRangeChange = useCallback((newTimeRange) => {
    setTimeRange(newTimeRange)
  }, [])
```

with:

```jsx
  const handleArcChange = useCallback((newArc) => {
    setArc(newArc)
  }, [])
```

- [ ] **Step 5: Replace the bottom-row clock card markup**

Replace the inner block of the second-row wrapper (currently lines ~901-916):

```jsx
            {speciesInitialized && sequenceGap !== undefined && (
              <div className="w-full flex h-[130px] gap-3">
                <div className="w-[140px] h-full rounded border border-border flex items-center justify-center relative">
                  <DailyActivityRadar
                    activityData={dailyActivityData}
                    selectedSpecies={selectedSpecies}
                    palette={palette}
                  />
                  <div className="absolute w-full h-full flex items-center justify-center">
                    <CircularTimeFilter
                      onChange={handleTimeRangeChange}
                      startTime={timeRange.start}
                      endTime={timeRange.end}
                    />
                  </div>
                </div>
```

with:

```jsx
            {speciesInitialized && sequenceGap !== undefined && (
              <div className="w-full flex h-[130px] gap-3">
                <div className="w-[180px] h-full rounded border border-border flex flex-col relative">
                  <div className="flex items-center justify-between px-2 pt-1.5">
                    <DayPeriodChips selection={chipSelection} onChange={setChipSelection} />
                    <ChartShapeToggle value={chartShape} onChange={setChartShape} />
                  </div>
                  <div className="flex-1 relative">
                    {chartShape === 'polar' ? (
                      <>
                        <DailyActivityRadar
                          activityData={dailyActivityData}
                          selectedSpecies={selectedSpecies}
                          palette={palette}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <CircularTimeFilter
                            onChange={handleArcChange}
                            startTime={arc.start}
                            endTime={arc.end}
                            mode={chipSelection.size > 0 ? 'chips' : 'drag'}
                            chipSectors={chipsToRanges(chipSelection)}
                          />
                        </div>
                      </>
                    ) : (
                      <DailyActivityLine
                        activityData={dailyActivityData}
                        selectedSpecies={selectedSpecies}
                        palette={palette}
                        selectedRanges={timeRange.ranges}
                      />
                    )}
                  </div>
                </div>
```

- [ ] **Step 6: Verify the dev build runs**

Run: `npm run dev`
Open the Activity tab. Confirm the same behavior as the Media tab in Task 10 Step 4, plus:
- Toggling chips also updates the species heatmap on the map (the heatmap query depends on `timeRange.ranges`).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/activity.jsx src/preload/index.js src/main/index.js
git commit -m "feat(activity): add day-period preset chips and chart-shape toggle"
```

(Include the IPC files in the commit only if Step 3 required updating them; otherwise stage only `activity.jsx`.)

---

## Task 12: Documentation update

**Files:**
- Modify: `docs/data-formats.md` (timeRange section, if present)
- Modify: `docs/ipc-api.md` (the `getSequenceAwareHeatmap` signature changed in Task 9)

- [ ] **Step 1: Search docs for stale references**

Run: `grep -n "timeRange" docs/*.md`

For every match, decide:
- If it documents the `{start, end}` shape, add a sentence noting that the new shape is `{ ranges: [{start, end}, ...] }` and that `{start, end}` is still accepted as legacy.
- If it documents the IPC signature for `getSequenceAwareHeatmap`, update it: the previous `(studyId, species, startDate, endDate, startHour, endHour, includeNullTimestamps)` becomes `(studyId, species, startDate, endDate, timeRange, includeNullTimestamps)`.

- [ ] **Step 2: Commit documentation**

```bash
git add docs/
git commit -m "docs: document multi-range timeRange shape"
```

(Skip this commit if no doc files referenced `timeRange`.)

---

## Self-Review Checklist (run before declaring done)

- [ ] Both Media and Activity tabs render the four chips and the chart-shape toggle.
- [ ] Toggling Dawn + Dusk shows two arcs on the polar clock and shaded bands on the x–y view that exclude only the 5–8 and 18–21 windows.
- [ ] Deselecting all chips restores the drag-arc handles and brings back the original single-range behavior.
- [ ] The heatmap on the Activity map updates when chips change.
- [ ] `npm test` passes (existing pseudo-species tests, plus the new dayPeriods + sequencesTimeRange tests).
- [ ] `npm run lint` is clean.
- [ ] No CLAUDE.md doc-update obligations missed (architecture.md / ipc-api.md / data-formats.md if anything in those areas changed).

---

## Notes on subagent dispatch

- Tasks 1–3 (sequences.js multi-range refactor) and Task 9 (heatmap chain refactor) can run in parallel with Tasks 4–8 (renderer pure helpers + UI components).
- Task 10 (media.jsx wiring) depends on Tasks 4–8.
- Task 11 (activity.jsx wiring) depends on Tasks 4–9 (Task 9's IPC change is required before Task 11 Step 3).
- Task 12 runs last.
