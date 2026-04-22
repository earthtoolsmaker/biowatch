# Media-tab species picker: chip + contextual actions

**Date:** 2026-04-22
**Status:** Design — approved
**Area:** renderer (`src/renderer/src/media.jsx`, `ObservationEditor`)

## Summary

Redesign the species tab of `ObservationEditor` so the current classification
lives in a dismissible chip at the top, the search input starts empty, and
the secondary actions (mark as blank, add custom species) move out of the
results list into contextual corners. The result: a list zone that contains
only species results, one place that shows what's set, and one affordance
for each secondary action.

## Motivation

Today the picker (media.jsx:526 `ObservationEditor`) has three problems when
it opens on an already-classified bbox:

1. The "✕ Mark as blank (no species)" button sits as a full-width row at the
   top of the list even when editing a bbox whose classification the user
   just wants to change — it reads as a destructive action on equal visual
   footing with species results.
2. The search input is empty with placeholder "Search species..." regardless
   of what's already set. Users lose the sense of "what's currently
   classified" the moment the picker opens.
3. The "+ Add custom species" row is always visible and swaps the whole
   panel into a separate form — a mode-switch that's overkill for what is
   fundamentally "type a name, save it."

This redesign treats the current classification as persistent state that
stays visible, and demotes the secondary actions to the moments they
actually apply.

## Goals

- Show the current classification as a chip on top of the picker whenever
  `scientificName` is non-null (dictionary-sourced, study-present, or
  custom — any classification counts).
- Keep the search input always empty and focused on open, so typing starts a
  new search without destroying visible state.
- Move "mark as blank" onto the chip's ✕ — one destructive affordance, tied
  to the thing it destroys.
- Turn "add custom species" into a query-aware footer button shown only
  when a 3+ character search yields zero results. No separate form.
- Leave the attributes tab, write path, IPC surface, and fuzzy-search
  ranking untouched.

## Non-goals

- Two-field custom-species entry (common + scientific). Today's single
  free-form field writes to `scientificName` only; this spec keeps that
  behavior. See "Deferred" below.
- Editing species outside `ObservationEditor` (bulk edit, thumbnail
  shortcuts).
- DB, IPC, or main-process changes. Every action goes through today's
  `onUpdate` → `window.api.updateObservationClassification` path.
- Changing the fuzzy-search ranking, index, or debounce — those live in the
  in-flight plan at `docs/plans/2026-04-22-media-species-picker-fuzzy-search.md`
  and this spec assumes they land first (or merge into one implementation).

## Design choices (locked from brainstorming)

| Choice | Decision |
| --- | --- |
| Current state surface | Dismissible chip at the top of the species tab |
| Chip render condition | `bbox.scientificName` is non-null (covers dictionary, study-present, and custom-entered strings) |
| Chip label | `commonName (scientificName)` — fallback to scientific-only when no common name stored |
| Chip ✕ action | Writes `{ observationType: 'blank', scientificName: null, commonName: null }` and closes picker |
| Custom-entry visual distinction | None — a chip with scientific-only text already reads as "not a dictionary species" |
| Search input on open | Always empty, auto-focused; no pre-fill |
| "Mark as blank" alt affordance | None — chip ✕ is the only path; new/already-blank bboxes show no chip and no blank button |
| "Add custom species" affordance | Zero-results footer button with the trimmed query as its label, only when `debouncedSearch.length >= 3` and results are empty |
| Custom write payload | `{ scientificName: query.trim(), commonName: null, observationType: 'animal' }` — identical to today's custom-form submission |
| Enter key with empty results + 3+ char query | Fires the custom-add button |
| Enter key with empty results + short query | No-op |
| "No species selected" empty state | No chip, focused empty input — applies to both new bboxes and previously-blanked bboxes |

## Layout

Species tab of the picker becomes three stacked zones. Attributes tab and
outer modal layout are untouched.

