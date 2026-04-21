# Common-Name Resolution: Robustness Redesign

**Date:** 2026-04-21
**Status:** Design

## Problem

The app displays common names (e.g. "Eurasian Red Squirrel") alongside scientific names (e.g. *Sciurus vulgaris*) in the overview, species distribution, and media views. Common names come from two sources:

1. **Imported data.** CamtrapDP, WildlifeInsights, DeepFaune, and LILA parsers populate `observations.commonName` from the source file. This is authoritative.
2. **Renderer-side GBIF lookups.** When `commonName` is missing (e.g. for ML-generated observations), `overview.jsx` and `ui/speciesDistribution.jsx` each call GBIF's `/species/match` → `/species/{usageKey}/vernacularNames` and pick the first entry with `language === "eng"`.

Source (2) is broken in two ways:

- **GBIF's `language` field is unreliable.** For *Sciurus vulgaris* (usageKey 8211070), GBIF returns multiple entries tagged `language: "eng"` that are actually Spanish ("Ardilla roja", "Ardilla Roja de Eurasia") or French ("Ecureuil d'Eurasie"), because source providers (Catalogue of Life, EUNIS, etc.) mis-tag the field. `find(name.language === "eng")` picks the first mis-tagged entry. The genuinely English entries ("Eurasian Red Squirrel") exist further down the list.
- **ML inference leaves `commonName` null.** `prediction.js insertPrediction` / `insertVideoPredictions` parse the scientific name but do not set `commonName`. The burden falls entirely on the renderer's GBIF lookup for every ML-generated observation.

Additional problems:

- Two near-identical GBIF lookup implementations in the renderer (`overview.jsx:182-221` and `ui/speciesDistribution.jsx:7-120`).
- In-memory cache at module level dies on reload; every session re-fetches.
- DeepFaune/Manas emit non-binomial labels ("chamois", "bird") that GBIF cannot match at all.
- User edits via the custom-entry form (`media.jsx handleCustomSubmit`) pass only `scientificName`; this defaults `commonName` to `null` in `handleSelectSpecies` and overwrites any existing value.

## Goals

- Show the correct English common name for species like *Sciurus vulgaris* where GBIF mislabels entries.
- Remove runtime dependence on GBIF for species that are covered by a shipped dictionary.
- Persist common names on observations when we have an authoritative source (import, dictionary hit at write time).
- Eliminate duplicate GBIF code in the renderer.
- Keep the app working offline for the common case.
- Avoid stale common names after a user edits the species.

## Non-goals

- A database table for caching GBIF lookups. Keep the GBIF cache in memory only for now; revisit if we see issues.
- A background worker that pre-resolves all species after import. Not needed at current scale.
- Fixing GBIF's upstream data quality. We route around bad data, we don't correct it.
- Supporting non-English common names. English only.

## Design

### Architecture — four-tier cascade

A common name is resolved in this priority order:

1. **Stored `observations.commonName`** (authoritative: set by the import parser, the ML write path via dictionary, or a picker-list user edit).
2. **Shared dictionary** (`src/shared/commonNames/dictionary.json`) — scientific name → common name.
3. **GBIF with improved English-detection scorer** — read-path only, renderer only, in-memory cache.
4. **Scientific name itself** — ultimate fallback.

Tiers 1 and 2 run in the main process at write time (insert and update) and persist to `observations.commonName`. Tiers 3 and 4 run in the renderer at read time only; GBIF results are never persisted.

### Shared layer — `src/shared/commonNames/`

**`dictionary.json`** — single map of `{ normalizedScientificName → commonName }`.

- Generated at build time by `scripts/build-common-names-dict.js`, committed to the repo.
- Seeded from four sources merged in priority order: SpeciesNet < DeepFaune < Manas < `extras.json`. Later sources override earlier ones on conflict.
- Keys are normalized: trimmed, lowercased, NFC-normalized, internal whitespace collapsed.
- Contains both binomial scientific names (e.g. `"sciurus vulgaris"`) AND raw non-binomial model labels (e.g. `"chamois"`, `"bird"`) so that write-path lookups succeed for DeepFaune/Manas.
- Expected size: ~3,000–5,000 entries, a few hundred KB.

**`extras.json`** — hand-maintained overrides and additions.

- Format: `{ "sciurus vulgaris": "Eurasian Red Squirrel", ... }`.
- Two purposes: (a) fix known-bad GBIF cases where even the scorer gets it wrong, (b) add species that appear in imported data but aren't in any model's label list.
- Starting entries include *Sciurus vulgaris* (the known-bad case).

**`resolver.js`** — exports `resolveCommonName(scientificName) → string | null`.

- Pure, synchronous, no network.
- Normalizes input (trim, lowercase, NFC, whitespace collapse) and looks up in the dictionary.
- Returns null on miss.

**`gbifScorer.js`** — exports `pickEnglishCommonName(vernacularResults) → string | null`.

