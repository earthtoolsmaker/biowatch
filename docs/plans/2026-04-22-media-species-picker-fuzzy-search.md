# Media-tab species picker: dictionary-backed fuzzy search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the species picker inside `ObservationEditor` (Media tab) from a plain substring filter over study-present species to a ranked, typo-tolerant fuzzy search that merges study-present species with the bundled scientific-name dictionary, with arrow-key navigation and a one-line `common name (scientific name)` row layout.

**Architecture:** Pure renderer-side feature. New helper module `src/renderer/src/utils/dictionarySearch.js` owns a module-level Fuse index over the filtered dictionary and exposes a `searchSpecies(query, studySpeciesList)` function. `ObservationEditor` in `src/renderer/src/media.jsx` is refactored to consume it, adds 150 ms debounce, `highlightedIndex` state for keyboard navigation, and the new row layout. No main-process, IPC, or DB changes.

**Tech Stack:** React 19, Node's built-in test runner (`node --test` with `node:assert/strict`), `fuse.js` (new dependency).

**Spec:** `docs/specs/2026-04-22-media-species-picker-fuzzy-search-design.md`

---

## File Structure

**New files:**
- `src/renderer/src/utils/dictionarySearch.js` — dictionary filter, module-level Fuse index, `searchSpecies(query, studySpeciesList)` function. Single responsibility: turn a query + study list into a ranked result list.
- `test/renderer/utils/dictionarySearch.test.js` — unit tests for the helper. Follows the existing pattern in `test/renderer/utils/commonNames.test.js` (Node test runner, `node:assert/strict`, importing directly from `src/renderer/src/utils/`).

**Modified files:**
- `package.json` — add `fuse.js` to `dependencies`.
- `src/renderer/src/media.jsx` — update `ObservationEditor` (lines 526–796) to consume `searchSpecies`, add debounce state + effect, add `highlightedIndex` state + keyboard nav, replace row layout, update empty-state messaging.

**Unchanged:**
- Main-process code, IPC layer, preload, DB schema, `getDistinctSpecies` query, `observations:update-classification` handler, custom-species form, mark-as-blank button, attributes tab, outer modal layout.

---

## Task 1: Add fuse.js dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install fuse.js**

Run:
```bash
npm install fuse.js@^7.0.0
```

Expected: `package.json` gains `"fuse.js": "^7.0.0"` (or similar current version) under `dependencies`, `package-lock.json` updated. No build or test run yet.

- [ ] **Step 2: Verify the dependency imports cleanly**

Run:
```bash
node -e "const Fuse = require('fuse.js'); console.log(typeof Fuse)"
```

Expected output: `function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add fuse.js for species picker fuzzy search"
```

---

## Task 2: Create dictionarySearch helper with dictionary filter — TDD

**Files:**
- Create: `src/renderer/src/utils/dictionarySearch.js`
- Create: `test/renderer/utils/dictionarySearch.test.js`

This task covers spec tests 1–3 (dictionary filter + below-threshold behavior). Later tasks add the Fuse-powered cases.

- [ ] **Step 1: Write the failing tests**

Create `test/renderer/utils/dictionarySearch.test.js` with:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  searchSpecies,
  _dictionaryEntries
} from '../../../src/renderer/src/utils/dictionarySearch.js'

describe('dictionary filter', () => {
  test('drops entries where commonName equals scientificName', () => {
    const sciNames = new Set(_dictionaryEntries.map((e) => e.scientificName))
    // Higher-taxa / identical-key entries must be filtered out.
    assert.equal(sciNames.has('accipitridae family'), false)
    assert.equal(sciNames.has('aburria species'), false)
    assert.equal(sciNames.has('badger'), false)
  })

  test('keeps proper species where commonName differs from scientificName', () => {
    const byName = new Map(_dictionaryEntries.map((e) => [e.scientificName, e.commonName]))
    assert.equal(byName.get('aburria aburri'), 'wattled guan')
    assert.equal(byName.get('acinonyx jubatus'), 'cheetah')
  })

  test('every kept entry has a distinct commonName', () => {
    for (const entry of _dictionaryEntries) {
      assert.notEqual(entry.commonName, entry.scientificName)
    }
  })
})

