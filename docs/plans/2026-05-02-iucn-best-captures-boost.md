# IUCN Status Boost in Best Captures — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift IUCN-threatened species (CR/EW/EX/EN/VU/NT) higher in the Overview "Best Captures" panel, both in the auto-scored picks and in favorites ordering when the user has more favorites than the panel can display.

**Architecture:** Single-file change in `src/main/database/queries/best-media.js`. A new `IUCN_BOOST` constant + two pure helpers (`groupSpeciesByIucnTier`, `buildIucnCase`) generate a SQL `CASE WHEN scientificName IN (...) THEN <boost> END` fragment scoped to species actually present in the study. The fragment is injected into the existing auto-scored CTE chain (added to the composite-score formula) and into the favorites `ORDER BY` (only when favorites count exceeds the panel limit, decided by a bounded probe). The IUCN dictionary stays in `src/shared/speciesInfo/data.json`; no schema migration.

**Tech Stack:** Node `node:test`, `better-sqlite3` (already a dep, ABI-bound to Electron via `npm run test:rebuild` / `test:rebuild-electron`), existing `resolveSpeciesInfo` pure resolver.

**Spec:** `docs/specs/2026-05-02-iucn-best-captures-boost-design.md`

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `src/main/database/queries/best-media.js` | Edit | Add `IUCN_BOOST` constant, `groupSpeciesByIucnTier(distinctSpecies, resolver)`, `buildIucnCase(byTier)`. Wire CASE injection into the auto-scored SQL and the favorites SQL. Accept an optional `iucnResolver` option on `getBestMedia` to allow injection in tests; default to the bundled `resolveSpeciesInfo`. |
| `test/main/database/queries/buildIucnCase.test.js` | New | Pure-function unit tests for the two helpers — shape, parameter count, empty input, tier ordering. No DB. |
| `test/main/database/queries/bestMedia.test.js` | Edit | Append three new `describe` blocks: auto-scored boost magnitude, favorites over-limit ordering, and a synthetic large-N scaling test. |

`getBestImagePerSpecies` is intentionally untouched — see *What does not change* in the spec.

---

### Task 1: Add `IUCN_BOOST` constant and the two pure helpers (TDD)

**Files:**
- Create: `test/main/database/queries/buildIucnCase.test.js`
- Modify: `src/main/database/queries/best-media.js` (add constant + helpers, export them)

- [ ] **Step 1: Write the failing helper tests**

