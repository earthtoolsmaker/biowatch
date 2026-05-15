# Model selection dropdown: rich cards + path to install — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare-bones model dropdown in `import.jsx` and `AddSourceModal.jsx` with a single rich-card `<ModelSelect/>` component that teaches users what each model is, marks installed vs uninstalled status visually, and gives uninstalled rows a clear navigation path to `/settings/ml_zoo`. Drop the standalone "Install AI Models" button and the amber "No models installed" CTA — the dropdown handles both jobs at zero-installed.

**Architecture:** One new component `src/renderer/src/models/ModelSelect.jsx` (built on the existing shadcn `Select` primitives from `src/renderer/src/ui/select.tsx`) plus one tiny pure helper `src/renderer/src/models/installStatus.js`. Two callers (`import.jsx`, `AddSourceModal.jsx`) drop their inline `<Select>` markup and inline status helpers and use `<ModelSelect/>` instead. `ModelListPane.jsx` adds a highlight-on-mount effect driven by `location.state.highlightModel`. No new IPC.

**Tech Stack:** React (Electron renderer), `react-router` (`useNavigate` + `useLocation`), `lucide-react` icons, Tailwind classes, shadcn-style `Select` wrapping `@radix-ui/react-select`. Tests run via `node:test` (matching `test/renderer/regions.test.js`).

**Reference spec:** [`docs/specs/2026-05-15-model-select-rich-cards-design.md`](../specs/2026-05-15-model-select-rich-cards-design.md).

**Testing approach:** The renderer doesn't have React component tests today (see `test/renderer/`, which covers pure modules only). Task 1 is full TDD on a pure helper. Tasks 2–5 verify the UI by running `npm run dev` and walking through specific scenarios listed in each task. Don't skip the manual checks — they are the test plan.

---

## Files

- **Create:** `src/renderer/src/models/installStatus.js` — pure status helper
- **Create:** `test/renderer/installStatus.test.js` — `node:test` unit tests
- **Create:** `src/renderer/src/models/ModelSelect.jsx` — the rich-card dropdown component
- **Modify:** `src/renderer/src/models/ModelListPane.jsx` — read `location.state.highlightModel`, scroll target card into view, apply ring-flash
- **Modify:** `src/renderer/src/AddSourceModal.jsx` — replace inline `<Select>` with `<ModelSelect/>`, drop the amber "No models installed" block, drop inline status helper
- **Modify:** `src/renderer/src/import.jsx` — replace inline `modelSelect` markup with `<ModelSelect/>`, always render it, drop the two "Install AI Models" buttons, drop inline status helpers (replace with new helper), gate "Select Folder" on a usable selection

---

## Task 1: Extract install-status helper + tests

