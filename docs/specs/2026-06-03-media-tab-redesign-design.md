# Media Tab Redesign — Design

**Date:** 2026-06-03
**Status:** Approved design, pending implementation plan
**Branch context:** `arthur/feat-media-tab-revamp`

## Problem

The Media tab today is a stripped-down Explore: it reuses Explore's analytical
chrome (the `SpeciesDistribution` sidebar panel, the timeline area chart, and the
circular time-of-day clock as the primary filter surface) and simply drops the
map. That chrome is built for *comparing species and exploring distributions*, not
for the two jobs people actually open the Media tab to do:

1. **Review / verify** AI classifications and bounding boxes (a QA workspace).
2. **Browse** the imagery — find interesting, rare, or specific captures (a
   photo-library feel).

It also has no sorting, no way to surface media that *needs attention* (blank,
missing timestamp, low confidence), no bulk operations, no review-status
indication, and no clean way to land here pre-filtered from other tabs.

## Goals

- Make browsing, filtering, and sorting media fast and obvious.
- Support both jobs: fast visual scanning **and** efficient correction.
- Surface media that needs attention (blank, no timestamp, low confidence,
  vehicle, needs-review) as one-click views.
- Add bulk operations for QA at scale (relabel, mark blank, mark reviewed).
- Show whether a human has reviewed each sequence.
- Make the tab fully URL-addressable so other pages deep-link into it.

## Non-Goals

- Redesigning the media **modal** (`ImageModal` in `Gallery.jsx`). It stays the
  shared editor; both Grid and Table open it unchanged.
- Touching the Explore tab (map + analytical charts stay as they are).
- Changing the sequence-grouping logic (`sequenceGap`) — reused as-is.
- A provenance/audit trail of AI-vs-human values beyond what the existing undo
  stack and `classificationMethod` already provide.

## Core Decisions

| Decision | Choice |
|---|---|
| Unit of browsing | **Sequence** (existing grouping reused) |
| Primary jobs | Review/verify **and** browse |
| Layout chrome | Slim **toolbar + collapsible Filter drawer** (no permanent side rail) |
| View modes | **Grid** (scan) ⇄ **Table** (verify) toggle |
| Sorting | Date (both directions) and Deployment. In Table, via clickable column headers; in Grid, a small sort dropdown |
| Filters | Species · Deployment · **Source** · Date · Time-of-day |
| Date filter UI | **Density histogram + brush** (reuse `TimelineChart`) with presets; time-of-day chips bundled in the same drawer panel |
| Quick views | Needs review · Reviewed · Favorites · Blank · No timestamp · Low confidence · Vehicle |
| Bulk actions | **Set species · Mark blank · Mark reviewed** |
| Review status | Derived from `classificationMethod` (`human`/`machine`); explicit **Mark reviewed** for confirm-without-change. No schema change. |
| Multi-species sequence | Show **top species + "+N"**; full set in the modal |
| Row/tile click | Opens existing media modal |
| Cross-tab linking | Media tab is URL-addressable; pre-filters arrive as removable toolbar chips |

## Layout

### Toolbar (always visible)

A single slim row:

- `⊕ Filter` button → opens the **Filter drawer**.
- **Active-filter chips** (removable): species chips carry their palette color
  dot; deployment/source/date/time render as chips too. Chips arriving from a
  deep-link look identical to ones set in-tab.
- **Sequence count** (e.g. "1,204 sequences").
- **Grid ⇄ Table** segmented control.
- In Grid mode only: a small **Sort** dropdown (Newest / Oldest / Deployment).

### Quick views (row under the toolbar)

A row of pill toggles that apply a predefined filter in one click. "Attention"
views (Needs review, Blank, No timestamp, Low confidence) use the amber accent;
neutral views (Reviewed, Favorites, Vehicle) stay plain. Each shows a count.

A quick view is a shortcut that sets the underlying filters/flags — it composes
with the other active filters rather than replacing them.

### Filter drawer

Opened by `⊕ Filter`; closed by default so the grid is full-bleed. Contains:

- **Species** — multi-select list with counts (reuse `SpeciesDistribution`'s row
  pattern: color dot, count, thin bar).