Create `test/main/database/queries/buildIucnCase.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  IUCN_BOOST,
  groupSpeciesByIucnTier,
  buildIucnCase
} from '../../../../src/main/database/queries/best-media.js'

describe('IUCN_BOOST constant', () => {
  test('has the documented per-tier boost values', () => {
    assert.equal(IUCN_BOOST.CR, 0.25)
    assert.equal(IUCN_BOOST.EW, 0.25)
    assert.equal(IUCN_BOOST.EX, 0.25)
    assert.equal(IUCN_BOOST.EN, 0.18)
    assert.equal(IUCN_BOOST.VU, 0.10)
    assert.equal(IUCN_BOOST.NT, 0.03)
  })

  test('is frozen so callers cannot mutate it at runtime', () => {
    assert.equal(Object.isFrozen(IUCN_BOOST), true)
  })

  test('does not assign a boost to LC, DD, NE, or unknown tiers', () => {
    for (const tier of ['LC', 'DD', 'NE', 'XX', '']) {
      assert.equal(IUCN_BOOST[tier], undefined)
    }
  })
})

describe('groupSpeciesByIucnTier', () => {
  // Stub resolver so tests do not depend on the bundled dictionary.
  const stubMap = {
    'panthera tigris': { iucn: 'EN' },
    'panthera leo': { iucn: 'VU' },
    'diceros bicornis': { iucn: 'CR' },
    'vulpes vulpes': { iucn: 'LC' },
    'unknown species x': null
  }
  const stubResolver = (name) => stubMap[name?.toLowerCase()] ?? null

  test('groups species into the boost-eligible tiers', () => {
    const distinct = [
      { scientificName: 'Diceros bicornis' },
      { scientificName: 'Panthera tigris' },
      { scientificName: 'Panthera leo' },
      { scientificName: 'Vulpes vulpes' },
      { scientificName: 'Unknown species X' }
    ]
    const byTier = groupSpeciesByIucnTier(distinct, stubResolver)
    assert.deepEqual(byTier.CR, ['Diceros bicornis'])
    assert.deepEqual(byTier.EN, ['Panthera tigris'])
    assert.deepEqual(byTier.VU, ['Panthera leo'])
    assert.deepEqual(byTier.NT, [])
    assert.deepEqual(byTier.EW, [])
    assert.deepEqual(byTier.EX, [])
  })

  test('LC, DD, and unresolved species are dropped (not zero-bucketed)', () => {
    const distinct = [
      { scientificName: 'Vulpes vulpes' },
      { scientificName: 'Unknown species X' }
    ]
    const byTier = groupSpeciesByIucnTier(distinct, stubResolver)
    for (const tier of ['CR', 'EW', 'EX', 'EN', 'VU', 'NT']) {
      assert.deepEqual(byTier[tier], [])
    }
  })

  test('preserves the original (un-normalized) scientific name in the bucket', () => {
    // The SQL CASE matches against o.scientificName as stored in the DB,
    // so we must keep the source casing/whitespace and only normalize for lookup.
    const distinct = [{ scientificName: 'Panthera Tigris' }]
    const byTier = groupSpeciesByIucnTier(distinct, (n) =>
      n?.toLowerCase() === 'panthera tigris' ? { iucn: 'EN' } : null
    )
    assert.deepEqual(byTier.EN, ['Panthera Tigris'])
  })
})

describe('buildIucnCase', () => {
  test('emits one IN-branch per non-empty tier with the correct boost literal', () => {
    const byTier = {
      CR: ['Diceros bicornis'],
      EW: [],
      EX: [],
      EN: ['Panthera tigris', 'Loxodonta africana'],
      VU: ['Panthera leo'],
      NT: []
    }
    const { expr, params } = buildIucnCase(byTier)
    assert.equal((expr.match(/WHEN/g) || []).length, 3)
    assert.match(expr, /THEN 0\.25/)
    assert.match(expr, /THEN 0\.18/)
    assert.match(expr, /THEN 0\.1/) // 0.10 may print as 0.1
    assert.match(expr, /ELSE 0 END\s*$/)
    assert.equal(params.length, 4)
    assert.deepEqual(params, [
      'Diceros bicornis',
      'Panthera tigris',
      'Loxodonta africana',
      'Panthera leo'
    ])
  })

  test('returns the literal "0" expression and zero params when all tiers empty', () => {
    const byTier = { CR: [], EW: [], EX: [], EN: [], VU: [], NT: [] }
    const { expr, params } = buildIucnCase(byTier)
    assert.equal(expr, '0')
    assert.equal(params.length, 0)
  })

  test('CR/EW/EX share the 0.25 boost (each gets its own branch)', () => {
    const byTier = {
      CR: ['A a'], EW: ['B b'], EX: ['C c'],
      EN: [], VU: [], NT: []
    }
    const { expr, params } = buildIucnCase(byTier)
    // Three branches, all THEN 0.25
    assert.equal((expr.match(/THEN 0\.25/g) || []).length, 3)
    assert.deepEqual(params, ['A a', 'B b', 'C c'])
  })
})
```

- [ ] **Step 2: Run the failing tests**

Run: `npx node --test test/main/database/queries/buildIucnCase.test.js`

Expected: FAIL with `SyntaxError` or `TypeError: ... is not a function` for the missing exports.

- [ ] **Step 3: Implement the constant and helpers**

Open `src/main/database/queries/best-media.js`. Add at the top of the file, immediately after the existing `import` block (so above `assignSequenceIDs`):