**Files:**
- Create: `src/renderer/src/models/installStatus.js`
- Create: `test/renderer/installStatus.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/renderer/installStatus.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getModelInstallStatus } from '../../src/renderer/src/models/installStatus.js'

const SPECIESNET = {
  reference: { id: 'speciesnet', version: '4.0.1a' },
  pythonEnvironment: { id: 'common', version: '0.1.4' }
}

const DEEPFAUNE = {
  reference: { id: 'deepfaune', version: '1.3' },
  pythonEnvironment: { id: 'common', version: '0.1.4' }
}

describe('getModelInstallStatus', () => {
  test("returns 'installed' when both model and env are present", () => {
    const installedModels = [{ id: 'speciesnet', version: '4.0.1a' }]
    const installedEnvs = [{ id: 'common', version: '0.1.4' }]
    assert.equal(
      getModelInstallStatus(SPECIESNET, installedModels, installedEnvs),
      'installed'
    )
  })

  test("returns 'env-missing' when model is present but env is not", () => {
    const installedModels = [{ id: 'speciesnet', version: '4.0.1a' }]
    const installedEnvs = []
    assert.equal(
      getModelInstallStatus(SPECIESNET, installedModels, installedEnvs),
      'env-missing'
    )
  })

  test("returns 'not-installed' when model is not present", () => {
    const installedModels = []
    const installedEnvs = [{ id: 'common', version: '0.1.4' }]
    assert.equal(
      getModelInstallStatus(SPECIESNET, installedModels, installedEnvs),
      'not-installed'
    )
  })

  test("returns 'not-installed' when neither model nor env is present", () => {
    assert.equal(getModelInstallStatus(SPECIESNET, [], []), 'not-installed')
  })

  test('matches model by both id and version (not just id)', () => {
    const installedModels = [{ id: 'speciesnet', version: '3.0.0' }]
    const installedEnvs = [{ id: 'common', version: '0.1.4' }]
    assert.equal(
      getModelInstallStatus(SPECIESNET, installedModels, installedEnvs),
      'not-installed'
    )
  })

  test('matches env by both id and version', () => {
    const installedModels = [{ id: 'speciesnet', version: '4.0.1a' }]
    const installedEnvs = [{ id: 'common', version: '0.1.0' }]
    assert.equal(
      getModelInstallStatus(SPECIESNET, installedModels, installedEnvs),
      'env-missing'
    )
  })

  test('returns the right status for a different model in the same env', () => {
    const installedModels = [{ id: 'speciesnet', version: '4.0.1a' }]
    const installedEnvs = [{ id: 'common', version: '0.1.4' }]
    // DeepFaune shares the env but its own model isn't installed
    assert.equal(
      getModelInstallStatus(DEEPFAUNE, installedModels, installedEnvs),
      'not-installed'
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx node --test test/renderer/installStatus.test.js`
Expected: FAIL — module `installStatus.js` does not exist (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Implement the helper**

Create `src/renderer/src/models/installStatus.js`:

```js
/**
 * Pure helper that classifies a model's install status from the
 * installed-model and installed-environment lists returned by
 * `window.api.listInstalledMLModels()` and
 * `window.api.listInstalledMLModelEnvironments()`.
 *
 * Returns one of:
 *   - 'installed'      both model + env are present
 *   - 'env-missing'    model present, env missing (download was partial)
 *   - 'not-installed'  model missing (env may or may not be present)
 */
export function getModelInstallStatus(model, installedModels, installedEnvironments) {
  const modelOk = installedModels.some(
    (m) => m.id === model.reference.id && m.version === model.reference.version
  )
  if (!modelOk) return 'not-installed'

  const envOk = installedEnvironments.some(
    (e) =>
      e.id === model.pythonEnvironment.id && e.version === model.pythonEnvironment.version
  )
  return envOk ? 'installed' : 'env-missing'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx node --test test/renderer/installStatus.test.js`
Expected: PASS — all 7 tests pass.

Also run the full test suite to confirm nothing else broke:

Run: `npm test`
Expected: All tests pass (the new ones plus the existing suite). If anything unrelated fails, leave it for the user to triage — do not paper over it.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/models/installStatus.js test/renderer/installStatus.test.js
git commit -m "feat(models): extract install-status helper with unit tests"
```

---

## Task 2: Create the `<ModelSelect/>` component

**Files:**
- Create: `src/renderer/src/models/ModelSelect.jsx`

This task creates the component but does NOT wire it into any caller yet. Verification is by visual smoke test in a sandbox route — but to keep the diff focused, we'll just verify it compiles and lints clean. Real UI verification happens in Task 3 when we wire it into `AddSourceModal.jsx`.

- [ ] **Step 1: Create the component file**

Create `src/renderer/src/models/ModelSelect.jsx`:

```jsx
import { useNavigate } from 'react-router'
import { CheckCircle2, AlertTriangle, Settings, ArrowRight } from 'lucide-react'
import { modelZoo } from '../../../shared/mlmodels.js'
import { getRegion } from './regions.js'
import { getModelInstallStatus } from './installStatus.js'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '../ui/select'

function RegionPill({ regionId }) {
  const region = getRegion(regionId)
  if (!region) return null
  return (
    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground inline-flex items-center gap-1 flex-shrink-0">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: region.color }}
        aria-hidden
      />
      {region.label}
    </span>
  )
}

function StatusAffordance({ status }) {
  if (status === 'installed') {
    return (
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-500/30 inline-flex items-center gap-1 flex-shrink-0">
        <CheckCircle2 size={10} />
        Installed
      </span>
    )
  }
  if (status === 'env-missing') {
    return (
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-100 dark:border-amber-500/30 inline-flex items-center gap-1 flex-shrink-0">
        <AlertTriangle size={10} />
        Env missing
      </span>
    )
  }
  return (
    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-500/30 inline-flex items-center gap-1 flex-shrink-0">
      Install in Settings
      <ArrowRight size={10} />
    </span>
  )
}

function ModelRow({ model, status }) {
  return (
    <div className="flex flex-col gap-1 py-1 w-full min-w-0">
      <div className="flex items-center justify-between gap-2 w-full">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-sm text-foreground truncate">
            {model.name}
          </span>
          <span className="text-xs text-muted-foreground">v{model.reference.version}</span>
        </div>
        <StatusAffordance status={status} />
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <RegionPill regionId={model.region} />
        <span>{model.species_count} species</span>
      </div>
      <p className="text-xs text-muted-foreground leading-snug line-clamp-2">
        {model.description}
      </p>
    </div>
  )
}

const FOOTER_VALUE = '__manage_models__'

/**
 * Rich-card model picker. Renders all entries from `modelZoo`:
 *   - installed rows: selectable, fire `onChange({ id, version })`
 *   - uninstalled / env-missing rows: navigate to /settings/ml_zoo with
 *     route state `{ highlightModel: { id, version } }` so the settings
 *     page can scroll-and-flash the matching card.
 *
 * Always renders a "Manage models in Settings →" footer entry.
 *
 * Props:
 *   value                 — { id, version } | null (currently selected model)
 *   onChange              — (ref) => void; called only for installed picks
 *   installedModels       — array from listInstalledMLModels()
 *   installedEnvironments — array from listInstalledMLModelEnvironments()
 *   onBeforeNavigate      — optional; called when an uninstalled row triggers
 *                           navigation (e.g. parent closes its modal first)
 *   triggerClassName      — optional Tailwind classes for the trigger
 *   placeholder           — string placeholder when no model is selected
 */
export default function ModelSelect({
  value,
  onChange,
  installedModels,
  installedEnvironments,
  onBeforeNavigate,
  triggerClassName,
  placeholder = 'Select a model'
}) {
  const navigate = useNavigate()

  const valueKey = value ? `${value.id}-${value.version}` : ''

  const handleValueChange = (key) => {
    if (key === FOOTER_VALUE) {
      onBeforeNavigate?.()
      navigate('/settings/ml_zoo')
      return
    }

    const [id, ...rest] = key.split('-')
    const version = rest.join('-')
    const model = modelZoo.find(
      (m) => m.reference.id === id && m.reference.version === version
    )
    if (!model) return

    const status = getModelInstallStatus(model, installedModels, installedEnvironments)
    if (status === 'installed') {
      onChange({ id: model.reference.id, version: model.reference.version })
      return
    }
    // not-installed or env-missing → navigate with highlight state
    onBeforeNavigate?.()
    navigate('/settings/ml_zoo', {
      state: { highlightModel: { id: model.reference.id, version: model.reference.version } }
    })
  }

  const selectedModel = value
    ? modelZoo.find((m) => m.reference.id === value.id && m.reference.version === value.version)
    : null

  return (
    <Select value={valueKey} onValueChange={handleValueChange}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder={placeholder}>
          {selectedModel ? `${selectedModel.name} v${selectedModel.reference.version}` : placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-w-[min(560px,calc(100vw-2rem))] w-[var(--radix-select-trigger-width)] min-w-[320px]">
        <SelectGroup>
          {modelZoo.map((model) => {
            const status = getModelInstallStatus(
              model,
              installedModels,
              installedEnvironments
            )
            return (
              <SelectItem
                key={`${model.reference.id}-${model.reference.version}`}
                value={`${model.reference.id}-${model.reference.version}`}
                className="items-start [&>span:last-child]:hidden cursor-pointer py-2"
              >
                <ModelRow model={model} status={status} />
              </SelectItem>
            )
          })}
        </SelectGroup>
        <SelectSeparator />
        <SelectItem
          value={FOOTER_VALUE}
          className="cursor-pointer text-sm text-muted-foreground"
        >
          <span className="inline-flex items-center gap-2">
            <Settings size={12} />
            Manage models in Settings
            <ArrowRight size={12} />
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  )
}
```

**Notes for the implementer.**

- Radix `Select.Item` runs `onValueChange` for every pick — installed or not. We branch on status inside `handleValueChange` so that uninstalled rows navigate instead of becoming the selected value. This is the intentional pattern from the spec (§"Component primitive").
- The `[&>span:last-child]:hidden` class hides the default Radix check-icon slot on the right since each row brings its own status pill. (`SelectItem` in `ui/select.tsx` renders `<span class="absolute right-2 …">` as the indicator slot.)
- `line-clamp-2` is provided by the project's Tailwind config (used elsewhere — verify by searching the codebase if it's missing).
- `onBeforeNavigate` exists so `AddSourceModal` can close itself before navigation (otherwise the modal stays open underneath the settings page).

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint` (or equivalent — check `package.json` scripts).

Expected: no new lint errors in `src/renderer/src/models/ModelSelect.jsx`.

If `npm run lint` isn't configured, run a build/typecheck to catch obvious problems:

Run: `npm run build` (Electron build script; OK to interrupt after the renderer compiles cleanly).

Expected: renderer bundle compiles without errors mentioning `ModelSelect.jsx`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/models/ModelSelect.jsx
git commit -m "feat(models): add ModelSelect rich-card dropdown component"
```

---

## Task 3: Wire `<ModelSelect/>` into `AddSourceModal.jsx`

**Files:**
- Modify: `src/renderer/src/AddSourceModal.jsx`

This replaces the inline `<Select>` (lines 271-309) and removes the amber "No models installed" CTA block (lines 238-256). The `modelLocked` reinstall path (lines 311-326) stays untouched.

- [ ] **Step 1: Add the import**

Open `src/renderer/src/AddSourceModal.jsx`. At the top, replace the `Select` import (line 6):

```jsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
```

with imports for `Select` (still needed for the unrelated Country dropdown further down) and the new component:

```jsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import ModelSelect from './models/ModelSelect.jsx'
```

(The existing `Select` import stays — the country picker still uses it.)

- [ ] **Step 2: Remove the inline `isModelCompletelyInstalled` helper and the `hasAnyInstalledModel` derived value**

In `src/renderer/src/AddSourceModal.jsx`, locate the inline helper around lines 57-65:

```jsx
const isModelCompletelyInstalled = (model) => {
  const modelOk = installedModels.some(
    (m) => m.id === model.reference.id && m.version === model.reference.version
  )
  const envOk = installedEnvironments.some(
    (e) => e.id === model.pythonEnvironment.id && e.version === model.pythonEnvironment.version
  )
  return modelOk && envOk
}
```

Replace it with an import and a thin wrapper:

```jsx
// At the top of the file, add to existing imports:
import { getModelInstallStatus } from './models/installStatus.js'

// In place of the deleted helper:
const isModelCompletelyInstalled = (model) =>
  getModelInstallStatus(model, installedModels, installedEnvironments) === 'installed'
```

(We keep the name so the `modelLocked` reinstall branch later in the file — which calls `isModelCompletelyInstalled(pickedModel)` — keeps working.)

Find and delete the `hasAnyInstalledModel` derived value around line 153:

```jsx
const hasAnyInstalledModel = modelZoo.some(isModelCompletelyInstalled)
```

It's only used by the amber CTA block we're about to remove.

- [ ] **Step 3: Remove the amber "No models installed" block**

Delete the block at lines 238-256 (the `{!modelLocked && !hasAnyInstalledModel && (…)}` JSX expression and its contents — the entire amber warning panel). Leave a blank line where it was.

After deletion, the section that started with the comment `{/* No-models-installed CTA: dead-end for users with a fresh install */}` is gone entirely.

- [ ] **Step 4: Replace the inline Select with `<ModelSelect/>`**

Find the unlocked branch of the Model picker (lines 270-310, the `<Select …>` block — the one with `modelZoo.map` and the `(not installed)` / `(environment missing)` suffix logic).

Replace this entire `<Select> … </Select>` block:

```jsx
<Select
  value={pickedModelKey}
  onValueChange={(value) => {
    const [id, ...rest] = value.split('-')
    const version = rest.join('-')
    const model = modelZoo.find(
      (m) => m.reference.id === id && m.reference.version === version
    )
    if (model && isModelCompletelyInstalled(model)) {
      setPickedModelKey(value)
    }
  }}
>
  <SelectTrigger className="w-full bg-card border-border">
    <SelectValue placeholder="Select a model" />
  </SelectTrigger>
  <SelectContent>
    {modelZoo.map((m) => {
      const installed = isModelCompletelyInstalled(m)
      const modelOk = installedModels.some(
        (im) => im.id === m.reference.id && im.version === m.reference.version
      )
      let suffix = ''
      if (!modelOk) suffix = ' (not installed)'
      else if (!installed) suffix = ' (environment missing)'
      return (
        <SelectItem
          key={`${m.reference.id}-${m.reference.version}`}
          value={`${m.reference.id}-${m.reference.version}`}
          disabled={!installed}
          className={!installed ? 'opacity-50 cursor-not-allowed' : ''}
        >
          {m.name} v{m.reference.version}
          {suffix}
        </SelectItem>
      )
    })}
  </SelectContent>
</Select>
```

with:

```jsx
<ModelSelect
  value={
    pickedModelKey
      ? (() => {
          const [id, ...rest] = pickedModelKey.split('-')
          return { id, version: rest.join('-') }
        })()
      : null
  }
  onChange={(ref) => setPickedModelKey(`${ref.id}-${ref.version}`)}
  installedModels={installedModels}
  installedEnvironments={installedEnvironments}
  onBeforeNavigate={onClose}
  triggerClassName="w-full bg-card border-border"
/>
```

The `onBeforeNavigate={onClose}` ensures the modal closes before navigation lands on the settings page.

- [ ] **Step 5: Manual verification — installed model selection**

Run: `npm run dev`

Open an existing study (need at least one model installed already — e.g. SpeciesNet). Click "+ Add images directory" / equivalent to open the AddSource modal in its **unlocked** form (i.e. study has no prior model run).

If you don't have such a study, create one via the Import flow with a small folder.

Expected:
- Modal opens. Model dropdown is rendered with `<ModelSelect/>`.
- Opening the dropdown shows three rich-card rows (SpeciesNet, DeepFaune, Manas) and a "Manage models in Settings →" footer.
- The installed model shows a green `✓ Installed` pill on the right.
- Clicking the installed row selects it; trigger collapses and shows `<name> v<version>`.

- [ ] **Step 6: Manual verification — uninstalled model navigates**

Still in `npm run dev`. Open the same modal.

Click on an uninstalled row (e.g. DeepFaune if you only have SpeciesNet).

Expected:
- The modal closes (because `onBeforeNavigate={onClose}` fired).
- The app navigates to `/settings/ml_zoo`.
- Highlight effect is NOT yet implemented (Task 4 adds it) — the card is not flashed yet. That's expected.

- [ ] **Step 7: Manual verification — zero models installed**

Stop the app. Manually clear all installed models: navigate to `/settings/ml_zoo` and click "Clear all" (or delete each model card's button). Confirm the install state is empty.

Re-open a study and the AddSource modal.

Expected:
- The amber "No models installed" CTA block is **gone**.
- The dropdown is rendered. The trigger shows the placeholder "Select a model".
- Opening it shows all three models with `Install in Settings →` pills.
- Clicking any row closes the modal and navigates to `/settings/ml_zoo`.
- The locked path (when the study already has a prior model run on a now-uninstalled model) is unchanged — verify by re-installing SpeciesNet, using it on a study, deleting it from Settings, then reopening the AddSource modal on that study. The amber-text reinstall hint and its `Open Models` button still appear.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/AddSourceModal.jsx
git commit -m "feat(add-source): use ModelSelect rich-card dropdown"
```

---

## Task 4: Add highlight-on-mount to `ModelListPane.jsx`

**Files:**
- Modify: `src/renderer/src/models/ModelListPane.jsx`

When the user navigates from `<ModelSelect/>` to `/settings/ml_zoo` with `state: { highlightModel: { id, version } }`, scroll that card into view and apply a brief ring-flash.

- [ ] **Step 1: Update the imports and add the highlight effect**

Open `src/renderer/src/models/ModelListPane.jsx`. Replace the top of the file (lines 1-5):

```jsx
import { useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import ModelCard from './ModelCard'
import SpeciesPanel from './SpeciesPanel'
import CustomModelCard from './CustomModelCard'
```

with:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Trash2 } from 'lucide-react'
import ModelCard from './ModelCard'
import SpeciesPanel from './SpeciesPanel'
import CustomModelCard from './CustomModelCard'
```

- [ ] **Step 2: Add the highlight state + effect inside the component**

Inside `ModelListPane`, just after `const ordered = useMemo(...)` (line 26), add:

```jsx
const location = useLocation()
const navigate = useNavigate()
const cardRefs = useRef(new Map())
const [highlightedKey, setHighlightedKey] = useState(null)

useEffect(() => {
  const target = location.state?.highlightModel
  if (!target) return
  const key = `${target.id}-${target.version}`
  const el = cardRefs.current.get(key)
  if (!el) return

  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  setHighlightedKey(key)
  const t = setTimeout(() => setHighlightedKey(null), 1500)

  // Clear the route state so back/forward navigation doesn't re-trigger.
  navigate(location.pathname, { replace: true, state: null })

  return () => clearTimeout(t)
}, [location.state, location.pathname, navigate])
```

**Why `replace: true` with `state: null`:** `react-router`'s state is part of the history entry. Without clearing it, hitting Back from another page in Settings and forward again would re-trigger the flash.

- [ ] **Step 3: Wrap each `<ModelCard>` so we can target it for scroll + flash**

Replace the map block (lines 45-57):

```jsx
{ordered.map((model) => (
  <ModelCard
    key={model.reference.id}
    model={model}
    selected={selectedId === model.reference.id}
    speciesOpen={openSpeciesId === model.reference.id}
    onSelect={onSelect}
    onToggleSpecies={onToggleSpecies}
    speciesPanel={<SpeciesPanel model={model} />}
    refreshKey={refreshKey}
    onDownloadStatusChange={onDownloadStatusChange}
  />
))}
```

with:

```jsx
{ordered.map((model) => {
  const key = `${model.reference.id}-${model.reference.version}`
  const isHighlighted = highlightedKey === key
  return (
    <div
      key={key}
      ref={(el) => {
        if (el) cardRefs.current.set(key, el)
        else cardRefs.current.delete(key)
      }}
      className={
        isHighlighted
          ? 'rounded-lg ring-2 ring-blue-400 ring-offset-2 ring-offset-background transition-shadow duration-700'
          : 'transition-shadow duration-700'
      }
    >
      <ModelCard
        model={model}
        selected={selectedId === model.reference.id}
        speciesOpen={openSpeciesId === model.reference.id}
        onSelect={onSelect}
        onToggleSpecies={onToggleSpecies}
        speciesPanel={<SpeciesPanel model={model} />}
        refreshKey={refreshKey}
        onDownloadStatusChange={onDownloadStatusChange}
      />
    </div>
  )
})}
```

**Note:** We moved `key` from `<ModelCard>` to the wrapper `<div>` so React's reconciliation lines up with the wrapper, and changed the `key` value from `model.reference.id` to the `id-version` combination (matches `cardRefs` map keys).

- [ ] **Step 4: Manual verification — highlight fires from AddSourceModal**

Run: `npm run dev`

Open a study, open the AddSource modal (unlocked form). Click an uninstalled model row.

Expected:
- Modal closes.
- App navigates to `/settings/ml_zoo`.
- The clicked model's card scrolls into view (smooth scroll, centered).
- A blue ring flashes around the card for ~1.5s, then fades.
- Hitting browser Back, then Forward, does NOT re-trigger the flash (because the route state was cleared).

- [ ] **Step 5: Manual verification — settings page without route state**

Stop the app, restart, navigate to `/settings/ml_zoo` directly (via the settings sidebar).

Expected:
- Page renders normally. No card is scrolled to. No ring flash. List shows from the top.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/models/ModelListPane.jsx
git commit -m "feat(models): highlight-on-mount for target model from route state"
```

---

## Task 5: Wire `<ModelSelect/>` into `import.jsx` + drop legacy CTAs

**Files:**
- Modify: `src/renderer/src/import.jsx`

The biggest of the five tasks. Three things happen:

1. Replace the inline `modelSelect` (lines 565-617) with `<ModelSelect/>`.
2. Always render the dropdown — drop both `Install AI Models` button branches (the hero card and the alternate card).
3. Disable "Select Folder" when no installed model is currently selected.

- [ ] **Step 1: Update imports**

Open `src/renderer/src/import.jsx`. Add the new imports near the top of the file (after the existing local-module imports around lines 7-13):

```jsx
import ModelSelect from './models/ModelSelect.jsx'
import { getModelInstallStatus } from './models/installStatus.js'
```

The existing `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` import (line 27) is no longer used anywhere in `import.jsx` after this task. Remove it:

```jsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.jsx'
```

Delete that line entirely.

(Sanity-check before deleting: grep for `SelectTrigger`, `SelectContent`, etc. in `import.jsx`. The only matches should be inside the to-be-removed `modelSelect` block.)

- [ ] **Step 2: Replace the inline status helpers with the new helper**

Find the three `useCallback`-wrapped helpers `isModelInstalled`, `isEnvironmentInstalled`, `isModelCompletelyInstalled` (lines 229-261).

Replace **all three** with a single derived helper that uses the shared function:

```jsx
const isModelCompletelyInstalled = useCallback(
  (modelReference) => {
    const model = modelZoo.find(
      (m) =>
        m.reference.id === modelReference.id && m.reference.version === modelReference.version
    )
    if (!model) return false
    return (
      getModelInstallStatus(model, installedModels, installedEnvironments) === 'installed'
    )
  },
  [installedModels, installedEnvironments]
)
```

(The `useCallback` import is already in place; `modelZoo` is already imported.)

Also delete `getCompletelyInstalledModels` (lines 312-317) — it's only used to compute `hasInstalledModels` (line 563), and that derived value goes away in Step 4.

- [ ] **Step 3: Simplify the "set default selected model" effect**

The existing effect at lines 263-310 inlines a local filter. Replace its body with the helper. The full effect becomes:

```jsx
useEffect(() => {
  const fetchInstalledData = async () => {
    try {
      const [models, environments] = await Promise.all([
        window.api.listInstalledMLModels(),
        window.api.listInstalledMLModelEnvironments()
      ])

      setInstalledModels(models)
      setInstalledEnvironments(environments)

      const completelyInstalledModels = modelZoo.filter(
        (m) => getModelInstallStatus(m, models, environments) === 'installed'
      )

      if (completelyInstalledModels.length > 0) {
        const firstCompleteModel = completelyInstalledModels[0]
        setSelectedModel((currentSelected) => {
          if (!currentSelected) return firstCompleteModel.reference
          const isCurrentValid = completelyInstalledModels.some(
            (m) =>
              m.reference.id === currentSelected.id &&
              m.reference.version === currentSelected.version
          )
          return isCurrentValid ? currentSelected : firstCompleteModel.reference
        })
      } else {
        // Zero installed: drop any stale selection so the dropdown shows
        // the placeholder and "Select Folder" stays disabled.
        setSelectedModel(null)
      }
    } catch (error) {
      console.error('Failed to fetch installed models and environments:', error)
      setInstalledModels([])
      setInstalledEnvironments([])
    }
  }
  fetchInstalledData()
}, [])
```

Also change the initial `selectedModel` state (line 53):

```jsx
const [selectedModel, setSelectedModel] = useState(modelZoo[0]?.reference || null)
```

to:

```jsx
const [selectedModel, setSelectedModel] = useState(null)
```

(The effect above sets it to the first installed model on mount.)

- [ ] **Step 4: Replace the `modelSelect` block with `<ModelSelect/>` and drop `hasInstalledModels`**

Find the block at lines 563-617:

```jsx
const hasInstalledModels = getCompletelyInstalledModels().length > 0

const modelSelect = (
  <Select …>
    …
  </Select>
)
```

Replace it with:

```jsx
const modelSelect = (
  <ModelSelect
    value={selectedModel}
    onChange={setSelectedModel}
    installedModels={installedModels}
    installedEnvironments={installedEnvironments}
    triggerClassName="w-full sm:max-w-lg bg-card border-border"
  />
)

const canImport =
  selectedModel != null && isModelCompletelyInstalled(selectedModel)
```

(`canImport` is the new gate for "Select Folder" — see Step 5.)

- [ ] **Step 5: Always render the dropdown — drop "Install AI Models" branches**

Two spots in the JSX use `hasInstalledModels` to conditionally render either the dropdown or an "Install AI Models" button. Both need to change so the dropdown always renders and the folder picker is disabled when `canImport` is false.

**First spot: the recommended-hero card (lines ~660-690)**. Find this block:

```jsx
<div className="flex-1 min-w-0">
  <div className="flex items-center gap-2">
    <h3 className="font-medium">Images Directory</h3>
    <span className="text-xs text-blue-600 dark:text-blue-400">Recommended</span>
  </div>
  <p className="text-sm text-muted-foreground mt-0.5">
    Import images and detect species using AI models.
    {!hasInstalledModels && ' Install an AI model to get started.'}
  </p>
</div>
{!hasInstalledModels && (
  <Button onClick={() => navigate('/settings/ml_zoo')} className="shrink-0">
    Install AI Models
  </Button>
)}
</div>
{hasInstalledModels && (
  <div className="flex flex-col sm:flex-row gap-2 mt-3 sm:items-center">
    {modelSelect}
    <Button onClick={handleImportImages} className="shrink-0 sm:ml-auto sm:w-40">
      <FolderOpen className="size-4 mr-2" />
      Select Folder
    </Button>
  </div>
)}
```

Replace it with (always render the dropdown, gate the button):

```jsx
<div className="flex-1 min-w-0">
  <div className="flex items-center gap-2">
    <h3 className="font-medium">Images Directory</h3>
    <span className="text-xs text-blue-600 dark:text-blue-400">Recommended</span>
  </div>
  <p className="text-sm text-muted-foreground mt-0.5">
    Import images and detect species using AI models.
  </p>
</div>
</div>
<div className="flex flex-col sm:flex-row gap-2 mt-3 sm:items-center">
  {modelSelect}
  <Button
    onClick={handleImportImages}
    disabled={!canImport}
    className="shrink-0 sm:ml-auto sm:w-40"
  >
    <FolderOpen className="size-4 mr-2" />
    Select Folder
  </Button>
</div>
```

**Second spot: the alternate (returning-user) card (lines ~700-735)**. Find this block:

```jsx
<div className="flex-1 min-w-0">
  <h4 className="text-sm font-medium leading-tight">Images Directory</h4>
  <p className="text-xs text-muted-foreground truncate mt-0.5">
    {hasInstalledModels
      ? 'Import images and classify species using AI'
      : 'Install an AI model to import an images folder'}
  </p>
</div>
{!hasInstalledModels ? (
  <Button
    variant="outline"
    size="sm"
    className="shrink-0"
    onClick={() => navigate('/settings/ml_zoo')}
  >
    Install AI Models
  </Button>
) : (
  <div className="flex flex-1 sm:flex-none sm:basis-auto basis-full min-w-[240px] gap-2 sm:ml-auto">
    <div className="flex-1 min-w-0">{modelSelect}</div>
    <Button
      variant="outline"
      size="sm"
      className="shrink-0"
      onClick={handleImportImages}
    >
      Select Folder
    </Button>
  </div>
)}
```

Replace it with:

```jsx
<div className="flex-1 min-w-0">
  <h4 className="text-sm font-medium leading-tight">Images Directory</h4>
  <p className="text-xs text-muted-foreground truncate mt-0.5">
    Import images and classify species using AI
  </p>
</div>
<div className="flex flex-1 sm:flex-none sm:basis-auto basis-full min-w-[240px] gap-2 sm:ml-auto">
  <div className="flex-1 min-w-0">{modelSelect}</div>
  <Button
    variant="outline"
    size="sm"
    className="shrink-0"
    onClick={handleImportImages}
    disabled={!canImport}
  >
    Select Folder
  </Button>
</div>
```

- [ ] **Step 6: Manual verification — zero installed**

Run: `npm run dev`

Clear all installed models from Settings (Clear all button).

Navigate to the Import page.

Expected:
- The hero "Images Directory" card and the alternate card both render their dropdown. The trigger shows "Select a model".
- The "Install AI Models" button is **gone** from both cards.
- "Select Folder" is rendered but **disabled** (greyed, no pointer).
- Opening the dropdown shows all three models with `Install in Settings →` pills + the footer link.
- Clicking any uninstalled row navigates to `/settings/ml_zoo` and flashes that model's card (Task 4 work).

- [ ] **Step 7: Manual verification — one model installed**

Install SpeciesNet from the settings page. Navigate back to Import.

Expected:
- Dropdown trigger reads `SpeciesNet v4.0.1a` (auto-selected by the effect in Step 3).
- "Select Folder" is **enabled**.
- Opening the dropdown shows SpeciesNet with `✓ Installed` and the other two with `Install in Settings →`. Footer link present.
- Clicking "Select Folder" opens the native folder picker (existing behaviour).

- [ ] **Step 8: Manual verification — env-missing edge case**

Manually simulate env-missing: in Settings, delete a model whose env you have, then re-download just the model (or, easier: edit local state so `installedModels` includes the model but `installedEnvironments` doesn't).

If easier: skip this in dev and just visually verify by reading the code that `getModelInstallStatus` returns `env-missing` and `<ModelSelect/>` renders the amber pill. Logged here so QA can hit it during release testing.

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `installStatus.test.js` (already added in Task 1) and the existing suite.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/import.jsx
git commit -m "feat(import): use ModelSelect dropdown, drop standalone Install AI Models CTA"
```

---

## Final verification

After all five tasks are merged, run through the spec's manual verification checklist once end-to-end:

1. Fresh install, zero models — import screen → dropdown trigger reads "Select a model"; opening it shows all three models with Install pills; clicking one lands on Settings with that card scrolled-and-flashed.
2. One model installed (SpeciesNet) — dropdown shows ✓ Installed on it; others show Install. Picking SpeciesNet enables Select Folder.
3. Env-missing state — row shows ⚠ Env missing pill; click navigates with highlight.
4. Same three states inside AddSourceModal.
5. Selected model deleted in Settings while a study is open — reopening AddSourceModal still shows the unchanged `modelLocked` reinstall path with the `Open Models` button.
6. Keyboard nav: tab into trigger, arrow through items, Enter selects installed rows and navigates uninstalled rows. (Radix Select handles arrow keys natively.)
7. Long descriptions clamp to 2 lines.
8. "Manage models in Settings →" footer works from both call sites in all model states.

If anything in this list fails, capture it in a follow-up task — do not paper over it inside this branch.

## Out of scope (reminders from the spec)

- Showing model **size** anywhere in the dropdown.
- Inline downloads — clicking Install always navigates to Settings.
- Adding new metadata to `modelZoo`.
- A new test framework for renderer React components.
- Surfacing the `logo` field in dropdown rows (deferred to a future iteration).
