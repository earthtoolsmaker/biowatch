# Media Grid Cell — Timestamp Overlay + Slim Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the media-tab grid cell's timestamp into a top-left overlay badge on the thumbnail image and collapse the two-line footer to one capitalized species line with `×N` per-species counts. Per spec at `docs/specs/2026-04-30-media-grid-cell-redesign-design.md`.

**Architecture:** Five small TDD-style tasks. Two new pure utilities (`formatGridTimestamp`, `getSpeciesCountsFromSequence`) land first with unit tests. Then the two grid cells (`ThumbnailCard`, `SequenceCard`) are updated independently — each is a self-contained edit to a single component. The final task is manual UI verification in the running app.

**Tech Stack:** React 18 + Tailwind CSS + lucide-react icons in the renderer (`src/renderer/src/`); `node:test` + `node:assert/strict` for unit tests; Electron-Vite for the dev server.

**Starting branch:** `arthur/ui-media-grid-cell-improvement` (already contains spec commit + merged origin/main).

---

## File map

| File | Change |
|---|---|
| `src/renderer/src/utils/formatTimestamp.js` | **Create** — pure formatter `formatGridTimestamp(timestamp, options?)`. |
| `test/renderer/formatTimestamp.test.js` | **Create** — one unit test asserting the output shape. |
| `src/renderer/src/utils/speciesFromBboxes.js` | **Modify** — add `getSpeciesCountsFromSequence(items, bboxesByMedia)` next to `getSpeciesListFromSequence`. |
| `test/renderer/speciesFromBboxes.test.js` | **Modify** — add a `describe('getSpeciesCountsFromSequence', …)` block with four cases mirroring the existing list-variant tests. |
| `src/renderer/src/media.jsx` | **Modify** — `ThumbnailCard` (line ~1634, footer ~1785-1792) and `SequenceCard` (line ~1801, footer ~2043-2053): insert a top-left timestamp overlay inside the image container, replace the two-line footer with a single capitalized species line using `SpeciesCountLabel`, update imports. |

The `Clock` icon is added to the existing `lucide-react` import block at `media.jsx:1-25`. `SpeciesCountLabel` and `getSpeciesCountsFromBboxes` are already exported from `ui/SpeciesLabel.jsx` and `utils/speciesFromBboxes.js` respectively — no changes needed in those files for the bbox variant.

---

## Task 1: Add `formatGridTimestamp` utility (TDD)

**Files:**
- Create: `src/renderer/src/utils/formatTimestamp.js`
- Test: `test/renderer/formatTimestamp.test.js`

The formatter wraps a single `Intl.DateTimeFormat` configured for `en-US` short style: `Apr 30, 2:34 PM`. The unit test asserts the output **shape** with a regex rather than an exact string — `Intl.DateTimeFormat` defaults to the local timezone and Node test runs in whatever TZ the dev machine is set to. Shape-matching keeps the test deterministic across machines without forcing a `timeZone: 'UTC'` option (which would diverge from the production callsite that should use local time).

### Steps

- [ ] **Step 1: Write the failing test**

Create `test/renderer/formatTimestamp.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { formatGridTimestamp } from '../../src/renderer/src/utils/formatTimestamp.js'

describe('formatGridTimestamp', () => {
  test('renders an ISO timestamp as "MMM D, h:mm AM/PM"', () => {
    const result = formatGridTimestamp('2026-04-30T14:34:56Z')
    // Shape only — actual hour depends on test runner's local timezone.
    // Examples: "Apr 30, 2:34 PM", "Apr 30, 10:34 AM", "May 1, 12:34 AM".
    assert.match(
      result,
      /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s(AM|PM)$/,
      `unexpected shape: "${result}"`
    )
  })

  test('accepts a Date instance', () => {
    const result = formatGridTimestamp(new Date('2026-04-30T14:34:56Z'))
    assert.match(result, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s(AM|PM)$/)
  })
})
```

