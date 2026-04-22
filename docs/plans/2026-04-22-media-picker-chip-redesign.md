# Media picker chip + contextual actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the species tab of `ObservationEditor` so the current classification lives in a dismissible chip at the top, the search input starts empty, "mark as blank" moves onto the chip's ✕, and "add custom species" becomes a query-aware zero-results footer. Deletes the separate custom-input mode.

**Architecture:** Renderer-only change inside one React component (`ObservationEditor` in `src/renderer/src/media.jsx`). No new files. No IPC, DB, or main-process changes. Every write path already exists; we're rewiring which UI element triggers which.

**Tech Stack:** React 19, Tailwind 4, `lucide-react` icons (already imported). The fuzzy-search infrastructure (`searchSpecies`, `debouncedSearch`, `highlightedIndex`, `rowRefs`) is already live in the component — this plan builds on it.

**Reference spec:** `docs/specs/2026-04-22-media-picker-chip-redesign-design.md`

---

## Context for the engineer

This plan mutates **one function** in **one file**: `ObservationEditor` at `src/renderer/src/media.jsx:527`. You do not need to touch anything else in the file, and you do not need to read other files unless a task tells you to.

**Existing behavior you must preserve** (verify after each task):
- Search input with debounce, ranked `results` from `searchSpecies(debouncedSearch, speciesList)`.
- Arrow-key navigation (`ArrowUp`/`ArrowDown`) over `results`, wrapping at ends.
- `Enter` on a highlighted result selects it.
- `Escape` closes the picker.
- `Backspace`/`Delete` in the input use `stopPropagation()` so the modal's delete-observation shortcut does not fire.
- Attributes tab (sex, life-stage, behavior) is completely untouched.
- Row highlighting: hovered row gets `bg-lime-50`; row whose `scientificName` matches `bbox.scientificName` gets `bg-lime-100`.
- Observation-count badge: in-study rows show a lime dot + count on the right.

**What's going away:**
- `showCustomInput` state, `customSpecies` state, `customInputRef`.
- The `showCustomInput ? <form> : <search>` ternary — collapses to just the search input.
- The always-on "+ Add custom species" blue row at the top of the list.
- The "✕ Mark as blank (no species)" red row inside the list.
- `handleCustomSubmit`.
- The "Click Add custom species" copy inside the zero-results empty state.