- **Deployment** — multi-select list of cameras/locations with counts.
- **Source** — multi-select list of import sources (`importFolder`) with counts.
  *New filter; see Data Layer.*
- **Date + Time of day** — a small capture-count **histogram with a draggable
  brush** (reuse `TimelineChart`) plus quick presets (All time / Last 30 days /
  Last year / Custom); below it, **Dawn / Day / Dusk / Night** time-of-day chips
  (reuse existing day-period logic).

### Grid view (browse default)

Dense tiles (white card, `rounded`, `rgba(0,0,0,.1)` border). Each tile:

- Thumbnail of the sequence's representative frame; bbox overlay with
  `species confidence` label (respects the existing thumbnail-bbox toggle).
- `N frames` sequence-count badge (top-left) for multi-item sequences.
- Review marker (top-right): green **✓** when reviewed, subtle **AI** tag when
  raw machine output, amber issue tag (e.g. "no time", "blank") when applicable.
- Footer: species color dot + name (+N for multi-species), deployment/location,
  time.

### Table view (verify)

One row per sequence. Columns:

`thumbnail · species (+N) · when · deployment · confidence · reviewed`

- Clickable headers sort by that column (asc/desc); this is the Table's sort
  mechanism. Covers the Date and Deployment sort requirements.
- "when" shows "— missing —" for null timestamps; confidence shows a small bar
  and "human" (not a probability) for human-classified rows; reviewed shows
  "✓ Reviewed" (green) or "— AI —" (muted).
- Video sequences get a ▶ marker on the thumbnail.

### Selection & bulk actions (both views)

- Checkboxes on tiles/rows; **shift-click** selects a range; a header/select-all
  affordance selects the current result set.
