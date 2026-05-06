# AI Models tab — geographic-scope redesign

**Date:** 2026-05-05
**Status:** Design — pending review
**Area:** renderer (`src/renderer/src/models.jsx`, `src/renderer/src/settings.jsx`), shared (`src/shared/mlmodels.js`, new `src/shared/species/`)

## Summary

Replace today's flat table in Settings → AI Models with a split view: an
interactive Leaflet map on the left showing each model's coverage as a
shaded zone, a model list on the right linked to those zones by color.
The Worldwide model (SpeciesNet) is surfaced as a chip above the map
rather than painted across the whole world. Each card gains a structured
species count and an opt-in "▾ Species" panel — flat chips for small
lists (DeepFaune, Manas), search + taxonomic-class drill-down for large
ones (SpeciesNet). Today's download / delete / progress UI moves into
the cards; no IPC changes. Below ~900 px the layout stacks (map on top,
list below).

## Motivation

The current tab treats all models as equivalent rows. The single most
useful piece of information for picking a model — _which part of the
world it works on_ — is buried in description prose. Users coming to
this tab cold (typical first run, before any study exists) have no
visual cue that DeepFaune is European or that Manas is for the
Himalayas; they have to read three descriptions and reverse-engineer
the geography.

Three concrete frictions:

1. **Geography is invisible at a glance.** "European fauna" / "developed
   in Kyrgyzstan" lives inside paragraph descriptions; there's no badge,
   filter, or visualization.
2. **No structured species-coverage signal.** Users can't see how many
   species each model handles, and can't browse the actual list — both
   are decision-relevant when choosing between e.g. DeepFaune (26
   targeted European species) and SpeciesNet (2,000+ general).
3. **The recommendation moment is wasted.** Users install models _before_
   creating studies (a hard workflow constraint), so we can't infer
   their region from data. The tab itself has to do the explaining.

## Goals

- Make geographic scope the first thing a user perceives on the tab.
- Let a user identify "which model fits my region" without reading
  descriptions.
- Expose species coverage (count + list) as structured, browsable data.
- Preserve every existing management capability (download, delete,
  progress, clear all, custom-model contact) with no IPC changes.
- Keep the design coherent as we add more models or regions over time.
- Support narrow window widths (Electron content area can be < 900 px).

## Non-goals

- Auto-detecting the user's region from imported studies. Workflow
  constraint: models are picked before studies exist. Cross-tab
  recommendations (e.g. an alert at study-creation time) are a separate
  feature, not this redesign.
- Country-level filtering or a country picker. With three coverage zones
  today (Worldwide / Europe / Himalayas), the map zones themselves are
  the picker.
- Changing the model registry's source of truth. `src/shared/mlmodels.js`
  remains the canonical list; we extend its schema, not replace it.
- New IPC handlers. Download / delete / status polling reuse today's
  `model:*` handlers as-is.
- Styling for the rest of the Settings page (info tab, advanced tab) —
  out of scope.

## Layout

### Wide (≥ ~900 px) — split view

Two-column grid, ~55% map / ~45% list, equal height.

```
┌──────────────────────────────────┬───────────────────────────────┐
│ [🌍 Worldwide model available]   │ 3 models · 2 downloaded   ↗   │
│                                  │                                │
│   ┌──────────────────┐           │  ┌─────────────────────────┐  │
│   │  Leaflet map     │           │  │ ▌ SpeciesNet  Worldwide │  │
│   │  with shaded     │           │  │   v4.0.1a · 468 MB · …  │  │
│   │  region overlays │           │  │   [Delete]              │  │
│   │                  │           │  │   ▾ Browse 2,000+ …     │  │
│   │  ▒ Europe        │           │  └─────────────────────────┘  │
│   │  ▒ Himalayas     │           │  ┌─────────────────────────┐  │
│   │                  │           │  │ ▌ DeepFaune     Europe  │  │
│   │                  │           │  │   v1.3 · 1.2 GB · …     │  │
│   └──────────────────┘           │  │   [Delete]              │  │
│                                  │  │   ▾ 26 species          │  │
│   Click a zone to see its model  │  └─────────────────────────┘  │
└──────────────────────────────────┴───────────────────────────────┘
```

