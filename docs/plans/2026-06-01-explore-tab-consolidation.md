# Explore Tab Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Activity tab into an "Explore" tab with a `[Map | Gallery | Both]` view toggle, lifting the sequence-gap slider and filter controls into a top control bar, while leaving the separate Media tab untouched.

**Architecture:** The current `activity.jsx` already owns every piece of filter state the gallery needs (`selectedSpecies`, `dateRange`, `timeRange`, `isFullRange`, `sequenceGap`). We add a `viewMode` state, a top control bar, and a swappable main pane that renders the existing `SpeciesMap`, the existing `Gallery`, or both. Responsive rules (`both` only at `lg`+, side-by-side at `2xl`+ else stacked) come from a pure helper module plus one matchMedia hook. The thumbnail-bbox toggle is extracted from `GalleryDisplayStrip` so the new control bar and the Media tab share one implementation.

**Tech Stack:** React 18, electron-vite, Tailwind CSS, @tanstack/react-query, react-leaflet, lucide-react, @radix-ui/react-tooltip. Tests run on Node's built-in runner (`node --test`); there is **no** React component test infra, so component verification is via lint + running the app, and only pure logic is unit-tested.

**Spec:** `docs/specs/2026-06-01-explore-tab-consolidation-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/renderer/src/utils/viewLayout.js` | Pure rules: which view modes are available + clamping at a breakpoint | Create |
| `test/renderer/viewLayout.test.js` | Unit tests for `viewLayout.js` | Create |
| `src/renderer/src/hooks/useIsLgUp.js` | Reactive `>=1024px` matchMedia flag | Create |
| `src/renderer/src/ui/ViewModeToggle.jsx` | `[Map\|Gallery\|Both]` segmented control | Create |
| `src/renderer/src/ui/ThumbnailBboxToggle.jsx` | Bbox-on-thumbnail toggle (extracted from `GalleryDisplayStrip`) | Create |
| `src/renderer/src/media/GalleryDisplayStrip.jsx` | Media tab's display strip — now consumes `ThumbnailBboxToggle` | Modify |
| `src/renderer/src/activity.jsx` | The Explore page: view state, top control bar, swappable pane | Modify |
| `src/renderer/src/study.jsx` | Nav tab label "Activity" → "Explore" | Modify |
| `docs/architecture.md` | Reflect the Explore tab / consolidated view | Modify |

**Out of scope (per spec):** `media.jsx` and the Media route/tab; internals of `Gallery`, `SpeciesMap`, `SpeciesDistribution`; view-mode persistence; deduplicating the shared filter scaffolding between `activity.jsx` and `media.jsx`.

---

## Task 1: Pure view-layout helpers (TDD)

**Files:**
- Create: `src/renderer/src/utils/viewLayout.js`
- Test: `test/renderer/viewLayout.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/renderer/viewLayout.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  VIEW_MODES,
  getAvailableViewModes,
  clampViewMode
} from '../../src/renderer/src/utils/viewLayout.js'

describe('viewLayout', () => {
  test('VIEW_MODES lists all three modes in toggle order', () => {
    assert.deepEqual(VIEW_MODES, ['map', 'gallery', 'both'])
  })

  test('getAvailableViewModes offers both only at lg and up', () => {
    assert.deepEqual(getAvailableViewModes(true), ['map', 'gallery', 'both'])
    assert.deepEqual(getAvailableViewModes(false), ['map', 'gallery'])
  })

  test('clampViewMode falls back from both to map below lg', () => {
    assert.equal(clampViewMode('both', false), 'map')
  })

  test('clampViewMode keeps both at lg and up', () => {
    assert.equal(clampViewMode('both', true), 'both')
  })

  test('clampViewMode leaves map and gallery untouched at any size', () => {
    assert.equal(clampViewMode('map', false), 'map')
    assert.equal(clampViewMode('gallery', false), 'gallery')
    assert.equal(clampViewMode('gallery', true), 'gallery')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/renderer/viewLayout.test.js`
Expected: FAIL — `Cannot find module '.../viewLayout.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/utils/viewLayout.js`:

```js
/**
 * Pure rules for the Explore tab's view-mode toggle.
 *
 * View modes: 'map' | 'gallery' | 'both'. 'both' (map and gallery shown
 * together) is only offered at the Tailwind `lg` breakpoint and up
 * (>= 1024px); below that the window is too narrow to show both at once, so
 * the toggle collapses to map/gallery.
 */
export const VIEW_MODES = ['map', 'gallery', 'both']

/** Modes the toggle should offer at the current breakpoint. */
export function getAvailableViewModes(isLgUp) {
  return isLgUp ? ['map', 'gallery', 'both'] : ['map', 'gallery']
}

/**
 * Coerce a view mode to one valid at the current breakpoint: if 'both' was
 * selected and the window shrank below `lg`, fall back to 'map'.
 */
export function clampViewMode(mode, isLgUp) {
  if (mode === 'both' && !isLgUp) return 'map'
  return mode
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/renderer/viewLayout.test.js`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/viewLayout.js test/renderer/viewLayout.test.js
git commit -m "feat(explore): add pure view-mode layout helpers"
```

---

## Task 2: `useIsLgUp` breakpoint hook

**Files:**
- Create: `src/renderer/src/hooks/useIsLgUp.js`

No unit test — matchMedia behavior has no DOM in the `node --test` environment; it is exercised manually when running the app.

- [ ] **Step 1: Write the hook**

Create `src/renderer/src/hooks/useIsLgUp.js`:

```js
import { useEffect, useState } from 'react'

const LG_QUERY = '(min-width: 1024px)'

/**
 * Reactive Tailwind `lg` flag (viewport >= 1024px) via matchMedia. Updates on
 * resize. Drives the Explore tab's view toggle — 'both' is only offered at lg
 * and up. Defaults to true before the effect runs (desktop-first Electron
 * window), which avoids a flash of the narrow layout on mount.
 */
