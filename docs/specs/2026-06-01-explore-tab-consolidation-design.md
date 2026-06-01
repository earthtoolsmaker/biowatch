# Explore tab — consolidating map + media gallery

**Date:** 2026-06-01
**Status:** Approved design, ready for implementation plan

## Summary

Rework the current **Activity** tab into a single **Explore** tab that can show
the **species map**, the **media gallery**, or **both** via a view toggle. The
sequence-gap slider and temporal-filter controls move into a top control bar
("above the map"). The species rail (which is both the map legend and the
species filter) stays on the right, collapsible, and the layout is responsive.

This is a *soft* consolidation: the existing separate **Media** tab is left
**untouched** for now — a proper Media rework comes later. The Explore tab
gains the gallery by **reusing** the existing `Gallery` / `GalleryDisplayStrip`
components, so `media.jsx` is not modified.

## Motivation

`src/renderer/src/activity.jsx` (the Activity page) and
`src/renderer/src/media.jsx` (the Media page) are already structurally
near-identical: both render a `flex-1` main pane next to a right rail
containing `SpeciesDistribution`, plus the same collapsible temporal-filter
row, and both pull the same filter hooks (`useDateRange`, `useSequenceGap`,
`useShowFilterCharts`). The map page renders `SpeciesMap` in the main pane; the
media page renders `Gallery`. Folding the gallery into the Activity page is
therefore mostly a view-switch over a pane that already shares all its
filtering state.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Tab name | **Explore** (rename from "Activity") |
| Default view | **Map** (no persistence; opens on Map each time) |
| Old Media tab | **Left untouched** — stays a separate tab/route for now |
| Species rail placement | **Right**, collapsible (it is the map legend + species filter) |
| Filter controls (gap slider, temporal toggle) | Move into a **top control bar** above the content |
| "Both" arrangement | Side-by-side on wide screens; **responsive** below |

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ [Sequence gap ──●──] [⏱ Temporal filters]   [Map|Gallery|Both] ⟷│  ← top control bar
├──────────────────────────────────────────────────────────────┤
│                                              │                 │
│            MAP  /  GALLERY  /  BOTH          │  Species rail   │  ← main content (swaps)
│                                              │  (legend+filter)│
│                                              │  collapsible ⟷  │
├──────────────────────────────────────────────────────────────┤
│ ▾ Temporal-filter row — clock radar/line + timeline (collapsible)│  ← constant across views
└──────────────────────────────────────────────────────────────┘
```

- **Top control bar** (new): holds the `SequenceGapSlider`, the
  `FilterChartsToggle` (temporal filters), and a new **view toggle**
  segmented control `[Map | Gallery | Both]`, plus the species-rail
  collapse control. These controls currently live in the right rail
  (above `SpeciesDistribution`); they move up so they apply visibly to the
  whole content area.
- **Main content** swaps on the view toggle:
  - **Map** — `SpeciesMap` (or `PlaceholderMap`) in the main pane.
  - **Gallery** — `Gallery` in the main pane; `GalleryDisplayStrip`
    (gallery-specific display controls) shown contextually above/with the
    gallery.
  - **Both** — map and gallery share the main pane (see Responsive).
- **Species rail** (right, `w-xs`): `SpeciesDistribution`. Shown in all three
  views (it filters the gallery too), collapsible via the `⟷` control to
  reclaim width.
- **Bottom temporal-filter row**: the existing collapsible row
  (`CircularTimeFilter` / `DailyActivityRadar` / `DailyActivityLine` +
  `TimelineChart`), unchanged, gated by `showFilterCharts`. Constant across
  all views — filters apply to whatever pane(s) are visible.

## View toggle

- New component, e.g. `src/renderer/src/ui/ViewModeToggle.jsx` — a small
  segmented control with values `'map' | 'gallery' | 'both'`.
- State held in the Explore page via `useState('map')` (default Map). **Not
  persisted** — matches the "Map default" decision; no per-study storage.
- Below the `lg` breakpoint, **`both` is not offered**; the toggle shows only
  `[Map | Gallery]`. If the viewport shrinks while `both` is active, fall back
  to `map`.

## Responsive behavior

Targets Tailwind breakpoints (the project uses Tailwind):

| Width | Behavior |
|---|---|
| `≥ 2xl` (≥1536px) | "Both" = map and gallery **side-by-side**; species rail visible → up to 3 columns, comfortable. |
| `lg`–`xl` (1024–1535px) | "Both" available but map and gallery **stacked vertically** (map top, gallery below) so neither is cramped; species rail stays. |
| `< lg` (<1024px) | "Both" hidden; single view (Map ⇄ Gallery). Species rail collapses to an on-demand drawer/popover (`☰`). |

Map-only and Gallery-only views fill the available width at every size.

## State & data flow

No new state plumbing for filters. The Explore page already owns (or will own,
after merging the gallery in) the shared filter state via the existing hooks:

- `useDateRange(studyId)` — date-range brush
- `useSequenceGap(studyId)` — sequence-gap slider (drives both map heatmap and
  gallery queries; already in both pages' query keys)
- `useShowFilterCharts(studyId)` — temporal-row visibility
- `useAreaFilter` — map viewport area filter (map only)
- `selectedSpecies` / `speciesDistributionData` — species rail selection

Because the gallery already reads these same hooks today, rendering `Gallery`
inside the Explore page means the existing filters drive it automatically —
the species selection, date range, time-of-day filter, and sequence gap all
apply to the gallery with no extra wiring.

## Scope / what changes

**In scope:**
- `src/renderer/src/activity.jsx` — becomes the Explore page: add the view
  toggle, lift gap-slider + temporal toggle into a top control bar, render
  `Gallery` / `GalleryDisplayStrip` in the gallery/both views, make the
  rail collapsible, add responsive behavior.
- New `ViewModeToggle` component.
- `src/renderer/src/study.jsx` — rename the "Activity" `Tab` label to
  "Explore" (route can stay `/study/:id/activity` to avoid breaking links, or
  add `/explore` with a redirect — to be decided in the plan).
- Docs: update `docs/architecture.md` if the tab/route changes.

**Explicitly out of scope (YAGNI / per decisions):**
- `src/renderer/src/media.jsx` and the **Media** tab — left untouched.
- `Gallery`, `GalleryDisplayStrip`, `SpeciesDistribution`,
  `SpeciesMap` internals — reused as-is.
- View-mode persistence across sessions.
- Deduplicating the shared filter scaffolding between `activity.jsx` and
  `media.jsx` (deferred to the future Media rework).

## Risks / open points for the plan

- **`activity.jsx` is large (~1200 lines).** Adding a view switch + gallery
  risks bloating it further. The plan should consider extracting the
  map pane, gallery pane, and top control bar into focused subcomponents so
  the Explore page stays a readable orchestrator.
- **Route renaming** vs. keeping `/activity` — decide in the plan; prefer
  keeping the route to avoid breaking deep links, only changing the label.
- **`GalleryDisplayStrip` placement** in the new top-bar world — it's
  gallery-specific, so it should appear only when the gallery is visible
  (gallery/both views), not in map-only.

## Testing

- Manual/visual: toggle Map / Gallery / Both; confirm filters (species, date,
  time-of-day, sequence gap) apply to both panes; confirm rail collapse;
  confirm responsive breakpoints (≥2xl side-by-side, xl stacked, <lg single +
  drawer, Both hidden).
- Confirm the **Media** tab still works unchanged.
- Existing tests must still pass (`npm test`).
