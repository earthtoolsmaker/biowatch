# Species tooltip descriptions — design

**Date:** 2026-04-27
**Status:** Approved (pending implementation plan)

## Goal

Extend the species hover tooltip in the overview tab to show, in addition to the existing image and species name:

- A short text description (1–2 sentences, ~250 chars)
- The IUCN Red List conservation status as a colored badge
- A fallback image when the study has no "best media" for that species

## Non-goals

- Live API calls from the rendered app at view time
- Per-study cached species metadata (data is global, not study-scoped)
- Multi-language descriptions (English only for v1)
- Editorial review tooling (descriptions can be hand-edited directly in the JSON for now)

## Background

The tooltip lives in `src/renderer/src/ui/SpeciesTooltipContent.jsx`. It currently shows a `cached-image://` thumbnail of the study's best image for that species, the common name (resolved through a four-tier cascade: stored → dictionary → GBIF → scientific), and the scientific name as a footer.

The codebase already ships a static species dictionary at `src/shared/commonNames/dictionary.json` (~2,540 entries, ~112KB, bundled into the renderer JS). Common-name lookups follow a "static JSON + pure synchronous resolver" pattern (`src/shared/commonNames/resolver.js`). This design extends that pattern to a second reference file covering descriptions, IUCN status, and fallback images.

The current shipped demo dataset (Kruger, v1.7.2) uses real Latin binomial names and includes a `commonName` column, so lookups will resolve cleanly without normalization.

## Architecture

A **build-time script** generates a static JSON of species reference data. The runtime tooltip reads it via a pure synchronous resolver — no API calls during normal app use.

```
┌────────────────────────────────────────────────────────────┐
│  BUILD TIME (run manually, periodically)                   │
│                                                            │
│  scripts/build-species-info.js                             │
│    ├─ reads dictionary.json keys                           │
│    ├─ pre-filters non-species (rank keywords, single word) │
│    ├─ for each candidate:                                  │
│    │    ├─ GBIF /species/match  → usageKey + rank          │
│    │    ├─ skip if rank ∉ {SPECIES, SUBSPECIES}            │
│    │    ├─ GBIF /species/{key}/iucnRedListCategory         │
│    │    └─ Wikipedia /page/summary/{name}                  │
│    │         → blurb, thumbnail URL, page URL              │
│    └─ writes src/shared/speciesInfo/data.json              │
│                                                            │
│  Idempotent · resumable · diff-friendly                    │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼  (committed JSON)
┌────────────────────────────────────────────────────────────┐
│  RUNTIME                                                   │
│                                                            │
│  src/shared/speciesInfo/index.js                           │
│    resolveSpeciesInfo(scientificName) → { iucn, blurb,     │
│                                  imageUrl, wikipediaUrl }  │
│    Pure, synchronous, lowercase-keyed lookup               │
│                                                            │
│  SpeciesTooltipContent.jsx                                 │
│    ├─ existing image (from study) OR fallback imageUrl     │
│    ├─ existing species name footer                         │
│    ├─ NEW: blurb (1–2 sentences)                           │
│    └─ NEW: IUCN status badge                               │
└────────────────────────────────────────────────────────────┘
```

### Boundaries

- The script owns all external HTTP. The runtime never calls GBIF or Wikipedia for this feature.
- The resolver is pure (synchronous, no I/O). Trivially unit-testable.
- The tooltip component grows by ~30 lines but its responsibility doesn't change — it still renders species reference UI.

## Components

### `scripts/build-species-info.js` (new, ~250 lines)

CLI:

```
node scripts/build-species-info.js [--limit N] [--resume] [--force] [--dry-run]
```

Pipeline:

1. Load existing `src/shared/speciesInfo/data.json` (if any) into memory for resume support.
2. Read keys from `src/shared/commonNames/dictionary.json` → candidate list.
3. **Pre-filter (cheap, no API):** drop single-token keys and any matching `/\b(species|family|order|class|genus|subfamily|suborder|superfamily)\b/`. Knocks out a few hundred non-species entries before any network call.
4. For each candidate, in serial with a polite ~200ms delay:
   - `GET https://api.gbif.org/v1/species/match?name=<n>` → `{ usageKey, rank, matchType }`
   - Skip if `rank` ∉ `{SPECIES, SUBSPECIES}` or `matchType === 'NONE'`. Optionally skip `FUZZY` matches below a confidence threshold (decide during implementation; default: keep all non-`NONE` matches).
   - `GET https://api.gbif.org/v1/species/<usageKey>/iucnRedListCategory` → `{ category }` if present (404 is acceptable; not all species have an IUCN record).
   - `GET https://en.wikipedia.org/api/rest_v1/page/summary/<encoded scientific name>` → `{ extract, thumbnail.source, originalimage.source, content_urls.desktop.page }`.
   - Merge into output map. A species is recorded even if some fields are missing (UI handles partial data).