```
┌──────────────────────────────────────────┐
│ [ jaguar (Panthera onca)          ✕ ]    │  ← chip, only when classified
├──────────────────────────────────────────┤
│ 🔍 Search species…                       │  ← empty, auto-focused
├──────────────────────────────────────────┤
│ jaguarundi (Herpailurus yagouaroundi)  3 │  ← ranked results
│ jaguar (Panthera onca)              ✓ 12 │  ← ✓ marks the chip's match
│ …                                        │
│                                          │
│ — no-results state (query ≥ 3, empty) —  │
│ No species found.                        │
│ [ + Add "jagur" as custom species ]      │  ← contextual, query-aware
└──────────────────────────────────────────┘
```

### Chip

- Rendered inline inside `ObservationEditor` (no new file — ~30 lines of
  JSX).
- Visual: lime-50 background, lime-700 text, rounded, sits in a new header
  strip above the search input. ✕ on the right uses the existing `X` icon
  from `lucide-react` (already imported).
- Label: `commonName (scientificName)`; falls back to scientific-only when
  `commonName` is null.
- Not rendered when `bbox.scientificName` is null, which covers:
  - New bboxes (`observationID === 'new-observation'`,
    `scientificName: null`).
  - Existing bboxes previously marked blank (`observationType === 'blank'`,
    `scientificName: null`).

### Search input

- Unchanged markup from today's search input (media.jsx:700–721) except the
  blue "+ Add custom species" row above it is deleted.
- Auto-focused on mount whenever `activeTab === 'species'`.
- `Backspace` / `Delete` keep `stopPropagation()` so the modal's
  delete-observation shortcut doesn't fire.

### Results list

- Ranked fuzzy-search results from the in-flight fuzzy-search spec (merged
  dictionary + study-present, top 50).
- Row that matches `bbox.scientificName` gets a ✓ badge on the right
  alongside the existing observation-count badge (in-study only).
- Hover highlights and keyboard highlighting behave as designed in the
  fuzzy-search spec.

### Zero-results footer

- Visible only when `debouncedSearch.trim().length >= 3` and the merged
  result list is empty.
- Copy:
  ```
  No species found.
  [ + Add "<query>" as custom species ]
  ```
- The query is shown trimmed and collapsed to single spaces. Long queries
  are truncated with ellipsis inside the button at render time (CSS
  `truncate`) rather than in the stored payload.
- Clicking the button calls `handleSelectSpecies(query.trim(), null)` and
  closes the picker.

## State changes in `ObservationEditor`

```js
// Kept (from today or from the fuzzy-search spec)
const [activeTab, setActiveTab]
const [searchTerm, setSearchTerm]
const [debouncedSearch, setDebouncedSearch]    // fuzzy-search spec
const [highlightedIndex, setHighlightedIndex]  // fuzzy-search spec
const inputRef

// Removed
const [customSpecies, setCustomSpecies]
const [showCustomInput, setShowCustomInput]
const customInputRef
```

Deleted code in media.jsx:

- `showCustomInput` state and `customSpecies` state (media.jsx:529–530).
- `customInputRef` (media.jsx:532).
- The `showCustomInput` branch of the focus effect (media.jsx:551–557).
- `handleCustomSubmit` (media.jsx:592–597).
- The `showCustomInput ? <form> : <search>` ternary (media.jsx:666–722) —
  collapses to just the search input.
- The always-on "+ Add custom species" row (media.jsx:728–735).
- The "✕ Mark as blank (no species)" row inside the list (media.jsx:
  738–747).

## Keyboard

- `ArrowDown` / `ArrowUp` — navigate `results`, wrap at ends (fuzzy-search
  spec).
- `Enter` with `highlightedIndex >= 0` — select that result (fuzzy-search
  spec).
- `Enter` with `highlightedIndex === -1` **and** the zero-results footer is
  visible — fire the custom-add button with the current trimmed query.
- `Enter` otherwise — no-op.
- `Backspace` / `Delete` in the search input — `stopPropagation()`,
  unchanged.
- `Escape` — unchanged, closes picker.
- Tab order: chip ✕ → search input → results → zero-results footer button
  (when visible). The chip ✕ is before the input so keyboard users can
  reach "mark as blank" without tabbing past the whole result list.