```js
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/resolver.js'

/**
 * IUCN tier → additive boost applied on top of the composite score in
 * getBestMedia (auto-scored path) and used as the primary ORDER BY key
 * in the favorites path when the user is over-limit.
 *
 * Spec: docs/specs/2026-05-02-iucn-best-captures-boost-design.md
 *
 * Tunable knob — change values here, rebuild. LC/DD/NE intentionally
 * absent; the resolver only emits boosts for tiers in this map.
 */
export const IUCN_BOOST = Object.freeze({
  CR: 0.25,
  EW: 0.25,
  EX: 0.25,
  EN: 0.18,
  VU: 0.10,
  NT: 0.03
})

const IUCN_TIERS_ORDER = ['CR', 'EW', 'EX', 'EN', 'VU', 'NT']

/**
 * Group a list of distinct species names into IUCN boost-eligible tiers.
 * Names that resolve to LC/DD/NE or do not resolve at all are dropped
 * (they would contribute a zero-boost branch, which is the same as the
 * default ELSE 0).
 *
 * @param {Array<{scientificName: string}>} distinctSpecies - rows from a
 *   `SELECT DISTINCT scientificName FROM observations` probe.
 * @param {(name: string) => {iucn?: string} | null} resolver - usually
 *   the bundled `resolveSpeciesInfo`, but injectable for tests.
 * @returns {{CR: string[], EW: string[], EX: string[], EN: string[], VU: string[], NT: string[]}}
 *   Each tier holds the original (un-normalized) scientificName values,
 *   matching how they appear in the DB column.
 */
export function groupSpeciesByIucnTier(distinctSpecies, resolver) {
  const byTier = { CR: [], EW: [], EX: [], EN: [], VU: [], NT: [] }
  for (const row of distinctSpecies) {
    const name = row?.scientificName
    if (!name) continue
    const info = resolver(name)
    const tier = info?.iucn
    if (tier && byTier[tier]) byTier[tier].push(name)
  }
  return byTier
}

/**
 * Build a SQL `CASE` fragment that maps `o.scientificName` to its IUCN
 * boost. Returns `{expr: '0', params: []}` when no species qualify, so
 * callers can always splice the expr in without a special-case branch.
 *
 * Each branch uses `IN (?, ?, ...)` with positional placeholders so
 * scientific names are bound, not interpolated (SQL-injection safe).
 *
 * @param {ReturnType<typeof groupSpeciesByIucnTier>} byTier
 * @returns {{expr: string, params: string[]}}
 */
export function buildIucnCase(byTier) {
  const branches = []
  const params = []
  for (const tier of IUCN_TIERS_ORDER) {
    const names = byTier[tier]
    if (!names || names.length === 0) continue
    const placeholders = names.map(() => '?').join(', ')
    branches.push(`WHEN o.scientificName IN (${placeholders}) THEN ${IUCN_BOOST[tier]}`)
    params.push(...names)
  }
  if (branches.length === 0) return { expr: '0', params: [] }
  return { expr: `CASE ${branches.join(' ')} ELSE 0 END`, params }
}
```

- [ ] **Step 4: Run the helper tests, expect PASS**

Run: `npx node --test test/main/database/queries/buildIucnCase.test.js`

Expected: all 8 tests pass.

- [ ] **Step 5: Run the full test suite to make sure no regressions**

Run: `npm run test:rebuild && node --test 'test/**/*.test.js' 2>&1 | tail -25`

Expected: all existing tests still pass. (`npm run test:rebuild` rebuilds `better-sqlite3` for the system Node ABI; if you skip it you get `Module did not self-register`.)

- [ ] **Step 6: Restore the Electron ABI for `better-sqlite3` after testing**

Run: `npm run test:rebuild-electron`

This is a no-op for tests but lets `npm run dev` pick up better-sqlite3 again.

- [ ] **Step 7: Commit**

```bash
git add test/main/database/queries/buildIucnCase.test.js src/main/database/queries/best-media.js
git commit -m "feat(best-media): IUCN_BOOST constant + buildIucnCase / groupSpeciesByIucnTier helpers

Pure helpers that turn a per-study list of distinct species into a
SQL CASE fragment with bound parameters. Will be wired into the
auto-scored and favorites paths in follow-up commits."
```

---

### Task 2: Wire the IUCN boost into the auto-scored SQL path (TDD)

**Files:**
- Modify: `src/main/database/queries/best-media.js` (`getBestMedia` non-favorites path)
- Modify: `test/main/database/queries/bestMedia.test.js` (new `describe` block)

- [ ] **Step 1: Write the failing integration test**

Open `test/main/database/queries/bestMedia.test.js`. After the last existing `describe` block, append:

```js
describe('getBestMedia auto-scored IUCN boost', () => {
  // Real species names that resolve in the bundled IUCN dictionary.
  // Verify with: grep '"ailurus fulgens"' src/shared/speciesInfo/data.json
  const EN_NAME = 'Ailurus fulgens'      // Endangered (red panda) → +0.18
  const LC_NAME = 'Vulpes vulpes'        // Least Concern (red fox) → 0
  const NOT_IN_DICT = 'Made up species'  // No resolution → 0

  test('an EN species displaces a comparable LC species when their raw scores are close', async () => {
    // Two media at the same deployment, identical bbox geometry and detection
    // confidence so the only difference between them in the orig formula is
    // the rarity boost (which is the same when each species appears once).
    // The IUCN boost should tip the EN species above the LC one.
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-en', '2024-01-05T12:00:00Z'),
        'b.jpg': mediaEntry('m-lc', '2024-01-06T12:00:00Z')
      },
      observations: [
        {
          observationID: 'o-en', mediaID: 'm-en', deploymentID: 'd1',
          eventID: 'e-en', scientificName: EN_NAME, count: 1
        },
        {
          observationID: 'o-lc', mediaID: 'm-lc', deploymentID: 'd1',
          eventID: 'e-lc', scientificName: LC_NAME, count: 1
        }
      ]
    })
    setBbox(manager, 'o-en', { x: 0.3, y: 0.3, width: 0.3, height: 0.3, detectionConfidence: 0.9 })
    setBbox(manager, 'o-lc', { x: 0.3, y: 0.3, width: 0.3, height: 0.3, detectionConfidence: 0.9 })

    const result = await getBestMedia(testDbPath, { limit: 12 })

    const enRow = result.find((r) => r.scientificName === EN_NAME)
    const lcRow = result.find((r) => r.scientificName === LC_NAME)
    assert.ok(enRow, `expected EN row for ${EN_NAME}`)
    assert.ok(lcRow, `expected LC row for ${LC_NAME}`)
    assert.ok(
      enRow.compositeScore > lcRow.compositeScore,
      `expected EN boost to make ${EN_NAME} (${enRow.compositeScore}) outrank ${LC_NAME} (${lcRow.compositeScore})`
    )
    // Boost magnitude: EN gets +0.18 on top of an otherwise-equal score.
    // We allow a small tolerance because rarity score is per-species count.
    assert.ok(
      enRow.compositeScore - lcRow.compositeScore >= 0.17,
      `expected score gap ≥ 0.17, got ${enRow.compositeScore - lcRow.compositeScore}`
    )
  })

  test('a species not in the IUCN dictionary gets no boost', async () => {
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-x', '2024-01-05T12:00:00Z'),
        'b.jpg': mediaEntry('m-lc', '2024-01-06T12:00:00Z')
      },
      observations: [
        {
          observationID: 'o-x', mediaID: 'm-x', deploymentID: 'd1',
          eventID: 'e-x', scientificName: NOT_IN_DICT, count: 1
        },
        {
          observationID: 'o-lc', mediaID: 'm-lc', deploymentID: 'd1',
          eventID: 'e-lc', scientificName: LC_NAME, count: 1
        }
      ]
    })
    setBbox(manager, 'o-x', { x: 0.3, y: 0.3, width: 0.3, height: 0.3, detectionConfidence: 0.9 })
    setBbox(manager, 'o-lc', { x: 0.3, y: 0.3, width: 0.3, height: 0.3, detectionConfidence: 0.9 })

    const result = await getBestMedia(testDbPath, { limit: 12 })

    const xRow = result.find((r) => r.scientificName === NOT_IN_DICT)
    const lcRow = result.find((r) => r.scientificName === LC_NAME)
    assert.ok(xRow && lcRow)
    // Both have no IUCN boost, so the gap should be ≤ 0.01 (just rarity ties).
    assert.ok(
      Math.abs(xRow.compositeScore - lcRow.compositeScore) < 0.05,
      `expected no boost for unresolved species; gap was ${Math.abs(xRow.compositeScore - lcRow.compositeScore)}`
    )
  })

  test('zero IUCN-tagged species in the study → query still runs (CASE expr is "0")', async () => {
    const manager = await seed({
      media: { 'a.jpg': mediaEntry('m-x', '2024-01-05T12:00:00Z') },
      observations: [
        {
          observationID: 'o-x', mediaID: 'm-x', deploymentID: 'd1',
          eventID: 'e-x', scientificName: NOT_IN_DICT, count: 1
        }
      ]
    })
    setBbox(manager, 'o-x', { x: 0.3, y: 0.3, width: 0.3, height: 0.3, detectionConfidence: 0.9 })

    const result = await getBestMedia(testDbPath, { limit: 12 })

    assert.equal(result.length, 1)
    assert.equal(result[0].scientificName, NOT_IN_DICT)
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `npm run test:rebuild && node --test test/main/database/queries/bestMedia.test.js 2>&1 | tail -20`

Expected: the new tests fail because the IUCN boost is not yet wired in. The score gap will be near zero, not 0.18.

- [ ] **Step 3: Modify `getBestMedia` to inject the IUCN CASE into the auto-scored query**

In `src/main/database/queries/best-media.js`, change the signature of `getBestMedia` to accept an injected resolver:

```js
export async function getBestMedia(dbPath, options = {}) {
  const { limit = 12, iucnResolver = resolveSpeciesInfo } = options
  // ... rest unchanged until the auto-scored path
```

Then, **inside `getBestMedia` after the `hasUsableBbox` short-circuit and before the existing `const remainingSlots = ...` line**, run the distinct-species probe and build the IUCN case:

```js
    // Probe distinct species in the study so the CASE list is bounded by
    // species actually present, not the entire bundled IUCN dictionary.
    // Cheap thanks to idx_observations_scientificName.
    const distinctSpecies = await executeRawQuery(
      studyId,
      dbPath,
      `SELECT DISTINCT scientificName FROM observations
         WHERE scientificName IS NOT NULL AND scientificName != ''`,
      []
    )
    const byTier = groupSpeciesByIucnTier(distinctSpecies, iucnResolver)
    const iucnCase = buildIucnCase(byTier)
```

Then, **inside the big template literal `query`**, change the `scored_observations` SELECT list — find the `daytimeScore` block ending in `END as daytimeScore` and add a new column right after it:

```sql
          END as daytimeScore,
          -- IUCN boost (additive, on top of the composite score)
          -- See IUCN_BOOST in best-media.js / docs/specs/2026-05-02-iucn-best-captures-boost-design.md
          ${iucnCase.expr} as iucnBoost
```

Then, **inside `scored_with_formula`**, append `+ iucnBoost` at the very end of the composite-score formula (right before the closing `) as compositeScore`):

```sql
            -- Daytime boost (10%) - favor daylight captures
            + daytimeScore * 0.10
            -- IUCN boost (additive, can push score above 1.0 for threatened species)
            + iucnBoost
          ) as compositeScore
