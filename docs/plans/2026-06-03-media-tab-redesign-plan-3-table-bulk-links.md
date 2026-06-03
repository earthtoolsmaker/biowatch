# Media Tab Redesign — Plan 3: Table view, bulk actions, cross-tab links

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the redesign: a sortable **Table view**, **multi-select + a bulk-action bar** (Set species / Mark blank / Mark reviewed, wiring the Plan-1 IPCs), **multi-select** deployment/source filtering, and **cross-tab entry points** (Deployments "Open in Media", Sources "View media").

**Architecture:** The Table is a `view` mode inside the existing `Gallery` (wrap the card-grid render block) so it reuses the sequence pagination, the `ImageModal`, and `getSpeciesCountsFromSequence` unchanged. Selection state lives in Gallery (it owns the sequence list) and drives a floating action bar that calls the Plan-1 bulk IPCs. Pure logic (range-select, table-row derivation) is TDD'd as helpers; React pieces are build-verified + manually checked.

**Tech Stack:** React 18, @tanstack/react-query, Tailwind v4 tokens, lucide-react, `window.api` bulk IPCs from Plan 1.

**Spec:** `docs/specs/2026-06-03-media-tab-redesign-design.md`. **Depends on:** Plans 1 & 2 (committed).

**Testing reality (same as Plan 2):** no renderer render-harness — pure helpers are TDD'd; components are verified by `npx eslint`, `npm run build`, and a manual `npm run dev` checkpoint per phase. NOTE: `npm run build` rebuilds better-sqlite3 for Electron; run `npm run test:rebuild` before `node --test` and `npm run test:rebuild-electron` before running the app.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/renderer/src/media/selection.js` | Pure: shift-click range selection over an ordered id list | Create |
| `src/renderer/src/media/tableRows.js` | Pure: derive a table row (dominant species, confidence, when, deployment, reviewed) from a sequence + bbox map | Create |
| `src/renderer/src/media/MediaTableView.jsx` | Table markup (sortable headers, rows, checkboxes) — rendered by Gallery in table mode | Create |
| `src/renderer/src/media/SelectionActionBar.jsx` | Floating bulk-action bar (Set species / Mark blank / Mark reviewed / Clear) | Create |
| `src/renderer/src/media/Gallery.jsx` | `view` prop (grid/table); selection state; render table + action bar; multi deployment/source | Modify |
| `src/renderer/src/media/MediaGridView.jsx` | Pass `view`, full `deployments`/`sources` arrays | Modify |
| `src/renderer/src/media/MediaToolbar.jsx` | Enable the Table toggle | Modify |
| `src/main/database/queries/sequences.js` | deployment/source filters accept arrays (`inArray`) | Modify |
| `src/main/services/sequences/pagination.js` | thread array filters | Modify |
| `src/renderer/src/deployments/DeploymentDetailPane.jsx` | "Open in Media ↗" link | Modify |
| `src/renderer/src/sources.jsx` | per-source "View media ↗" link | Modify |
| `docs/ipc-api.md`, `docs/architecture.md` | document multi-select + table | Modify |

---

## Phase A — Backend: multi-select deployment & source

### Task 1: deployment/source filters accept arrays

Today `getMediaForSequencePagination` filters by a single `deploymentID` / `source` via `eq`. Accept either a string (back-compat) or an array (→ `inArray`).

**Files:**
- Modify: `src/main/database/queries/sequences.js` (the `eq(media.deploymentID, deploymentID)` sites + `eq(media.importFolder, source)` sites + `hasTimestampedMedia`)
- Test: `test/main/database/queries/sequencesMultiFilter.test.js` (create)

- [ ] **Step 1: Write the failing test** — seed media across deployments d1,d2,d3 and sources s1,s2; assert `deploymentID: ['d1','d2']` returns only those, and `source: ['s1']` works; assert a bare string still works (back-compat).

```js
// mirror sequencesDeploymentFilter.test.js structure; key assertions:
// getMediaForSequencePagination(dbPath, { ..., deploymentID: ['d1', 'd2'] }) → media from d1,d2 only
// getMediaForSequencePagination(dbPath, { ..., deploymentID: 'd1' }) → d1 only (back-compat)
// getMediaForSequencePagination(dbPath, { ..., source: ['s1'] }) → s1 only
```