export function useIsLgUp() {
  const [isLgUp, setIsLgUp] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia
      ? true
      : window.matchMedia(LG_QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(LG_QUERY)
    const update = () => setIsLgUp(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  return isLgUp
}
```

- [ ] **Step 2: Verify it lints**

Run: `npm run lint`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useIsLgUp.js
git commit -m "feat(explore): add useIsLgUp breakpoint hook"
```

---

## Task 3: `ViewModeToggle` segmented control

**Files:**
- Create: `src/renderer/src/ui/ViewModeToggle.jsx`

- [ ] **Step 1: Write the component**

Create `src/renderer/src/ui/ViewModeToggle.jsx`:

```jsx
import { Map as MapIcon, Images, Columns2 } from 'lucide-react'

const MODE_META = {
  map: { label: 'Map', icon: MapIcon },
  gallery: { label: 'Gallery', icon: Images },
  both: { label: 'Both', icon: Columns2 }
}

/**
 * Segmented control for the Explore tab's main view. `modes` is the list of
 * modes available at the current breakpoint (from getAvailableViewModes), so
 * 'both' is omitted on narrow windows. Uses an explicit blue active state to
 * match the other toggles in the control bar.
 */
export default function ViewModeToggle({ value, modes, onChange }) {
  return (
    <div className="inline-flex items-center rounded-md border border-border p-0.5 gap-0.5">
      {modes.map((mode) => {
        const { label, icon: Icon } = MODE_META[mode]
        const active = value === mode
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            aria-pressed={active}
            className={`flex items-center gap-1.5 px-2.5 h-7 rounded text-sm transition-colors ${
              active
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify it lints**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/ViewModeToggle.jsx
git commit -m "feat(explore): add ViewModeToggle segmented control"
```

---

## Task 4: Extract `ThumbnailBboxToggle` and reuse it in `GalleryDisplayStrip`

The bbox toggle is currently inlined in `GalleryDisplayStrip`. Extract it so the Explore control bar (Task 6) and the Media tab share one source. `GalleryDisplayStrip`'s rendered output must stay identical so the Media tab is unchanged.

**Files:**
- Create: `src/renderer/src/ui/ThumbnailBboxToggle.jsx`
- Modify: `src/renderer/src/media/GalleryDisplayStrip.jsx`

- [ ] **Step 1: Create the extracted component**

Create `src/renderer/src/ui/ThumbnailBboxToggle.jsx` (markup copied verbatim from `GalleryDisplayStrip` lines 50–80, plus the `studyHasAnyBboxes` query and `useShowThumbnailBboxes` hook it depended on):

```jsx
import { Eye, EyeOff } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useShowThumbnailBboxes } from '../hooks/useShowThumbnailBboxes'

/**
 * Toggle for drawing AI-detected bounding boxes on gallery thumbnails. Hidden
 * when the study has no bbox observations. Per-study state via
 * useShowThumbnailBboxes. Extracted from GalleryDisplayStrip so the Explore
 * tab's control bar and the Media tab's strip share one implementation.
 *
 * On IPC failure `studyHasBboxes` falls back to false (toggle hidden) — the
 * safer default than a button that does nothing.
 */
export default function ThumbnailBboxToggle({ studyId }) {
  const { showThumbnailBboxes, setShowThumbnailBboxes } = useShowThumbnailBboxes(studyId)

  const { data: studyHasBboxes = false } = useQuery({
    queryKey: ['studyHasAnyBboxes', studyId],
    queryFn: async () => {
      const response = await window.api.studyHasAnyBboxes(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    staleTime: Infinity,
    retry: 1,
    throwOnError: false
  })

  if (!studyHasBboxes) return null

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          onClick={() => setShowThumbnailBboxes((prev) => !prev)}
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
            showThumbnailBboxes
              ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
              : 'text-muted-foreground hover:bg-accent'
          }`}
          aria-label={showThumbnailBboxes ? 'Hide bounding boxes' : 'Show bounding boxes'}
        >
          {showThumbnailBboxes ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={10}
          align="end"
          className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
        >
          <p className="font-medium mb-1">
            {showThumbnailBboxes ? 'Hide bounding boxes' : 'Show bounding boxes'}
          </p>
          <p className="text-muted-foreground leading-snug">
            Outlines AI-detected animals on each thumbnail.
          </p>
          <Tooltip.Arrow className="fill-popover" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
```

- [ ] **Step 2: Replace the inlined toggle in `GalleryDisplayStrip` with the component**

In `src/renderer/src/media/GalleryDisplayStrip.jsx`:

Replace the import block top lines:
```jsx
import { Eye, EyeOff } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import * as Tooltip from '@radix-ui/react-tooltip'
import { SequenceGapSlider } from '../ui/SequenceGapSlider'
import FilterChartsToggle from '../ui/FilterChartsToggle'
import { useSequenceGap } from '../hooks/useSequenceGap'
import { useShowThumbnailBboxes } from '../hooks/useShowThumbnailBboxes'
```
with:
```jsx
import { SequenceGapSlider } from '../ui/SequenceGapSlider'
import FilterChartsToggle from '../ui/FilterChartsToggle'
import ThumbnailBboxToggle from '../ui/ThumbnailBboxToggle'
import { useSequenceGap } from '../hooks/useSequenceGap'
```

Delete the now-unused hook + query inside the component body — remove these lines:
```jsx
  const { showThumbnailBboxes, setShowThumbnailBboxes } = useShowThumbnailBboxes(studyId)

  // On IPC failure we fall back to `false` (toggle hidden), which is the
  // safer default than showing a button that does nothing — matches the
  // resilience pattern in useSequenceGap.
  const { data: studyHasBboxes = false } = useQuery({
    queryKey: ['studyHasAnyBboxes', studyId],
    queryFn: async () => {
      const response = await window.api.studyHasAnyBboxes(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    staleTime: Infinity,
    retry: 1,
    throwOnError: false
  })
```
(Keep `const { sequenceGap, setSequenceGap } = useSequenceGap(studyId)`.)

Replace the inlined toggle JSX (the whole `{studyHasBboxes && ( ... )}` block, lines 49–81) with:
```jsx
        <ThumbnailBboxToggle studyId={studyId} />
```

- [ ] **Step 3: Verify lint + Media tab unchanged**

Run: `npm run lint`
Expected: PASS, no unused-import warnings for `Eye`, `EyeOff`, `Tooltip`, `useQuery`, `useShowThumbnailBboxes`.

Run: `npm run dev`, open a study with bbox data → **Media** tab. Confirm the gap slider, bbox toggle (eye icon, toggles boxes on thumbnails), and filter-charts toggle all behave exactly as before.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/ui/ThumbnailBboxToggle.jsx src/renderer/src/media/GalleryDisplayStrip.jsx
git commit -m "refactor(media): extract ThumbnailBboxToggle from GalleryDisplayStrip"
```

---

## Task 5: Wire view state + gallery imports into `activity.jsx`

State-only change; no visual difference yet. Keeps the file compiling so the next task is a focused layout edit.

**Files:**
- Modify: `src/renderer/src/activity.jsx`

- [ ] **Step 1: Add imports**

After the existing `import { SequenceGapSlider } from './ui/SequenceGapSlider'` line, add:
```jsx
import ViewModeToggle from './ui/ViewModeToggle'
import ThumbnailBboxToggle from './ui/ThumbnailBboxToggle'
import Gallery from './media/Gallery'
import { useIsLgUp } from './hooks/useIsLgUp'
import { getAvailableViewModes, clampViewMode } from './utils/viewLayout'
```

- [ ] **Step 2: Add view state + breakpoint clamp**

Immediately after the existing line `const { showFilterCharts } = useShowFilterCharts(actualStudyId)` (around line 794), add:
```jsx
  // Explore view toggle: 'map' | 'gallery' | 'both'. Defaults to 'map'
  // (not persisted). 'both' is only available at lg+; clamp to 'map' if the
  // window is narrower so a stale 'both' selection can't render off-breakpoint.
  const isLgUp = useIsLgUp()
  const [viewModeRaw, setViewMode] = useState('map')
  const viewMode = clampViewMode(viewModeRaw, isLgUp)
  const availableViewModes = getAvailableViewModes(isLgUp)
  const showMap = viewMode === 'map' || viewMode === 'both'
  const showGallery = viewMode === 'gallery' || viewMode === 'both'
```

- [ ] **Step 3: Verify it still lints and runs**

Run: `npm run lint`
Expected: PASS (the new vars are consumed in Task 6; if lint flags them as unused here, proceed — Task 6 consumes them in the same uncommitted-then-committed pair; to keep this commit clean, do Step 4 of Task 5 and Task 6 before committing if your lint config errors on unused vars).

> Note: eslint may flag `availableViewModes`, `showMap`, `showGallery`, `setViewMode`, `ViewModeToggle`, `ThumbnailBboxToggle`, `Gallery` as unused until Task 6. If `npm run lint` errors (not warns), combine Task 5 and Task 6 into a single commit.

- [ ] **Step 4: Commit (or defer to Task 6 if lint errors on unused)**

```bash
git add src/renderer/src/activity.jsx
git commit -m "feat(explore): add view-mode state and gallery imports to activity"
```

---

## Task 6: Top control bar + swappable main pane + trimmed rail

The core layout change. Replaces the first-row block (current lines 1046–1124) with: a top control bar, a swappable main pane (map / gallery / both), and a species-only right rail. The bottom temporal-filter row (lines 1126–1199) stays untouched.

**Files:**
- Modify: `src/renderer/src/activity.jsx`

- [ ] **Step 1: Replace the first-row block**

In the `return`, replace this entire block (the `{/* First row ... */}` comment through the closing `</div>` of the first row, current lines 1046–1124):

```jsx
          {/* First row - takes remaining space */}
          <div className="flex flex-row gap-4 flex-1 min-h-0">
            {/* Species Distribution - left side */}

            {/* Map - right side. ... */}
            <div className="h-full flex-1">
              {deploymentLocations &&
                ... (SpeciesMap + PlaceholderMap) ...
            </div>
            <div className="h-full w-xs flex flex-col gap-2 min-h-0">
              {speciesInitialized && sequenceGap !== undefined && (
                <div className="flex items-center gap-2 px-2 h-10 flex-shrink-0">
                  <SequenceGapSlider ... />
                  <div className="ml-auto flex items-center gap-1">
                    <FilterChartsToggle ... />
                  </div>
                </div>
              )}
              {speciesDistributionData && (
                <div className="flex-1 min-h-0">
                  <SpeciesDistribution ... />
                </div>
              )}
            </div>
          </div>
```

with the new structure (top control bar + content row):

```jsx
          {/* Top control bar — gap slider + view toggle + filter toggles.
              Lifted out of the right rail so the controls apply visibly to
              whatever the main pane shows (map, gallery, or both). */}
          {speciesInitialized && sequenceGap !== undefined && (
            <div className="flex items-center gap-2 px-2 h-10 flex-shrink-0 mb-2">
              <SequenceGapSlider value={sequenceGap} onChange={setSequenceGap} variant="compact" />
              <ViewModeToggle
                value={viewMode}
                modes={availableViewModes}
                onChange={setViewMode}
              />
              <div className="ml-auto flex items-center gap-1">
                {showGallery && <ThumbnailBboxToggle studyId={actualStudyId} />}
                <FilterChartsToggle
                  studyId={actualStudyId}
                  hasTemporalData={hasTemporalData || timeseriesQueryData === undefined}
                  isFiltering={isFilteringWithArea}
                  dayFilterLabel={dayFilterLabel}
                  dateFilterLabel={dateFilterLabel}
                  areaFilterLabel={areaFilterLabel}
                  onResetFilters={handleResetFilters}
                />
              </div>
            </div>
          )}

          {/* Content row — main pane (map / gallery / both) + species rail. */}
          <div className="flex flex-row gap-4 flex-1 min-h-0">
            {/* Main pane. In 'both' the two panes stack on lg–xl and sit
                side-by-side at 2xl+ so neither is cramped (see spec
                responsive table). */}
            <div className="h-full flex-1 min-w-0 flex flex-col 2xl:flex-row gap-4">
              {showMap && (
                <div className="h-full flex-1 min-h-0 min-w-0">
                  {deploymentLocations &&
                    deploymentLocations.length > 0 &&
                    heatmapStatus !== 'noData' && (
                      <SpeciesMap
                        deploymentLocations={deploymentLocations}
                        heatmapData={heatmapStatus === 'hasData' ? heatmapData : null}
                        selectedSpecies={selectedSpecies}
                        palette={palette}
                        studyId={actualStudyId}
                        studyName={studyData?.name}
                        geoKey={geoKey}
                        scientificToCommon={scientificToCommon}
                        areaFilter={areaFilter}
                        onApplyAreaFilter={setAreaFilter}
                      />
                    )}
                  {heatmapStatus === 'noData' && !isHeatmapLoading && (
                    <PlaceholderMap
                      title="No Species Location Data"
                      description="Select species from the list and set up deployment coordinates in the Deployments tab to view the species distribution map."
                      linkTo="/deployments"
                      linkText="Go to Deployments"
                      icon={MapPin}
                      studyId={actualStudyId}
                    />
                  )}
                </div>
              )}
              {showGallery && (
                <div className="h-full flex-1 min-h-0 min-w-0">
                  <Gallery
                    species={selectedSpecies.map((s) => s.scientificName)}
                    dateRange={dateRange}
                    timeRange={timeRange}
                    includeNullTimestamps={isFullRange}
                    speciesReady={speciesInitialized}
                  />
                </div>
              )}
            </div>

            {/* Species rail — legend + filter, shown in all views. */}
            <div className="h-full w-xs flex flex-col gap-2 min-h-0">
              {speciesDistributionData && (
                <div className="flex-1 min-h-0">
                  <SpeciesDistribution
                    data={speciesDistributionData}
                    taxonomicData={taxonomicData}
                    selectedSpecies={selectedSpecies}
                    onSpeciesChange={handleSpeciesChange}
                    palette={palette}
                    studyId={actualStudyId}
                    showHeader={false}
                    hidePseudoSpecies
                  />
                </div>
              )}
            </div>
          </div>
```

- [ ] **Step 2: Verify lint**

Run: `npm run lint`
Expected: PASS — all of `ViewModeToggle`, `ThumbnailBboxToggle`, `Gallery`, `availableViewModes`, `showMap`, `showGallery`, `setViewMode` are now consumed.

- [ ] **Step 3: Manual verification (run the app)**

Run: `npm run dev`. Open a study → **Activity/Explore** tab and confirm:
1. Top bar shows: gap slider, `[Map | Gallery | Both]` toggle, filter-charts toggle. Defaults to **Map**.
2. **Map** view: map fills the pane; species rail on the right keys to the map pies.
3. **Gallery** view: gallery grid replaces the map; the bbox toggle appears in the top bar (for studies with bboxes); species selection filters the gallery.
4. **Both** view: map + gallery share the pane. Narrow the window from wide → the panes switch from side-by-side (≥1536px) to stacked (1024–1535px).
5. Shrink below ~1024px: the **Both** option disappears from the toggle; if Both was selected it falls back to Map.
6. The bottom temporal-filter row (toggled by the filter-charts button) still opens/closes and filters apply in every view.
7. Date brush, time-of-day chips, and sequence-gap slider all affect both map and gallery.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/activity.jsx
git commit -m "feat(explore): add view toggle and gallery pane to the Explore tab"
```

---

## Task 7: Rename the nav tab to "Explore"

**Files:**
- Modify: `src/renderer/src/study.jsx`

- [ ] **Step 1: Change the tab label (route unchanged)**

In `src/renderer/src/study.jsx`, replace:
```jsx
            <Tab to={`/study/${id}/activity`} icon={ChartBar} compact={isImportActive}>
              Activity
            </Tab>
```
with:
```jsx
            <Tab to={`/study/${id}/activity`} icon={Compass} compact={isImportActive}>
              Explore
            </Tab>
```

- [ ] **Step 2: Update the icon import**

In the lucide-react import in `study.jsx`, add `Compass` to the named imports (and leave `ChartBar` if it is still used elsewhere in the file; remove it from the import only if a grep shows no other usage):

Run first: `grep -n "ChartBar" src/renderer/src/study.jsx`
- If `ChartBar` appears only on the line you just changed, replace `ChartBar` with `Compass` in the import.
- Otherwise add `Compass` alongside it.

- [ ] **Step 3: Verify lint + nav**

Run: `npm run lint`
Expected: PASS, no unused-import error for `ChartBar`.

Run: `npm run dev` → the second tab now reads **Explore** with a compass icon and still routes to the consolidated page. The **Media** tab is still present and unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/study.jsx
git commit -m "feat(explore): rename Activity tab to Explore"
```

---

## Task 8: Docs + full verification

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Update architecture docs**

In `docs/architecture.md`, find the section describing the renderer tabs/pages (search for "Activity" and "Media"). Update the Activity entry to read "Explore" and note it now hosts a `[Map | Gallery | Both]` view toggle reusing the `Gallery` component; note the Media tab remains a separate page pending a future rework. Match the surrounding doc style; do not restructure unrelated sections.

- [ ] **Step 2: Run the full unit suite**

Run: `npm test`
Expected: all tests pass (baseline was 1442 passing, 0 failing; this plan adds the `viewLayout` tests). 0 failures.

- [ ] **Step 3: Lint + format**

Run: `npm run lint && npm run format`
Expected: lint passes; format leaves the new/edited files prettier-clean.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(architecture): document the consolidated Explore tab"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** view toggle (Tasks 3,5,6) · gap slider + filter toggle moved to top bar (Task 6) · species rail kept right, all views (Task 6) · responsive both side-by-side/stacked (Task 6 Tailwind `flex-col 2xl:flex-row`) · both hidden + clamp <lg (Tasks 1,2,5) · Map default, no persistence (Task 5 `useState('map')`) · Media untouched (Task 4 verifies parity; no `media.jsx` edits) · reuse Gallery/GalleryDisplayStrip (Tasks 4,6) · Explore name (Task 7).
- **Deferred from spec (flag to user before/at PR):** the `<lg` species-rail **drawer/popover** is not implemented — below `lg` the rail simply stays as the right column (narrower). The high-value responsive behaviors (Both side-by-side↔stacked, Both hidden + clamp) are covered. The rail-collapse `⟷` control and drawer were design ideas; implementing the drawer is a follow-up if the desktop window is realistically used below 1024px. The plan keeps scope tight per YAGNI; confirm this trade-off is acceptable.
- **Type/name consistency:** `viewMode`/`setViewMode`, `getAvailableViewModes(isLgUp)`, `clampViewMode(mode, isLgUp)`, `showMap`/`showGallery` are used identically across Tasks 1, 5, 6. `ThumbnailBboxToggle` props (`studyId`) match in Tasks 4 and 6.