## Write paths

All three go through the existing `onUpdate` →
`window.api.updateObservationClassification` path. No new IPC.

| Trigger | Payload |
| --- | --- |
| Click / Enter on a result row | `{ observationID, scientificName, commonName, observationType: 'animal' }` |
| Click on zero-results footer / Enter with empty results | `{ observationID, scientificName: query.trim(), commonName: null, observationType: 'animal' }` |
| Click on chip ✕ | `{ observationID, scientificName: null, commonName: null, observationType: 'blank' }` |

The three-case discrimination in `updateObservationClassification`
(observations.js:50–68) already handles all three correctly — no
main-process change needed.

## Error handling & edge cases

- **Custom query with only whitespace.** Button is disabled (and footer
  hidden) because `debouncedSearch.trim().length >= 3` gates the footer.
- **Custom query that collides with an existing species.** Can't happen —
  if the query matches a dictionary or study entry, results are non-empty
  and the footer isn't shown. If the collision is a near-miss that fuse
  doesn't rank, the custom entry still succeeds and creates a duplicate;
  same behavior as today.
- **Chip ✕ on a bbox whose `observationType` is already `'blank'`.** Can't
  happen — no chip is rendered in that case.
- **Chip ✕ on a `new-observation` bbox.** Can't happen — no
  `scientificName`, no chip. If the user opens a fresh bbox picker and
  closes without picking, nothing is written (today's behavior).
- **Chip label for a custom species with no common name stored.** Falls
  back to scientific-only, same as today's row rendering.
- **Very long chip labels.** CSS `truncate` with a tooltip on hover
  (existing `title` attribute pattern in media.jsx).
- **`results` empty because `speciesList` hasn't loaded yet.** Footer hides
  until `debouncedSearch.length >= 3` anyway; the short-query empty state
  from the fuzzy-search spec shows its existing "type at least 3
  characters" copy.

## Testing

### Unit tests

No new `dictionarySearch` tests — that's the fuzzy-search spec's surface.
This spec's logic is UI behavior in a React component; the existing test
suite has no component-level coverage of `ObservationEditor`, and
introducing it for one feature is out of scope.

### Manual verification

Required before claiming the feature is done (CLAUDE.md):

1. Open the Media tab, click a classified bbox.
   - Chip shows `commonName (scientificName)` at the top.
   - Search input is empty and focused.
   - The row matching the chip is highlighted with ✓ in the results list.
2. Type a new species name → Enter.
   - Picker writes the new classification and closes.
   - Reopen the picker: chip now shows the new species.
3. Click the chip's ✕.
   - Picker closes.
   - Bbox label now reads "Blank".
   - Reopen the picker: no chip, empty input.
4. On a blank bbox, type "aardvark" → Enter on the result.
   - Bbox label updates, chip appears on next open.
5. Type a species not in the dictionary or study (e.g. "madeup-species").
   - Zero-results footer shows `+ Add "madeup-species" as custom species`.
   - Click it → bbox gets that string as `scientificName`, `commonName`
     null.
   - Reopen: chip shows scientific-only (no parenthetical).
6. On a new (just-drawn) bbox, open picker.
   - No chip, empty input, focused.
   - Type + Enter writes a fresh observation as today.
7. Attributes tab, sex/life-stage/behavior selectors: unchanged.

### No e2e tests

No existing e2e coverage of `ObservationEditor`; not added for this
feature.

## Deferred

- **Two-field custom entry (common + scientific).** Today's custom-species
  flow writes user input to `scientificName` regardless of whether the
  user typed a common name. Users who want explicit control need a
  two-field form. Noted during brainstorming; punted because the existing
  flow has this same ambiguity and users have been living with it.
- **Pre-fill the search with the current species name.** Discussed as
  approach B; rejected because a pre-filled input conflates "search" with
  "edit this text" and risks users wiping the current value by starting to
  type without noticing the pre-selection.