**What's being added:**
- A chip strip above the search input, rendered when `bbox.scientificName` is non-null. Shows `commonName (scientificName)` (italicized scientific, like today's result rows) with an ✕ that calls `handleMarkAsBlank`.
- A query-aware "Add custom species" button inside the existing `results.length === 0 && searchTerm.length >= 3` empty state. Button label includes the trimmed, single-space-collapsed query.
- Enter-key behavior: when `highlightedIndex === -1` AND `debouncedSearch.trim().length >= 3` AND `results.length === 0`, Enter fires the custom-add button.

**Running things:**
- `npm run dev` — dev server (not required by this plan; manual verification runs against it).
- `npm run lint` — ESLint + prettier. Run after each edit; must pass before commit.
- `npm run format` — fix formatting in place if lint fails on formatting.
- No unit test file for `ObservationEditor` exists and this plan does not add one (per spec: "no component-level coverage of `ObservationEditor`, introducing it for one feature is out of scope").

**Branch:** `arthur/feat-improve-species-selection-input-form` (already checked out).

**Commit-message preferences (from CLAUDE.md + repo memory):**
- Conventional commits: `feat(media): ...`, `refactor(media): ...`, `chore: ...`.
- **No Co-Authored-By trailer.**
- One commit per task step marked "commit."

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/renderer/src/media.jsx` | Modify (`ObservationEditor`, ~527–831) | Chip render, zero-results footer button, delete custom-input mode |

That's the whole file structure. One file, one function.

---

## Task 1: Delete the custom-input mode (state, refs, handler)

Remove all state and handlers that exist only to support the separate custom-input form. The JSX that references them is removed in Task 2, so after this task the code will not compile — Task 2 fixes it. Batch the two as one commit at the end of Task 2.

**Files:**
- Modify: `src/renderer/src/media.jsx`

- [ ] **Step 1: Delete `customSpecies` and `showCustomInput` state**

Open `src/renderer/src/media.jsx`. Locate `ObservationEditor` at line 527. Find:

```js
const [customSpecies, setCustomSpecies] = useState('')
const [showCustomInput, setShowCustomInput] = useState(false)
```

Delete both lines. Leave `searchTerm`, `debouncedSearch`, `highlightedIndex`, and `activeTab` state alone.

- [ ] **Step 2: Delete `customInputRef`**

Find:

```js
const customInputRef = useRef(null)
```

Delete the line. Leave `inputRef` and `rowRefs` alone.

- [ ] **Step 3: Simplify the focus effect**

Find the focus-on-mount effect (currently lines 553–562):

```js
useEffect(() => {
  if (activeTab === 'species') {
    if (showCustomInput && customInputRef.current) {
      customInputRef.current.focus()
    } else if (inputRef.current) {
      inputRef.current.focus()
    }
  }
}, [showCustomInput, activeTab])
```

Replace with:

```js
useEffect(() => {
  if (activeTab === 'species' && inputRef.current) {
    inputRef.current.focus()
  }
}, [activeTab])
```

- [ ] **Step 4: Delete `handleCustomSubmit`**

Find:

```js
const handleCustomSubmit = (e) => {
  e.preventDefault()
  if (customSpecies.trim()) {
    handleSelectSpecies(customSpecies.trim())
  }
}
```

Delete the whole function (currently lines 615–620).

- [ ] **Step 5: Verify intermediate state**

The file will not currently build (JSX below still references the deleted symbols). This is expected. Do NOT run lint or commit yet — continue to Task 2.

---

## Task 2: Rewrite the search input header (remove custom-input ternary)

Replace the `showCustomInput ? <form> : <search>` ternary with just the search input. After this task the file compiles again.

**Files:**
- Modify: `src/renderer/src/media.jsx`

- [ ] **Step 1: Replace the input header block**

Find the whole block starting with `{/* Search/Custom input header */}` (currently around line 687) and ending at the closing `</div>` of that section (currently line 764):

```jsx
{/* Search/Custom input header */}
<div className="p-2 border-b border-gray-100">
  {showCustomInput ? (
    <form onSubmit={handleCustomSubmit} className="flex gap-2">
      {/* ... form markup ... */}
    </form>
  ) : (
    <div className="relative">
      <Search
        size={16}
        className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
      />
      <input
        ref={inputRef}
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onKeyDown={(e) => {
          // ... keydown handler ...
        }}
        placeholder="Search species..."
        className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent"
      />
    </div>
  )}
</div>
```

Replace with (keep the keydown handler logic identical — only the ternary wrapper is removed):

```jsx
{/* Search input */}
<div className="p-2 border-b border-gray-100">
  <div className="relative">
    <Search
      size={16}
      className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
    />
    <input
      ref={inputRef}
      type="text"
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
      onKeyDown={(e) => {
        // Stop Backspace/Delete from reaching the ImageModal
        // window shortcut that deletes the selected observation.
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
      placeholder="Search species..."
      className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent"
    />
  </div>
</div>
```

The Enter-key branch in this handler stays as-is for now. Task 5 extends it to handle the zero-results footer.

- [ ] **Step 2: Delete the always-on "+ Add custom species" row**

Find (around line 768–776 before edits — renumbered now):

```jsx
{/* Add Custom option */}
{!showCustomInput && (
  <button
    onClick={() => setShowCustomInput(true)}
    className="w-full px-3 py-2 text-left hover:bg-blue-50 flex items-center gap-2 text-blue-600 border-b border-gray-100"
  >
    <span className="text-sm">+ Add custom species</span>
  </button>
)}
```

Delete the whole block including the `{/* Add Custom option */}` comment.

- [ ] **Step 3: Delete the inline "Mark as blank" row**

Find (around line 778–788 before edits):

```jsx
{/* Mark-as-blank option (only when there is a species to clear) */}
{!showCustomInput &&
  bbox.observationID !== 'new-observation' &&
  bbox.scientificName && (
    <button
      onClick={handleMarkAsBlank}
      className="w-full px-3 py-2 text-left hover:bg-red-50 flex items-center gap-2 text-red-600 border-b border-gray-100"
    >
      <span className="text-sm">✕ Mark as blank (no species)</span>
    </button>
  )}
```

Delete the whole block including the comment. `handleMarkAsBlank` is still used (it'll move to the chip ✕ in Task 3), so do NOT delete the handler itself.

- [ ] **Step 4: Remove unused `Check` icon import**

`Check` was only used by the deleted form's submit button. Open the top of the file (line 1–23) and remove `Check,` from the `lucide-react` import. Result:

```js
import {
  CameraOff,
  X,
  Square,
  Calendar,
  Pencil,
  Search,
  Trash2,
  Plus,
  Layers,
  Play,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Heart,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Info
} from 'lucide-react'
```

Note: `X` stays — it's used elsewhere in the file (the bbox label's delete button at `media.jsx:106`-area, and we'll also use it in the chip in Task 3).

Before deleting, grep to confirm `Check` has no other uses:

```bash
grep -n "Check" src/renderer/src/media.jsx
```

Expected after Task 1+2 edits: no `Check` references remain in the file. If any remain, leave the import in place and investigate.

- [ ] **Step 5: Run lint**

```bash
npm run lint
```

Expected: PASS. If it fails on formatting, run `npm run format` and re-run lint.

- [ ] **Step 6: Commit Tasks 1 + 2 together**

```bash
git add src/renderer/src/media.jsx
git commit -m "refactor(media): delete custom-input mode from ObservationEditor

The add-custom-species flow is replaced by a query-aware zero-results
footer button (next commit). This commit removes the separate input
form, its state, and the always-on blue row."
```

---

## Task 3: Add the chip strip above the search input

Render a dismissible chip at the top of the species tab whenever `bbox.scientificName` is non-null. Clicking the ✕ calls the existing `handleMarkAsBlank`.

**Files:**
- Modify: `src/renderer/src/media.jsx`

- [ ] **Step 1: Add the chip JSX**

Locate the species tab content (currently around line 684–834, the block after `{activeTab === 'species' && (`). Directly after the opening `<>` fragment and before `{/* Search input */}`, insert:

```jsx
{/* Current classification chip */}
{bbox.scientificName && (
  <div className="p-2 border-b border-gray-100 flex items-center gap-2">
    <div
      className="flex-1 min-w-0 inline-flex items-center gap-1 px-2 py-1 rounded bg-lime-50 text-lime-700 text-sm"
      title={
        bbox.commonName
          ? `${bbox.commonName} (${bbox.scientificName})`
          : bbox.scientificName
      }
    >
      <span className="truncate">
        <span className="font-medium">
          {bbox.commonName || bbox.scientificName}
        </span>
        {bbox.commonName && (
          <span className="ml-1 italic text-lime-600/80">
            ({bbox.scientificName})
          </span>
        )}
      </span>
    </div>
    <button
      type="button"
      onClick={handleMarkAsBlank}
      aria-label="Mark as blank (no species)"
      title="Mark as blank (no species)"
      className="shrink-0 p-1 rounded text-lime-700 hover:bg-lime-100"
    >
      <X size={14} />
    </button>
  </div>
)}
```

The chip renders above the search input whenever the bbox is classified (dictionary, study-present, or custom). No chip for `new-observation` (no `scientificName`) or for previously-blanked bboxes (`scientificName: null`). The `title` attribute provides a tooltip for truncated long labels.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Start dev server and manually verify the chip**

Run:

```bash
make dev
```

In the app:
1. Open the Media tab, click a classified bbox. The picker should open with the chip at the top showing `<common name> (<scientific name>)` (scientific italicized).
2. Click the chip's ✕. Picker should close, bbox label should update to "Blank".
3. Draw a new bbox (no species). Open picker — no chip, empty focused input.
4. Click a previously-blanked bbox's picker — no chip.

If any of those fail, stop and debug before committing.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "feat(media): show current classification as a chip in picker

Dismissible chip renders above the search input whenever the bbox has
a scientificName. Clicking the ✕ writes observationType='blank' and
clears the species, replacing the inline 'Mark as blank' row that
used to live inside the results list."
```

---

## Task 4: Rewrite the zero-results empty state as a query-aware custom-add button

Replace the static "Click Add custom species" copy with an actual button that pre-fills the query and commits on click.

**Files:**
- Modify: `src/renderer/src/media.jsx`

- [ ] **Step 1: Replace the zero-results empty state block**

Find the current zero-results block (around line 827–831 after prior edits):

```jsx
{results.length === 0 && searchTerm.length >= 3 && (
  <div className="px-3 py-4 text-sm text-gray-500 text-center">
    No species found. Click &quot;Add custom species&quot; to add a new one.
  </div>
)}
```

Replace with:

```jsx
{results.length === 0 && debouncedSearch.trim().length >= 3 && (
  <div className="px-3 py-4 text-center space-y-2">
    <p className="text-sm text-gray-500">No species found.</p>
    <button
      type="button"
      onClick={() => handleSelectSpecies(customSpeciesQuery)}
      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-lime-500 text-white hover:bg-lime-600 max-w-full"
    >
      <Plus size={14} className="shrink-0" />
      <span className="truncate">
        Add &ldquo;{customSpeciesQuery}&rdquo; as custom species
      </span>
    </button>
  </div>
)}
```

Note two changes from the old block:
1. Condition uses `debouncedSearch.trim().length >= 3` instead of `searchTerm.length >= 3`. This keeps the footer in sync with what the results were computed from (the debounced value).
2. References `customSpeciesQuery` — a derived value we compute next.

- [ ] **Step 2: Derive `customSpeciesQuery`**

In `ObservationEditor`, just after the `results` `useMemo` (currently line 586–589), add:

```js
// Trimmed and single-space-collapsed query used for the custom-species
// footer button. Kept in sync with `debouncedSearch` so the button label
// matches what the results were computed from.
const customSpeciesQuery = useMemo(
  () => debouncedSearch.trim().replace(/\s+/g, ' '),
  [debouncedSearch]
)
```

- [ ] **Step 3: Guard the short-query empty-state condition**

The existing 1–2 char empty-state block uses `searchTerm.length`. For consistency with the new footer (which uses `debouncedSearch.trim().length`), update it too.

Find (current around line 822–826):

```jsx
{results.length === 0 && searchTerm.length > 0 && searchTerm.length < 3 && (
  <div className="px-3 py-4 text-sm text-gray-500 text-center">
    Type at least 3 characters to search the species dictionary.
  </div>
)}
```

Replace with:

```jsx
{results.length === 0 &&
  debouncedSearch.trim().length > 0 &&
  debouncedSearch.trim().length < 3 && (
    <div className="px-3 py-4 text-sm text-gray-500 text-center">
      Type at least 3 characters to search the species dictionary.
    </div>
  )}
```

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Manually verify**

Dev server should still be running from Task 3. If not, `make dev`.

1. In the picker, type "madeup-species-xyz". After ~150 ms debounce, the zero-results footer appears with `+ Add "madeup-species-xyz" as custom species`.
2. Click the button. Picker closes, bbox label shows `madeup-species-xyz`.
3. Reopen the picker on that bbox. Chip shows `madeup-species-xyz` (scientific-only, no parenthetical because `commonName` is null).
4. Type spaces-only in a fresh picker (`"   "`). Footer does NOT appear (short-query message shows briefly, then nothing once trim is 0).
5. Type "  hello   world  ". Footer appears with `+ Add "hello world" as custom species` (collapsed spaces).

If any fail, stop and debug before committing.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "feat(media): query-aware custom-species button in zero-results state

When a 3+ char search yields no results, the empty state shows a button
that adds the trimmed query as a custom species on one click. Replaces
the static 'Click Add custom species' copy."
```

---

## Task 5: Wire Enter-key to fire the custom-add button when there are no results

Extend the input's `onKeyDown` Enter branch so that when the results list is empty and the query is long enough, Enter commits the custom species.

**Files:**
- Modify: `src/renderer/src/media.jsx`

- [ ] **Step 1: Extend the Enter handler**

In the `onKeyDown` handler on the search `<input>` (inside the block edited in Task 2 Step 1), find the current Enter branch:

```js
if (e.key === 'Enter') {
  if (highlightedIndex < 0 || highlightedIndex >= results.length) return
  e.preventDefault()
  const picked = results[highlightedIndex]
  handleSelectSpecies(picked.scientificName, picked.commonName)
}
```

Replace with:

```js
if (e.key === 'Enter') {
  if (highlightedIndex >= 0 && highlightedIndex < results.length) {
    e.preventDefault()
    const picked = results[highlightedIndex]
    handleSelectSpecies(picked.scientificName, picked.commonName)
    return
  }
  if (results.length === 0 && customSpeciesQuery.length >= 3) {
    e.preventDefault()
    handleSelectSpecies(customSpeciesQuery)
  }
}
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Manually verify**

1. In the picker, type "madeup-species-xyz" and press Enter (without arrow-keying, since there are no results to arrow through). Bbox commits with that scientific name. Chip on next open shows scientific-only.
2. Type "jaguar" (should return real results), Enter — picks the highlighted top result as before. Sanity check that arrow-nav + Enter on results still works.
3. Type "ab" (short query) and press Enter. Nothing happens.
4. Type "    " (whitespace only) and press Enter. Nothing happens.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "feat(media): Enter commits custom species when results are empty

If no results match the 3+ char query, pressing Enter in the search
input fires the same custom-add path as clicking the footer button."
```

---

## Task 6: Full manual verification pass

Run through the spec's manual verification checklist (`docs/specs/2026-04-22-media-picker-chip-redesign-design.md` — "Manual verification" section). No code changes in this task; if a step fails, file a follow-up task and DO NOT commit.

**Files:** none.

- [ ] **Step 1: Start dev server**

```bash
make dev
```

- [ ] **Step 2: Verification matrix (all 7 spec items)**

For each, the bullet list in the spec is authoritative. Summarized:

1. **Classified bbox open.** Chip at top, search empty+focused, matching row gets `bg-lime-100` highlight.
2. **Pick a different species via search.** New classification persists; reopening shows updated chip.
3. **Chip ✕.** Picker closes, bbox label reads "Blank", reopening shows no chip.
4. **Type on a blank bbox.** Pick a result, bbox updates, chip appears on reopen.
5. **Custom species via zero-results footer.** Write succeeds, chip shows scientific-only (no parenthetical).
6. **New (just-drawn) bbox.** No chip, empty focused input, Enter-on-picked-result creates the observation.
7. **Attributes tab unchanged.** Sex / life-stage / behavior all still work.

Additional regressions to spot-check:
- Arrow-up from index 0 wraps to last.
- Arrow-down from last wraps to 0.
- Escape closes the picker.
- `Backspace` inside the search input does NOT delete the observation.
- Hover on a result row still highlights it.
- The observation-count badge + lime dot still appear on in-study rows.

- [ ] **Step 3: If anything failed**

Do NOT commit or push. Describe the failure and update the plan with a follow-up fix task. If all passed, this plan is done — proceed to whatever branch/PR workflow the user chose.

---

## Self-review notes (do not delete)

- **Spec coverage:** Chip (Task 3), chip ✕ = mark-as-blank (Task 3), empty+focused input (Task 2), zero-results footer (Task 4), Enter-commits-custom (Task 5), delete showCustomInput mode (Tasks 1+2), keyboard behavior preserved (Tasks 2+5), attributes tab untouched (no task — intentional), truncation and tooltip on chip (Task 3), "new / blank" states render no chip (Task 3 step 3 verification), no new IPC/DB/tests (no tasks — per spec).
- **Deferred items** (spec §Deferred) intentionally not implemented: two-field custom entry, pre-fill search.