### Narrow (< ~900 px) — stacked

Map on top with fixed height (~220 px). Worldwide chip stays anchored
top-left of the map. List flows below, full-width, scrollable.

Tapping a map zone scrolls the list below to the matching card and
applies a brief highlight ring on that card.

The breakpoint is a starting point — tune by testing in the actual
Electron settings window with the sidebar deducted.

## The map

- **Engine:** Leaflet (already a dependency, used by `study.jsx`,
  `overview.jsx`, `activity.jsx`, `deployments.jsx`,
  `ui/PlaceholderMap.jsx`).
- **Tiles:** same Esri World Imagery layer used by the existing
  `PlaceholderMap`, for visual consistency.
- **Zoom / pan:** disabled (or strictly clamped) — the map is a
  reference visualization, not a navigation tool. Default view shows
  the full world.
- **Region overlays:** one polygon per region, drawn as semi-transparent
  filled shapes with a 2 px border in the region's color. Polygons
  come from GeoJSON shipped with the app:
  - `europe.geojson` — union of European country boundaries (Natural
    Earth low-res; ~30 KB).
  - `himalayas.geojson` — Kyrgyzstan boundary (Natural Earth) or a
    hand-drawn high-altitude Central Asian polygon. To be confirmed
    with the model author; Kyrgyzstan is the safe default.
- **Worldwide handling:** SpeciesNet does _not_ get a polygon. Painting
  the entire world would visually wash out the regional zones. Instead,
  a persistent chip sits above the map: "🌍 Worldwide model available".
  Clicking the chip selects SpeciesNet's card on the right (and scrolls
  to it on narrow layouts).
- **Interaction:**
  - Hovering a region polygon highlights the matching list card.
  - Clicking a region polygon selects (and on narrow layouts, scrolls
    to) the matching card.
  - Hovering a list card highlights its polygon.
  - On narrow widths the hover-link still works for pointer devices,
    but the primary mode is tap → scroll.
- **Color palette** (must remain distinguishable on the map fill and as
  a card border):
  - Worldwide → indigo (`#6366f1` border, `#e0e7ff` badge bg)
  - Europe → emerald (`#047857` border, `#d1fae5` badge bg)
  - Himalayas → pink (`#be185d` border, `#fce7f3` badge bg)
  - Custom → purple (`#a855f7` border, `#f3e8ff` badge bg, dashed)
  - Future regions extend this palette.

## The model list

A vertically-stacked list of cards. Order:

1. SpeciesNet (Worldwide) — first, because it's the safe default for
   anyone who doesn't have a regional fit.
2. Regional models — DeepFaune, Manas, etc. (order within this group:
   alphabetical by region label, then by model name).
3. Custom row — always last, dashed border.

### Card structure

```
┌─ 4 px colored left border (matches region) ─────────────────┐
│  [Model name] [Region badge]              [Status pill]     │
│  v · size · author · N species                              │
│  Description (1–2 lines, hidden during download)            │
│  [Action button(s)]                                         │
│  ▾ Species                                                  │
└─────────────────────────────────────────────────────────────┘
```

- **Left border** — 4 px in the region's color. Selected card gets a
  small outer shadow ring.
- **Region badge** — small pill next to the model name. Color matches
  the border / map zone.
- **Status pill** — top-right of the card.
- **Meta line** — `version · size · author · species_count`. Bold the
  species count; it's the most decision-relevant spec.
- **Description** — 1–2 lines from the existing `description` field.
  Hidden while the card is in the Downloading state to keep card
  height stable.
- **Actions** — single inline action depending on state (see below).
  Website buttons are removed (no value, takes space).
- **Species toggle** — `▾ N species` (or `▾ Browse N+ species` for the
  large case). Closed by default. Opening one auto-closes any other
  open species panel.

### Card states

**Not downloaded** — grey "Not downloaded" pill, primary `↓ Download`
button.

**Downloading** — blue "Downloading…" pill with a small spinner.
Description is hidden. Inline progress bar with `MB / total · pct%`
text and a "Cancel" link to its right. The card border (and optionally
the matching map zone) can pulse softly.

