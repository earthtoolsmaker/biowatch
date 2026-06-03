# Media Tab Redesign — Plan 2: Browsable UI (shell, toolbar, drawer, quick views, grid)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Explore-derived Media tab with the redesigned browsable tab: a slim toolbar (filter button, active-filter chips, sequence count, Grid/Table toggle), a collapsible filter drawer (species · deployment · source · date+time), a quick-views row (Needs review · Reviewed · Favorites · Blank · No timestamp · Low confidence · Vehicle), and a full-bleed Grid that reuses the existing `Gallery` sequence fetching + media modal. Fully URL-addressable.

**Architecture:** Decompose the 680-line `media.jsx` into focused components under `src/renderer/src/media/`. A single `useMediaFilters` hook owns filter/sort/view state, synced to the URL via pure serialization helpers (TDD'd with `node:test`, matching repo convention — no component-render tests exist here). The Grid reuses `Gallery` (extended to accept `source` + `sort`). The media modal is untouched. Quick views map to existing filter primitives + the Plan-1 review/low-confidence flags.

**Tech Stack:** React 18, react-router (`useSearchParams`), @tanstack/react-query, Tailwind v4 (theme tokens in `src/renderer/src/assets/main.css`), Radix UI (Popover/Dialog for the drawer), `window.api` IPC from Plan 1.

**Spec:** `docs/specs/2026-06-03-media-tab-redesign-design.md`.

**Depends on:** Plan 1 (committed) — `getSequences` now accepts `filters.source` + `sort`, returns `reviewed` per sequence; `window.api.getSourceDistribution`, `getLowConfidenceCount` exist.

**Out of scope (→ Plan 3):** Table view, multi-select, bulk action bar (Set species / Mark blank / Mark reviewed), and the cross-tab "Open in Media" / "View media" entry points (those depend on the URL scheme this plan establishes). The Grid/Table toggle ships with **Table disabled/coming-soon** so the toggle exists but only Grid is active.

**Testing reality:** This repo has NO renderer component-render harness (no jsdom/testing-library/vitest). Renderer `node:test` files test *pure functions only*. Therefore: every task that can be reduced to pure logic (URL serialization, quick-view→filter mapping, count-label formatting) is TDD'd as a helper module. React components are verified by `node --check` (syntax), the existing Playwright e2e smoke (`npm run test:e2e`), and a manual run (`/run` or `npm run dev`). Each phase ends with an explicit manual-verification checkpoint.

**Visual fidelity:** Match the approved mockups in `.superpowers/brainstorm/112368-1780486191/content/hifi-grid.html` and `hifi-temporal.html`. Use the real theme tokens (Inter, `bg-card`, `border-border`, blue-50 chips, the species `palette`) — never `font-mono` for freeform text; explicit blue palette, soft borders.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/renderer/src/media/mediaFilters.js` | Pure helpers: filter state ↔ URL searchParams, defaults, active-chip derivation | Create |
| `src/renderer/src/media/quickViews.js` | Pure: quick-view definitions + (quickView → filter patch) mapping | Create |
| `src/renderer/src/media/useMediaFilters.js` | Hook: owns filter/sort/view state, syncs to URL via `mediaFilters.js` | Create |
| `src/renderer/src/media/MediaTab.jsx` | Top-level: wires hook → toolbar + quick views + drawer + grid; fetches counts | Create |
| `src/renderer/src/media/MediaToolbar.jsx` | Filter button, active-filter chips, sequence count, Grid/Table toggle | Create |
| `src/renderer/src/media/QuickViews.jsx` | The preset pill row | Create |
| `src/renderer/src/media/FilterDrawer.jsx` | Species · Deployment · Source · Date+Time panels (reuses existing components) | Create |
| `src/renderer/src/media/MediaGridView.jsx` | Thin wrapper over `Gallery` passing filters/sort; reviewed/issue badges | Create |
| `src/renderer/src/media/Gallery.jsx` | Accept `source` + `sort` props; thread into query; render `reviewed`/AI badge | Modify |
| `src/renderer/src/study.jsx` | Mount `MediaTab` instead of old `Media` (`media.jsx`) | Modify |
| `src/renderer/src/media.jsx` | Old tab — kept until parity confirmed, then removed in the final task | Modify/Delete |
| `docs/architecture.md`, `docs/ipc-api.md` | Note the new Media tab component tree + URL params | Modify |

---

## Phase 1 — URL filter state (pure helpers + hook)

### Task 1: `mediaFilters.js` — serialize/parse filter state ↔ URL

**Files:**
- Create: `src/renderer/src/media/mediaFilters.js`
- Test: `test/renderer/media/mediaFilters.test.js`

The canonical filter state shape:

```js
// FilterState
{
  species: string[],        // scientific names (+ BLANK_SENTINEL / VEHICLE_SENTINEL)
  deployments: string[],    // deploymentIDs
  sources: string[],        // importFolders
  dateRange: [string|null, string|null], // ISO dates
  timeRange: { ranges: [{start:number,end:number}] }, // hours; {ranges:[]} = no filter
  quickView: string|null,   // one of the quick-view keys, or null
  sort: 'newest'|'oldest',
  view: 'grid'|'table'
}
```

- [ ] **Step 1: Write the failing test**

Create `test/renderer/media/mediaFilters.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_FILTERS,
  filtersToSearchParams,
  searchParamsToFilters,
  hasActiveFilters
} from '../../../src/renderer/src/media/mediaFilters.js'

