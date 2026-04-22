# Media-tab species picker: dictionary-backed fuzzy search

**Date:** 2026-04-22
**Status:** Design — approved
**Area:** renderer (`src/renderer/src/media.jsx`, new helper)

## Summary

Upgrade the species picker inside `ObservationEditor` (Media tab) from a plain
substring filter over study-present species to a ranked fuzzy search that
merges study-present species and the bundled scientific-name dictionary.
Users can search by common name or scientific name, keyboard-navigate ranked
results, and pick species that don't yet exist in the study.

## Motivation

Today the picker (`src/renderer/src/media.jsx:526` `ObservationEditor`) only
surfaces species that have already been classified in the current study. A
user correcting a detection to a species that has never been labelled in the
study must type it manually via the "Add custom species" escape hatch, which
invites typos and breaks the common-name display cascade. The app already
ships a ~2.5k-entry `scientificName → commonName` dictionary at
`src/shared/commonNames/dictionary.json`, used at display time only. This
feature wires the dictionary into the picker so any proper species is one
fuzzy search away.

## Goals

- Fuzzy-match typed queries against both common and scientific names.
- Rank study-present species above dictionary-only species on ties.
- Filter out non-species dictionary entries (higher taxa, generic words).
- Keep the existing attributes tab, custom-species form, and mark-as-blank
  behavior untouched.
- No main-process or IPC changes.

## Non-goals

- Editing species outside `ObservationEditor` (grid-level bulk edit, keyboard
  shortcuts on thumbnails, etc.).
- Changing the DB schema, IPC surface, or observation write path.
- Allowing higher-taxa picks from the dictionary (`"accipiter species"`,
  `"accipitridae family"`). Users who need these still have the "Add custom
  species" form.
- Server-side or persistent search index. The dictionary ships in the
  renderer bundle and is indexed in memory.

## Design choices (locked from brainstorming)

| Choice | Decision |
| --- | --- |
| Ranking | Single merged list, study-present gets a score boost |
| Row layout | One line: `common name (scientific name)` |
| Search library | `fuse.js` |
| Dictionary filter | Keep entries where `commonName !== scientificName` (~2105 of 2535) |
| Keyboard | Arrow keys navigate, Enter selects highlighted, no implicit custom-submit |
| Index lifetime | Dictionary Fuse is module-level (built once at import); study Fuse is rebuilt per call because the study list changes as species are added |
| Debounce | 150 ms on the search input |
| Min query length for dictionary | 3 characters |
| Result cap | Top 50 |
| Write on pick | Both `scientificName` and `commonName` |
| Merge strategy | Two Fuse queries merged in JS; study entry wins on duplicates |
| Field weighting | Equal weight on `scientificName` and `commonName` |
| Edit surface | Unchanged — wherever `ObservationEditor` already opens today |

## Architecture

Pure renderer-side feature. No main-process, IPC, or DB changes.

### New file

`src/renderer/src/utils/dictionarySearch.js` — owns the filtered dictionary,
the module-level Fuse index, and the merge+rank `searchSpecies` function.

Shape:

```js
import Fuse from 'fuse.js'
import dictionary from '../../../shared/commonNames/dictionary.json'

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
```

Below-threshold behavior preserves today's UX: with zero or 1–2 characters,
the picker shows the study's distinct species unchanged (no ranking, no
dictionary).

The dictionary Fuse index is built once at module import (~2105 entries,
one-time ~10–20 ms cost). The study Fuse is reconstructed on each
`searchSpecies` call because the study's distinct-species list grows as the
user classifies observations; study lists are typically small (< a few
hundred entries), so per-call construction is cheap.

### Modified files

- `src/renderer/src/media.jsx` — `ObservationEditor` consumes
  `searchSpecies`, adds debounce, arrow-key nav, and the new row layout.
- `package.json` — adds `fuse.js` dependency.

## UI changes to `ObservationEditor`

Scope: the species tab only (media.jsx:662–775). Attributes tab,
custom-species form, mark-as-blank, and outer modal layout untouched.

### Row layout

One line per row: `common name (scientific name)`. If `commonName` is
missing (only possible for study-present species with no common name
stored), fall back to scientific name only. Right side shows a small lime
dot + observation count for in-study entries; dictionary-only entries show
nothing on the right. Hover and the "currently selected" highlight stay as
today.

### State additions

```js
const [searchTerm, setSearchTerm]              // existing
const [debouncedSearch, setDebouncedSearch]    // NEW — 150 ms debounced
const [highlightedIndex, setHighlightedIndex]  // NEW — arrow-key cursor
```

A `useEffect` sets `debouncedSearch` to `searchTerm` after 150 ms of
inactivity.

### Results computation

Replaces the `filteredSpecies` useMemo at media.jsx:573:

```js
const results = useMemo(
  () => searchSpecies(debouncedSearch, speciesList),
  [debouncedSearch, speciesList]
)
```

### Keyboard navigation

- `ArrowDown` / `ArrowUp` — move `highlightedIndex` within
  `[0, results.length - 1]`, wrapping at ends.
- `Enter` — if `highlightedIndex !== -1`, call `handleSelectSpecies(result)`.
  If `-1`, do nothing (no implicit custom-submit).
- `Escape` — unchanged.
- `Backspace` / `Delete` in the search input — unchanged
  (`stopPropagation` so the modal's delete-observation shortcut does not
  fire).

When `results` changes via a new debounced query, reset `highlightedIndex`
to `0` if there are results, else `-1`.

### Scroll-into-view

When `highlightedIndex` changes via arrow keys, scroll the highlighted row
into view using `ref.scrollIntoView({ block: 'nearest' })`.

### Empty-state messages

- 1–2 characters typed and no study matches → "Type at least 3 characters
  to search the species dictionary."
- 3+ characters typed and zero merged results → existing copy: "No species
  found. Click 'Add custom species' to add a new one."

## Data flow on selection

No write-path changes. The existing
`handleSelectSpecies(scientificName, commonName)` at media.jsx:582 covers
both study-species and dictionary picks:

```
User presses Enter / clicks row
  → handleSelectSpecies(result.scientificName, result.commonName)
  → onUpdate({ observationID, scientificName, commonName, observationType: 'animal' })
  → window.api.updateObservationClassification(studyId, observationID, updates)
  → src/main/database/queries/observations.js:50-76 picker-selection branch
    saves both scientificName and commonName
  → DB write
  → React Query cache invalidation (already wired in commit fdfbd8d:1536-1545)
  → picker closes
```

A dictionary-picked species enters the study's `getDistinctSpecies` list
after write, so subsequent picker opens surface it with the in-study boost.

Unchanged paths: mark-as-blank, custom-species entry, sex / life-stage /
behavior attributes all bypass the ranked search and use their existing
write code.

## Error handling & edge cases

- **Dictionary JSON fails to load.** Static import bundled at build time; a
  failure would break the app entirely. No runtime handling needed.
- **Fuse index construction fails.** Not expected on a clean 2105-entry
  array; trust the library (per CLAUDE.md).
- **`speciesList` not yet loaded.** `useQuery` returns `[]` by default;
  `searchSpecies(query, [])` returns dictionary-only results — acceptable.
- **Debounced query lags keystrokes.** Intentional; arrow-key nav operates
  on the current `results`, not on `searchTerm`.
- **`results` shrinks while user is navigating.** Reset logic clamps
  `highlightedIndex` to `[0, results.length - 1]` or `-1`. No stale-index
  crash.
- **Dictionary-picked species with no common name.** Cannot happen — the
  filter guarantees `commonName !== scientificName`. The row renderer still
  has the scientific-only fallback in case the filter ever loosens.
- **Duplicate scientific name across study and dictionary.** Handled in the
  merge: study entry wins, dictionary entry skipped. User sees one row with
  the in-study badge.

## Testing

Project uses Node test runner for unit/integration and Playwright for e2e
(per CLAUDE.md). `better-sqlite3` rebuild quirk does not apply here —
renderer-only code, no native modules touched.

### Unit tests

New file `test/unit/dictionarySearch.test.js`:

1. Dictionary filter drops entries where `commonName === scientificName`
   (spot-check: `"accipitridae family"` absent, `"aburria aburri"` present).
2. `searchSpecies('', [...])` returns the study list unchanged.
3. `searchSpecies('ab', [...])` (< 3 chars) returns only study matches, no
   dictionary results.
4. `searchSpecies('wattle', [])` returns `"wattled guan"` among the top
   results (typo-tolerant fuzzy match).
5. When a species exists in both study and dictionary, the result has
   `inStudy: true` and appears as one row.
6. `searchSpecies('bird', [...])` returns at most 50 results.
7. A study match with the same raw Fuse score as a dictionary match ranks
   higher after the boost.

### Manual verification

Required before claiming the feature is done (CLAUDE.md):

1. Open the Media tab, click a detection/observation to open the picker.
2. Type a 3-letter query → dictionary matches appear mixed with study
   species, ranked sensibly.
3. Arrow keys navigate, Enter selects the highlighted row.
4. A dictionary-picked species persists: reopen the picker on another
   observation, the species now appears with the in-study badge and a
   count of 1.
5. Common-name display still works on the grid and filter chips after the
   pick (existing cascade unchanged).
6. Custom-species form and mark-as-blank still work.

### No e2e or main-process tests

No e2e coverage of `ObservationEditor` exists today; adding one just for
this feature is out of scope. Zero main-process code changes means no
main-process tests.
