# Media Tab Redesign — Design

**Date:** 2026-06-03 (updated to reflect the shipped implementation)
**Status:** Implemented
**Branch context:** `arthur/feat-media-tab-revamp`

> This document was revised after implementation to match what actually shipped.
> The Media tab landed as a focused browser; several originally-scoped features
> (bulk operations, AI review-status, the source filter) were built then removed
> during iteration and are **not** part of the current design — see
> "Dropped during iteration" below.

## Problem

The Media tab used to be a stripped-down Explore: it reused Explore's analytical
chrome (the `SpeciesDistribution` sidebar, the timeline area chart, the circular
time-of-day clock) and dropped the map. That chrome is built for *comparing
species and exploring distributions*, not for what people open the Media tab to
do: **browse** the imagery and **review** specific captures.

It had no sorting, no way to surface media that needs attention (blank, missing
timestamp), and no clean way to land here pre-filtered from other tabs.

## Goals

- Make browsing, filtering, and sorting media fast and obvious.
- Surface media that needs attention (blank, no timestamp) as one-click views.
- Make the tab fully URL-addressable so other pages deep-link into it.

## Non-Goals

- Redesigning the media **modal** (`ImageModal` in `Gallery.jsx`). It stays the
  shared editor; both Grid and Table open it unchanged.
- Touching the Explore tab (map + analytical charts stay as they are).
- Changing the sequence-grouping logic (`sequenceGap`) — reused as-is.

## Core Decisions

| Decision | Choice |
|---|---|
| Unit of browsing | **Sequence** (existing grouping reused) |
| Layout chrome | Slim **toolbar** + a persistent **right-side filter pane** (Explore-rail style) |
| View modes | **Table** (default) ⇄ **Grid** toggle, Table on the left |
| Sorting | In Table, via clickable column headers (Type · Species · When · Deployment) |
| Filters | Species · Deployment · Media type |
| Quick views | Blank · No timestamp · Favorites (Vehicle hidden behind a flag) |
| Multi-species sequence | Show **all species** (comma-separated, common names in Title Case) |
| Row/tile click | Opens the existing media modal; modal next/prev follows the table's sort/filter order |
| Cross-tab linking | Media tab is URL-addressable; pre-filters arrive as removable toolbar chips |

## Layout

### Toolbar (always visible)

A single slim row:

- **Table ⇄ Grid** segmented control (Table first, default).
- **Quick views** button → dropdown of preset views (with counts + descriptions).
- **Active-filter chips** (removable), each tagged with a per-facet icon (paw =
  species, pin = deployment, etc.) so same-type chips read as a group. Species
  chips show the Title-Case common name; deployment chips show the location name.
- **Filters** button (right end) — toggles the filter pane; shows a dot when
  facet filters are active.

### Quick views

A dropdown (not a pill row). Each entry has a label, a one-line description, and a
count. Selecting a quick view is a **fresh preset**: it resets the facet filters
so the view shows exactly its category. Visible: **Blank**, **No timestamp**,
**Favorites**. Hidden behind a flag (query-patch + URL deep-link still work):
**Vehicle** (and the parked needs-review/reviewed/low-confidence have been removed
entirely — see "Dropped during iteration").

### Filter pane (right side)