- Takes the raw `results` array from GBIF's `/vernacularNames` endpoint.
- Scores candidates with `language === "eng"` using signals gathered from the design-time audit (see "Scorer design" below).
- Returns the highest-scored candidate, or null if nothing scores positively.

### Build script — `scripts/build-common-names-dict.js`

- Reads SpeciesNet's shipped taxonomy file (in the Python environment), DeepFaune's label file, Manas's label file, and `extras.json`.
- Merges in priority order (SpeciesNet < DeepFaune < Manas < extras).
- Normalizes keys.
- Writes `src/shared/commonNames/dictionary.json`.
- Run manually when any of the sources change. The CI coverage test (below) catches drift.

### Write paths

**`src/main/services/prediction.js`** — `insertPrediction`, `insertVideoPredictions`:

- After parsing `scientificName` (existing logic, unchanged), call `resolveCommonName(scientificName)` and persist the result to `observations.commonName` alongside `scientificName`.
- If the resolver misses, `commonName` stays null. The renderer's read path handles it.

**Import parsers** (`camtrapDP.js`, `wildlifeInsights.js`, `deepfaune.js`, `lila.js`):

- **Unchanged.** Imported `commonName` is authoritative; we do not second-guess source files.

**`src/main/database/queries/observations.js`** — `updateObservationClassification`:

The IPC contract now distinguishes three cases by the combination of `scientificName` and `commonName` values in the update payload:

- **Picker-list selection** — `scientificName` is a non-empty string AND `commonName` is a non-null string. Save both as-is. This is the picker's existing behavior for rows selected from the species list.
- **Custom entry** — `scientificName` is a non-empty string AND `commonName` is null (or the key is absent). Save `scientificName`; set `commonName` to null. Rationale: the picker's single-input form cannot tell whether the user typed a scientific or common name, so any auto-resolved `commonName` would risk a wrong pairing. The read path's cascade will either find a dictionary match (if the user typed a canonical scientific name), fetch a candidate from GBIF (whose `/species/match` endpoint does accept common-name queries), or fall back to displaying what the user typed — never worse than today.
- **Species cleared** — `scientificName` is null or empty. Clear `commonName` to null as well. Prevents stale pairings surviving a species removal.