- [ ] **Step 2: Run → fail** (`node --test test/main/database/queries/sequencesMultiFilter.test.js`)

- [ ] **Step 3: Implement** — add a small helper near the top of `sequences.js`:

```js
// Build an equality/IN condition for a column that accepts a single value or an
// array of values. Returns null when there's nothing to filter.
function eqOrIn(column, value) {
  if (value == null) return null
  if (Array.isArray(value)) return value.length ? inArray(column, value) : null
  return eq(column, value)
}
```

Replace each `if (deploymentID) conditions.push(eq(media.deploymentID, deploymentID))` with:

```js
const depCond = eqOrIn(media.deploymentID, deploymentID)
if (depCond) conditions.push(depCond)
```

and each source site with `eqOrIn(media.importFolder, source)`. Apply at all three pagination sites + `hasTimestampedMedia`.

- [ ] **Step 4: Run → pass**; **Step 5:** regression `node --test test/main/database/queries/sequences*.test.js test/main/services/sequences/*.test.js`; **Step 6: commit** `feat(sequences): deployment/source filters accept arrays`.

### Task 2: thread arrays through the service + Gallery

**Files:** `src/main/services/sequences/pagination.js` (no logic change — values pass through; verify nothing coerces to string), `src/renderer/src/media/MediaGridView.jsx` (pass `filters.deployments` / `filters.sources` arrays instead of `[0]`), `src/renderer/src/media/Gallery.jsx` (rename props or accept arrays — keep prop names `deploymentID`/`source`, now array-capable).

- [ ] **Step 1:** In `MediaGridView.jsx` change `deploymentID: filters.deployments[0] ?? null` → `deploymentID: filters.deployments` and `source: filters.sources[0] ?? null` → `source: filters.sources`. Gallery forwards them into `filters` unchanged; the query helper handles arrays.
- [ ] **Step 2:** `FilterDrawer.jsx` deployment/source become multi-select (toggle add/remove in the array instead of single-select). Update `PickList` to take `selected: string[]` + `onToggle`.
- [ ] **Step 3:** build + manual check; **commit** `feat(media): multi-select deployment and source filters`.

---

## Phase B — Pure helpers (TDD)

### Task 3: `selection.js` — shift-click range selection

**Files:** Create `src/renderer/src/media/selection.js`; Test `test/renderer/media/selection.test.js`.

- [ ] **Step 1: Write failing test:**

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { toggleSelection, rangeSelection } from '../../../src/renderer/src/media/selection.js'