5. Write `data.json` pretty-printed (sorted keys, 2-space indent) for clean diffs.
6. Print a summary: total candidates, kept, skipped (with per-reason counts), and a diff vs. previous run (added / removed / changed entries).

Resilience:

- Each candidate's three network calls are wrapped with a small retry/backoff (e.g. 3 attempts, exponential).
- On any unrecoverable failure, log and continue — partial data is better than no data.
- `--resume` skips entries already present in the existing JSON unless `--force` is passed.
- A SIGINT mid-run flushes in-memory progress to disk before exiting.

### `src/shared/speciesInfo/data.json` (new, ~600KB once populated)

Format:

```json
{
  "panthera leo": {
    "iucn": "VU",
    "blurb": "The lion is a large cat of the genus Panthera, native to Africa and India...",
    "imageUrl": "https://upload.wikimedia.org/.../320px-Lion_waiting_in_Namibia.jpg",
    "wikipediaUrl": "https://en.wikipedia.org/wiki/Lion"
  },
  "acinonyx jubatus": {
    "iucn": "VU",
    "blurb": "The cheetah is a large cat...",
    "imageUrl": "https://upload.wikimedia.org/.../320px-...jpg",
    "wikipediaUrl": "https://en.wikipedia.org/wiki/Cheetah"
  }
}
```

Lowercase scientific name as key, matching `dictionary.json` convention. Any of `iucn`, `blurb`, `imageUrl`, `wikipediaUrl` may be omitted; the UI renders the corresponding element only when present. The file is hand-editable — if a Wikipedia summary is awkward or the wrong page, edit the JSON and commit.

### `src/shared/speciesInfo/index.js` (new, ~30 lines)

```js
import data from './data.json' with { type: 'json' }

export function resolveSpeciesInfo(scientificName) {
  if (!scientificName) return null
  return data[scientificName.toLowerCase().trim()] ?? null
}
```

Mirrors `resolveCommonName` in `src/shared/commonNames/resolver.js`. Pure, synchronous, importable from both renderer and main process.

### `src/renderer/src/ui/SpeciesTooltipContent.jsx` (modified)

Changes:

- Call `resolveSpeciesInfo(scientificName)` once at the top of the component.
- **Image source priority:** `imageData?.filePath` (study photo) → `info?.imageUrl` (Wikipedia thumbnail) → existing `<CameraOff>` placeholder. The current early-return on missing `filePath` (line 50–52) is removed.
- **Below the species name footer**, add (in order, each conditional on its data):
  - IUCN badge: small colored pill with the category code (LC, NT, VU, EN, CR, EX). Color mapping: LC=green, NT=yellow, VU=orange, EN=red, CR=darkred, EX=black, DD/NE=gray.
  - Blurb paragraph: 3-line clamp with `line-clamp-3`, small text.
  - "Read more on Wikipedia" link to `info.wikipediaUrl`, opens externally (uses the existing external-link IPC pattern). Doubles as attribution.
- Tooltip width grows from `w-[280px]` to `w-[320px]` to accommodate the text comfortably.

### Tests

- **`src/shared/speciesInfo/index.test.js` (new):** unit tests for the resolver — hit, miss, case-insensitivity, leading/trailing whitespace, null/empty/undefined input.
- **`scripts/build-species-info.test.js` (new):** unit tests for the pre-filter regex and the rank-skip logic. Network calls mocked; no live HTTP in tests.
- **Manual smoke test** (added to manual QA checklist): launch packaged app, import demo dataset, hover `Panthera leo` in the overview tab, confirm blurb + VU badge + Wikipedia link render correctly.

## Data flow

### Tooltip render

1. User hovers a species name in the overview tab → existing `Tooltip.Trigger` fires.
2. `SpeciesTooltipContent` mounts → calls `resolveSpeciesInfo(scientificName)` once.
3. Image source resolves in priority order: study `filePath` → `info?.imageUrl` → placeholder.
4. Footer renders: existing common+scientific name → IUCN badge (if `info.iucn`) → blurb (if `info.blurb`) → "Read more on Wikipedia" link (if `info.wikipediaUrl`).