describe('mediaFilters round-trip', () => {
  test('defaults serialize to an empty query', () => {
    const sp = filtersToSearchParams(DEFAULT_FILTERS)
    assert.equal(sp.toString(), '')
  })

  test('species + deployment + source round-trip', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      species: ['Panthera pardus', 'Genetta genetta'],
      deployments: ['Cam-A1'],
      sources: ['ndutu_2024']
    }
    const sp = filtersToSearchParams(filters)
    const back = searchParamsToFilters(new URLSearchParams(sp.toString()))
    assert.deepEqual(back.species, ['Panthera pardus', 'Genetta genetta'])
    assert.deepEqual(back.deployments, ['Cam-A1'])
    assert.deepEqual(back.sources, ['ndutu_2024'])
  })

  test('date range + sort + view round-trip', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      dateRange: ['2024-03-01', '2024-03-31'],
      sort: 'oldest',
      view: 'table'
    }
    const back = searchParamsToFilters(filtersToSearchParams(filters))
    assert.deepEqual(back.dateRange, ['2024-03-01', '2024-03-31'])
    assert.equal(back.sort, 'oldest')
    assert.equal(back.view, 'table')
  })

  test('quickView round-trips and unknown values are dropped', () => {
    const back = searchParamsToFilters(new URLSearchParams('view=grid&q=needs-review'))
    assert.equal(back.quickView, 'needs-review')
    const bad = searchParamsToFilters(new URLSearchParams('q=bogus'))
    assert.equal(bad.quickView, null)
  })

  test('hasActiveFilters is false for defaults, true when any filter set', () => {
    assert.equal(hasActiveFilters(DEFAULT_FILTERS), false)
    assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, species: ['x'] }), true)
    // sort/view are not "filters"
    assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, sort: 'oldest', view: 'table' }), false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/renderer/media/mediaFilters.test.js`
Expected: FAIL — module not found / exports missing.

- [ ] **Step 3: Implement `mediaFilters.js`**

```js
// Pure helpers translating Media-tab filter state to/from URL search params.
// No React here — keeps the logic unit-testable under node:test.

export const QUICK_VIEW_KEYS = [
  'needs-review',
  'reviewed',
  'favorites',
  'blank',
  'no-timestamp',
  'low-confidence',
  'vehicle'
]

export const DEFAULT_FILTERS = {
  species: [],
  deployments: [],
  sources: [],
  dateRange: [null, null],
  timeRange: { ranges: [] },
  quickView: null,
  sort: 'newest',
  view: 'grid'
}

