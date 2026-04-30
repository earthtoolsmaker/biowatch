# Media-tab grid cell: timestamp overlay + slim species footer

**Date:** 2026-04-30
**Status:** Design — approved
**Area:** renderer (`src/renderer/src/media.jsx` — `ThumbnailCard`, `SequenceCard`; `src/renderer/src/utils/speciesFromBboxes.js`)

## Summary

Tighten the media-tab grid cell so the time information moves to a small
overlay on the image (top-left, mirroring the existing video play badge),
and the footer collapses from two lines to one. The footer keeps a
capitalized species sentence with `×N` occurrence counts — the same
information density the modal already shows.

## Motivation

The grid cell footer currently renders two stacked lines:

```jsx
<div className="p-2">
  <h3 className="text-sm font-semibold truncate">
    <SpeciesLabel names={getSpeciesListFromBboxes(bboxes, media.scientificName)} />
  </h3>
  <p className="text-xs text-gray-500">
    {media.timestamp ? new Date(media.timestamp).toLocaleString() : 'No timestamp'}
  </p>
</div>
```

Three issues:

1. The `toLocaleString()` timestamp ("4/30/2026, 2:34:56 PM") is verbose
   and dominates the second line.
2. Two stacked text lines waste vertical space in a tightly-packed grid.
3. Species names render comma-separated with no `×N` counts — losing
   information the modal preserves via `SpeciesCountLabel`.

Additionally, `SpeciesLabel` renders the dictionary's lowercase common
names ("red deer") raw, while the rest of the app (overview,
species distribution, etc.) applies Tailwind `capitalize` to display them
title-cased.

## Goals

- Move the timestamp into a top-left overlay badge on the thumbnail
  image, formatted compactly as `Apr 30, 2:34 PM`.
- Collapse the footer to a single capitalized species line with `×N`
  per-species counts.
- Apply this identically to `ThumbnailCard` (single image) and
  `SequenceCard` (auto-cycling sequence). Sequence-card timestamp updates
  per cycled frame, matching today's footer behavior.
- Re-use the existing video-badge visual style for the new overlay so the
  grid feels consistent across image / video / sequence variants.

## Non-goals

- Modal footer / observation-rail capitalize alignment. Out of scope;
  user opted to keep this session grid-cell-only.
- Changing the bbox overlay, video play badge, sequence count badge, or
  sequence progress dots/counter. All existing overlays remain in place
  and unchanged.
- Hover-only or conditional display of the timestamp. Always visible when
  a timestamp exists.
- Localization of the timestamp format. `en-US` short style for now.
- Database, IPC, or main-process changes.

## Visual layout

The thumbnail image area uses up to four overlay corners. After this
change:

| Position      | Owner                                                             |
| ------------- | ----------------------------------------------------------------- |
| top-left      | **Timestamp overlay (new)** — every card with `media.timestamp`   |
| top-right     | Sequence count badge (existing) — sequence cards only             |
| bottom-left   | unused                                                            |
| bottom-center | Sequence progress dots / counter (existing) — sequence cards only |
| bottom-right  | Video play badge (existing) — video cards only                    |

Worst-case density: a sequence-of-videos cell shows timestamp top-left,
Layers count top-right, dots/counter bottom-center, play badge
bottom-right. All four corners populated, none overlap.

## Components

### Timestamp overlay (new, inline JSX)

Rendered inside the existing image container (`<div ref={containerRef} className="relative bg-black ...">`) of both `ThumbnailCard` and `SequenceCard`, conditional on `media.timestamp` (or `currentMedia.timestamp` for sequence) being present:

```jsx
{
  media.timestamp && (
    <div className="absolute top-2 left-2 z-20 bg-black/65 text-white px-1.5 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 backdrop-blur-[2px] tabular-nums">
      <Clock size={11} />
      <span>{formatGridTimestamp(media.timestamp)}</span>
    </div>
  )
}
```

Styling notes:

- `bg-black/65` (slightly lighter than the video badge's `bg-black/70`) so
  the timestamp reads as secondary chrome rather than a primary action
  indicator.
- `backdrop-blur-[2px]` for legibility over busy frames.
- `tabular-nums` keeps digits aligned as the value changes (visible while
  a sequence cycles).
- `Clock` icon imported from `lucide-react` (already used elsewhere in
  the renderer).

When `media.timestamp` is null/undefined, the overlay is omitted entirely
— no "No timestamp" placeholder. The slim footer below already conveys
the cell's content.

### Slim species footer

The footer collapses from two lines to one, keeps the existing wrapper,
and adds `capitalize`:

```jsx
<div className="p-2">
  <h3 className="text-sm font-semibold truncate capitalize">
    <SpeciesCountLabel entries={getSpeciesCountsFromBboxes(bboxes, media.scientificName)} />
  </h3>
</div>
```

`SpeciesCountLabel` is already exported from `ui/SpeciesLabel.jsx` and
renders `Red Deer ×2 · European Hare`-style output. The `×N` span and the
`·` separator have no letters and so are unaffected by the parent
`capitalize` transform.

For `SequenceCard`, the helper differs (needs to span all frames) — see
below.

### `getSpeciesCountsFromSequence` (new)

In `src/renderer/src/utils/speciesFromBboxes.js`, add a counts variant
that mirrors `getSpeciesListFromSequence`:

```js
/**
 * Counts use the MAX bbox occurrence per species across frames — sequences
 * are usually bursts of the same scene, so summing would over-count the
 * same animals seen in multiple frames. Max gives the conservative
 * "at least N individuals present in the sequence" estimate.
 *
 * @param {Array<{mediaID: string, scientificName?: string}>} items
 * @param {Object<string, Array<{scientificName?: string}>>} bboxesByMedia
 * @returns {Array<{scientificName: string, count: number}>}
 */
export function getSpeciesCountsFromSequence(items, bboxesByMedia) {
  const maxCounts = new Map()
  for (const item of items) {
    const itemBboxes = bboxesByMedia[item.mediaID] || []
    const frameCounts = new Map()
    for (const b of itemBboxes) {
      const name = b.scientificName
      if (!name) continue
      frameCounts.set(name, (frameCounts.get(name) || 0) + 1)
    }
    for (const [name, count] of frameCounts) {
      maxCounts.set(name, Math.max(maxCounts.get(name) || 0, count))
    }
  }
  if (maxCounts.size > 0) {
    return Array.from(maxCounts, ([scientificName, count]) => ({ scientificName, count }))
  }
  // Fallback: distinct fileScientificName across items, count = 1 each
  const fallback = [...new Set(items.map((i) => i.scientificName).filter(Boolean))]
  return fallback.map((scientificName) => ({ scientificName, count: 1 }))
}
```

Used in `SequenceCard`'s footer:

```jsx
<SpeciesCountLabel entries={getSpeciesCountsFromSequence(sequence.items, bboxesByMedia)} />
```

### `formatGridTimestamp` (new, small utility)

A tiny pure formatter, defined either inline at the top of `media.jsx` or
in a small `utils/formatTimestamp.js` (preferred — easier to test
in isolation):

```js
const GRID_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

export function formatGridTimestamp(timestamp) {
  return GRID_TIMESTAMP_FORMATTER.format(new Date(timestamp))
}
```

Output example: `Apr 30, 2:34 PM`.

## Data flow

Unchanged. Bboxes still arrive via the existing `thumbnailBboxesBatch`
TanStack query, the `media` object still carries `timestamp`,
`scientificName`, `filePath`. No new IPC, no new query.

## Tests

`test/renderer/speciesFromBboxes.test.js` (existing file):

- `getSpeciesCountsFromSequence` returns counts grouped by species across
  all frames in the sequence.
- Returns count = 1 fallback entries from item-level `scientificName` when
  no bboxes carry species.
- Returns `[]` when neither bboxes nor items have species.

`test/renderer/formatTimestamp.test.js` (new, if utility lives in its
own file):

- Formats a known timestamp to the expected `MMM D, h:mm A` shape.
- Single test is enough; the formatter is one `Intl.DateTimeFormat` call.

No new tests for the JSX changes themselves — the visual layout is the
kind of thing covered by manual verification in the running app, and
the existing test suite has no `ThumbnailCard` / `SequenceCard` rendering
tests today.

## Verification

1. Run `npm run dev` and navigate to the media tab.
2. Confirm:
   - Single image card: timestamp shows top-left, footer is one line with
     capitalized species names + `×N` counts.
   - Video card: timestamp top-left, play badge bottom-right, both
     visible.
   - Sequence card (≤ 8 items): timestamp top-left, Layers count
     top-right, progress dots bottom-center, footer one line. Timestamp
     value updates as the sequence auto-cycles.
   - Sequence card (> 8 items): same as above but with `n/N` counter
     instead of dots.
   - Card with `media.timestamp = null`: no overlay rendered, footer
     still shows species (or "Blank" via existing `SpeciesCountLabel`
     empty-state).
3. `npm test` — `getSpeciesCountsFromSequence` and `formatGridTimestamp`
   unit tests pass.

## Files touched

- `src/renderer/src/media.jsx`
  - `ThumbnailCard` (around line 1634, footer at ~1787-1791): add
    timestamp overlay JSX inside the image container; rewrite the footer
    block.
  - `SequenceCard` (around line 1801, footer at ~2046-2051): same
    treatment, using `currentMedia.timestamp` and
    `getSpeciesCountsFromSequence`.
  - Add `Clock` to the lucide-react import.
  - Other `toLocaleString()` callers in the file (around lines 273, 472,
    522, 1042) belong to the inline editor / modal — leave untouched.
- `src/renderer/src/utils/speciesFromBboxes.js`
  - Add `getSpeciesCountsFromSequence`.
- `src/renderer/src/utils/formatTimestamp.js` (new) — single helper.
- `test/renderer/speciesFromBboxes.test.js` — counts-from-sequence cases.
- `test/renderer/formatTimestamp.test.js` (new) — one test.

## Deferred

- Apply the same `capitalize` treatment to the modal / observation-rail
  species labels for consistency. Trivial follow-up; user explicitly
  scoped this session to grid cells.
- Localized timestamp formatting. Today's app is en-US throughout; revisit
  if/when locale support is added project-wide.
- Hover-only timestamp / conditional suppression on busy sequences.
  Default to always-visible; reconsider if the all-corners-populated case
  feels too dense in practice.
