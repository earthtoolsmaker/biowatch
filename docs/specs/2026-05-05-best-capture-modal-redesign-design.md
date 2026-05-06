# Best-Capture Modal Redesign

## Goal

Apply the same deployment-link pattern from the standard media modal to the
best-capture modals (`ImageViewerModal` and `VideoViewerModal` in
`BestMediaCarousel.jsx`), and rearrange the existing metadata so the modals
read more like a polished image/video viewer:

- A floating species pill at the top-center of the media area.
- The filename anchored to the bottom-left of the footer.
- A clickable deployment pill at the bottom-right of the footer.

Both image and video modals get the same treatment for consistency.

## UX

```
┌───────────────────────────────────────────┐
│ [< >]  timestamp              [♥] [×]    │  Top toolbar (unchanged)
├───────────────────────────────────────────┤
│        ┌────────────────────┐             │
│        │ Common (Sci. name) │  ← overlay  │
│        └────────────────────┘             │
│              [   image   ]                │
├───────────────────────────────────────────┤
│  filename             📍 Location Name →  │  Footer
└───────────────────────────────────────────┘
```

Three changes per modal:

1. **Species pill overlay.** Top-center over the media area, semi-transparent
   black background (`bg-black/60`), white text, rounded pill, `text-sm`.
   Renders the same `<SpeciesHeading scientificName=…>` already used in the
   footer (common name + italic scientific name).
2. **Filename moves to footer-left.** Currently footer-right; takes the
   `flex-1` slot so it pushes the deployment pill to the right edge.
3. **Deployment pill at footer-right.** Same component shipped previously
   in the standard `ImageModal` (PR #500). Always interactive in the
   best-capture context — these modals are reached from the Overview tab,
   never from inside the Deployments tab, so the `interactive={true}` branch
   is hardcoded.

The deployment pill follows the established label fallback chain:
`locationName → locationID → 'View deployment'`.

## Architecture

Five layers.

### 1 — Backend: include location fields in `getBestMedia` results

**File:** `src/main/database/queries/best-media.js`

The function uses two raw-SQL queries: a favorites CTE (~line 277) and an
auto-scored CTE (~line 391). Both return `f.deploymentID` already.

For each query:

- Add `LEFT JOIN deployments d ON d.deploymentID = m.deploymentID` (or the
  CTE equivalent — wherever the media row originates).
- Project `d.locationID AS locationID, d.locationName AS locationName` in the
  CTE that wraps the media row.
- Forward both fields through the final `SELECT` so they reach the consumer.

Cost: one extra LEFT JOIN per query against a small PK-keyed table.
Negligible.

### 2 — Component extraction: shared `DeploymentLinkPill`

**Files:**

- New: `src/renderer/src/media/DeploymentLinkPill.jsx`
- Modify: `src/renderer/src/media/Gallery.jsx`

The pill currently lives at the top of `Gallery.jsx`, just before
`ImageModal`. Move it verbatim into its own file. Update `Gallery.jsx` to
import it instead of defining it.

Pure refactor — same component, same props
(`studyId`, `deploymentID`, `locationName`, `locationID`, `interactive`,
`onNavigate`), same behavior, same styling. The `useNavigate` import moves
with the component; `Gallery.jsx` drops `useNavigate` from its react-router
import if no other use site exists in that file.

### 3 — `SpeciesHeading` dark-background variant

**File:** `src/renderer/src/ui/BestMediaCarousel.jsx`

`SpeciesHeading` (~line 31) currently renders the scientific name inside a
`text-gray-500` span — readable on the existing white footer but illegible
on a `bg-black/60` overlay. Add a `tone` prop:

```jsx
function SpeciesHeading({ scientificName, tone = 'light' }) {
  // 'light' = current behavior (gray-500 sci-name, gray-800 common in caller).
  // 'dark'  = white common, gray-300 italic sci-name. For overlays on dark.
}
```

Default keeps the existing footer rendering identical (no behavior change
for current callers). Best-capture overlays pass `tone="dark"`.

### 4 — `ImageViewerModal` layout edits

**File:** `src/renderer/src/ui/BestMediaCarousel.jsx`, lines 79-257

Three JSX edits:

**(a) Species overlay** in the image area (currently lines 222-238).
Inside the existing `relative` container, add a top-center absolutely-positioned
pill:

```jsx
<div className="flex-1 min-h-0 flex items-center justify-center bg-black overflow-hidden relative">
  {media.scientificName !== undefined && (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-black/60 text-white text-sm">
      <SpeciesHeading scientificName={media.scientificName} tone="dark" />
    </div>
  )}
  {/* existing image / error state */}
</div>
```

**(b) Footer rewrite** (lines 240-252). The `<SpeciesHeading>` is removed
(it lives in the overlay now); filename moves to the `flex-1` slot;
`<DeploymentLinkPill>` is added at the right:

```jsx
<div className="px-4 py-2.5 bg-gray-50 flex-shrink-0 border-t border-gray-200">
  <div className="flex items-center gap-3 min-w-0">
    {media.fileName && (
      <span className="font-mono text-[11px] text-gray-400 truncate min-w-0 flex-1">
        {media.fileName}
      </span>
    )}
    {media.deploymentID && (
      <DeploymentLinkPill
        studyId={studyId}
        deploymentID={media.deploymentID}
        locationName={media.locationName}
        locationID={media.locationID}
        interactive={true}
        onNavigate={handleClose}
      />
    )}
  </div>
</div>
```

**(c) Always-interactive.** No `deploymentID` prop threading from the
carousel — `interactive={true}` is hardcoded.

### 5 — `VideoViewerModal` layout edits

**File:** `src/renderer/src/ui/BestMediaCarousel.jsx`, lines 262-558

Same three edits as `ImageViewerModal`:

- Species overlay anchored top-center over the video area. The video area
  already has absolutely-positioned overlay siblings (the duration / error
  badges at lines ~1812 / ~2050), so the new overlay fits the existing
  pattern.
- Footer rewrite identical to `ImageViewerModal`'s.
- `interactive={true}` hardcoded.

The transcoding-state placeholders at lines ~509, ~516, ~523 (which inline
`media.fileName` in their bodies as fallback labels) are unrelated to the
footer and stay as-is.

## Testing

- **Backend:** one new test in `test/main/database/queries.test.js`. Insert a
  favorite media row, call `getBestMedia`, assert the returned row carries
  the expected `locationID` / `locationName`. Reuses the existing
  `createTestData` helper pattern.
- **Renderer:** no unit tests (the repo has no React Testing Library
  setup). Manual verification in the dev server: open the Overview tab,
  click a best-capture image, verify (1) species pill at top-center,
  (2) filename at footer-left, (3) deployment pill at footer-right and
  navigates correctly. Repeat for a video best capture if available.

## Out of scope

- Hovercard on the species pill (the carousel cards already provide a
  GBIF/IUCN hovercard before the modal opens; adding a second one inside the
  modal would be redundant chrome).
- Merging `ImageViewerModal` and `VideoViewerModal` into one component.
  They share patterns but their internals (zoom vs transcode states) are
  different enough that the duplication is currently the right call.
- Changes to the standard `ImageModal` in `Gallery.jsx`. Its layout already
  ships with the deployment pill; no further redesign.