Note the `\s` between `:mm` and `AM|PM` — `Intl.DateTimeFormat` may emit either a regular space or a narrow no-break space (U+202F) depending on the ICU version; `\s` matches both.

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test test/renderer/formatTimestamp.test.js
```

Expected: failure on import — `Cannot find module '.../utils/formatTimestamp.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/renderer/src/utils/formatTimestamp.js`:

```js
/**
 * Compact "MMM D, h:mm AM/PM" formatter used by the media-tab grid cell
 * timestamp overlay. Pure, no React, safe to unit-test.
 *
 * Uses the runtime's local timezone — camera-trap timestamps in the DB are
 * already display-time at the camera, and the rest of the app uses local
 * time elsewhere (e.g. inline editor timestamps).
 *
 * @param {string | number | Date} timestamp - Anything `new Date(x)` accepts.
 * @returns {string} Formatted string, e.g. "Apr 30, 2:34 PM".
 */
const FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

export function formatGridTimestamp(timestamp) {
  return FORMATTER.format(timestamp instanceof Date ? timestamp : new Date(timestamp))
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test test/renderer/formatTimestamp.test.js
```

Expected: both tests PASS.

- [ ] **Step 5: Run prettier + the full test suite to make sure nothing else broke**

```bash
npm run format -- src/renderer/src/utils/formatTimestamp.js test/renderer/formatTimestamp.test.js
npm test
```

Expected: full suite passes.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/utils/formatTimestamp.js test/renderer/formatTimestamp.test.js
git commit -m "feat(media): add formatGridTimestamp utility for compact grid cell timestamps"
```

---

## Task 2: Add `getSpeciesCountsFromSequence` helper (TDD)

**Files:**
- Modify: `src/renderer/src/utils/speciesFromBboxes.js`
- Test: `test/renderer/speciesFromBboxes.test.js`

This mirrors the existing `getSpeciesListFromSequence` (which returns deduped names) but preserves per-species occurrence counts. The shape matches `getSpeciesCountsFromBboxes` so the same `SpeciesCountLabel` component can render both.

### Steps

- [ ] **Step 1: Write the failing tests**

Append to `test/renderer/speciesFromBboxes.test.js`, after the existing `describe('getSpeciesListFromSequence', …)` block:

```js
import {
  getSpeciesListFromBboxes,
  getSpeciesListFromSequence,
  getSpeciesCountsFromSequence
} from '../../src/renderer/src/utils/speciesFromBboxes.js'

// ...keep the existing describe blocks above; only the new one is added below