```

Finally, **prepend the IUCN params to `queryParams`**:

```js
    // IUCN params come first because the CASE expression is the first
    // parameterized clause in the SQL (inside the scored_observations CTE,
    // which is evaluated before the WHERE clause uses the favorite IDs).
    const queryParams = [...iucnCase.params, ...favoriteMediaIDs, candidatesPerSpecies]
    const scoredCandidates = await executeRawQuery(studyId, dbPath, query, queryParams)
```

(Replace the existing `const queryParams = [...favoriteMediaIDs, candidatesPerSpecies]` line.)

- [ ] **Step 4: Run the auto-scored tests, expect PASS**

Run: `node --test test/main/database/queries/bestMedia.test.js 2>&1 | tail -25`

Expected: all `getBestMedia auto-scored IUCN boost` tests pass, plus existing tests still pass.

- [ ] **Step 5: Run the unit helper tests too, expect PASS**

Run: `node --test test/main/database/queries/buildIucnCase.test.js`

Expected: all 8 helper tests still pass.

- [ ] **Step 6: Update the JSDoc on `getBestMedia` to reflect the new behavior**

In `src/main/database/queries/best-media.js`, update the comment block above `getBestMedia` (the one that lists the scoring formula). Add a new bullet to the weights list:

```js
 * Scoring formula for non-favorites (weights):
 * - 15%: Bbox area (sweet spot 10-60% of image)
 * - 20%: Fully visible (not cut off at edges)
 * - 15%: Padding (distance to nearest edge)
 * - 15%: Detection confidence
 * - 10%: Classification probability
 * - 15%: Rarity boost (rare species score higher, common species penalized)
 * - 10%: Daytime boost (favor daylight captures)
 * - additive: IUCN status boost (CR/EW/EX +0.25, EN +0.18, VU +0.10, NT +0.03;
 *             others 0). Pushes max score from 1.0 to 1.25 for threatened species.
```

- [ ] **Step 7: Commit**

```bash
git add src/main/database/queries/best-media.js test/main/database/queries/bestMedia.test.js
git commit -m "feat(best-media): apply IUCN boost in auto-scored Best Captures