// Repeatable list params use comma-join; the renderer never stores a comma in a
// scientificName/deploymentID, so a plain split is safe.
const listToParam = (xs) => (xs && xs.length ? xs.join(',') : null)
const paramToList = (v) => (v ? v.split(',').filter(Boolean) : [])

export function filtersToSearchParams(filters) {
  const sp = new URLSearchParams()
  const f = { ...DEFAULT_FILTERS, ...filters }
  if (f.species.length) sp.set('species', listToParam(f.species))
  if (f.deployments.length) sp.set('deployment', listToParam(f.deployments))
  if (f.sources.length) sp.set('source', listToParam(f.sources))
  if (f.dateRange[0]) sp.set('from', f.dateRange[0])
  if (f.dateRange[1]) sp.set('to', f.dateRange[1])
  if (f.timeRange.ranges.length) sp.set('time', JSON.stringify(f.timeRange.ranges))
  if (f.quickView) sp.set('q', f.quickView)
  if (f.sort && f.sort !== 'newest') sp.set('sort', f.sort)
  if (f.view && f.view !== 'grid') sp.set('view', f.view)
  return sp
}

export function searchParamsToFilters(sp) {
  const q = sp.get('q')
  let ranges = []
  try {
    const raw = sp.get('time')
    if (raw) ranges = JSON.parse(raw)
    if (!Array.isArray(ranges)) ranges = []
  } catch {
    ranges = []
  }
  return {
    species: paramToList(sp.get('species')),
    deployments: paramToList(sp.get('deployment')),
    sources: paramToList(sp.get('source')),
    dateRange: [sp.get('from') || null, sp.get('to') || null],
    timeRange: { ranges },
    quickView: QUICK_VIEW_KEYS.includes(q) ? q : null,
    sort: sp.get('sort') === 'oldest' ? 'oldest' : 'newest',
    view: sp.get('view') === 'table' ? 'table' : 'grid'
  }
}