describe('getSpeciesCountsFromSequence', () => {
  test('aggregates per-species counts across sequence items', () => {
    const items = [{ mediaID: '1' }, { mediaID: '2' }, { mediaID: '3' }]
    const bboxesByMedia = {
      1: [{ scientificName: 'Panthera leo' }],
      2: [{ scientificName: 'Panthera leo' }, { scientificName: 'Loxodonta africana' }],
      3: [{ scientificName: 'Loxodonta africana' }]
    }
    assert.deepEqual(getSpeciesCountsFromSequence(items, bboxesByMedia), [
      { scientificName: 'Panthera leo', count: 2 },
      { scientificName: 'Loxodonta africana', count: 2 }
    ])
  })

  test('falls back to deduped item scientificNames with count = 1', () => {
    const items = [
      { mediaID: '1', scientificName: 'Panthera leo' },
      { mediaID: '2', scientificName: 'Panthera leo' }
    ]
    assert.deepEqual(getSpeciesCountsFromSequence(items, {}), [
      { scientificName: 'Panthera leo', count: 1 }
    ])
  })

  test('filters null/undefined item scientificNames in fallback', () => {
    const items = [
      { mediaID: '1', scientificName: null },
      { mediaID: '2', scientificName: 'Panthera leo' },
      { mediaID: '3', scientificName: undefined }
    ]
    assert.deepEqual(getSpeciesCountsFromSequence(items, {}), [
      { scientificName: 'Panthera leo', count: 1 }
    ])
  })

  test('returns [] when nothing found', () => {
    assert.deepEqual(getSpeciesCountsFromSequence([{ mediaID: '1' }], {}), [])
  })
})
```

**Important:** the `import` line at the top of the file needs `getSpeciesCountsFromSequence` added. Update the existing import block:

```js
import {
  getSpeciesListFromBboxes,
  getSpeciesListFromSequence,
  getSpeciesCountsFromSequence
} from '../../src/renderer/src/utils/speciesFromBboxes.js'
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test test/renderer/speciesFromBboxes.test.js
```

Expected: import error or `getSpeciesCountsFromSequence is not a function` for all four new tests.

- [ ] **Step 3: Implement the helper**

In `src/renderer/src/utils/speciesFromBboxes.js`, append after the existing `getSpeciesListFromSequence` export:

```js
/**
 * Like getSpeciesListFromSequence but preserves per-species occurrence counts
 * across the whole sequence. Used by the media-tab grid cell to feed
 * SpeciesCountLabel for cards backed by a sequence of media items.
 *
 * Counts are aggregated across every bbox in every item. When no bboxes carry
 * species at all, falls back to distinct item-level scientificNames with
 * count = 1 each (matching the contract of getSpeciesCountsFromBboxes).
 *
 * @param {Array<{mediaID: string, scientificName?: string}>} items
 * @param {Object<string, Array<{scientificName?: string}>>} bboxesByMedia
 * @returns {Array<{scientificName: string, count: number}>}
 */