Note: the current code uses `!== undefined` to decide whether to apply each field. The new logic replaces that with explicit null-vs-string discrimination so that the custom-entry case (which passes `commonName: null` via `handleSelectSpecies`'s default parameter) is handled correctly rather than being treated as "skip this field".

### Picker (`src/renderer/src/media.jsx`)

- **List selection** (user picks an existing species from the dropdown) — unchanged. Both `scientificName` and `commonName` are known from the DB row and passed to `handleSelectSpecies`.
- **Custom entry** (`handleCustomSubmit`) — unchanged in UX (single input). Already calls `handleSelectSpecies(customSpecies.trim())` with no `commonName`. The update mutation now correctly clears `commonName` to null (via the main-process logic above) instead of leaving stale values.
- No new inputs. No auto-detection. Simple.

### Renderer read path — `src/renderer/src/utils/commonNames.js` (new)

**`useCommonName(scientificName, { storedCommonName }) → string | null`** React hook:

1. If `storedCommonName` is present → return it.
2. Else run `resolveCommonName(scientificName)` (synchronous dictionary lookup) → return if hit.
3. Else enqueue GBIF fetch via TanStack Query (matches codebase style, gets request dedup and retry for free).
4. While GBIF pending → return `scientificName`.
5. On GBIF success → run `pickEnglishCommonName` on the results, cache in module-level `Map`, return.
6. On GBIF failure / no match → cache null, return `scientificName`.

Call sites updated to use the hook:

- `src/renderer/src/overview.jsx` — remove `fetchGbifCommonName` (lines 182-221), remove inline scientific-to-common map logic.
- `src/renderer/src/ui/speciesDistribution.jsx` — remove `fetchCommonName` (lines 65-120) and `commonNamesCache` module variable (line 8).

### Scorer design (GBIF English-detection fix)

The scorer is the trickiest piece and must be designed against real data, not first principles.

**Design-time audit (before writing the scorer):**

1. Assemble `scripts/audit-set.txt` — 200–300 scientific names. Composition:
   - All DeepFaune labels (~25).
   - All Manas labels (~30).
   - ~150 SpeciesNet species sampled across taxonomic classes (mammals, birds, reptiles) and biogeographic regions (Neotropical, Palearctic, Nearctic, Afrotropical).
   - ~30-50 "high-risk" species known to produce multilingual-name-noisy GBIF responses (common European mammals with EUNIS entries; widely-introduced species like *Sciurus*, *Rattus*, *Mustela*; species with strong Spanish/Portuguese/French common names).

2. Run `scripts/explore-gbif-vernaculars.js` against the audit set. For each species, dump the full GBIF response to `scripts/output/gbif-dumps/` (gitignored).

3. Human review of raw data. Identify the signals that distinguish real English entries from mis-tagged ones. Candidates include:
   - `source` field string (ITIS, "Mammal Species of the World", "Catalogue of Life" are typically reliable; EUNIS, national checklists are often the mis-taggers).
   - `preferred: true` flag (when present).
   - Character composition of `vernacularName` (Spanish/French diacritics — `ñ`, `é`, `ô` — are a strong signal of non-English content).
   - Entry position in results.
   - Entry frequency across multiple independent sources.

4. Design the scoring function from the observed data. Implement. Capture fixture files in `test/fixtures/gbif/` from the tricky cases.

**Scoring function shape (to be refined by the audit):**

- Start with candidates where `language === "eng"`.
- Additive scoring across signals weighted by how well they separate real from mis-tagged in the audit data.
- Reject candidates containing non-English diacritics.
- Return highest-scored; null if nothing scores positive.

### Data flow summary

**Flow 1 — ML inference writes observation:**
```
Python server → prediction JSON
  → parseScientificName()                  [unchanged]
  → resolveCommonName(scientificName)      [new, dictionary]
  → persist scientificName + commonName (null on miss)
```

**Flow 2 — User edits species:**
```
Picker list selection (both known):
  → save scientificName + commonName as-is

Picker custom entry (single input, intent unknown):
  → save scientificName = typed value
  → clear commonName to null

Species cleared:
  → clear both
```

**Flow 3 — Renderer displays species:**
```
Query row { scientificName, commonName }
  → useCommonName(scientificName, { storedCommonName: commonName })
    1. storedCommonName? return it.
    2. Dictionary hit? return it.
    3. GBIF fetch (TanStack Query). While pending: return scientificName.
       - Scorer picks best English candidate.
       - Cache in module-level Map.
    4. GBIF miss / failure: return scientificName.
```

### Error handling & edge cases

- `scientificName` null/empty → resolver returns null immediately.
- Author citations ("Sciurus vulgaris Linnaeus, 1758") are NOT stripped — kept as a known limitation; the dictionary will miss and the GBIF fallback runs. Revisit if we actually see importer output with author citations.
- Genus-only names → dictionary may or may not cover them; GBIF fallback catches the gap.
- Non-binomial model labels ("chamois", "bird") → dictionary must include them as keys; enforced by the coverage test.
- GBIF network error / timeout / non-200 → fall back to scientific name, log once per species per session.
- Malformed GBIF response → treat as miss.
- GBIF whitelisted in CSP already (`renderer/index.html:9`). No CSP changes.
- Concurrent requests for the same species → TanStack Query dedupes natively.

## Testing strategy

**Unit tests (CI):**

1. `resolver.test.js` — `resolveCommonName` with known keys, model labels, normalization cases (whitespace, case), null input, misses.
2. `gbifScorer.test.js` — `pickEnglishCommonName` with captured GBIF fixtures. Must return "Eurasian Red Squirrel" for the Sciurus vulgaris fixture, not "Ardilla Roja". Additional fixtures captured during the design-time audit.
3. `useCommonName.test.js` — hook tests: stored name shortcut, dictionary hit, GBIF fallback, GBIF failure.
4. `dictionary.integrity.test.js` — no duplicate keys, no empty/whitespace values, all keys follow canonical normalization.
5. `dictionary.coverage.test.js` — every label across SpeciesNet, DeepFaune, and Manas has a dictionary entry. Fails with readable diff listing missing species.

**Integration tests (CI):**

6. Write-path integration:
   - `insertPrediction` → assert `observations.commonName` populated from dictionary.
   - `updateObservationClassification` picker-style (both provided) → both saved.
   - `updateObservationClassification` custom-entry (scientificName only) → scientificName saved, commonName cleared.
   - `updateObservationClassification` species cleared → both cleared.
   - Existing CamtrapDP / WildlifeInsights import tests unchanged.

**On-demand scripts (not CI):**

7. `scripts/explore-gbif-vernaculars.js` — fetches raw GBIF data for the audit set; output in gitignored `scripts/output/`. Used at design time and when revising the scorer.
8. `scripts/audit-common-names.js` — runs the scorer against the audit set, outputs CSV of `scientificName, selectedName, top3Candidates, dictionaryEntry`. Used during review to identify cases needing `extras.json` entries or new fixtures.

## Implementation order

Staged so quick wins land first:

1. **Shared dictionary + resolver** (no behavior change yet). Build script, `dictionary.json`, `resolver.js`, integrity test, coverage test.
2. **Wire dictionary into ML write path.** `prediction.js` resolves and persists `commonName`. Fixes the "ML observations have no common name" bug.
3. **Wire dictionary into update path.** `updateObservationClassification` clears `commonName` on custom-entry edits; picker-list edits unchanged.
4. **Design-time GBIF audit.** Assemble audit set, run exploration script, review raw data, design scorer.
5. **Renderer cascade module + hook.** Build `useCommonName`, `gbifScorer.js`, fixture tests. Replace the two inline GBIF implementations.
6. **Polish: `extras.json` entries** from audit findings (Sciurus vulgaris and siblings).

Each step is independently shippable; the cascade degrades gracefully at each intermediate state.

## Open questions

None. Scope is settled.
