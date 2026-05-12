# IUCN Rationale in Species Tooltip — Design

## Goal

Surface the _why_ behind a species' IUCN threat status — i.e. the IUCN Red List **rationale** prose — for species classified as Vulnerable (VU), Endangered (EN), or Critically Endangered (CR), starting from the species hover card on the Overview tab.

## Two-phase plan

The IUCN Red List Terms and Conditions (v3, May 2017) prohibit reposting or redistribution of Red List Data — including derivatives, paraphrases, or partial redistributions — without a written permission Waiver from IUCN. Bundling rationale text inside our public repo or our distributed Electron binary qualifies as redistribution. The Categories themselves (VU/EN/CR/LC/...) and bare taxon identifiers are explicitly unrestricted (Section 3).

We split delivery to respect those terms:

- **Phase 1 (this spec, ships now)**: a prominent click-through from the hover card to the official IUCN assessment page on `iucnredlist.org`. License-clean: we bundle only the IUCN taxon ID (a public identifier), the category we already have, and a direct deep link.
- **Phase 2 (queued, gated on waiver)**: if/when IUCN grants Biowatch a Waiver under Section 4, we extend the build pipeline to bundle rationale text and year, and the hover card upgrades from a click-through to inline prose. Parallel work — see "Waiver pursuit" below — does not block Phase 1.

## Phase 1 — UI

### Source of data

Bundled per VU/EN/CR species in `data.json`: the IUCN `internalTaxonId` and `assessmentId` (both stable public integers used in the canonical URL `iucnredlist.org/species/<taxonId>/<assessmentId>`). No rationale text, no year, no criteria string, no derived prose.

```json
"helarctos malayanus": {
  "iucn": "VU",
  "blurb": "...wikipedia summary...",
  "imageUrl": "...",
  "wikipediaUrl": "...",
  "iucnTaxonId": 9760,
  "iucnAssessmentId": 123798233
}
```

LC/NT/DD/NE/EW/EX entries are unchanged — we only emit these IDs for VU/EN/CR (smallest-possible surface area, and the only category set we click out from). We bundle both IDs because the full URL with both segments is the canonical form on `iucnredlist.org`; whether the taxon-only path auto-redirects to the latest assessment is unverified, and the cost of including a second integer per species is negligible.

Two top-level metadata keys also live in `data.json` (alongside the per-species map) so contributors and CI can see how stale the IUCN data is at a glance:

```json
{
  "_iucnSourceVersion": "2025-1",
  "_iucnRefreshedAt": "2026-05-02",
  "aardvark": { ... },
  ...
}
```

The script writes both fields each time it runs. `_iucnSourceVersion` comes from the IUCN export folder's filename / metadata if available; otherwise from a `--version` flag the user passes. `_iucnRefreshedAt` is the script's run date. The leading underscore signals "metadata, not a species key" so `resolveSpeciesInfo` can ignore them.

### Source data folder layout

The IUCN bulk export goes in a project-root `data/` folder, gitignored:

```
data/
  .gitkeep                                    ← committed (so the dir exists in fresh clones)
  redlist_species_data_<uuid>/                ← gitignored, downloaded by maintainer
    assessments.csv
    taxonomy.csv
    ReadMe.txt
    IUCN Red List_Terms and Conditions of Use_v3.pdf
    ...
```

The build script defaults to scanning `data/redlist_species_data_*` and using the most recent folder. `--from <path>` overrides for testing or for maintainers who keep the export elsewhere.

### Build script

New file: `scripts/build-iucn-link-id.js` (kept separate from `build-species-info.js` for clarity, since it consumes a different input and writes only one new field).

Behavior:

1. Resolve input: CLI flag `--from <path>` pointing at the IUCN export folder; default to the most recent `data/redlist_species_data_*` folder.
2. Stream `assessments.csv` (use a CSV streaming parser — the file is ~156 MB).
3. For each row whose `redlistCategory` is in {Vulnerable, Endangered, Critically Endangered}, keep `scientificName` (lowercased), `internalTaxonId`, `assessmentId`, and `yearPublished` (used only to resolve duplicate-row tiebreaks; not written to `data.json`). Discard everything else — no rationale, no criteria, no other text fields.
4. Reuse the existing alias map from `build-species-info.js` (extract `buildAliasMap` to a shared util module so both builders import it) so snake_case dictionary keys (`hatinh_langur`) resolve to their binomial.
5. For each entry in `data.json` whose `iucn ∈ {VU, EN, CR}`, set both `iucnTaxonId` and `iucnAssessmentId` if a match is found; remove both fields otherwise (idempotent re-run). Where the CSV contains multiple rows for the same taxon, keep the row with the highest `yearPublished`.
6. Atomic write (temp file + rename), same pattern as the existing builder.
7. Update `_iucnSourceVersion` (from `--version <id>` if passed, else inferred from the folder name) and `_iucnRefreshedAt` (today's ISO date) at the top of `data.json`.
8. Print a summary: matched / unmatched counts, sample of unmatched names, source version, refresh date.

The CSV folder stays gitignored (`data/redlist_species_data_*/`); only the resulting `data.json` is committed. **No IUCN prose, summaries, paraphrases, or other rationale-derived text is ever written into the repo or the bundled app under Phase 1.**

### UI changes — `src/renderer/src/ui/SpeciesTooltipContent.jsx`

When `iucnTaxonId` is present (which by construction means the species is VU/EN/CR), insert a single new section directly under the name + badge row, **above** the Wikipedia blurb:

```
┌────────────────────────────────┐
│   [image]                       │
├────────────────────────────────┤
│  Common Name (Scientific)  [VU] │
│                                 │
│ ┃ Why threatened?               │  ← left bar in IUCN category color
│ ┃ View IUCN Red List            │     visually weighted call-to-action
│ ┃ assessment ↗                  │     opens iucnredlist.org in browser
│                                 │
│ Sun bears are the smallest      │  ← Wikipedia blurb, unchanged
│ bears, found in tropical        │     same line-clamp-5 + Show more
│ forests of Southeast Asia...    │     toggle as today
│ Show more                       │
│ Read on Wikipedia ↗              │
└────────────────────────────────┘
```

Specifics:

- The "Why threatened?" block uses a left-edge color bar matching `IucnBadge`'s palette for the species' category (yellow VU, orange EN, red CR), and a slightly heavier text weight than the body to signal importance.
- The block as a whole is the link target — clicking anywhere in it opens `https://www.iucnredlist.org/species/<iucnTaxonId>/<iucnAssessmentId>` in the user's default browser. Implemented as a regular `<a target="_blank" rel="noopener noreferrer">`; the existing `setWindowOpenHandler` in `src/main/app/lifecycle.js` routes external URLs through `shell.openExternal`, same as the existing "Read on Wikipedia" link.
- Cursor `pointer`, hover state lightens the left-edge bar, focus-visible ring for keyboard users.
- The Wikipedia "About" section is **unchanged** when `iucnTaxonId` is present — full body text, expand/collapse "Show more" toggle, "Read on Wikipedia" link all behave identically to today. Both the IUCN CTA and the Wikipedia blurb stay useful: the CTA explains _why threatened_, the Wikipedia blurb gives general species context.
- For LC/NT/DD/NE/EW/EX species (no `iucnTaxonId`): tooltip renders identically to today — only the IUCN CTA is conditional; the rest of the layout doesn't depend on threat status.

### Acceptance criteria — Phase 1

1. `data.json` contains `iucnTaxonId` and `iucnAssessmentId` for ≥260 of the 288 currently-threatened entries (target ~90%; direct binomial match alone gives 86%, alias map adds the rest). No other IUCN-sourced fields are added.
2. Build script logs match-rate and unmatched names; running it twice in a row produces an identical `data.json`.
3. Hover card on a known threatened species (Giant Panda, Sun Bear) shows the "Why threatened?" call-to-action above the Wikipedia "About" block; the Wikipedia blurb itself is unchanged (same size, same expand/collapse toggle, same "Read on Wikipedia" link).
4. Clicking the call-to-action opens the correct species page on `iucnredlist.org` in the default browser.
5. Hover card on a Least-Concern species (e.g. Eastern Spinebill) is visually identical to current behavior.
6. No rationale prose, summaries, or any other IUCN text fields appear in the repo or the bundled app.

### File-touch list — Phase 1

- **New**: `data/.gitkeep` (so a fresh clone has the directory ready for the maintainer's IUCN export).
- **New**: `scripts/build-iucn-link-id.js`.
- **Edit**: extract `buildAliasMap` from `scripts/build-species-info.js` into a shared util (e.g., `scripts/lib/aliases.js`) so both builders consume it; update `build-species-info.js` to import from there.
- **New**: tests for the new builder (parser, latest-year tiebreak, idempotency, alias resolution).
- **Edit**: `package.json` — add `iucn-link-id:build` script.
- **Edit**: `src/shared/speciesInfo/data.json` — populated by the build script (committed artifact); gains the per-species ID fields plus the two top-level `_iucnSourceVersion` / `_iucnRefreshedAt` metadata keys.
- **Edit**: `src/shared/speciesInfo/resolver.js` — extend the JSDoc return shape to include `iucnTaxonId` and `iucnAssessmentId`. Skip the `_`-prefixed metadata keys when iterating species (no logic change otherwise; the resolver looks species up by name, so leading-underscore keys are naturally excluded).
- **Edit**: `src/renderer/src/ui/SpeciesTooltipContent.jsx` — render the "Why threatened?" call-to-action, demote the Wikipedia blurb when `iucnTaxonId` is present.
- **Edit**: `.gitignore` — add `data/redlist_species_data_*/` (and keep `!data/.gitkeep` if necessary).
- **Edit**: `docs/development.md` — document the IUCN CSV download workflow, the `data/` folder convention, and the new build script.

### Refresh flow

The IUCN bulk export is account-bound and not redistributable, so only contributors who have downloaded their own copy can refresh the IUCN link IDs. The committed `data.json` is the canonical artifact for everyone else.

| Action                                                         | Requires                                                                                              | Who can do it                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Use the committed `data.json` (run the app, ship a build)      | Nothing                                                                                               | Anyone — clone the repo and you're done                 |
| Refresh GBIF + Wikipedia fields (`npm run build:species-info`) | Network access                                                                                        | Anyone — the script hits live APIs that don't need auth |
| Refresh IUCN link IDs (`npm run iucn-link-id:build`)           | A logged-in IUCN account that requested a bulk export, with the resulting folder placed under `data/` | Only contributors with their own download               |

Recommended cadence: rerun `iucn-link-id:build` when IUCN publishes a new Red List version (typically once or twice a year — versions are tagged like "2024-1", "2024-2", "2025-1"). The two `_iucnSourceVersion` / `_iucnRefreshedAt` metadata fields in `data.json` make it easy to see at a glance whether a refresh is overdue. New species added to the camera-trap dictionary between IUCN refreshes simply won't have an `iucnTaxonId` in the meantime — the hover card falls back to its non-threatened layout, and a maintainer with the export catches them up on the next refresh.

CI does not run either build script. CI consumes the committed `data.json` as-is. There's no special CI permission, no IUCN token in CI secrets, and no fetch step in the build pipeline.

## Phase 2 — Inline rationale (queued behind waiver)

If IUCN grants a redistribution Waiver, the work to upgrade is small relative to Phase 1:

- Extend the build script to also extract `rationale` (HTML-entity-decoded) and `yearPublished` for the same VU/EN/CR rows. Add `iucnRationale` and `iucnAssessmentYear` to the relevant `data.json` entries (the `iucnTaxonId` / `iucnAssessmentId` fields from Phase 1 are reused for the linkback URL).
- Replace the click-through call-to-action with inline prose: a "Why threatened" section showing the rationale text with the same line-clamp-6 + "Show more" expand pattern the Wikipedia blurb already uses, followed by an attribution footer "Source: IUCN Red List, <year> assessment ↗" linking to the assessment URL.
- Visual structure (left bar, eyebrow, "About" demotion) carries over from Phase 1 unchanged.

Phase 2 is a separate spec at the time work begins; it depends on a written Waiver from IUCN being on file in the repo (committed to `docs/legal/iucn-redistribution-waiver-YYYY-MM-DD.pdf`), so future contributors can verify the basis for the bundled prose.

## Waiver pursuit (parallel to Phase 1)

Send a request to `redlist@iucn.org` describing Biowatch and asking for a Section 4 Waiver to redistribute rationale text for threatened species in the bundled app, with attribution and deep-link to each assessment. Brief outline:

- Identity: Biowatch, an open-source Electron desktop application for camera-trap researchers and conservation operators.
- Use: non-commercial, conservation/research/education aligned with IUCN's mission.
- Scope: rationale text for the ~290 VU/EN/CR species detected in the camera-trap species dictionaries we ship; not the full Red List dataset.
- Display: shown only on user hover over a species in the app; attribution `Source: IUCN Red List, <year> assessment` always rendered alongside, with a clickable link to the official assessment page.
- Distribution: open-source repo on GitHub + signed Electron binaries on macOS/Windows/Linux.

This is a separate, async track — Phase 1 ships independently. Track the waiver request status in a private project note (not committed) so we know whether/when Phase 2 can proceed.

## Out of scope (explicit non-goals)

- Showing the IUCN criteria code (e.g., "VU A2cd+3cd"). Useful to specialists, noise to most users; revisit later.
- Showing population trend, threats list, habitat fields, range, or any other CSV-only fields. Even those that are individually short are still IUCN data subject to Section 4.
- Live IUCN API integration. The bulk CSV is the v1 source for the taxon IDs; switching to API later is a non-breaking swap of the build script.
- Translating rationale into other languages.
- Per-region (subpopulation / regional) assessments. Only the global latest assessment is referenced.