export function getSpeciesCountsFromSequence(items, bboxesByMedia) {
  const counts = new Map()
  for (const item of items) {
    const itemBboxes = bboxesByMedia[item.mediaID] || []
    for (const b of itemBboxes) {
      const name = b.scientificName
      if (!name) continue
      counts.set(name, (counts.get(name) || 0) + 1)
    }
  }
  if (counts.size > 0) {
    return Array.from(counts, ([scientificName, count]) => ({ scientificName, count }))
  }
  const fallback = [...new Set(items.map((i) => i.scientificName).filter(Boolean))]
  return fallback.map((scientificName) => ({ scientificName, count: 1 }))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test test/renderer/speciesFromBboxes.test.js
```

Expected: every test in the file PASSES (including the four new ones and the eight pre-existing ones).

- [ ] **Step 5: Run prettier + the full suite**

```bash
npm run format -- src/renderer/src/utils/speciesFromBboxes.js test/renderer/speciesFromBboxes.test.js
npm test
```

Expected: full suite passes.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/utils/speciesFromBboxes.js test/renderer/speciesFromBboxes.test.js
git commit -m "feat(media): add getSpeciesCountsFromSequence for grid cell ×N counts"
```

---

## Task 3: Update `ThumbnailCard` — overlay + slim footer

**Files:**
- Modify: `src/renderer/src/media.jsx` — imports (lines 1-47), `ThumbnailCard` JSX (lines 1694-1794)

There are no unit tests for the JSX in `media.jsx` — verification is manual (Task 5). Three edits to the file: (1) the `lucide-react` import block, (2) the `utils` and `ui/SpeciesLabel` imports, (3) the `ThumbnailCard` return statement.

### Steps

- [ ] **Step 1: Add `Clock` to the lucide-react import**

In `src/renderer/src/media.jsx`, find the import block at lines 1-25 and add `Clock` (alphabetically positioned near the existing `Calendar`, `Check`):

**Before** (lines 1-25):
```jsx
import {
  CameraOff,
  X,
  Calendar,
  Pencil,
  Check,
  Search,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  SquarePlus,
  Layers,
  Play,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Heart,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Info
} from 'lucide-react'
```

**After:**
```jsx
import {
  CameraOff,
  X,
  Calendar,
  Pencil,
  Check,
  Clock,
  Search,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  SquarePlus,
  Layers,
  Play,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Heart,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Info
} from 'lucide-react'
```

- [ ] **Step 2: Update the species + utils imports**

In `media.jsx`, find lines 46-47:

**Before:**
```jsx
import { getSpeciesListFromBboxes, getSpeciesListFromSequence } from './utils/speciesFromBboxes'
import SpeciesLabel from './ui/SpeciesLabel'
```

**After:**
```jsx
import {
  getSpeciesListFromBboxes,
  getSpeciesListFromSequence,
  getSpeciesCountsFromBboxes,
  getSpeciesCountsFromSequence
} from './utils/speciesFromBboxes'
import SpeciesLabel, { SpeciesCountLabel } from './ui/SpeciesLabel'
import { formatGridTimestamp } from './utils/formatTimestamp'
```

`SpeciesLabel` and `getSpeciesListFromBboxes` / `getSpeciesListFromSequence` are kept because other places in the file (and any future callers in this session's scope) still import them. The lint/format pass at the end will flag any actually-unused imports.

- [ ] **Step 3: Add the timestamp overlay inside `ThumbnailCard`'s image container**

In `media.jsx`, the `ThumbnailCard` image container starts at line 1699. Find the `</div>` that closes the image container at line 1783, immediately after the image-error fallback (lines 1775-1782). Insert the timestamp overlay just before that closing `</div>`, alongside the existing video badge and bbox overlay:

**Before** (lines 1769-1783):
```jsx
        {/* Bbox overlay - only for images */}
        {showBboxes && !isVideo && (
          <ThumbnailBboxOverlay bboxes={bboxes} imageRef={imageRef} containerRef={containerRef} />
        )}

        {/* Image error fallback - only for non-video */}
        {!isVideo && imageErrors[media.mediaID] && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 text-gray-400"
            title="Image not available"
          >
            <CameraOff size={32} />
          </div>
        )}
      </div>
```

**After:**
```jsx
        {/* Bbox overlay - only for images */}
        {showBboxes && !isVideo && (
          <ThumbnailBboxOverlay bboxes={bboxes} imageRef={imageRef} containerRef={containerRef} />
        )}

        {/* Image error fallback - only for non-video */}
        {!isVideo && imageErrors[media.mediaID] && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 text-gray-400"
            title="Image not available"
          >
            <CameraOff size={32} />
          </div>
        )}

        {/* Timestamp overlay (top-left) */}
        {media.timestamp && (
          <div className="absolute top-2 left-2 z-20 bg-black/65 text-white px-1.5 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 backdrop-blur-[2px] tabular-nums">
            <Clock size={11} />
            <span>{formatGridTimestamp(media.timestamp)}</span>
          </div>
        )}
      </div>
```

- [ ] **Step 4: Replace the `ThumbnailCard` footer**

In `media.jsx`, find lines 1785-1792:

**Before:**
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

**After:**
```jsx
      <div className="p-2">
        <h3 className="text-sm font-semibold truncate capitalize">
          <SpeciesCountLabel
            entries={getSpeciesCountsFromBboxes(bboxes, media.scientificName)}
          />
        </h3>
      </div>
```

- [ ] **Step 5: Run the dev server and visually confirm `ThumbnailCard`**

```bash
npm run dev
```

Open the media tab, confirm:
- Image cards show timestamp top-left (e.g. `Apr 30, 2:34 PM`).
- Video cards show timestamp top-left **and** the existing play badge bottom-right.
- Footer is one line, capitalized, with `×N` for repeated species (`Red Deer ×2 · European Hare`).
- Cards with missing `media.timestamp`: no overlay rendered, footer still shows correctly.

If anything is broken, fix and re-verify before continuing.

- [ ] **Step 6: Run lint, format, full test suite**

```bash
npm run format -- src/renderer/src/media.jsx
npm run lint
npm test
```

Expected: lint clean, format clean, tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "feat(media): grid cell — timestamp overlay and slim footer for ThumbnailCard"
```

---

## Task 4: Update `SequenceCard` — overlay + slim footer

**Files:**
- Modify: `src/renderer/src/media.jsx` — `SequenceCard` JSX (the existing image container is roughly lines 1989-2041, the footer is lines 2043-2053).

The structural change mirrors Task 3 but uses `currentMedia.timestamp` (the per-frame timestamp of whichever item is currently displayed) and `getSpeciesCountsFromSequence` (which spans all frames).

### Steps

- [ ] **Step 1: Add the timestamp overlay inside `SequenceCard`'s image container**

In `media.jsx`, find the SequenceCard image container's closing `</div>` (at the end of the progress-indicator block, ~line 2040-2041). Add the timestamp overlay just before that closing tag, alongside the progress indicator:

**Before** (the closing region of the image container, lines 2020-2041):
```jsx
        {/* Progress indicator */}
        {itemCount > 1 && (
          <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex gap-1">
            {itemCount <= 8 ? (
              // Dots for small sequences
              sequence.items.map((_, idx) => (
                <div
                  key={idx}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    idx === currentIndex ? 'bg-blue-500' : 'bg-white/60'
                  }`}
                />
              ))
            ) : (
              // Counter text for large sequences
              <span className="text-xs font-medium text-white bg-black/50 px-1.5 py-0.5 rounded">
                {currentIndex + 1}/{itemCount}
              </span>
            )}
          </div>
        )}
      </div>
```

**After:**
```jsx
        {/* Progress indicator */}
        {itemCount > 1 && (
          <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex gap-1">
            {itemCount <= 8 ? (
              // Dots for small sequences
              sequence.items.map((_, idx) => (
                <div
                  key={idx}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    idx === currentIndex ? 'bg-blue-500' : 'bg-white/60'
                  }`}
                />
              ))
            ) : (
              // Counter text for large sequences
              <span className="text-xs font-medium text-white bg-black/50 px-1.5 py-0.5 rounded">
                {currentIndex + 1}/{itemCount}
              </span>
            )}
          </div>
        )}

        {/* Timestamp overlay (top-left) — updates as the sequence cycles */}
        {currentMedia.timestamp && (
          <div className="absolute top-2 left-2 z-20 bg-black/65 text-white px-1.5 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 backdrop-blur-[2px] tabular-nums">
            <Clock size={11} />
            <span>{formatGridTimestamp(currentMedia.timestamp)}</span>
          </div>
        )}
      </div>