**Downloaded** — green "✓ Downloaded" pill, danger-style "Delete"
button.

**Custom** — no status pill, no meta line. Description text:
"Don't see a model that fits your region or species? We can train one
for you, or integrate yours." Single primary "✉ Get in touch" button.

### Species panel

Opt-in detail panel that expands inside the card. The panel always
shows a search/filter input at the top. Body content depends on
species count:

- **≤ ~50 species** (DeepFaune, Manas) — flat chip list. Filter input
  narrows the visible chips.
- **> 50 species** (SpeciesNet) — taxonomic-class summary rows
  (`🦌 Mammals · ~480`, `🦅 Birds · ~1,200`, etc.) with drill-down on
  click. Search input hits all species directly.

Single-open behaviour: opening one card's species panel auto-closes any
other open panel. Vertical real estate is the constraint, especially on
the stacked layout.

## Data model

### `src/shared/mlmodels.js` — extend each model entry

Add two new fields to every entry in the `modelZoo` array:

```js
{
  // …existing fields (reference, name, size_in_MB, files,
  //                  downloadURL, description, website, logo,
  //                  detectionConfidenceThreshold)…

  region: {
    id: 'europe',         // 'worldwide' | 'europe' | 'himalayas' | …
    label: 'Europe',
    color: '#047857',     // border / badge / map fill (alpha applied at render time)
    geojson: 'europe.geojson',  // path under src/shared/regions/, omit for 'worldwide'
  },

  species_count: 26,      // number, OR string for approximate ('2,000+')
  species_data: 'deepfaune.json',  // path under src/shared/species/
}
```