describe('searchSpecies — below threshold', () => {
  const studyList = [
    { scientificName: 'panthera leo', commonName: 'lion', observationCount: 3 },
    { scientificName: 'canis lupus', commonName: 'wolf', observationCount: 1 }
  ]

  test('empty query returns study list unchanged', () => {
    const result = searchSpecies('', studyList)
    assert.deepEqual(result, studyList)
  })

  test('query shorter than 3 chars returns study list unchanged (no dictionary)', () => {
    const result = searchSpecies('ab', studyList)
    assert.deepEqual(result, studyList)
  })

  test('null/undefined query returns study list unchanged', () => {
    assert.deepEqual(searchSpecies(null, studyList), studyList)
    assert.deepEqual(searchSpecies(undefined, studyList), studyList)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test test/renderer/utils/dictionarySearch.test.js
```

Expected: FAIL with `Cannot find module '.../src/renderer/src/utils/dictionarySearch.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/utils/dictionarySearch.js`:

```js
import Fuse from 'fuse.js'
import dictionary from '../../../shared/commonNames/dictionary.json'

// Filter out entries where commonName === scientificName.
// These are higher taxa ("accipitridae family", "aburria species")
// and generic one-word names ("badger", "bat") that we don't want
// to surface in a species picker. Users can still enter these via
// the "Add custom species" form.
const dictionaryEntries = Object.entries(dictionary)
  .filter(([sci, common]) => sci !== common)
  .map(([scientificName, commonName]) => ({ scientificName, commonName }))

const fuseOptions = {
  keys: ['scientificName', 'commonName'],
  includeScore: true,
  threshold: 0.4,
  ignoreLocation: true
}

const dictionaryFuse = new Fuse(dictionaryEntries, fuseOptions)

export function searchSpecies(query, studySpeciesList) {
  if (!query || query.length < 3) {
    return studySpeciesList
  }

  const studyFuse = new Fuse(studySpeciesList, fuseOptions)
  const studyHits = studyFuse.search(query)
  const dictHits = dictionaryFuse.search(query)

  const merged = new Map()
  for (const { item, score } of studyHits) {
    merged.set(item.scientificName, { ...item, score: score * 0.7, inStudy: true })
  }
  for (const { item, score } of dictHits) {
    if (!merged.has(item.scientificName)) {
      merged.set(item.scientificName, { ...item, score, inStudy: false })
    }
  }

  return [...merged.values()]
    .sort((a, b) => a.score - b.score)
    .slice(0, 50)
}

// Exported for tests only.
export const _dictionaryEntries = dictionaryEntries
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test test/renderer/utils/dictionarySearch.test.js
```

Expected: all tests PASS (6 tests under 2 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/dictionarySearch.js test/renderer/utils/dictionarySearch.test.js
git commit -m "feat(species): add dictionarySearch helper with dictionary filter"
```

---

## Task 3: Add fuzzy + ranking tests — TDD for the Fuse-powered cases

**Files:**
- Modify: `test/renderer/utils/dictionarySearch.test.js`

This task covers spec tests 4–7 (fuzzy tolerance, dedupe, cap, study-boost). Implementation is already in place from Task 2; the tests verify observable behavior.

- [ ] **Step 1: Add the new test cases**

Append to `test/renderer/utils/dictionarySearch.test.js`:

```js
describe('searchSpecies — fuzzy + ranking', () => {
  test('matches on common name with a small typo', () => {
    const results = searchSpecies('wattle', [])
    const sciNames = results.map((r) => r.scientificName)
    assert.ok(
      sciNames.includes('aburria aburri'),
      `expected 'aburria aburri' (wattled guan) in results, got: ${sciNames.slice(0, 10).join(', ')}`
    )
  })

  test('matches on scientific name', () => {
    const results = searchSpecies('acinonyx', [])
    const sciNames = results.map((r) => r.scientificName)
    assert.ok(
      sciNames.includes('acinonyx jubatus'),
      `expected 'acinonyx jubatus' (cheetah) in results, got: ${sciNames.slice(0, 10).join(', ')}`
    )
  })

  test('dictionary-only result has inStudy: false', () => {
    const results = searchSpecies('cheetah', [])
    const cheetah = results.find((r) => r.scientificName === 'acinonyx jubatus')
    assert.ok(cheetah, 'expected cheetah in results')
    assert.equal(cheetah.inStudy, false)
  })

  test('deduplicates when species exists in both study and dictionary', () => {
    const studyList = [
      { scientificName: 'acinonyx jubatus', commonName: 'cheetah', observationCount: 5 }
    ]
    const results = searchSpecies('cheetah', studyList)
    const cheetahMatches = results.filter((r) => r.scientificName === 'acinonyx jubatus')
    assert.equal(cheetahMatches.length, 1, 'expected exactly one cheetah row')
    assert.equal(cheetahMatches[0].inStudy, true)
    assert.equal(cheetahMatches[0].observationCount, 5)
  })

  test('caps results at 50', () => {
    // "species" would match many higher-taxa entries, but those are
    // filtered out. Use a broad common-name substring that matches many rows.
    const results = searchSpecies('bird', [])
    assert.ok(results.length <= 50, `expected <= 50 results, got ${results.length}`)
  })

  test('study match ranks above dictionary-only match when both are in results', () => {
    // Pick a study species that also exists in the dictionary so both
    // queries will hit. Query on a term that matches multiple dictionary
    // species too, to exercise ranking.
    const studyList = [
      { scientificName: 'acinonyx jubatus', commonName: 'cheetah', observationCount: 5 }
    ]
    const results = searchSpecies('cheetah', studyList)
    // Study cheetah should appear first (boost applied).
    assert.equal(results[0].scientificName, 'acinonyx jubatus')
    assert.equal(results[0].inStudy, true)
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
node --test test/renderer/utils/dictionarySearch.test.js
```

Expected: all tests PASS (12 total across the 3 describe blocks). If `'wattle'` does not match `'wattled guan'`, increase `threshold` in `dictionarySearch.js` to `0.5` and re-run; this is the one spec-level parameter that may need a small tune-up depending on the installed Fuse version.

- [ ] **Step 3: Commit**

```bash
git add test/renderer/utils/dictionarySearch.test.js
git commit -m "test(species): cover fuzzy match, dedupe, cap, and study boost"
```

---

## Task 4: Replace filter logic in ObservationEditor and debounce the search input

**Files:**
- Modify: `src/renderer/src/media.jsx` (lines 526–796 — `ObservationEditor`)

- [ ] **Step 1: Add the import at the top of `media.jsx`**

Find the existing imports block near the top of `src/renderer/src/media.jsx`. Add:

```js
import { searchSpecies } from './utils/dictionarySearch'
```

(Place it near other `./utils/...` imports to match the existing pattern.)

- [ ] **Step 2: Add `debouncedSearch` state and effect; replace `filteredSpecies` with `results`**

In `ObservationEditor` (media.jsx:527–580), replace:

```js
const [searchTerm, setSearchTerm] = useState('')
```

with:

```js
const [searchTerm, setSearchTerm] = useState('')
const [debouncedSearch, setDebouncedSearch] = useState('')
```

Still inside `ObservationEditor`, add this effect immediately after the existing focus/keydown effects (around line 570, after the `useEffect` that registers the Escape handler):

```js
// Debounce the search term by 150 ms so we don't re-run fuse on every keystroke.
useEffect(() => {
  const handle = setTimeout(() => setDebouncedSearch(searchTerm), 150)
  return () => clearTimeout(handle)
}, [searchTerm])
```

Then replace the existing `filteredSpecies` useMemo at lines 573–580:

```js
const filteredSpecies = useMemo(() => {
  if (!searchTerm) return speciesList
  const term = searchTerm.toLowerCase()
  return speciesList.filter(
    (s) =>
      s.scientificName?.toLowerCase().includes(term) || s.commonName?.toLowerCase().includes(term)
  )
}, [speciesList, searchTerm])
```

with:

```js
const results = useMemo(
  () => searchSpecies(debouncedSearch, speciesList),
  [debouncedSearch, speciesList]
)
```

- [ ] **Step 3: Update the render path to use `results` instead of `filteredSpecies`**

In the same file, find the render block for the species list (around line 750, inside the `activeTab === 'species'` branch):

Change:
```jsx
{filteredSpecies.map((species) => (
```
to:
```jsx
{results.map((species) => (
```

And change the empty-state condition at line 768:
```jsx
{filteredSpecies.length === 0 && searchTerm && (
  <div className="px-3 py-4 text-sm text-gray-500 text-center">
    No species found. Click &quot;Add custom species&quot; to add a new one.
  </div>
)}
```
to:
```jsx
{results.length === 0 && searchTerm.length > 0 && searchTerm.length < 3 && (
  <div className="px-3 py-4 text-sm text-gray-500 text-center">
    Type at least 3 characters to search the species dictionary.
  </div>
)}
{results.length === 0 && searchTerm.length >= 3 && (
  <div className="px-3 py-4 text-sm text-gray-500 text-center">
    No species found. Click &quot;Add custom species&quot; to add a new one.
  </div>
)}
```

- [ ] **Step 4: Lint**

Run:
```bash
npm run lint
```

Expected: PASS (no new errors in `media.jsx`).

- [ ] **Step 5: Manual smoke test in dev**

Run:
```bash
npm run dev
```

- Open a study in the Media tab, click an observation to open the picker.
- Type a common name like `cheetah`. After ~150 ms, dictionary matches should appear mixed with any study species.
- Type a short query (`ab`) — no dictionary results, only study species that match substring.
- Close the dev server with Ctrl-C.

Expected: mouse-click selection still works, debounce feels ~instantaneous but not jittery.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "feat(media): use dictionarySearch + debounce in species picker"
```

---

## Task 5: One-line row layout with in-study badge

**Files:**
- Modify: `src/renderer/src/media.jsx` (species-list render block)

- [ ] **Step 1: Replace the row JSX**

In `ObservationEditor`, find the species-list row rendering (around line 750, after the changes from Task 4):

```jsx
{results.map((species) => (
  <button
    key={species.scientificName}
    onClick={() => handleSelectSpecies(species.scientificName, species.commonName)}
    className={`w-full px-3 py-2 text-left hover:bg-lime-50 flex items-center justify-between ${
      species.scientificName === bbox.scientificName ? 'bg-lime-100' : ''
    }`}
  >
    <div>
      <span className="text-sm font-medium">{species.scientificName}</span>
      {species.commonName && (
        <span className="text-xs text-gray-500 ml-2">({species.commonName})</span>
      )}
    </div>
    <span className="text-xs text-gray-400">{species.observationCount}</span>
  </button>
))}
```

Replace with:

```jsx
{results.map((species) => (
  <button
    key={species.scientificName}
    onClick={() => handleSelectSpecies(species.scientificName, species.commonName)}
    className={`w-full px-3 py-2 text-left hover:bg-lime-50 flex items-center justify-between ${
      species.scientificName === bbox.scientificName ? 'bg-lime-100' : ''
    }`}
  >
    <div className="min-w-0 truncate">
      <span className="text-sm font-medium">
        {species.commonName || species.scientificName}
      </span>
      {species.commonName && (
        <span className="text-xs text-gray-500 ml-2 italic">
          ({species.scientificName})
        </span>
      )}
    </div>
    {species.inStudy !== false && typeof species.observationCount === 'number' && (
      <span className="flex items-center gap-1 text-xs text-gray-400 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-lime-500" aria-hidden="true" />
        {species.observationCount}
      </span>
    )}
  </button>
))}
```

Rationale for the `inStudy !== false` guard: below-threshold queries return the raw `speciesList` which has `observationCount` but no `inStudy` field. We still want the badge for those rows (they *are* in the study), so check for `inStudy !== false` rather than `inStudy === true`.

- [ ] **Step 2: Lint**

Run:
```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Manual visual check**

Run:
```bash
npm run dev
```

- Open the picker, verify:
  - In-study rows (no query / short query): common name first, scientific italic in parens, lime dot + count on the right.
  - Dictionary-only rows (query ≥ 3 chars, species not yet in study): common name first, scientific italic in parens, no right-side badge.
  - Rows that exist in both: appear once with the badge.
  - Long names truncate instead of overflowing.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "feat(media): one-line common-first row with in-study badge"
```

---

## Task 6: Keyboard navigation — ArrowUp/Down/Enter, highlightedIndex, scroll-into-view

**Files:**
- Modify: `src/renderer/src/media.jsx` (`ObservationEditor`)

- [ ] **Step 1: Add `highlightedIndex` state and reset effect**

Inside `ObservationEditor`, near the other `useState` calls (around line 529), add:

```js
const [highlightedIndex, setHighlightedIndex] = useState(-1)
```

After the `results` useMemo (from Task 4), add an effect that resets the index whenever `results` changes:

```js
useEffect(() => {
  setHighlightedIndex(results.length > 0 ? 0 : -1)
}, [results])
```

- [ ] **Step 2: Add a ref array and scroll-into-view behavior**

Near the other `useRef` declarations at the top of `ObservationEditor` (around line 531):

```js
const rowRefs = useRef([])
```

Reset the ref array on each render where `results` changes — the simplest approach is to rebuild it inline in the render. That's done in Step 4 below.

Add an effect that scrolls the highlighted row into view when `highlightedIndex` changes:

```js
useEffect(() => {
  if (highlightedIndex < 0) return
  const node = rowRefs.current[highlightedIndex]
  if (node) {
    node.scrollIntoView({ block: 'nearest' })
  }
}, [highlightedIndex])
```

- [ ] **Step 3: Extend the search-input keydown handler with arrow-key and Enter logic**

Find the existing `onKeyDown` handler on the search input at media.jsx:710–717:

```jsx
onKeyDown={(e) => {
  // Stop Backspace/Delete from reaching the ImageModal
  // window shortcut that deletes the selected observation.
  // Let other keys (Escape, arrows) bubble as before.
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.stopPropagation()
  }
}}
```

Replace with:

```jsx
onKeyDown={(e) => {
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.stopPropagation()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (results.length === 0) return
    setHighlightedIndex((i) => (i + 1) % results.length)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (results.length === 0) return
    setHighlightedIndex((i) => (i <= 0 ? results.length - 1 : i - 1))
    return
  }
  if (e.key === 'Enter') {
    if (highlightedIndex < 0 || highlightedIndex >= results.length) return
    e.preventDefault()
    const picked = results[highlightedIndex]
    handleSelectSpecies(picked.scientificName, picked.commonName)
  }
}}
```

- [ ] **Step 4: Attach refs and a visual highlight class to rows**

Update the row JSX from Task 5 to attach refs and apply a highlight class when `highlightedIndex === index`:

```jsx
{results.map((species, index) => (
  <button
    key={species.scientificName}
    ref={(node) => {
      rowRefs.current[index] = node
    }}
    onMouseEnter={() => setHighlightedIndex(index)}
    onClick={() => handleSelectSpecies(species.scientificName, species.commonName)}
    className={`w-full px-3 py-2 text-left flex items-center justify-between ${
      index === highlightedIndex ? 'bg-lime-50' : ''
    } ${species.scientificName === bbox.scientificName ? 'bg-lime-100' : ''}`}
  >
    <div className="min-w-0 truncate">
      <span className="text-sm font-medium">
        {species.commonName || species.scientificName}
      </span>
      {species.commonName && (
        <span className="text-xs text-gray-500 ml-2 italic">
          ({species.scientificName})
        </span>
      )}
    </div>
    {species.inStudy !== false && typeof species.observationCount === 'number' && (
      <span className="flex items-center gap-1 text-xs text-gray-400 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-lime-500" aria-hidden="true" />
        {species.observationCount}
      </span>
    )}
  </button>
))}
```

Note: the previous `hover:bg-lime-50` class has been dropped because hover now drives `setHighlightedIndex` and the class is applied via `index === highlightedIndex`. Keyboard and mouse converge on the same highlight state.

- [ ] **Step 5: Trim the stale refs array when results shrink**

Extend the existing results-reset effect from Step 1 so it also trims the ref array:

```js
useEffect(() => {
  setHighlightedIndex(results.length > 0 ? 0 : -1)
  rowRefs.current.length = results.length
}, [results])
```

This releases refs to rows that no longer exist when a new query narrows the result set.

- [ ] **Step 6: Lint**

Run:
```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Manual keyboard test**

Run:
```bash
npm run dev
```

Verify:
- Open the picker. First result is highlighted (lime background).
- Arrow Down moves highlight down, wraps at bottom.
- Arrow Up moves highlight up, wraps at top.
- Typing a query changes `results` and the highlight resets to index 0.
- Enter selects the highlighted row and closes the picker.
- Enter with zero results does nothing.
- Mouse hover still changes highlight; click still selects.
- Escape closes the picker as before.
- Backspace/Delete in the search input erases characters without deleting the observation.

Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "feat(media): arrow-key navigation and Enter select in species picker"
```

---

## Task 7: Verification before completion — full test and lint run

**Files:**
- None modified.

- [ ] **Step 1: Run full renderer-only tests**

Run:
```bash
node --test test/renderer/utils/dictionarySearch.test.js
```

Expected: all tests PASS.

- [ ] **Step 2: Run full lint**

Run:
```bash
npm run lint
```

Expected: PASS, no new warnings in `src/renderer/src/media.jsx` or `src/renderer/src/utils/dictionarySearch.js`.

- [ ] **Step 3: Run formatter check**

Run:
```bash
npm run format:check
```

Expected: PASS. If it fails, run `npm run format` and commit the formatting fix separately.

- [ ] **Step 4: Build the renderer bundle**

Run:
```bash
npm run build
```

Expected: build completes without errors; the new `fuse.js` dep is bundled into the renderer output.

- [ ] **Step 5: Final manual end-to-end check in dev**

Run:
```bash
npm run dev
```

Walk through the spec's manual-verification checklist:
1. Open the Media tab; click a detection/observation. Picker opens, focus is in the search input, first study species is highlighted.
2. Type a 3-letter query (e.g. `che`). After ~150 ms, matching dictionary entries appear alongside matching study species, with study species ranked first on ties.
3. Arrow Down/Up cycles the highlight. Enter selects the highlighted row.
4. Pick a dictionary species that wasn't yet in the study. The picker closes and the observation updates. Reopen the picker on another observation and search again — the species now shows the in-study badge with count 1.
5. Verify the grid and filter chips display the common name for the newly picked species (existing cascade unchanged).
6. Custom-species form still works (click "+ Add custom species", type, submit).
7. Mark-as-blank still works (pick a species first, reopen picker, click "✕ Mark as blank").

Stop the dev server. No commit for this verification step.

---

## Self-review notes (for the plan author)

- Spec sections covered:
  - Architecture / new file → Task 2
  - Dictionary filter → Task 2 tests
  - `searchSpecies` fuzzy + rank + cap → Tasks 2–3
  - Row layout → Task 5
  - State additions + debounce → Task 4
  - Results computation → Task 4
  - Keyboard nav → Task 6
  - Scroll-into-view → Task 6
  - Empty-state messages → Task 4
  - Data-flow on selection → unchanged (no code task); manual check in Task 7
  - Error handling edge cases → covered by the below-threshold tests in Task 2 (empty list, short query) and the merge-dedupe test in Task 3
  - Testing unit tests 1–7 → Tasks 2 + 3
  - Manual verification → Task 7
- No e2e or main-process tests — matches spec.