```

- [ ] **Step 2: Replace the `SequenceCard` footer**

In `media.jsx`, find lines 2043-2053:

**Before:**
```jsx
      {/* Info section */}
      <div className="p-2">
        <h3 className="text-sm font-semibold truncate">
          <SpeciesLabel names={getSpeciesListFromSequence(sequence.items, bboxesByMedia)} />
        </h3>
        <p className="text-xs text-gray-500">
          {currentMedia.timestamp
            ? new Date(currentMedia.timestamp).toLocaleString()
            : 'No timestamp'}
        </p>
      </div>
```

**After:**
```jsx
      {/* Info section */}
      <div className="p-2">
        <h3 className="text-sm font-semibold truncate capitalize">
          <SpeciesCountLabel
            entries={getSpeciesCountsFromSequence(sequence.items, bboxesByMedia)}
          />
        </h3>
      </div>
```

- [ ] **Step 3: Verify dead imports**

After Tasks 3 and 4, `SpeciesLabel` and `getSpeciesListFromBboxes` / `getSpeciesListFromSequence` may have no remaining callers in `media.jsx`. Verify:

```bash
grep -n "SpeciesLabel\b\|getSpeciesListFromBboxes\|getSpeciesListFromSequence" src/renderer/src/media.jsx
```

If only the import lines match (no JSX or call sites), tighten the imports:

**Before** (the import block from Task 3 Step 2):
```jsx
import {
  getSpeciesListFromBboxes,
  getSpeciesListFromSequence,
  getSpeciesCountsFromBboxes,
  getSpeciesCountsFromSequence
} from './utils/speciesFromBboxes'
import SpeciesLabel, { SpeciesCountLabel } from './ui/SpeciesLabel'
```

**After:**
```jsx
import {
  getSpeciesCountsFromBboxes,
  getSpeciesCountsFromSequence
} from './utils/speciesFromBboxes'
import { SpeciesCountLabel } from './ui/SpeciesLabel'
```

If any remaining callers exist (e.g. somewhere else in the file uses `SpeciesLabel`), leave the imports alone. Run `npm run lint` to confirm — `eslint --cache` will flag any genuinely-unused imports left behind.

- [ ] **Step 4: Run the dev server and visually confirm `SequenceCard`**

```bash
npm run dev
```

Open the media tab on a study with sequences (or use the sample data) and confirm:
- Sequence cards show timestamp top-left, sequence-count badge top-right (`Layers + N`), progress dots/counter bottom-center.
- Hovering a sequence cycles through frames; the timestamp value updates per frame.
- Footer is one line, capitalized, with `×N` counts spanning all frames.
- Sequences containing video items show timestamp top-left **and** the play badge bottom-right when that frame is active.

If anything is broken, fix and re-verify before continuing.

- [ ] **Step 5: Run lint, format, full test suite**

```bash
npm run format -- src/renderer/src/media.jsx
npm run lint
npm test
```

Expected: lint clean, format clean, tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "feat(media): grid cell — timestamp overlay and slim footer for SequenceCard"
```