Custom-model row is **not** part of `modelZoo` (it isn't a real model).
It stays a hardcoded entry in the renderer, as today.

### Per-model assignments (initial)

| Model      | region.id   | region.label | species_count | Source for species list        |
| ---------- | ----------- | ------------ | ------------- | ------------------------------ |
| SpeciesNet | `worldwide` | Worldwide    | `'2,000+'`    | Google's published labels file |
| DeepFaune  | `europe`    | Europe       | `26`          | DeepFaune project repo         |
| Manas      | `himalayas` | Himalayas    | `11`          | OSI-Panthera (to confirm)      |

Exact `species_count` for DeepFaune and Manas to be confirmed against
their published label files before merge.

### Region GeoJSON files

Bundled under `src/shared/regions/`:

- `europe.geojson` — derived from Natural Earth Admin-0 boundaries,
  union of European countries. Low-res variant (~30 KB).
- `himalayas.geojson` — Kyrgyzstan boundary (Natural Earth) for v1.
  May be replaced later with a hand-drawn high-altitude polygon if
  OSI-Panthera prefers a different scope.

Worldwide has no GeoJSON file (it's the chip, not a polygon).

### Species JSON files

Bundled under `src/shared/species/`:

- `deepfaune.json` — flat list of 26 species (common names).
- `manas.json` — flat list of 11 species.
- `speciesnet.json` — full label list, ~2,000 entries. Each entry
  carries a taxonomic class (`mammal` / `bird` / `reptile` / etc.) so
  the rendered summary groups can be computed at load time.

Schema:

```js
// small list (DeepFaune, Manas)
{
  "species": [
    { "common": "Red fox", "scientific": "Vulpes vulpes" },
    …
  ]
}

// large list (SpeciesNet) — adds taxonomic class
{
  "species": [
    { "common": "Red fox", "scientific": "Vulpes vulpes", "class": "mammal" },
    …
  ]
}
```

Loaded via dynamic `import()` on first species-panel open per model,
then memoized in renderer state. No IPC, no caching layer needed.
First open shows a brief skeleton; subsequent opens are instant.

## IPC and state — unchanged

All download / delete / progress / clear-all behavior reuses today's
handlers in `src/main/ipc/ml.js`:

- `model:download`
- `model:delete`
- `model:get-download-status`
- `model:get-global-download-status`
- `model:clear-all`

The renderer's existing `useQuery` polling (every 2 s) drives the
Downloading state of each card. The sidebar tab spinner
(`isModelDownloading`) is unchanged.

## Component decomposition

Replace the monolithic `Zoo` component in `src/renderer/src/models.jsx`
with a small set of single-purpose components:

- `<MlZoo />` — top-level. Owns download-status query, selection state
  (`selectedModelId`), open-species-panel state. Computes the layout
  mode (split vs stacked) from a window-width hook. Renders
  `<MapPane />` and `<ModelListPane />`.
- `<MapPane />` — Leaflet map, region overlays, Worldwide chip.
  Receives the model list and selection callbacks. Loads region
  GeoJSON files lazily.
- `<ModelListPane />` — header (count + Clear all), ordered list of
  `<ModelCard />`, custom row at the bottom.
- `<ModelCard />` — single card. Receives a model entry, download
  status, and selection / species-toggle callbacks. Renders the
  appropriate state (Not / Downloading / Downloaded). Hosts the
  species panel.
- `<SpeciesPanel />` — chip-list flavor or summary-with-drill-down
  flavor, picked from `species_count`. Owns its filter / search
  input.
- `<CustomModelCard />` — static contact CTA card.

Files (proposed, under `src/renderer/src/models/`):

```
models/
  index.jsx               // exports MlZoo
  MapPane.jsx
  ModelListPane.jsx
  ModelCard.jsx
  SpeciesPanel.jsx
  CustomModelCard.jsx
  useResponsiveLayout.js  // window-width hook → 'split' | 'stacked'
```

`src/renderer/src/models.jsx` becomes a thin re-export of
`models/index.jsx` (or is removed and the import in `settings.jsx` is
updated — preference is the latter, but defer until implementation).

## Scaling considerations (deferred — not implemented now)

The design holds for ~3–6 models cleanly. Specific affordances we'd
add as the catalog grows:

- **List grouping** by region (section headers) — kicks in once N > ~5
  or once any single region has 2+ models.
- **Compact rows by default** with click-to-expand, replacing the
  always-expanded card body — kicks in at the same threshold.
- **Search box** at the top of the list — kicks in at N > ~5.
- **Multi-model regions** — zone label shows a count ("Europe · 2");
  clicking the zone scrolls to the group with both models visible.
- **Plural Worldwide chip** — "🌍 N worldwide models" expands into a
  popover or scrolls the list.
- **Country-level granularity** (e.g. one model per country): the
  shaded-zone approach falls apart. Switch to choropleth shading and
  add a country-picker filter. This is a re-architecture, not a
  scaling tweak.

None of these are built in v1. The data model (`region` object,
`species_count` field) is forward-compatible with all of them.

## Honest tradeoffs

- **The map weakens on narrow screens.** Once stacked, scrolling the
  list is faster than tap-then-scroll via the map. The map becomes
  more illustration than navigation. This is acceptable: the original
  goal — geographic context at a glance — still works in the stacked
  layout. We don't add narrow-screen-specific affordances (e.g.
  region-chip filters above the list) unless real usage shows the map
  is being ignored.
- **Region GeoJSON adds bundle weight** (~30–60 KB compressed total
  for v1). Acceptable trade for the visualization.
- **Species lists for SpeciesNet add ~50–100 KB** to the bundle.
  Acceptable. If it grows further (e.g. a model with 10,000 species),
  switch that model's species data to lazy-fetch from disk.
- **Region polygons are hand-curated, not authoritative.** "Europe" as
  a single union polygon is a visual approximation; some users may
  argue about edge cases (Russia, Turkey, Cyprus). The badge text and
  description prose disambiguate. Documenting source data origin in
  comments is sufficient — not a contract with users.

## Open questions

- **Manas species count and exact region.** OSI-Panthera should confirm
  before merge. If the region is broader than Kyrgyzstan, we replace
  the GeoJSON; the rest of the design is unaffected.
- **Worldwide chip wording.** "🌍 Worldwide model available" works for
  one model. With two it becomes "🌍 2 worldwide models" — which we'll
  cross when relevant. Implementation today writes the singular form.
- **Pulse on map zone during download.** Polish, not required. Decide
  during implementation based on whether it adds clarity or noise.