A persistent, rounded **card** docked on the right with a gap from the table
(mirrors Explore's species rail), open by default. Animating its width pushes the
table left; the gap collapses when closed. Sections:

- **Species** — multi-select distribution (reuses `SpeciesDistribution`): dot +
  Title-Case common name + scientific name + count + proportional bar. Blank is
  selectable here too.
- **Deployment** — multi-select list. Each row shows a **detections-vs-blank
  composition bar** and the total count. Hovering a row opens a hovercard with a
  **satellite map** (the deployment marker plus faint markers for the other survey
  deployments, scroll-zoom + drag-pan enabled), a detections/blank + images/videos
  breakdown, and a **survey-wide activity heatmap** (reuses the Deployments-tab
  sparkline).
- **Media type** — Images / Videos toggle buttons (0..2 selected).

Section headers turn blue with a count badge when active; the pane closes its
hovercards on scroll.

### Table view (default)

Virtualized rows (`@tanstack/react-virtual`), one per sequence. Columns:

`thumbnail · type · species · when · deployment`

- **Type** column: a photo icon, a video icon, or the sequence (Layers) icon with
  the frame count. Sorts on media type then sequence length.
- **Species** lists every species in the sequence (comma-separated, Title-Case
  common names); a "Blank" pill when there's no detection.
- **When** shows "— missing —" for null timestamps.
- Clickable headers sort the loaded rows; the same sorted order drives the modal's
  next/prev navigation. The header sits outside the scroll container so the
  scrollbar doesn't run alongside it (a measured gutter keeps columns aligned).

### Grid view

Dense tiles (white card, light border). Each tile shows the sequence's
representative frame with the thumbnail-bbox overlay, an `N frames` badge for
multi-item sequences, and a low-res server-resized thumbnail for fast scrolling.

### Row/tile click

Opens the existing `ImageModal` for that sequence — unchanged (edit species, draw
/fix bboxes, set timestamp, favorite, navigate within sequence). Cross-sequence
next/prev follows the order the user currently sees (sorted + filtered).

## Data Layer

The tab reuses the existing `window.api.getSequences(studyId, opts)` pipeline and
its `filters` object. Implemented additions:

1. **Media-type filter** — `filters.mediaTypes: ('image'|'video')[]` matches a
   `media.fileMediatype` prefix in `getMediaForSequencePagination`.
2. **Sort** — a `sort` option (`newest`/`oldest`) on the timestamped phase; the
   Table's column sort is applied client-side over the loaded rows.
3. **Quick-view predicates** — composed from existing primitives: blank/vehicle
   via species sentinels, no-timestamp via the null-phase, favorites via
   `media.favorite`. Counts: `getBlankMediaCount`, `getVehicleMediaCount`,
   `countMediaWithNullTimestamps`, `countFavoriteMedia`.
4. **Deployment composition** — `getDeploymentDistribution` returns per-deployment
   media-level counts: total, detections (media with a real observation), blank,
   and image/video tallies. The hovercard heatmap reuses `getDeploymentsActivity`.

The generic `importFolder`/`source` filter param remains in the query layer as a
benign capability, but there is no source-filter UI.

## URL / Deep-Linking

Pre-applied params render as **removable toolbar chips**; they persist in the URL
while on the tab (shareable / back-button-friendly).

Params (all optional, composable):

- `?species=<scientificName>` (comma-list)
- `?deployment=<deploymentID>` (comma-list)
- `?mediaType=<image|video>` (comma-list)
- `?q=<blank|no-timestamp|favorites|vehicle>` (quick view)
- `?view=<grid|table>` (default `table`) and `?sort=<newest|oldest>`

### Entry points

- **Deployments** — the inline `DeploymentMediaGallery` quick-peek in the detail
  pane, plus the deep-link into `/study/:id/media?deployment=<id>`.
- **Overview / Explore** — existing species links generalize to `?species=`.

## Components

Under `src/renderer/src/media/`:

- `MediaTab.jsx` — top-level: owns filter/sort/view URL state, fetches counts,
  renders toolbar + filter pane + active view.
- `MediaToolbar.jsx` — Table/Grid toggle, Quick views, active-filter chips,
  Filters toggle.
- `QuickViews.jsx` — the quick-view dropdown.
- `FilterDrawer.jsx` — the right-side filter pane (species / deployment / media
  type), reusing `SpeciesDistribution`.
- `DeploymentHoverMap.jsx` — the deployment hovercard (satellite map + composition
  + activity heatmap).
- `MediaGridView.jsx` / `MediaTableView.jsx` — the two presentations over the
  shared `Gallery` fetch/pagination + `ImageModal`.
- `mediaFilters.js` / `quickViews.js` / `tableRows.js` — pure helpers
  (filter↔URL serialization, quick-view defs, table-row derivation), unit-tested
  under `node:test`.

Reused: `Gallery.jsx`'s `ImageModal`, sequence pagination, bbox batching;
`SpeciesDistribution`; the Deployments `Sparkline`.

## Dropped during iteration

Built during the redesign, then removed (and their dead code/queries/IPC handlers
cleaned up):

- **Bulk operations** (set species / mark blank / mark reviewed) and the selection
  / `SelectionActionBar` UI.
- **AI review status** — the needs-review / reviewed / low-confidence quick views,
  the per-sequence reviewed flag and green "reviewed" badge, and the
  low-confidence/review-status query predicates. `classificationMethod` is still
  written by the modal editor, but the Media tab exposes no review workflow.
- **Source filter** — the in-drawer source distribution UI, the `sources` filter
  state/chips, the Sources-tab "View media" deep-link, and `getSourceDistribution`.
- **Date-range + time-of-day filters** in the drawer (URL params still parsed).

## Success Criteria

- Open Media → see a sortable, virtualized table of sequences (default); toggle to
  a grid.
- One click on a quick view surfaces blanks / no-timestamp / favorites.
- Sort the table by type, species, when, or deployment; the modal navigates in
  that order.
- Filter by species, deployment, and media type from the right-side pane.
- Deep-link from Deployments lands on Media pre-scoped, with the scope shown as a
  removable chip.
