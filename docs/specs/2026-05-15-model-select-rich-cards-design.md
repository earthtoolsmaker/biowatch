# Model selection dropdown: rich cards + path to install

**Date:** 2026-05-15
**Status:** Design — pending review
**Area:** renderer (`src/renderer/src/import.jsx`, `src/renderer/src/AddSourceModal.jsx`, new `src/renderer/src/models/ModelSelect.jsx` and `src/renderer/src/models/installStatus.js`; light navigation hook into `src/renderer/src/models/ModelListPane.jsx`)

## Summary

Replace the current bare-bones model dropdown with a single rich-card
dropdown that teaches users what each model is and gives them a clear
path to install models they don't yet have. The standalone
"Install AI Models" button on the import screen and the amber
"No models installed" CTA in the Add Source modal both go away — their
job is folded into the dropdown itself, which is now also rendered when
zero models are installed.

Each row inside the dropdown carries the model name + version, a region
pill, the species count, and a two-line description. Installed models
get a `✓ Installed` pill and are selectable. Uninstalled models (or
models with a missing Python environment) get an `Install in Settings →`
affordance that navigates to `/settings/ml_zoo` with that model
scrolled into view and briefly highlighted. A persistent
`⚙ Manage models in Settings →` footer link gives users an escape hatch
for delete / reinstall / size-checking.

The dropdown does **not** show model size and does **not** install
models inline. Size is a property of the install action, and the
install action lives in Settings.

## Motivation

Two concrete problems with the current UI:

1. **The dropdown shows uninstalled models as disabled rows with a
   `(not installed)` suffix and no way to act on them.** A user who
   sees a model in the list but can't pick it has no path forward
   except to know on their own that they should navigate to Settings.
2. **The dropdown only shows `{name} v{version}`.** Users meeting
   SpeciesNet, DeepFaune, and Manas for the first time get no help
   choosing between them. The settings page has all the information
   they'd need (region, species count, description) — the dropdown
   surfaces none of it.

The current zero-models state — a primary "Install AI Models" button
on the import screen and an amber "No models installed" CTA inside the
Add Source modal — is a separate surface for the same job
(introducing users to the model catalogue). Folding it into the
dropdown reduces the number of UI states and gives first-time users
the same rich treatment as returning users.

## Non-goals

- Not changing the settings/ml_zoo cards (`ModelCard.jsx`). They
  already show size, full description, and species panels.
- Not adding new metadata to `modelZoo`. The dropdown uses fields that
  exist today.
- Not running downloads inline. The settings page remains the single
  surface for installs, progress, env handling, and size disclosure.
- Not changing how `modelLocked` works in `AddSourceModal.jsx` (the
  "this study's model was uninstalled, reinstall it" path is
  unchanged).
- No new test framework. Renderer unit tests cover the pure helper;
  the UI is verified manually.

## Design

### Component shape

A new shared component:

```
src/renderer/src/models/ModelSelect.jsx

<ModelSelect
  value={selectedModelRef}            // { id, version } | null
  onChange={(ref) => …}               // fires only for installed models
  installedModels={[…]}               // from listInstalledMLModels()
  installedEnvironments={[…]}         // from listInstalledMLModelEnvironments()
  triggerClassName="…"                // layout flex per caller
/>
```

Internally:

- `ModelSelectTrigger` — closed-state trigger. Shows the selected
  model's `name vX.Y` or the placeholder `"Select a model"`. Reuses
  shadcn `SelectTrigger` styling.
- `ModelSelectItem` — one rich card per model. Renders:
  - Top row: model name + version on the left, status affordance on
    the right (pill or button — see "States" below).
  - Meta row: region pill (color + label from
    `regions.js → getRegion()`) · species count.
  - Description: 2-line `line-clamp-2` of `model.description`.
- `ModelSelectFooter` — sticky bottom row inside the popover,
  `⚙ Manage models in Settings →`, always present.

### Status helper

The status derivation currently duplicated inline in two places
(`import.jsx:592-601`, `AddSourceModal.jsx:290-295`) moves to:

```
src/renderer/src/models/installStatus.js

export function getModelInstallStatus(model, installedModels, installedEnvironments) {
  const modelOk = installedModels.some(m =>
    m.id === model.reference.id && m.version === model.reference.version)
  const envOk = installedEnvironments.some(e =>
    e.id === model.pythonEnvironment.id && e.version === model.pythonEnvironment.version)
  if (modelOk && envOk) return 'installed'
  if (!modelOk)         return 'not-installed'
  return 'env-missing'
}
```

The existing callers' inline branches are removed and replaced with
calls to this helper.

### States per row

| Status          | Right-side affordance              | Selectable? | Click behavior                             |
| --------------- | ---------------------------------- | ----------- | ------------------------------------------ |
| `installed`     | `✓ Installed` pill                 | Yes         | Selects the model, closes popover          |
| `env-missing`   | `⚠ Environment missing` pill + nav | No          | Navigates to `/settings/ml_zoo`            |
| `not-installed` | `Install in Settings →` button    | No          | Navigates to `/settings/ml_zoo`            |

For `not-installed` and `env-missing`, the entire row is the click
target; the right-side button is a visual affordance for the same
action.

### Navigation with highlight

When the user clicks an uninstalled row, we navigate with route state:

```js
navigate('/settings/ml_zoo', { state: { highlightModel: { id, version } } })
```

`ModelListPane.jsx` reads `location.state.highlightModel` once on
mount, scrolls that `ModelCard` into view, and applies a brief
ring-flash (`ring-2 ring-blue-400` tweening out over ~1.5s). The
location state is cleared after the effect runs so that subsequent
navigations (e.g., browser back) don't re-trigger the flash.

### Always show the dropdown

`import.jsx`:

- The `!hasInstalledModels` branches that render
  `<Button>Install AI Models</Button>` (lines 671-679 and 711-720)
  are removed.
- The dropdown is always rendered. The "Select Folder" button stays
  disabled until `selectedModel` is set.

`AddSourceModal.jsx`:

- The amber "No models installed" CTA block (lines 238-256) is
  removed.
- The unlocked `<Select>` (lines 270-310) is replaced by `<ModelSelect/>`.
- The `modelLocked` reinstall path (lines 311-326) is left as-is.

### Data flow

No new IPC. `<ModelSelect/>` receives `installedModels` and
`installedEnvironments` as props from the parent. Both callers
already fetch these:

- `AddSourceModal.jsx:42-55` fetches both on modal open.
- `import.jsx` has them via `getCompletelyInstalledModels()` (need to
  expose the raw lists; small refactor of the existing hook).

When the user returns from `/settings/ml_zoo` after installing a
model, the parent re-fetches on mount, and the dropdown reflects the
new status. No live polling inside the dropdown.

### Component primitive

Start with shadcn `Select` (matches today's component). If
keyboard-Enter on uninstalled rows ends up conflicting with `Select`'s
value-selection model, swap to `Popover` + custom list during
implementation. This decision is isolated to `ModelSelect.jsx` and
does not affect callers.

## Edge cases

- **Mid-download model.** A model actively downloading from the
  settings page is not yet in `installedModels`. The dropdown shows
  it as `not-installed`. Clicking Install navigates to Settings,
  where the in-flight progress is already visible. No special state.
- **Selected model becomes uninstalled.** Only relevant in
  `AddSourceModal.jsx` (reopening a study whose model was deleted).
  Handled by the unchanged `modelLocked` branch.
- **All models installed.** Dropdown items all show `✓ Installed`.
  Footer link still present.
- **Long descriptions.** SpeciesNet's description is ~50 words.
  `line-clamp-2` truncates with no overflow. Full text remains on the
  settings card.
- **Keyboard navigation.** Tab into trigger, arrow keys through items,
  Enter selects installed models, Enter navigates for uninstalled
  rows. See "Component primitive" above for the implementation note.

## Testing

**Unit tests (renderer):**

- `test/renderer/installStatus.test.js` (using `node:test`,
  matching `test/renderer/regions.test.js`) — table-driven test of
  `getModelInstallStatus`: covers `installed`, `not-installed`,
  `env-missing`, and the case where both model and env are missing
  (still `not-installed`).

**Manual verification checklist:**

1. Fresh install, zero models installed. Open import screen. Trigger
   reads `"Select a model"`. Opening the dropdown shows all three
   models with `Install in Settings →`. Click one → lands on
   `/settings/ml_zoo`, that card is scrolled into view and
   ring-flashes briefly.
2. One model installed (e.g., SpeciesNet). Dropdown shows
   `✓ Installed` on it; other rows show `Install in Settings →`.
   Selecting SpeciesNet enables "Select Folder".
3. Model installed but env missing (simulate by deleting the env in
   Settings). Row shows `⚠ Environment missing` pill; row navigates
   to Settings on click.
4. Same three scenarios inside `AddSourceModal` ("Add images
   directory" from an existing study).
5. Selected model deleted in Settings while a study is open. Reopening
   the AddSource modal still shows the unchanged `modelLocked` reinstall
   path.
6. Keyboard nav: tab into trigger, arrow through items, Enter selects
   installed rows and navigates uninstalled rows.
7. Long descriptions clamp to 2 lines without overflow.
8. Footer `⚙ Manage models in Settings →` link works in both call
   sites and in all model states.

## Files changed

**New:**
- `src/renderer/src/models/ModelSelect.jsx`
- `src/renderer/src/models/installStatus.js`
- `test/renderer/installStatus.test.js` (uses `node:test`, matching the existing pattern at `test/renderer/regions.test.js`)

**Modified:**
- `src/renderer/src/import.jsx` — drop inline `modelSelect`, drop
  zero-state "Install AI Models" branches, always render
  `<ModelSelect/>`, gate "Select Folder" on `selectedModel`.
- `src/renderer/src/AddSourceModal.jsx` — drop amber "No models
  installed" CTA block, replace inline `<Select>` with
  `<ModelSelect/>`. Leave `modelLocked` branch unchanged.
- `src/renderer/src/models/ModelListPane.jsx` — read
  `location.state.highlightModel`, scroll into view, apply ring-flash,
  clear state.

## Open questions / out of scope

- Whether to swap shadcn `Select` for `Popover` + custom list is
  deferred to implementation; if it happens, it stays internal to
  `ModelSelect.jsx`.
- A future iteration could surface the model `logo` (already on each
  `modelZoo` entry) inside the dropdown row. Out of scope here to
  keep the visual density bounded.