---

## Task 5: End-to-end manual verification

**Files:** None (verification only).

This task is the final gate before declaring the work complete. No code changes — just exercise the running app against the spec's verification list.

### Steps

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Walk through the spec's verification matrix**

For each card variant, click into it and back, then visually confirm. Refer to the matrix in `docs/specs/2026-04-30-media-grid-cell-redesign-design.md` ("Verification" section). Specifically:

| Variant | Top-left | Top-right | Bottom-center | Bottom-right | Footer |
|---|---|---|---|---|---|
| Single image | timestamp | — | — | — | one line, capitalized, `×N` |
| Video | timestamp | — | — | play badge | one line |
| Sequence ≤8 items | timestamp | Layers count | dots | — | one line spanning all frames |
| Sequence >8 items | timestamp | Layers count | `n/N` counter | — | one line |
| Missing `media.timestamp` | (no overlay) | — | — | — | footer still renders |
| Sequence of videos | timestamp | Layers | dots / counter | play badge | one line |

- [ ] **Step 3: Check edge cases for the species line**

Confirm that:
- Single-occurrence species render as just `Red Deer` (no `×1` suffix).
- Multi-occurrence species render as `Red Deer ×2`.
- Multiple species are joined with ` · ` separator (existing `SpeciesCountLabel` behavior).
- Cards with no detected species render `Blank` (also existing `SpeciesCountLabel` behavior).
- Long species lists truncate with ellipsis at the right edge of the cell (existing `truncate` Tailwind utility).

- [ ] **Step 4: Final test run + push**

```bash
npm test
git log --oneline -6  # confirm 4 new commits since merge of origin/main
```

Expected: green test suite, four new commits on the branch (one per Task 1-4).

If everything is clean, the implementation is done. The user will handle pushing / opening the PR separately.

---

## Out of scope / deferred

Per the spec's "Non-goals" and "Deferred" sections, these are explicitly **not** part of this plan:

- Modal / observation-rail capitalize alignment.
- Hover-only or conditional timestamp display.
- Localized timestamp formatting (timezone, locale).
- Any DB / IPC / main-process changes.