// "Filters" = things that narrow the result set. sort/view are presentation,
// not filters, so they don't light up the "active filters" / reset affordance.
export function hasActiveFilters(filters) {
  const f = { ...DEFAULT_FILTERS, ...filters }
  return !!(
    f.species.length ||
    f.deployments.length ||
    f.sources.length ||
    f.dateRange[0] ||
    f.dateRange[1] ||
    f.timeRange.ranges.length ||
    f.quickView
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/renderer/media/mediaFilters.test.js`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/media/mediaFilters.js test/renderer/media/mediaFilters.test.js
git commit -m "feat(media): add URL <-> filter-state serialization helpers"
```

### Task 2: `quickViews.js` — quick-view → filter/query mapping

**Files:**
- Create: `src/renderer/src/media/quickViews.js`
- Test: `test/renderer/media/quickViews.test.js`

A quick view resolves to (a) a label/tone for the pill and (b) a patch describing how it constrains the `Gallery` query. Some map to the existing species sentinels, some to Plan-1 flags.

- [ ] **Step 1: Write the failing test**

Create `test/renderer/media/quickViews.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { QUICK_VIEWS, quickViewToQueryPatch } from '../../../src/renderer/src/media/quickViews.js'
import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../../../src/shared/constants.js'

describe('quickViews', () => {
  test('every quick view has a key, label and tone', () => {
    for (const qv of QUICK_VIEWS) {
      assert.ok(qv.key && qv.label && qv.tone)
      assert.ok(['neutral', 'warn'].includes(qv.tone))
    }
  })

  test('blank maps to the BLANK_SENTINEL species bucket', () => {
    assert.deepEqual(quickViewToQueryPatch('blank'), { species: [BLANK_SENTINEL] })
  })

  test('vehicle maps to the VEHICLE_SENTINEL species bucket', () => {
    assert.deepEqual(quickViewToQueryPatch('vehicle'), { species: [VEHICLE_SENTINEL] })
  })

  test('no-timestamp maps to the null-timestamp-only flag', () => {
    assert.deepEqual(quickViewToQueryPatch('no-timestamp'), { onlyNullTimestamps: true })
  })

  test('reviewed / needs-review / favorites / low-confidence map to server flags', () => {
    assert.deepEqual(quickViewToQueryPatch('reviewed'), { reviewed: true })
    assert.deepEqual(quickViewToQueryPatch('needs-review'), { reviewed: false })
    assert.deepEqual(quickViewToQueryPatch('favorites'), { favorite: true })
    assert.deepEqual(quickViewToQueryPatch('low-confidence'), { lowConfidence: true })
  })

  test('null / unknown quick view → empty patch', () => {
    assert.deepEqual(quickViewToQueryPatch(null), {})
    assert.deepEqual(quickViewToQueryPatch('bogus'), {})
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/renderer/media/quickViews.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `quickViews.js`**

```js
import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../../../shared/constants.js'

// Display metadata for the quick-view pill row. `tone` drives the amber
// "attention" styling vs the neutral pill. Counts are filled in by the caller.
export const QUICK_VIEWS = [
  { key: 'needs-review', label: 'Needs review', tone: 'warn' },
  { key: 'reviewed', label: 'Reviewed', tone: 'neutral' },
  { key: 'favorites', label: 'Favorites', tone: 'neutral' },
  { key: 'blank', label: 'Blank', tone: 'warn' },
  { key: 'no-timestamp', label: 'No timestamp', tone: 'warn' },
  { key: 'low-confidence', label: 'Low confidence', tone: 'warn' },
  { key: 'vehicle', label: 'Vehicle', tone: 'neutral' }
]

// Translate a quick view into a patch applied on top of the active filters when
// building the Gallery query. Keys here (reviewed/favorite/lowConfidence/
// onlyNullTimestamps) are consumed by Gallery's query builder (Task 6).
export function quickViewToQueryPatch(key) {
  switch (key) {
    case 'blank':
      return { species: [BLANK_SENTINEL] }
    case 'vehicle':
      return { species: [VEHICLE_SENTINEL] }
    case 'no-timestamp':
      return { onlyNullTimestamps: true }
    case 'reviewed':
      return { reviewed: true }
    case 'needs-review':
      return { reviewed: false }
    case 'favorites':
      return { favorite: true }
    case 'low-confidence':
      return { lowConfidence: true }
    default:
      return {}
  }
}
```

> NOTE: `reviewed`/`favorite`/`lowConfidence`/`onlyNullTimestamps` as *gallery filter flags* are not yet implemented server-side (Plan 1 added the counts + the `reviewed` payload field, not these filter predicates). Task 6 wires the ones that are cheap (favorites already exists as `media.favorite`; blank/vehicle already work as sentinels; no-timestamp via the existing null-phase). `reviewed`/`needs-review`/`low-confidence` *filtering* is deferred — see "Deferred" — so in this plan those three quick views filter client-side over the loaded page only, with a `log()`-style banner noting partial coverage, OR are visually disabled with a "counts only" tooltip. Pick the disabled-with-tooltip route to avoid misleading partial results (decided in Task 5).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/renderer/media/quickViews.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/media/quickViews.js test/renderer/media/quickViews.test.js
git commit -m "feat(media): add quick-view definitions and query-patch mapping"
```

### Task 3: `useMediaFilters` hook

**Files:**
- Create: `src/renderer/src/media/useMediaFilters.js`

No unit test (it's a thin React wrapper over the tested pure helpers + `useSearchParams`). Verified by syntax + manual run.

- [ ] **Step 1: Implement the hook**

```js
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { DEFAULT_FILTERS, filtersToSearchParams, searchParamsToFilters } from './mediaFilters.js'

// Single source of truth for the Media tab's filter/sort/view state, backed by
// the URL so deep-links and the back button work. Reads derive from the URL;
// writes push a new URLSearchParams.
export function useMediaFilters() {
  const [searchParams, setSearchParams] = useSearchParams()

  const filters = useMemo(() => searchParamsToFilters(searchParams), [searchParams])

  const setFilters = useCallback(
    (next) => {
      const resolved = typeof next === 'function' ? next(searchParamsToFilters(searchParams)) : next
      setSearchParams(filtersToSearchParams(resolved), { replace: false })
    },
    [searchParams, setSearchParams]
  )

  const patch = useCallback(
    (delta) => setFilters((f) => ({ ...f, ...delta })),
    [setFilters]
  )

  const reset = useCallback(() => setFilters(DEFAULT_FILTERS), [setFilters])

  return { filters, setFilters, patch, reset }
}
```

- [ ] **Step 2: Syntax check + commit**

Run: `node --check src/renderer/src/media/useMediaFilters.js`

```bash
git add src/renderer/src/media/useMediaFilters.js
git commit -m "feat(media): add useMediaFilters URL-backed state hook"
```

---

## Phase 2 — Grid shell wired into the route

### Task 4: Extend `Gallery` to accept `source` + `sort`

**Files:**
- Modify: `src/renderer/src/media/Gallery.jsx` (props ~2091; the `useInfiniteQuery` queryKey + `getSequences` options call ~2183/2201)

- [ ] **Step 1: Add the props**

In the `Gallery({...})` signature add `source = null,` and `sort = 'newest',`.

- [ ] **Step 2: Thread into the query**

In the `useInfiniteQuery` `queryKey` array, add `source` and `sort` (so a change refetches). In the `queryFn` call to `window.api.getSequences(studyId, { ... })`, add `sort` at the top level and `source` inside `filters`:

```js
window.api.getSequences(studyId, {
  gapSeconds,
  limit: PAGE_SIZE,
  cursor: pageParam,
  sort,                       // NEW
  filters: {
    species,
    dateRange: ...,
    timeRange: ...,
    deploymentID,
    source,                   // NEW
    bbox: areaFilter
  }
})
```

- [ ] **Step 3: Verify no regression**

Run: `node --check src/renderer/src/media/Gallery.jsx` and `npm run test:e2e -- --grep media` if an e2e media smoke exists (otherwise skip; manual check in Task 7).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/media/Gallery.jsx
git commit -m "feat(media): Gallery accepts source + sort props"
```

### Task 5: `MediaToolbar`, `QuickViews`, `MediaGridView`, `MediaTab` shell

**Files:**
- Create: `src/renderer/src/media/MediaToolbar.jsx`, `QuickViews.jsx`, `MediaGridView.jsx`, `MediaTab.jsx`
- Modify: `src/renderer/src/study.jsx` (mount `MediaTab`)

Build the visible shell. Match `hifi-grid.html`. Use theme tokens (`bg-card`, `border-border`, blue-50 chips, Inter). The Table toggle renders but is disabled with a "Coming soon" tooltip (Plan 3).

- [ ] **Step 1: `MediaGridView.jsx`** — thin wrapper resolving filters+quickView into Gallery props:

```jsx
import { useMemo } from 'react'
import Gallery from './Gallery.jsx'
import { quickViewToQueryPatch } from './quickViews.js'

// Resolves the active filter state (+ quick view) into Gallery's prop surface.
// Quick views that are server-supported (blank/vehicle via sentinels, favorites,
// no-timestamp) fold into props here; unsupported review/low-confidence filtering
// is gated upstream (those pills are disabled in this plan — see QuickViews).
export default function MediaGridView({ studyId, filters, speciesReady }) {
  const patch = useMemo(() => quickViewToQueryPatch(filters.quickView), [filters.quickView])
  const species = patch.species ?? filters.species
  const includeNullTimestamps = patch.onlyNullTimestamps === true
  return (
    <Gallery
      species={species}
      dateRange={filters.dateRange}
      timeRange={filters.timeRange}
      sort={filters.sort}
      deploymentID={filters.deployments[0] ?? null}
      source={filters.sources[0] ?? null}
      includeNullTimestamps={includeNullTimestamps}
      speciesReady={speciesReady}
      embedded
    />
  )
}
```

> NOTE: Gallery currently filters by a single `deploymentID` and (now) single `source`. Multi-select deployment/source filtering is a Gallery query change deferred to Plan 3; this plan wires the first selected value and the drawer allows single-select for those two facets (documented in Task 6). Species remains multi-select (already supported).

- [ ] **Step 2: `MediaToolbar.jsx`** — filter button, active chips, count, Grid/Table toggle. Reference `hifi-grid.html` markup; emit callbacks `onOpenFilter`, `onRemoveChip`, `onSortChange`, `onViewChange`. Build active chips from `filters` (species chips carry their palette dot). Table button: `disabled` + Radix tooltip "Table view coming soon".

- [ ] **Step 3: `QuickViews.jsx`** — render `QUICK_VIEWS` as pills (amber tone for `warn`), showing counts passed in via props. Clicking toggles `filters.quickView` (selecting clears it if already active). Pills whose filtering isn't server-supported in this plan (`needs-review`, `reviewed`, `low-confidence`) render disabled with a "counts only for now" tooltip.

- [ ] **Step 4: `MediaTab.jsx`** — compose everything; own `useMediaFilters`; fetch counts (`getBlankMediaCount`, `getVehicleMediaCount`, `getLowConfidenceCount`, plus favorites/reviewed counts where available via react-query); manage `speciesReady` + drawer open state; render `MediaToolbar` + `QuickViews` + `FilterDrawer` (Phase 3, stub for now) + `MediaGridView`.

- [ ] **Step 5: Mount in `study.jsx`** — replace `import Media from './media'` with `import MediaTab from './media/MediaTab.jsx'` and render `<MediaTab studyId={id} path={study.path} />` in the `path="media"` route. Keep `media.jsx` on disk until Task 8.

- [ ] **Step 6: Syntax-check all + manual checkpoint**

Run: `node --check` on each new file. Then `npm run dev` (or `/run`) → open a study → Media tab. **Verify:** the new toolbar + quick-view row render; the grid loads sequences; clicking a tile opens the existing modal; the Grid/Table toggle shows Table disabled.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/media/MediaToolbar.jsx src/renderer/src/media/QuickViews.jsx src/renderer/src/media/MediaGridView.jsx src/renderer/src/media/MediaTab.jsx src/renderer/src/study.jsx
git commit -m "feat(media): new Media tab shell — toolbar, quick views, grid (replaces old tab)"
```

---

## Phase 3 — Filter drawer

### Task 6: `FilterDrawer` + quick-view query wiring

**Files:**
- Create: `src/renderer/src/media/FilterDrawer.jsx`
- Modify: `src/renderer/src/media/MediaTab.jsx` (wire drawer state), `MediaGridView.jsx` (fold supported quick-view patches)

- [ ] **Step 1: Build the drawer** as a Radix Dialog/Popover panel containing four sections, reusing existing components:
  - **Species** — `SpeciesDistribution` (`src/renderer/src/ui/speciesDistribution.jsx`) driving `filters.species`.
  - **Deployment** — list of deployments (from `window.api.getDeploymentLocations` / existing deployment query) → single-select into `filters.deployments` (multi deferred, see Task 5 note).
  - **Source** — `window.api.getSourceDistribution(studyId)` → list with counts → single-select into `filters.sources`.
  - **Date + Time** — reuse `TimelineChart` (`./ui/timeseries`) histogram+brush → `filters.dateRange`, and the day-period chips (`./ui/dayPeriodChips` + `./utils/dayPeriods`) → `filters.timeRange`. Match `hifi-temporal.html` option A.

- [ ] **Step 2: Open/close** wired from the toolbar `⊕ Filter` button; closed by default.

- [ ] **Step 3: Syntax check + manual checkpoint**

`npm run dev` → open the drawer → set species/deployment/source/date/time → confirm the grid refetches and the URL updates with the corresponding params; reload the page and confirm filters persist from the URL.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/media/FilterDrawer.jsx src/renderer/src/media/MediaTab.jsx src/renderer/src/media/MediaGridView.jsx
git commit -m "feat(media): add filter drawer (species, deployment, source, date+time)"
```

---

## Phase 4 — Polish + parity + cleanup

### Task 7: Grid tile review/issue badges + count label

**Files:**
- Modify: `src/renderer/src/media/Gallery.jsx` (thumbnail/sequence card render)

- [ ] **Step 1:** Render the `reviewed` flag now present on each sequence as the corner ✓ (green) / AI badge per `hifi-grid.html`, and an issue flag for null-timestamp sequences. Gate behind the existing thumbnail-bbox toggle where appropriate.
- [ ] **Step 2:** Show the total sequence count in the toolbar (`useInfiniteQuery` total or a lightweight count query).
- [ ] **Step 3:** Manual checkpoint — reviewed sequences show ✓; AI ones show the AI tag.
- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/media/Gallery.jsx
git commit -m "feat(media): show review status + issue badges on grid tiles"
```

### Task 8: Remove the old Media tab + docs

**Files:**
- Delete: `src/renderer/src/media.jsx` (only after Task 5–7 parity confirmed)
- Verify: no remaining imports of `./media` (grep)
- Modify: `docs/architecture.md` (Media tab component tree), `docs/ipc-api.md` (Media tab URL params: `species`, `deployment`, `source`, `from`, `to`, `time`, `q`, `sort`, `view`)

- [ ] **Step 1:** `grep -rn "from './media'" src/renderer` → ensure nothing imports the old file (Deployments uses `media/DeploymentMediaGallery` + `media/Gallery`, not `media.jsx`). Confirm, then delete `media.jsx`.
- [ ] **Step 2:** Update docs.
- [ ] **Step 3:** Full check — `node --test 'test/**/*.test.js'` (renderer pure-helper tests + Plan-1 suite) green; `npm run dev` manual smoke of the Media tab.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(media): remove old Media tab; document new tab + URL params"
```

---

## Deferred to Plan 3

- **Table view** (sortable columns, click-to-modal) and the Grid/Table toggle's Table half.
- **Multi-select + bulk action bar** (Set species / Mark blank / Mark reviewed) — wire the Plan-1 `bulkSetSpecies` / `bulkMarkBlank` / `bulkMarkReviewed` IPCs.
- **Server-side filter predicates** for `reviewed` / `needs-review` / `low-confidence` (Plan 1 added counts + the `reviewed` payload, not the gallery filter predicates). Until then those three quick views are disabled (counts-only). Add `filters.reviewed` / `filters.lowConfidence` to `getMediaForSequencePagination`, mirroring the deployment/source filter pattern.
- **Multi-select deployment/source** in the gallery query (currently single-value).
- **Cross-tab entry points** — Deployments "Open in Media ↗", Sources "View media ↗" (use the URL scheme from Task 1).

---

## Self-Review Notes

- **Spec coverage (browse scope):** toolbar (T5), quick views (T2/T5), filter drawer with date histogram+brush (T6), grid reusing modal (T4/T5), review badges (T7), URL-addressable state (T1/T3), old tab removed (T8). Table/bulk/cross-tab explicitly deferred to Plan 3 with rationale.
- **Testing honesty:** pure helpers are TDD'd (`mediaFilters`, `quickViews`); components are syntax + manual + e2e verified because no render harness exists. Each phase has a manual checkpoint.
- **Known partial-coverage flags called out inline:** single-value deployment/source filtering, and review/low-confidence quick views disabled (counts only) until Plan 3 adds the server predicates — both surfaced to the user (disabled pills w/ tooltip) rather than silently returning partial results.
- **Type consistency:** `FilterState` shape is identical across `mediaFilters.js`, `useMediaFilters.js`, `MediaGridView.jsx`; quick-view keys come from the single `QUICK_VIEW_KEYS`/`QUICK_VIEWS` source.