Threatened species (CR/EW/EX/EN/VU/NT) get an additive boost on top of
the existing composite score, scoped to species actually present in
the study. Validated empirically on 21 study DBs — no measurable SQL
overhead, +5 threatened captures across the dataset."
```

---

### Task 3: Favorites over-limit detection + IUCN-aware ordering (TDD)

**Files:**
- Modify: `src/main/database/queries/best-media.js` (`getBestMedia` favorites path)
- Modify: `test/main/database/queries/bestMedia.test.js` (new `describe` block)

- [ ] **Step 1: Write the failing favorites tests**

Open `test/main/database/queries/bestMedia.test.js`. Append after the previous `describe`:

```js
describe('getBestMedia favorites over-limit ordering', () => {
  const EN_NAME = 'Ailurus fulgens'  // Endangered
  const VU_NAME = 'Acinonyx jubatus' // Vulnerable
  const LC_NAME = 'Vulpes vulpes'    // Least Concern

  test('when favorites count ≤ limit, ordering is timestamp DESC (unchanged)', async () => {
    // 3 favorites, limit=12 → under limit. The IUCN-aware reorder must NOT trigger.
    // The user's curated set is preserved in chronological order.
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-old-en', '2024-01-01T10:00:00Z'),
        'b.jpg': mediaEntry('m-mid-lc', '2024-01-02T10:00:00Z'),
        'c.jpg': mediaEntry('m-new-vu', '2024-01-03T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-en', mediaID: 'm-old-en', deploymentID: 'd1',
          eventID: 'e-en', scientificName: EN_NAME, count: 1
        },
        {
          observationID: 'o-lc', mediaID: 'm-mid-lc', deploymentID: 'd1',
          eventID: 'e-lc', scientificName: LC_NAME, count: 1
        },
        {
          observationID: 'o-vu', mediaID: 'm-new-vu', deploymentID: 'd1',
          eventID: 'e-vu', scientificName: VU_NAME, count: 1
        }
      ]
    })
    markFavorites(manager, ['m-old-en', 'm-mid-lc', 'm-new-vu'])

    const result = await getBestMedia(testDbPath, { limit: 12 })

    // All three favorites returned, in timestamp DESC order — NOT tier order.
    assert.deepEqual(
      result.map((r) => r.mediaID),
      ['m-new-vu', 'm-mid-lc', 'm-old-en']
    )
  })

  test('when favorites count > limit, ordering is IUCN tier DESC then timestamp DESC', async () => {
    // 5 favorites, limit=3 → over limit. EN (oldest) must beat LC (newest)
    // because tier-first beats recency.
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-en-old',  '2024-01-01T10:00:00Z'),
        'b.jpg': mediaEntry('m-en-new',  '2024-01-02T10:00:00Z'),
        'c.jpg': mediaEntry('m-vu',      '2024-01-03T10:00:00Z'),
        'd.jpg': mediaEntry('m-lc-old',  '2024-01-04T10:00:00Z'),
        'e.jpg': mediaEntry('m-lc-new',  '2024-01-05T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-1', mediaID: 'm-en-old', deploymentID: 'd1',
          eventID: 'e-1', scientificName: EN_NAME, count: 1
        },
        {
          observationID: 'o-2', mediaID: 'm-en-new', deploymentID: 'd1',
          eventID: 'e-2', scientificName: EN_NAME, count: 1
        },
        {
          observationID: 'o-3', mediaID: 'm-vu', deploymentID: 'd1',
          eventID: 'e-3', scientificName: VU_NAME, count: 1
        },
        {
          observationID: 'o-4', mediaID: 'm-lc-old', deploymentID: 'd1',
          eventID: 'e-4', scientificName: LC_NAME, count: 1
        },
        {
          observationID: 'o-5', mediaID: 'm-lc-new', deploymentID: 'd1',
          eventID: 'e-5', scientificName: LC_NAME, count: 1
        }
      ]
    })
    markFavorites(manager, ['m-en-old', 'm-en-new', 'm-vu', 'm-lc-old', 'm-lc-new'])

    const result = await getBestMedia(testDbPath, { limit: 3 })

    // Top 3 by tier-first: both EN (newest first within tier), then VU.
    // The two LC favorites get pushed off, even though one is the newest overall.
    assert.deepEqual(
      result.map((r) => r.mediaID),
      ['m-en-new', 'm-en-old', 'm-vu']
    )
  })

  test('with exactly limit favorites, no reorder happens (timestamp DESC preserved)', async () => {
    // Boundary: count === limit. Neither over-limit reorder nor auto-scored fill.
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-lc',  '2024-01-01T10:00:00Z'),
        'b.jpg': mediaEntry('m-en',  '2024-01-02T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-lc', mediaID: 'm-lc', deploymentID: 'd1',
          eventID: 'e-lc', scientificName: LC_NAME, count: 1
        },
        {
          observationID: 'o-en', mediaID: 'm-en', deploymentID: 'd1',
          eventID: 'e-en', scientificName: EN_NAME, count: 1
        }
      ]
    })
    markFavorites(manager, ['m-lc', 'm-en'])

    const result = await getBestMedia(testDbPath, { limit: 2 })

    // Count == limit → original timestamp-DESC path. EN (newest) first, LC second.
    // (The test would still pass under tier-first, but the assertion below is
    // strict about order: tier-first WOULD pass, timestamp-first ALSO passes
    // here. To distinguish, set up a case where tier order differs from
    // timestamp order — done in the previous test.)
    assert.deepEqual(
      result.map((r) => r.mediaID),
      ['m-en', 'm-lc']
    )
  })
})
```

- [ ] **Step 2: Run the failing tests**

Run: `node --test test/main/database/queries/bestMedia.test.js 2>&1 | tail -25`

Expected: the over-limit test fails. Without IUCN ordering, the result is `['m-lc-new', 'm-lc-old', 'm-vu']` (timestamp DESC), not `['m-en-new', 'm-en-old', 'm-vu']`.

- [ ] **Step 3: Add the over-limit probe and conditional IUCN ordering to `getBestMedia`**

In `src/main/database/queries/best-media.js`, **move the distinct-species probe + `byTier` + `iucnCase` setup earlier** — right after the `getStudyIdFromPath(dbPath)` line, so the IUCN expr is available to both the favorites path and the auto-scored path. (You added these in Task 2 right after the bbox short-circuit; relocate them.)

Then, **before the `favoritesQuery` template literal**, add the bounded probe:

```js
    // Bounded probe: stop scanning as soon as we have limit + 1 favorite rows.
    // No COUNT(*) — that would full-scan the media table (no index on favorite).
    const favoriteProbe = await executeRawQuery(
      studyId,
      dbPath,
      `SELECT 1 FROM media WHERE favorite = 1 LIMIT ?`,
      [limit + 1]
    )
    const favoritesOverLimit = favoriteProbe.length > limit