describe('selection', () => {
  test('toggle adds then removes an id', () => {
    const a = toggleSelection(new Set(), 'm2')
    assert.deepEqual([...a], ['m2'])
    assert.deepEqual([...toggleSelection(a, 'm2')], [])
  })
  test('rangeSelection selects the inclusive span between anchor and target', () => {
    const order = ['a', 'b', 'c', 'd', 'e']
    const sel = rangeSelection(new Set(['a']), order, 'b', 'd')
    assert.deepEqual([...sel].sort(), ['a', 'b', 'c', 'd'])
  })
  test('rangeSelection works regardless of direction', () => {
    const order = ['a', 'b', 'c', 'd', 'e']
    assert.deepEqual([...rangeSelection(new Set(), order, 'd', 'b')].sort(), ['b', 'c', 'd'])
  })
})
```

- [ ] **Step 2: fail → Step 3: implement:**

```js
export function toggleSelection(current, id) {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

// Add the inclusive span of `order` between anchorId and targetId to `current`.
export function rangeSelection(current, order, anchorId, targetId) {
  const next = new Set(current)
  const i = order.indexOf(anchorId)
  const j = order.indexOf(targetId)
  if (i === -1 || j === -1) {
    next.add(targetId)
    return next
  }
  const [lo, hi] = i <= j ? [i, j] : [j, i]
  for (let k = lo; k <= hi; k++) next.add(order[k])
  return next
}
```

- [ ] **Step 4: pass → Step 5: commit** `feat(media): add selection range helper`.

### Task 4: `tableRows.js` — derive a table row from a sequence

**Files:** Create `src/renderer/src/media/tableRows.js`; Test `test/renderer/media/tableRows.test.js`.

Derives `{ id, mediaID, thumbnailMedia, species, extraSpeciesCount, confidence, when, deployment, reviewed, isVideo }` from a sequence + a `bboxesByMedia` map, reusing the existing species-count util.

- [ ] **Step 1: Write failing test** asserting: dominant species selected by highest count; `extraSpeciesCount` = (#distinct species − 1); `when` is the sequence's representative timestamp (or null → flagged); `reviewed` passes through.

- [ ] **Step 2: fail → Step 3: implement** using `getSpeciesCountsFromSequence` from `./Gallery.jsx`'s util module (extract the util to `src/renderer/src/utils/` if it isn't already importable; if it lives inside Gallery, move it to a shared util in this step and re-import in Gallery).

> NOTE: verify where `getSpeciesCountsFromSequence` is defined (imported at Gallery.jsx top). If it's already a shared util module, import from there. If defined inline in Gallery, move it to `src/renderer/src/utils/speciesFromBboxes.js` (there's already a `speciesFromBboxes.test.js`) and import in both places.

- [ ] **Step 4: pass → Step 5: commit** `feat(media): add table-row derivation helper`.

---

## Phase C — Table view

### Task 5: `MediaTableView` + Gallery `view` prop

**Files:** Create `src/renderer/src/media/MediaTableView.jsx`; Modify `Gallery.jsx` (accept `view='grid'`, wrap the `allNavigableItems.map(...)` block: `view === 'table' ? <MediaTableView .../> : <cards/>`), `MediaGridView.jsx` (pass `view={filters.view}`), `MediaToolbar.jsx` (enable Table toggle).

- [ ] **Step 1:** `MediaTableView.jsx` — props `{ sequences, bboxesByMedia, onRowClick, selection, onToggleSelect, sort, onSortChange }`. Render a `<table>` with sortable headers (thumbnail · species(+N) · when · deployment · confidence · reviewed) using `deriveTableRow` per sequence. Row click → `onRowClick(media, sequence)` (the same `handleImageClick`). Header click → `onSortChange`. Match `hifi/table-lean.html` styling with theme tokens. Video thumbnails get a ▶.
- [ ] **Step 2:** In `Gallery.jsx`, add `view = 'grid'` prop; at the render block (~line 2518) branch to `<MediaTableView>` when `view === 'table'`, passing the same `allNavigableItems`, `bboxesByMedia`, and `handleImageClick`. The `ImageModal` (rendered separately, gated on `selectedMedia`) is reused untouched.
- [ ] **Step 3:** Sorting: the table's "When" header maps to the existing `sort` newest/oldest (already wired through Gallery → query). Other columns (species/deployment/confidence) sort the **currently loaded** rows client-side with a `log()`-style note, OR are left non-sortable in this plan (decide: non-sortable except When/Deployment, which map to server sort — deployment server-sort is deferred per Plan 1, so Deployment header sorts loaded rows client-side with a "sorts loaded rows" tooltip). Keep When = server sort; others = client-side over loaded pages with a tooltip.
- [ ] **Step 4:** `MediaToolbar.jsx` — remove `disabled` from the Table button; wire `onChange({...filters, view:'table'|'grid'})`.
- [ ] **Step 5:** build + **manual checkpoint** — toggle Grid/Table; table rows render with thumbnails + species + reviewed; clicking a row opens the modal; When header flips sort.
- [ ] **Step 6: commit** `feat(media): add sortable Table view`.

---

## Phase D — Multi-select + bulk actions

### Task 6: selection state + checkboxes (grid + table)

**Files:** Modify `Gallery.jsx` (selection state via `selection.js`; checkboxes on cards + rows), `MediaTableView.jsx` (row checkbox column), pass selection handlers into `ThumbnailCard`/`SequenceCard`.

- [ ] **Step 1:** In `Gallery.jsx` add `const [selection, setSelection] = useState(new Set())` and an `orderedIds = allNavigableItems.map(s => s.id)` memo. Add `onToggleSelect(id, shiftKey)` using `toggleSelection`/`rangeSelection` (track last-anchor in a ref).
- [ ] **Step 2:** Add a checkbox overlay to `ThumbnailCard`/`SequenceCard` (top-left, appears on hover or when any selected) and a checkbox column to the table. Clicking the checkbox toggles; shift-click extends.
- [ ] **Step 3:** build + manual check — selecting cards/rows highlights them; shift-click selects a range. **commit** `feat(media): multi-select for grid and table`.

### Task 7: `SelectionActionBar` + bulk IPC wiring

**Files:** Create `src/renderer/src/media/SelectionActionBar.jsx`; Modify `Gallery.jsx` (render bar when `selection.size > 0`).

- [ ] **Step 1:** `SelectionActionBar.jsx` — floating bar: `N selected · 🏷 Set species ▾ · ⌫ Mark blank · ✓ Mark reviewed · ✕`. "Set species" opens a species picker (reuse the modal's species-picker or a simple combobox over `getDistinctSpecies`).
- [ ] **Step 2:** Wire actions to the Plan-1 IPCs over the selected sequences' member mediaIDs:
  - Set species → `window.api.bulkSetSpecies(studyId, mediaIDs, { scientificName, commonName })`
  - Mark blank → `window.api.bulkMarkBlank(studyId, mediaIDs)`
  - Mark reviewed → `window.api.bulkMarkReviewed(studyId, mediaIDs)`
  After success, invalidate `['sequences', studyId]` (and bbox/count queries) so the grid/table + badges refresh, then clear selection.
- [ ] **Step 3:** Resolve selected sequence IDs → mediaIDs: `allNavigableItems.filter(s => selection.has(s.id)).flatMap(s => s.items.map(i => i.mediaID))`.
- [ ] **Step 4:** build + **manual checkpoint** — select several → Mark reviewed → ✓ badges appear; Set species → labels change; Mark blank → moves to Blank. **commit** `feat(media): bulk action bar (set species, mark blank, mark reviewed)`.

---

## Phase E — Cross-tab entry points

### Task 8: Deployments "Open in Media" + Sources "View media"

**Files:** Modify `src/renderer/src/deployments/DeploymentDetailPane.jsx` (add an "Open in Media ↗" link/button → `navigate(/study/${id}/media?deployment=${deploymentID})`), `src/renderer/src/sources.jsx` (per-source "View media ↗" → `/study/${id}/media?source=${encodeURIComponent(importFolder)}`).

- [ ] **Step 1:** Deployments detail pane — add the link near the inline gallery header (keep the inline mini-gallery per the spec). Use `useNavigate` from react-router.
- [ ] **Step 2:** Sources — add a small "View media ↗" affordance on each source row.
- [ ] **Step 3:** build + **manual checkpoint** — from a deployment, "Open in Media" lands on the Media tab with the deployment chip applied; from a source, "View media" applies the source chip.
- [ ] **Step 4: commit** `feat(media): link into Media tab from Deployments and Sources`.

### Task 9: Docs + final verification

- [ ] **Step 1:** `docs/ipc-api.md` — note deployment/source filters accept arrays; `docs/architecture.md` — add MediaTableView + SelectionActionBar to the component tree.
- [ ] **Step 2:** `npm run test:rebuild && node --test 'test/**/*.test.js'` green; `npm run build` clean; `npm run test:rebuild-electron`.
- [ ] **Step 3: commit** `docs: document Plan 3 (table, bulk, multi-select, cross-tab links)`.

---

## Self-Review Notes

- **Spec coverage:** Table view (T5), bulk Set species/Mark blank/Mark reviewed (T6–T7), multi-select deployment/source (T1–T2), cross-tab links (T8). The date histogram-brush polish (Plan 2 deferral) remains a separate cosmetic follow-up — not in this plan.
- **Reuse over rebuild:** Table is a Gallery `view` mode → reuses pagination + modal + bbox batching, avoiding a risky ImageModal extraction.
- **Honest partial coverage:** non-When column sorting acts on loaded rows only (tooltip); deployment server-sort still deferred (Plan 1). Surfaced in the UI, not silent.
- **Type consistency:** `deploymentID`/`source` props/filters now accept string | string[]; selection is a `Set<sequenceId>`; bulk IPCs take `mediaIDs[]` (resolved from selected sequences).