### Script run

1. Operator runs `node scripts/build-species-info.js` (optionally `--resume` after a previous interrupted run).
2. Script reads dictionary, pre-filters, fetches per species, writes JSON, prints diff.
3. Operator reviews the diff (any concerning changes? bad Wikipedia mappings? fix inline) and commits the updated `data.json`.

## Failure modes

### Runtime

| Condition | Behavior |
|---|---|
| Scientific name absent from `data.json` AND study has `filePath` | Tooltip shows study image + name only (today's behavior). |
| Scientific name absent from `data.json` AND study has no `filePath` | Tooltip shows `<CameraOff>` placeholder + name. **Behavior change:** today the tooltip returns `null` and does not render at all. New behavior renders an info-only tooltip — desirable since users still get the name and (when present) the IUCN badge / blurb. |
| Entry exists but `iucn` missing | No badge rendered. |
| Entry exists but `blurb` missing | No description paragraph. |
| Entry exists but `imageUrl` 404s at runtime | Existing `onError` handler on the `<img>` falls back to `<CameraOff>`. |
| `cached-image://` cannot fetch the Wikipedia URL (offline, blocked) | Same `onError` fallback. |

### Script

| Condition | Behavior |
|---|---|
| GBIF or Wikipedia 5xx for a single candidate | Retry with backoff; on final failure, log and skip. Partial entry still recorded if any of the three calls succeeded. |
| Network drop mid-run | SIGINT flushes progress; `--resume` continues from where it stopped. |
| Wikipedia returns a disambiguation page | Blurb is still recorded but may be suboptimal — operator can hand-edit `data.json`. |
| Rate limited | Polite default delay (~200ms). If still hit, retry/backoff handles it. |

## Build & packaging

The runtime resolver imports `data.json` via the JSON import attributes syntax already used for `dictionary.json`:

```js
import data from './data.json' with { type: 'json' }
```

This causes Vite to inline the JSON into the renderer JS bundle at build time. `electron-builder.yml` excludes `src/*` from the production package (line 8), but Vite's output in `out/` is what gets packaged — which contains the inlined JSON. So **no electron-builder changes are required**; bundling is automatic, identical to how `dictionary.json` ships today.

The renderer JS bundle grows by approximately 600KB. Acceptable for a desktop app.

### Build verification

To prove the data actually ships in production:

1. Run `npm run build`.
2. Grep the renderer chunk in `out/` for a known unique substring from one of the blurbs (e.g., a fragment of the lion entry).
3. Optionally automate this in CI as a guard against future build-config changes that might inadvertently strip the JSON.

A manual QA step also confirms the tooltip renders correctly in the packaged app for at least one species from the demo dataset.

## Documentation updates

Per `CLAUDE.md`'s documentation maintenance rules, the following docs need updating during implementation:

- `docs/architecture.md` — note the new shared module under `src/shared/speciesInfo/` and the data-flow diagram if affected.
- `docs/data-formats.md` — describe the `data.json` shape and its provenance.
- `docs/development.md` — add a section on running `scripts/build-species-info.js` and when to refresh the dataset.

## Open questions

None blocking. Items for the implementation plan to nail down:

- Exact pixel/typography choices for the IUCN badge palette (use existing Tailwind tokens where possible).
- Whether to also store `imageAttribution` (photographer + license) per entry — not strictly required by Wikipedia's terms when linking back to the page, but a tooltip-level "via Wikipedia" link covers the attribution obligation. Plan implementation accordingly.
- Whether `--force` should refetch all entries or only ones older than N days. Default to "refetch all when re-run" for simplicity.

## Risk summary

- **Bundle bloat:** +600KB to renderer JS. Mitigated by the size being small for a desktop app and by the alternative (`extraResources` + runtime path resolution) being more complex than the savings warrant.
- **Stale data:** static JSON drifts from reality (IUCN status changes, Wikipedia article updates). Mitigated by easy re-run of the script and the diff-friendly format making changes obvious.
- **Wikipedia article quality:** occasional dry/awkward intros. Mitigated by hand-editable JSON.
- **Disambiguation:** Wikipedia may return the wrong page for ambiguous names. Mitigated by operator review of script diff output and hand-edits.
