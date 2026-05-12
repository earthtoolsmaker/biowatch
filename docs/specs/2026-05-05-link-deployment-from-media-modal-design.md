# Link from Media Modal to Deployment

## Goal

From the media modal (the `ImageModal` opened by clicking an image in the Media
tab), let the user jump to the corresponding deployment in the Deployments tab.
The deployment auto-selects on arrival and its detail pane slides up.

When the same modal is opened from inside the Deployments tab itself (the
deployment-scoped consumer), still surface the deployment's location name in
the modal — but as static text, not a navigation control. You're already on
that deployment.

## UX

A small pill in the **bottom-right of the modal's existing footer**, opposite
the filename:

```
[ filename.jpg ───────────────────────  📍 North Ridge Camera → ]
```

- Icon: `MapPin` (matches `LocationPopover` and the location idiom used
  elsewhere in the app).
- Label: `locationName`, falling back to `locationID`, falling back to
  `'View deployment'`.
- Tooltip (interactive variant only): "Open in Deployments tab".

### Two variants

- **Interactive** — Media-tab consumer (`Gallery` instantiated without a
  `deploymentID` prop). Rendered as a `<button>` with hover/focus styles. On
  click: closes the modal, then navigates to
  `/study/:id/deployments?deploymentID=<media.deploymentID>`.
- **Static** — Deployments-tab consumer (`Gallery` instantiated with a
  `deploymentID` prop). Rendered as a `<span>` with muted styling. No hover,
  no tooltip, no navigation handler. Provides context only.

The pill is hidden entirely when `media.deploymentID` is missing (defensive;
shouldn't happen with normal data).

## Architecture

Three changes, in three layers.

### Part 1 — Backend: include location info in the media query

**File:** `src/main/database/queries/sequences.js`

The `getMediaInSequences` function (~line 53) builds three `selectFields*`
objects (with-obs / blank / vehicle arms) that today project from the `media`
table only. Two changes per arm:

- Add a `LEFT JOIN` against the `deployments` table on
  `media.deploymentID = deployments.deploymentID`.
- Add `locationID: deployments.locationID` and
  `locationName: deployments.locationName` to each `selectFields*` object so
  the union still type-checks.

The new fields propagate naturally through the existing union → row pipeline.
Downstream consumers (gallery, modal) ignore unknown fields, so no other
backend changes.

Cost: one extra LEFT JOIN per arm against a small table keyed by primary key.
Negligible.

### Part 2 — Thread `deploymentID` consumer flag from `Gallery` to `ImageModal`

**File:** `src/renderer/src/media/Gallery.jsx`

`Gallery` already accepts `deploymentID` as a prop (line 2162) and `ImageModal`
already receives `studyId` (line 2547). Two edits:

- At the `<ImageModal …>` call site (~line 2538), pass
  `deploymentID={deploymentID}`.
- In `ImageModal`'s prop destructuring (~line 211), accept `deploymentID`.

The prop is used solely as a "deployment-scoped consumer?" flag — when
truthy, the pill renders in static-span form rather than as a button. It does
not change any other modal behavior.

### Part 3 — `DeploymentLinkPill` component, in the modal footer

**File:** `src/renderer/src/media/Gallery.jsx`

Defined alongside `ImageModal` in the same file. (The file already holds many
local sub-components; a new ~25-line component fits the existing pattern.)

Behavior:

- Reads `studyId`, `deploymentID`, `locationName`, `locationID`,
  `interactive`, and `onNavigate` from props.
- Computes the label as
  `locationName || locationID || 'View deployment'`.
- Imports `useNavigate` from `react-router`.
- Interactive variant: `<button>` with hover/focus, MapPin icon, label, and a
  trailing chevron. On click, calls `onNavigate()` (the modal's `onClose`)
  then `navigate(\`/study/${studyId}/deployments?deploymentID=${deploymentID}\`)`.
- Static variant: `<span>` with the same icon + label, muted text color, no
  cursor change, no chevron.

Render call inside the footer at line 1531, immediately after the filename
span:

```jsx
{
  media.deploymentID && (
    <DeploymentLinkPill
      studyId={studyId}
      deploymentID={media.deploymentID}
      locationName={media.locationName}
      locationID={media.locationID}
      interactive={!deploymentID}
      onNavigate={onClose}
    />
  )
}
```

The footer's flex row already exists; the new element sits opposite the
filename naturally because filename has `flex-1` and the pill is fixed-width.

## Behavior on arrival

The Deployments tab already supports `?deploymentID=…` deep links via
`resolveSelectedDeployment` (`src/renderer/src/deployments/urlState.js`).
Navigating to `/study/:id/deployments?deploymentID=<id>` will:

1. Mount the Deployments tab.
2. Resolve the URL param against the loaded deployments list.
3. Auto-select that deployment, scroll the list to it, fly the map to it, and
   slide up the detail pane with the deployment's media gallery.

No additional wiring is needed on the Deployments-tab side.

## Out of scope

- Cross-tab "scroll to the same media" handoff. Clicking the pill takes you
  to the deployment's gallery; if you want to find the same image you can
  filter by species/date there. We can layer scroll-to-media on later if it
  turns out to be wanted.
- Surfacing the same pill anywhere else in the modal. Top-toolbar placement
  was considered and rejected — that bar is already busy with image
  controls; the footer has unused space and pairs naturally with the
  filename.