- When ≥1 is selected, a floating **action bar** appears with a selected count and:
  - **🏷 Set species ▾** — reclassify all selected (reuses the per-observation
    classification update; applies to each selected sequence's observations).
  - **⌫ Mark blank** — clear observations / mark as blank.
  - **✓ Mark reviewed** — flag as human-reviewed.
  - **✕ Clear** selection.

### Row/tile click

Opens the existing `ImageModal` for that sequence — unchanged (edit species, draw
/fix bboxes, set timestamp, favorite, navigate within sequence).

## Review Status

CamtrapDP fields already on `observations` carry this with **no schema change**:

- `classificationMethod` = `'machine'` (raw AI) | `'human'`
- `classifiedBy`, `classificationTimestamp`

Today, editing a species or bbox already flips an observation to
`classificationMethod='human'`, `classifiedBy='User'`. We extend this:

- **A sequence is "reviewed"** when all its (non-blank) observations have
  `classificationMethod='human'` — i.e. a human has edited or explicitly
  confirmed every detection. (Exact roll-up rule — all vs. any — to be finalized
  in the plan; default: **all** observations human.)
- **Mark reviewed** (per-item via modal + bulk via action bar) sets the existing
  observations to `classificationMethod='human'` / `classifiedBy='User'` /
  `classificationTimestamp=now` **without changing the species** — this captures
  the common "AI was right, confirmed" case.
- **Needs review** quick view = sequences with any `classificationMethod='machine'`
  observation.

## Data Layer

Most of the redesign reuses the existing `window.api.getSequences(studyId, opts)`
pipeline and its `filters` object (`species`, `dateRange`, `timeRange`,
`deploymentID`, `bbox`). New work:

1. **Source filter** — add `source` / `importFolder` to the sequences query
   filter and to the species/count aggregations. Backed by the existing
   `media.importFolder` column. Expose a list of sources with counts for the
   drawer (analogous to the species distribution query).
2. **Sort** — add a `sort` option to `getSequences` supporting
   `time` (asc/desc, existing default is time-desc) and `deployment`. Cursor
   pagination must remain correct under each sort key.
3. **Quick-view predicates** — server-side support (or composition of existing
   filters) for: needs-review, reviewed, favorites, blank, no-timestamp,
   low-confidence, vehicle. Several already exist (`getBlankMediaCount`,
   `getVehicleMediaCount`, `favorite`); add review-status and low-confidence
   predicates and the corresponding counts.
4. **Bulk operations** — bulk variants (or batched calls) of:
   - set species (existing `observations:update-classification` per observation),
   - mark blank,
   - mark reviewed (set `classificationMethod='human'` on existing labels).
5. **Review-status roll-up** — per-sequence reviewed flag derived from member
   observations' `classificationMethod`, surfaced in the sequence payload so Grid
   and Table can render it without N extra calls.

## URL / Deep-Linking

Generalize the Media tab's current `?species=` (single, consumed-then-cleared)
into a stable, fully-addressable scheme. Pre-applied params render as **removable
toolbar chips** — there is no separate "deployment mode"; clearing the chip
broadens to the whole study.

Params (all optional, composable):

- `?species=<scientificName>` (repeatable / comma-list)
- `?deployment=<deploymentID>` (repeatable)
- `?source=<importFolder>` (repeatable)
- `?view=<needs-review|reviewed|favorites|blank|no-timestamp|low-confidence|vehicle>`
- `?from=<ISO date>&to=<ISO date>` (date range)
- `?display=<grid|table>` and `?sort=<…>` (optional view state)

Unlike today, params **persist** in the URL while the user is on the tab (so the
state is shareable/back-button-friendly) rather than being cleared after applying.

### Entry points

- **Deployments** — keep the inline `DeploymentMediaGallery` quick-peek in the
  detail pane **and** add an **"Open in Media ↗"** button →
  `/study/:id/media?deployment=<id>`.
- **Sources** — add a **"View media ↗"** affordance per source row →
  `/study/:id/media?source=<importFolder>` (depends on the new Source filter).
- **Overview / Explore** — existing links retained; generalize the species link
  to the new scheme (`?species=`), KPI/media tiles to `/media`.

## Components (proposed structure)

The Media tab grows beyond a single 680-line file. Proposed decomposition under
`src/renderer/src/media/`:

- `MediaTab.jsx` — top-level: owns filter/sort/view URL state, fetches counts,
  renders toolbar + quick views + drawer + active view.
- `MediaToolbar.jsx` — filter button, active-filter chips, count, sort, view toggle.
- `QuickViews.jsx` — the preset pill row.
- `FilterDrawer.jsx` — species / deployment / source / date+time panels (reusing
  `SpeciesDistribution`, `TimelineChart`, day-period logic).
- `MediaGridView.jsx` / `MediaTableView.jsx` — the two presentations over a shared
  data hook; reuse `Gallery`'s sequence-fetching/pagination logic (extract a hook
  if needed) and open the existing `ImageModal`.
- `SelectionActionBar.jsx` — bulk action bar.
- A shared `useMediaQuery`/selection hook for filter→query state and multi-select.

Existing reused pieces: `Gallery.jsx`'s `ImageModal`, sequence pagination, bbox
batching; `SpeciesDistribution`, `TimelineChart`, `clock`/day-period utils;
`useDateRange`, `useSequenceGap`, `useShowThumbnailBboxes` hooks.

## Risks / Open Questions

- **Reviewed roll-up rule** (all vs. any observations human) — pick in the plan;
  default "all".
- **Bulk set-species semantics** on multi-species sequences — does it relabel
  every observation, or only the dominant one? Likely: apply to the selected
  sequences' observations matching the displayed top species; confirm in plan.
- **Sort + cursor pagination** correctness under `deployment` sort.
- **Quick-view + filter composition** — confirm each quick view composes with
  active filters rather than resetting them.
- Performance of source/review-status aggregations on large studies (e.g. GMU8
  Leuven) — reuse the sequence-aware, indexed query patterns.

## Success Criteria

- Open Media → see a full-bleed grid of sequences; toggle to a sortable table.
- One click on a quick view surfaces blanks / no-timestamp / low-confidence /
  needs-review.
- Sort by date and by deployment.
- Filter by species, deployment, source, date (histogram+brush), time-of-day.
- Select many sequences and relabel / mark blank / mark reviewed in one action.
- See at a glance which sequences are human-reviewed.
- Deep-link from Deployments and Sources lands on Media pre-scoped, with the
  scope shown as a removable chip.