```

Then **change the favorites `ORDER BY` clause** to be tier-first when over-limit, timestamp-only otherwise. Replace the existing `ORDER BY f.timestamp DESC` line in the favoritesQuery with:

```js
        ORDER BY ${favoritesOverLimit ? `(${iucnCase.expr.replace(/o\.scientificName/g, 'COALESCE(o1.scientificName, o2.scientificName)')}) DESC, ` : ''}f.timestamp DESC
```

The `.replace(...)` rewrites `o.scientificName` (which the helper emitted for the auto-scored CTE where the alias is `o`) to the favorites query's projection (`COALESCE(o1.scientificName, o2.scientificName)`). This keeps the helper itself dumb — it only knows one alias — while letting the favorites caller adapt.

Then **prepend the IUCN params to the favorites query params** when over-limit:

```js
    const favoritesParams = favoritesOverLimit
      ? [...iucnCase.params, limit]
      : [limit]
    const favorites = await executeRawQuery(studyId, dbPath, favoritesQuery, favoritesParams)
```

(Replace the existing `const favorites = await executeRawQuery(studyId, dbPath, favoritesQuery, [limit])`.)

- [ ] **Step 4: Run favorites tests, expect PASS**

Run: `node --test test/main/database/queries/bestMedia.test.js 2>&1 | tail -25`

Expected: all `favorites over-limit ordering` tests pass, plus the existing favorites CTE tests still pass (they all use ≤ limit favorites, so the over-limit branch is not exercised).

- [ ] **Step 5: Run the full test suite**

Run: `npm run test:rebuild && node --test 'test/**/*.test.js' 2>&1 | tail -25 && npm run test:rebuild-electron`

Expected: every existing test still passes.

- [ ] **Step 6: Commit**

```bash
git add src/main/database/queries/best-media.js test/main/database/queries/bestMedia.test.js
git commit -m "feat(best-media): IUCN-aware favorites ordering when over-limit

Bounded probe checks if the user has more favorites than the panel
can show. If so, favorites are ordered by IUCN tier first then
timestamp DESC. If not, behavior is unchanged (timestamp DESC)."
```

---

### Task 4: Synthetic large-N scaling test

**Files:**
- Modify: `test/main/database/queries/bestMedia.test.js` (one new `describe` block)

- [ ] **Step 1: Write the scaling test**

Append to `test/main/database/queries/bestMedia.test.js`:

```js
describe('getBestMedia IUCN scaling', () => {
  test('handles 1000 distinct species, all marked threatened, without "too many SQL variables"', async () => {
    // The realistic worst case is ~20 IUCN-tagged species per study (measured
    // on 56 local DBs); 1000 is two orders of magnitude beyond that. SQLite's
    // hard cap is 32766, so 1000 should comfortably succeed.
    const numSpecies = 1000

    // Stub resolver: every species we hand it is EN. No dependency on the
    // bundled dictionary — keeps this test deterministic.
    const stubResolver = () => ({ iucn: 'EN' })

    const media = {}
    const observations = []
    for (let i = 0; i < numSpecies; i++) {
      const mid = `m-${i}`
      media[`${i}.jpg`] = mediaEntry(mid, `2024-01-01T${String(i % 24).padStart(2, '0')}:00:00Z`)
      observations.push({
        observationID: `o-${i}`, mediaID: mid, deploymentID: 'd1',
        eventID: `e-${i}`, scientificName: `Genus speciesnumber${i}`, count: 1
      })
    }
    const manager = await seed({ media, observations })
    for (let i = 0; i < numSpecies; i++) {
      setBbox(manager, `o-${i}`, { x: 0.3, y: 0.3, width: 0.3, height: 0.3, detectionConfidence: 0.9 })
    }

    const t0 = Date.now()
    const result = await getBestMedia(testDbPath, { limit: 12, iucnResolver: stubResolver })
    const elapsed = Date.now() - t0

    // We injected the stub resolver, so every species is "EN" and gets +0.18.
    assert.equal(result.length, 12)
    // Sanity bound: the test infrastructure (seeding 1000 obs) dominates,
    // but the actual query should be well under 5 seconds even on slow CI.
    assert.ok(elapsed < 10000, `getBestMedia took ${elapsed}ms with 1000 species`)
  })
})
```

- [ ] **Step 2: Run the scaling test**

Run: `node --test test/main/database/queries/bestMedia.test.js 2>&1 | tail -15`

Expected: PASS. The seeding loop is the slow part; the SQL itself is sub-second.

- [ ] **Step 3: Commit**

```bash
git add test/main/database/queries/bestMedia.test.js
git commit -m "test(best-media): synthetic 1000-species IUCN scaling guard"
```

---

### Task 5: Manual smoke test in dev

**Files:** none (no code changes)

- [ ] **Step 1: Pick a study DB known to contain at least one threatened species**

From the validation work, `0889d172-40a3-484f-aba3-5741a859a554` has Endangered species (African elephant, African wild dog) — pick that or any other study you have where you know the IUCN tiers.

- [ ] **Step 2: Restore the Electron ABI and start dev**

Run from project root:

```bash
npm run test:rebuild-electron
npm run dev
```

- [ ] **Step 3: Check the Best Captures panel**

In the running app, open the study from Step 1 and look at the Overview tab's Best Captures section.

Expected:
- Threatened species (visible in the species hover card's IUCN tier indicator) should show up among the 12 best captures.
- Comparing against `git stash`'d main: at least one threatened-species capture should now appear that did not before.

- [ ] **Step 4: Test favorites over-limit (optional)**

If you have a study where you've favorited more than 12 captures, open it and confirm the threatened ones bubble to the top of the favorites block.

- [ ] **Step 5: Check the logs**

In `~/.config/biowatch/logs/` (or the platform-equivalent), look for the `Querying best media (hybrid mode)` line. The retrieval time should be similar to or slightly higher than before (typically <300ms even on the largest DBs).

- [ ] **Step 6: No commit for the smoke test**

If the manual smoke test reveals an issue, fix it in a follow-up commit referencing the spec. Otherwise, this task closes the implementation.

---

## Self-Review Notes

**Spec coverage:**
- Goal lines 1-2 of spec → Tasks 2 (auto-scored), 3 (favorites)
- Tier weights table → Task 1 step 3 (constant), Task 1 step 1 (test)
- Constant location → Task 1 step 3
- Inline CASE injection (steps 1-4 of Implementation) → Task 2 step 3
- Performance budget → Task 4 (scaling test enforces a sanity bound)
- Scaling considerations → Task 4
- Favorites over-limit ordering → Task 3
- "Why not boost + recency" → covered by Task 3's tier-first SQL; no separate test needed
- What does not change (`selectDiverseMedia`, `getBestImagePerSpecies`, filtering) → Tasks 2/3 only modify `getBestMedia`; existing tests in `selectDiverseMedia.test.js` and `getBestImagePerSpecies` describe block stay green
- Tests section of spec — boost magnitude, helper shape (non-empty + empty), large-N, property cap, regression, favorites over-limit — all covered across Tasks 1-4

**No placeholders:** every step has concrete code or a concrete command.

**Type consistency:** `IUCN_BOOST`, `groupSpeciesByIucnTier`, `buildIucnCase`, `iucnResolver` — all referenced consistently across tasks 1-4. The favorites query alias rewrite (`o.scientificName` → `COALESCE(o1.scientificName, o2.scientificName)`) is the one trick — Task 3 step 3 spells out the exact substitution.
