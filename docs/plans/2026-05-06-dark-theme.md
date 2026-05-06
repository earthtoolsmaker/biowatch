# Dark Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tri-state (System/Light/Dark) theme toggle to Biowatch, persisting across launches, following the OS preference when set to System, and re-theming the entire renderer in dark mode without altering light-mode appearance.

**Architecture:** Main process owns theme state via Electron's `nativeTheme`, persisted to `~userData/preferences.json`. Renderer subscribes via IPC and toggles `<html class="dark">`. Light-mode pixels are preserved by adding semantic tokens for neutrals only and pairing colored utilities (blue/red/green/yellow) with explicit `dark:` variants via a small codemod.

**Tech Stack:** Electron `nativeTheme`, Tailwind CSS v4 `@custom-variant`, React hooks + IPC, Node `node:test` for unit tests, Playwright for e2e.

**Spec:** `docs/specs/2026-05-06-dark-theme-design.md`

**Implementation order is significant.** Phases 1–3 leave the app fully functional in light mode while preparing infrastructure. Phase 4's codemod migrations land per-directory so dark mode lights up incrementally. Phase 5 wires up the user-facing toggle. Phase 6 covers third-party libs, tests, and docs.

---

## Phase 1 — Token Foundation

### Task 1: Add dark variant + dark token block to main.css

**Files:**

- Modify: `src/renderer/src/assets/main.css`

This task makes `dark:` classes work and adds dark counterpart values for every existing light token, but produces zero visible change because no component yet references `dark:` and no element has the `dark` class.

- [ ] **Step 1: Add the custom variant declaration**

In `src/renderer/src/assets/main.css`, immediately after the `@import 'tailwindcss';` line (line 2), insert:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

- [ ] **Step 2: Add the dark token block**

Append this block at the end of the file (after the existing `@theme` block, after the `body` rule, but before the `.logo` rule — pick a spot grouped with other CSS variable definitions for readability):

```css
.dark {
  --color-background: #0f172a; /* slate-900 */
  --color-foreground: #f1f5f9; /* slate-100 */
  --color-card: #1e293b; /* slate-800 */
  --color-card-foreground: #f1f5f9;
  --color-popover: #1e293b;
  --color-popover-foreground: #f1f5f9;
  --color-primary: oklch(0.985 0 0);
  --color-primary-foreground: #030213;
  --color-secondary: #334155;
  --color-secondary-foreground: #f1f5f9;
  --color-muted: #334155;
  --color-muted-foreground: #94a3b8;
  --color-accent: #334155;
  --color-accent-foreground: #f1f5f9;
  --color-destructive: #f87171;
  --color-destructive-foreground: #ffffff;
  --color-border: rgba(255, 255, 255, 0.1);
  --color-input: transparent;
  --color-input-background: #1e293b;
  --color-switch-background: #475569;
  --color-ring: oklch(0.708 0 0);
  --color-chart-1: oklch(0.7 0.18 41);
  --color-chart-2: oklch(0.65 0.14 184);
  --color-chart-3: oklch(0.55 0.16 227);
  --color-chart-4: oklch(0.78 0.18 84);
  --color-chart-5: oklch(0.72 0.2 70);
  --color-sidebar: #0a0f1f;
  --color-sidebar-foreground: #cbd5e1;
  --color-sidebar-primary: oklch(0.985 0 0);
  --color-sidebar-primary-foreground: #030213;
  --color-sidebar-accent: #1e293b;
  --color-sidebar-accent-foreground: #f1f5f9;
  --color-sidebar-border: rgba(255, 255, 255, 0.08);
  --color-sidebar-ring: oklch(0.708 0 0);
}

.dark body {
  background-color: var(--color-background);
}
```

- [ ] **Step 3: Verify the build still compiles**

Run: `npm run dev`
Expected: dev server starts, app launches normally, **light mode appearance unchanged**. No console errors about CSS parsing.

Force-test the dark block by opening DevTools and running:

```js
document.documentElement.classList.add('dark')
```

Expected: page flips to a slate-dark background. Most components still look "light" because they hardcode utilities — only elements that already use semantic tokens (almost none in this codebase yet) re-theme. This is expected at this phase.

Remove the class with:

```js
document.documentElement.classList.remove('dark')
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/assets/main.css
git commit -m "feat(theme): add dark variant and dark token block

@custom-variant dark plus a .dark { ... } block defining slate-flavored
dark counterparts to the existing @theme tokens. No visible change in
light mode; dark mode is now activatable by adding class=\"dark\" to <html>
but most components still hardcode utilities and won't yet re-theme."
```

---

## Phase 2 — Theme Infrastructure (Main Process)

### Task 2: Preferences service with tests

**Files:**

- Create: `src/main/services/preferences.js`
- Create: `test/main/services/preferences.test.js`

A simple JSON-backed key-value store living at `path.join(app.getPath('userData'), 'preferences.json')`. Atomic writes (write-temp-then-rename) so a crash mid-write can't corrupt the file. Read returns `{}` for missing or corrupt files.

- [ ] **Step 1: Write the failing test**

Create `test/main/services/preferences.test.js`:

```js
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { createPreferencesStore } from '../../../src/main/services/preferences.js'

let testDir

beforeEach(() => {
  testDir = join(tmpdir(), 'biowatch-prefs-test', Date.now().toString() + Math.random())
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
})

describe('preferences store', () => {
  test('reads {} when file does not exist', () => {
    const store = createPreferencesStore(testDir)
    assert.deepEqual(store.read(), {})
  })

  test('reads {} when file is corrupt JSON', () => {
    writeFileSync(join(testDir, 'preferences.json'), '{not json')
    const store = createPreferencesStore(testDir)
    assert.deepEqual(store.read(), {})
  })

  test('round-trips a write', () => {
    const store = createPreferencesStore(testDir)
    store.write({ theme: { source: 'dark' } })
    assert.deepEqual(store.read(), { theme: { source: 'dark' } })
  })

  test('write is atomic (no .tmp file left over)', () => {
    const store = createPreferencesStore(testDir)
    store.write({ theme: { source: 'system' } })
    const entries = require('fs').readdirSync(testDir)
    assert.deepEqual(entries.sort(), ['preferences.json'])
  })

  test('write fully replaces the file', () => {
    const store = createPreferencesStore(testDir)
    store.write({ theme: { source: 'dark' }, other: 'foo' })
    store.write({ theme: { source: 'light' } })
    assert.deepEqual(store.read(), { theme: { source: 'light' } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/main/services/preferences.test.js`
Expected: FAIL with "Cannot find module '../../../src/main/services/preferences.js'".

- [ ] **Step 3: Implement the service**

Create `src/main/services/preferences.js`:

```js
import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import { join } from 'path'
import log from './logger.js'

const FILENAME = 'preferences.json'

export function createPreferencesStore(userDataPath) {
  const filePath = join(userDataPath, FILENAME)
  const tmpPath = join(userDataPath, FILENAME + '.tmp')

  function read() {
    if (!existsSync(filePath)) return {}
    try {
      const raw = readFileSync(filePath, 'utf8')
      return JSON.parse(raw)
    } catch (err) {
      log.warn('preferences.json unreadable, falling back to defaults', err)
      return {}
    }
  }

  function write(prefs) {
    writeFileSync(tmpPath, JSON.stringify(prefs, null, 2), 'utf8')
    renameSync(tmpPath, filePath)
  }

  return { read, write }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/main/services/preferences.test.js`
Expected: 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/preferences.js test/main/services/preferences.test.js
git commit -m "feat(prefs): add preferences store backed by JSON file

Atomic write via temp+rename, graceful fallback to {} for missing or
corrupt files. Lives at userData/preferences.json."
```

---

### Task 3: Theme service (main) with tests

**Files:**

- Create: `src/main/services/theme.js`
- Create: `test/main/services/theme.test.js`

Wraps `nativeTheme`, the preferences store, and broadcasts to renderers. The service does not register IPC handlers itself (Task 4 does that) — it exposes pure functions that the IPC layer calls. This keeps unit tests simple: mock the store and the `nativeTheme` object, no Electron required.

- [ ] **Step 1: Write the failing test**

Create `test/main/services/theme.test.js`:

```js
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { createThemeService } from '../../../src/main/services/theme.js'

function makeMocks() {
  const fakeNativeTheme = {
    themeSource: 'system',
    shouldUseDarkColors: false,
    _listeners: [],
    on(event, fn) {
      if (event === 'updated') this._listeners.push(fn)
    },
    _emitUpdated() {
      for (const fn of this._listeners) fn()
    }
  }
  let stored = {}
  const fakeStore = {
    read: () => stored,
    write: (next) => {
      stored = next
    }
  }
  const broadcasts = []
  const broadcast = (event, payload) => broadcasts.push({ event, payload })
  return { fakeNativeTheme, fakeStore, broadcasts, broadcast, getStored: () => stored }
}

describe('theme service', () => {
  test('init reads source from store and applies to nativeTheme', () => {
    const { fakeNativeTheme, fakeStore, broadcast } = makeMocks()
    fakeStore.write({ theme: { source: 'dark' } })
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    svc.init()
    assert.equal(fakeNativeTheme.themeSource, 'dark')
  })

  test('init defaults to system when nothing stored', () => {
    const { fakeNativeTheme, fakeStore, broadcast } = makeMocks()
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    svc.init()
    assert.equal(fakeNativeTheme.themeSource, 'system')
  })

  test('getResolved returns dark when shouldUseDarkColors true', () => {
    const { fakeNativeTheme, fakeStore, broadcast } = makeMocks()
    fakeNativeTheme.shouldUseDarkColors = true
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    assert.equal(svc.getResolved(), 'dark')
  })

  test('getResolved returns light when shouldUseDarkColors false', () => {
    const { fakeNativeTheme, fakeStore, broadcast } = makeMocks()
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    assert.equal(svc.getResolved(), 'light')
  })

  test('setSource updates nativeTheme, persists, and broadcasts', () => {
    const { fakeNativeTheme, fakeStore, broadcasts, broadcast, getStored } = makeMocks()
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    svc.init()
    svc.setSource('dark')
    assert.equal(fakeNativeTheme.themeSource, 'dark')
    assert.deepEqual(getStored(), { theme: { source: 'dark' } })
    assert.equal(broadcasts.length, 1)
    assert.equal(broadcasts[0].event, 'theme:changed')
    assert.deepEqual(broadcasts[0].payload, { source: 'dark', resolved: 'light' })
  })

  test('setSource rejects invalid values', () => {
    const { fakeNativeTheme, fakeStore, broadcast } = makeMocks()
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    svc.init()
    assert.throws(() => svc.setSource('blue'), /invalid theme source/i)
  })

  test('OS update event triggers a broadcast', () => {
    const { fakeNativeTheme, fakeStore, broadcasts, broadcast } = makeMocks()
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    svc.init()
    fakeNativeTheme.shouldUseDarkColors = true
    fakeNativeTheme._emitUpdated()
    assert.equal(broadcasts.length, 1)
    assert.equal(broadcasts[0].event, 'theme:changed')
    assert.deepEqual(broadcasts[0].payload, { source: 'system', resolved: 'dark' })
  })

  test('setSource persists alongside other preferences', () => {
    const { fakeNativeTheme, fakeStore, broadcast, getStored } = makeMocks()
    fakeStore.write({ otherStuff: 'keep' })
    const svc = createThemeService({
      nativeTheme: fakeNativeTheme,
      store: fakeStore,
      broadcast
    })
    svc.init()
    svc.setSource('light')
    assert.deepEqual(getStored(), { otherStuff: 'keep', theme: { source: 'light' } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/main/services/theme.test.js`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the theme service**

Create `src/main/services/theme.js`:

```js
import log from './logger.js'

const VALID_SOURCES = new Set(['system', 'light', 'dark'])

export function createThemeService({ nativeTheme, store, broadcast }) {
  function getStoredSource() {
    const prefs = store.read()
    const src = prefs?.theme?.source
    return VALID_SOURCES.has(src) ? src : 'system'
  }

  function persistSource(source) {
    const prefs = store.read()
    store.write({ ...prefs, theme: { ...(prefs.theme || {}), source } })
  }

  function getResolved() {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  function getState() {
    return { source: nativeTheme.themeSource, resolved: getResolved() }
  }

  function init() {
    const source = getStoredSource()
    nativeTheme.themeSource = source

    nativeTheme.on('updated', () => {
      broadcast('theme:changed', getState())
    })
  }

  function setSource(source) {
    if (!VALID_SOURCES.has(source)) {
      throw new Error(`invalid theme source: ${source}`)
    }
    nativeTheme.themeSource = source
    persistSource(source)
    broadcast('theme:changed', getState())
  }

  return { init, getState, getResolved, setSource }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/main/services/theme.test.js`
Expected: 8 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/theme.js test/main/services/theme.test.js
git commit -m "feat(theme): add theme service wrapping nativeTheme

Service exposes init/getState/getResolved/setSource. Receives
nativeTheme, store, broadcast as injected deps so it is unit-testable
without Electron. IPC wiring lands in a follow-up."
```

---

### Task 4: IPC handlers for theme

**Files:**

- Create: `src/main/ipc/theme.js`
- Modify: `src/main/ipc/index.js` (lines 1–50, registration list)
- Modify: `src/preload/index.js` (add API methods)
- Modify: `src/main/app/lifecycle.js` (initialize theme service before window creation)
- Modify: `src/main/index.js` (call theme init after `app.whenReady`, before window creation)

The theme service is a singleton at module scope. The IPC module owns it (creates it once, exposes `getThemeService()` for `lifecycle.js` to read the resolved value during window creation). Broadcasts use `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(event, payload))`.

- [ ] **Step 1: Create the IPC module**

Create `src/main/ipc/theme.js`:

```js
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import log from '../services/logger.js'
import { createPreferencesStore } from '../services/preferences.js'
import { createThemeService } from '../services/theme.js'

let themeService = null

function broadcast(event, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(event, payload)
    }
  }
}

export function initializeThemeService() {
  if (themeService) return themeService
  const store = createPreferencesStore(app.getPath('userData'))
  themeService = createThemeService({ nativeTheme, store, broadcast })
  themeService.init()
  log.info('theme service initialized', themeService.getState())
  return themeService
}

export function getThemeService() {
  if (!themeService) throw new Error('theme service not initialized')
  return themeService
}

export function registerThemeIPCHandlers() {
  ipcMain.handle('theme:get', () => getThemeService().getState())
  ipcMain.handle('theme:set', (_event, source) => {
    getThemeService().setSource(source)
    return getThemeService().getState()
  })
}
```

- [ ] **Step 2: Wire IPC registration into the central hub**

Open `src/main/ipc/index.js`. After the existing imports block (around line 26), add:

```js
import { registerThemeIPCHandlers } from './theme.js'
```

Inside the `registerAllIPCHandlers` function, alongside the other `register…IPCHandlers()` calls, add:

```js
registerThemeIPCHandlers()
```

(Place it next to `registerInfoIPCHandlers()` for grouping; ordering does not affect correctness.)

- [ ] **Step 3: Initialize theme service before window creation**

Open `src/main/index.js`. Add this static import alongside the other imports:

```js
import { initializeThemeService } from './ipc/theme.js'
```

Inside the `app.whenReady().then(async () => { ... })` block, after `await initializeApp()` but **before** `createWindow()`, add:

```js
// Initialize theme (must happen before BrowserWindow so we can set
// the initial backgroundColor and avoid FOUC).
initializeThemeService()
```

(`nativeTheme` is imported as a reference inside `ipc/theme.js`; properties are only accessed inside `initializeThemeService()` and later, all after `app.whenReady`.)

- [ ] **Step 4: Set BrowserWindow backgroundColor + pass initial theme to renderer**

Open `src/main/app/lifecycle.js`. Locate `createWindow()` (around line 41).

Add this import near the top of the file:

```js
import { getThemeService } from '../ipc/theme.js'
```

Replace the `BrowserWindow` constructor call with:

```js
const themeService = getThemeService()
const themeState = themeService.getState()
const bgColor = themeState.resolved === 'dark' ? '#0f172a' : '#ffffff'

const mainWindow = new BrowserWindow({
  width: 1300,
  height: 800,
  autoHideMenuBar: true,
  backgroundColor: bgColor,
  ...(process.platform === 'linux' ? { icon } : {}),
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false,
    additionalArguments: [
      `--theme-initial-source=${themeState.source}`,
      `--theme-initial-resolved=${themeState.resolved}`
    ]
  }
})
```

The `additionalArguments` are read by the preload script to expose the initial theme to the renderer synchronously (before HTML loads).

- [ ] **Step 5: Expose theme APIs in preload**

Open `src/preload/index.js`. After the existing imports, locate where the `api` object is declared (`const api = { … }`). Add these methods to that object:

```js
  // ----- Theme -----
  getTheme: async () => {
    return await electronAPI.ipcRenderer.invoke('theme:get')
  },
  setThemeSource: async (source) => {
    return await electronAPI.ipcRenderer.invoke('theme:set', source)
  },
  onThemeChanged: (handler) => {
    const listener = (_event, payload) => handler(payload)
    electronAPI.ipcRenderer.on('theme:changed', listener)
    return () => {
      electronAPI.ipcRenderer.removeListener('theme:changed', listener)
    }
  }
```

After the `api` object, before the `contextBridge.exposeInMainWorld(...)` calls, parse the theme args:

```js
function parseThemeInitial() {
  const args = process.argv
  const find = (prefix) => {
    const arg = args.find((a) => a.startsWith(prefix))
    return arg ? arg.slice(prefix.length) : null
  }
  return {
    source: find('--theme-initial-source=') || 'system',
    resolved: find('--theme-initial-resolved=') === 'dark' ? 'dark' : 'light'
  }
}
api.themeInitial = parseThemeInitial()
```

If `src/preload/index.js` already exposes the `api` object via `contextBridge.exposeInMainWorld('api', api)`, no further preload change needed.

- [ ] **Step 6: Verify the dev build runs**

Run: `npm run dev`
Expected: app launches normally. Open DevTools console:

```js
window.api.getTheme()
// → Promise resolving to { source: 'system', resolved: 'light' | 'dark' }
window.api.themeInitial
// → { source: 'system', resolved: 'light' } (or 'dark' if OS is dark)
await window.api.setThemeSource('dark')
// → { source: 'dark', resolved: 'dark' }
document.documentElement.classList.contains('dark')
// → false (we haven't wired the renderer yet — Task 6 does)
```

Reset:

```js
await window.api.setThemeSource('system')
```

- [ ] **Step 7: Verify persistence**

Quit the app (Cmd-Q / Ctrl-Q). Reopen it. In DevTools:

```js
window.api.getTheme()
```

Expected: `{ source: 'system', resolved: ... }` (the previously-set value persists).

Confirm by inspecting `~/Library/Application Support/biowatch/preferences.json` (macOS) / `%APPDATA%\biowatch\preferences.json` (Windows) / `~/.config/biowatch/preferences.json` (Linux):

```bash
cat "$(node -e 'const {app} = require("electron")' 2>/dev/null || echo $HOME)/Library/Application Support/biowatch/preferences.json"
```

(or read the file via Finder/Explorer). Expected: `{ "theme": { "source": "system" } }`.

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc/theme.js src/main/ipc/index.js src/preload/index.js src/main/app/lifecycle.js src/main/index.js
git commit -m "feat(theme): wire theme service IPC and BrowserWindow backgroundColor

theme:get/theme:set IPC handlers, broadcast on theme:changed.
BrowserWindow backgroundColor matches initial resolved theme so the
native window paints the right color before HTML loads. Preload exposes
window.api.{themeInitial,getTheme,setThemeSource,onThemeChanged}."
```

---

### Task 5: Inline boot script in index.html

**Files:**

- Modify: `src/renderer/index.html` (lines 11–14, body section)

A small inline script runs before React mounts. It reads `window.api.themeInitial.resolved` and adds `class="dark"` to `<html>` if needed. Without this, dark-mode users would see a flash of light content while React boots.

- [ ] **Step 1: Add the inline script**

Open `src/renderer/index.html`. Replace the `<body>` block:

```html
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
```

with:

```html
<body>
  <script>
    // Apply dark class before React mounts to avoid FOUC.
    // window.api.themeInitial is set by the preload from process.argv.
    try {
      if (window.api && window.api.themeInitial && window.api.themeInitial.resolved === 'dark') {
        document.documentElement.classList.add('dark')
      }
    } catch (e) {
      // Preload not yet available — fall back gracefully.
    }
  </script>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
```

- [ ] **Step 2: Verify FOUC behavior**

Run: `npm run dev`

In DevTools: `await window.api.setThemeSource('dark')` then quit and relaunch.
Expected: window paints dark immediately on launch (no white flash).

Reset: `await window.api.setThemeSource('system')`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat(theme): inline boot script applies dark class before React mounts

Reads window.api.themeInitial.resolved (populated by preload from
process.argv) and toggles documentElement.classList. Eliminates flash
of light content for dark-mode users on launch."
```

---

### Task 6: useTheme hook

**Files:**

- Create: `src/renderer/src/hooks/useTheme.js`

Returns `{ source, resolved, setSource }` and keeps `<html class="dark">` in sync with the broadcast events from main.

- [ ] **Step 1: Implement the hook**

Create `src/renderer/src/hooks/useTheme.js`:

```js
import { useEffect, useState, useCallback } from 'react'

function applyHtmlClass(resolved) {
  const root = document.documentElement
  if (resolved === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export function useTheme() {
  const [state, setState] = useState(() => {
    const initial = window.api?.themeInitial
    return initial || { source: 'system', resolved: 'light' }
  })

  useEffect(() => {
    let cancelled = false
    window.api.getTheme().then((current) => {
      if (cancelled) return
      setState(current)
      applyHtmlClass(current.resolved)
    })
    const unsubscribe = window.api.onThemeChanged((payload) => {
      setState(payload)
      applyHtmlClass(payload.resolved)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const setSource = useCallback(async (source) => {
    const next = await window.api.setThemeSource(source)
    setState(next)
    applyHtmlClass(next.resolved)
  }, [])

  return { source: state.source, resolved: state.resolved, setSource }
}
```

- [ ] **Step 2: Mount the hook at app root**

The hook must run somewhere on every page so `<html class="dark">` stays synced. Open `src/renderer/src/base.jsx`. Inside `AppContent` (line 89), add at the top of the function body, before the existing state declarations:

```jsx
// Keeps <html class="dark"> in sync with main-process theme state
useTheme()
```

Add the import at the top of the file:

```jsx
import { useTheme } from './hooks/useTheme'
```

- [ ] **Step 3: Verify dark mode now syncs**

Run: `npm run dev`. In DevTools:

```js
await window.api.setThemeSource('dark')
```

Expected: `<html>` immediately gains `class="dark"`. The page background flips to slate (because the `.dark body` rule applies), but most components still look "light" because they hardcode utilities — Phase 4 fixes that. The visible result is a dark page edge with light cards still floating on it.

```js
await window.api.setThemeSource('light')
```

Expected: `dark` class removed, page back to fully light.

```js
await window.api.setThemeSource('system')
```

Expected: state matches OS preference.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useTheme.js src/renderer/src/base.jsx
git commit -m "feat(theme): useTheme hook syncs <html class=\"dark\"> with main process

Hook seeds from window.api.themeInitial, then reconciles via theme:get
and subscribes to theme:changed broadcasts. Mounted once at base.jsx so
the html class stays accurate across navigation."
```

---

## Phase 3 — Codemod Tool

### Task 7: Build the theme codemod

**Files:**

- Create: `scripts/theme-codemod.js`
- Create: `test/scripts/theme-codemod.test.js`

A Node script that walks `.jsx` files, parses class strings (both `className="..."` literals and template literals), applies the conversion rules from the spec, and writes the modified files. The script does not commit; the engineer reviews `git diff` and commits per chunk.

CLI: `node scripts/theme-codemod.js <path>` — `<path>` may be a file or directory; script processes all `.jsx` under it.

- [ ] **Step 1: Write the failing test**

Create `test/scripts/theme-codemod.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { transformClassString } from '../../scripts/theme-codemod.js'

describe('transformClassString', () => {
  test('bg-white → bg-card and flags review', () => {
    const { output, flags } = transformClassString('bg-white p-4')
    assert.equal(output, 'bg-card p-4')
    assert.deepEqual(flags, ['bg-white'])
  })

  test('text-gray-900 → text-foreground', () => {
    const { output } = transformClassString('text-gray-900 font-bold')
    assert.equal(output, 'text-foreground font-bold')
  })

  test('text-gray-500 → text-muted-foreground', () => {
    const { output } = transformClassString('text-gray-500')
    assert.equal(output, 'text-muted-foreground')
  })

  test('border-gray-200 → border-border', () => {
    const { output } = transformClassString('border border-gray-200')
    assert.equal(output, 'border border-border')
  })

  test('hover:bg-gray-100 → hover:bg-accent', () => {
    const { output } = transformClassString('hover:bg-gray-100')
    assert.equal(output, 'hover:bg-accent')
  })

  test('bg-blue-50 text-blue-700 keeps light + appends dark variants', () => {
    const { output } = transformClassString('bg-blue-50 text-blue-700')
    assert.equal(output, 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300')
  })

  test('bg-blue-600 text-white CTA keeps light + appends dark variants', () => {
    const { output } = transformClassString('bg-blue-600 text-white')
    assert.equal(output, 'bg-blue-600 text-white dark:bg-blue-500 dark:text-white')
  })

  test('bg-red-50 text-red-700 keeps light + appends dark variants', () => {
    const { output } = transformClassString('bg-red-50 text-red-700')
    assert.equal(output, 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300')
  })

  test('does not double-apply if dark variants already present', () => {
    const { output } = transformClassString(
      'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
    )
    assert.equal(output, 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300')
  })

  test('preserves unknown classes untouched', () => {
    const { output } = transformClassString('flex items-center gap-2 px-3')
    assert.equal(output, 'flex items-center gap-2 px-3')
  })

  test('handles multiple rules in one string', () => {
    const { output } = transformClassString(
      'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
    )
    assert.equal(output, 'bg-card text-foreground border border-border hover:bg-accent')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scripts/theme-codemod.test.js`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the codemod**

Create `scripts/theme-codemod.js`:

```js
#!/usr/bin/env node
/**
 * Theme migration codemod.
 *
 * Walks .jsx files, transforms hardcoded color utilities into either
 * semantic tokens (where the existing token paints the same pixels)
 * or paired light + dark: variants (for colored idioms).
 *
 * Usage: node scripts/theme-codemod.js <file-or-dir>
 *
 * The script writes changes in-place. Review with `git diff` and commit
 * per directory. Sites tagged with THEME-REVIEW need manual eyes.
 */

import { readFileSync, writeFileSync, statSync, readdirSync } from 'fs'
import { join, extname } from 'path'

// Token-substitution rules: applied via word-boundary regex.
// Order matters — more specific rules first.
const SUBSTITUTIONS = [
  // Neutral surfaces
  { from: /\bbg-gray-100\b/g, to: 'bg-muted' },
  { from: /\bbg-gray-200\b/g, to: 'bg-muted' },
  { from: /\bbg-gray-50\b/g, to: 'bg-muted' },
  { from: /\bhover:bg-gray-100\b/g, to: 'hover:bg-accent' },
  { from: /\bhover:bg-gray-200\b/g, to: 'hover:bg-accent' },
  { from: /\bhover:bg-gray-50\b/g, to: 'hover:bg-accent' },

  // Text neutrals
  { from: /\btext-gray-900\b/g, to: 'text-foreground' },
  { from: /\btext-gray-800\b/g, to: 'text-foreground' },
  { from: /\btext-gray-700\b/g, to: 'text-foreground' },
  { from: /\btext-gray-600\b/g, to: 'text-muted-foreground' },
  { from: /\btext-gray-500\b/g, to: 'text-muted-foreground' },
  { from: /\btext-gray-400\b/g, to: 'text-muted-foreground' },

  // Borders
  { from: /\bborder-gray-200\b/g, to: 'border-border' },
  { from: /\bborder-gray-300\b/g, to: 'border-border' },
  { from: /\bborder-gray-100\b/g, to: 'border-border' }
]

// Idioms to expand into light + dark: pairs. Matched as a single phrase.
// Each entry is [matcher (regex), replacement string]. We only append dark
// variants when none of the dark: substitutes are already present.
const COLORED_IDIOMS = [
  [
    /\bbg-blue-50 text-blue-700\b/g,
    'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  ],
  [/\bbg-blue-600 text-white\b/g, 'bg-blue-600 text-white dark:bg-blue-500 dark:text-white'],
  [/\bbg-blue-700 text-white\b/g, 'bg-blue-700 text-white dark:bg-blue-600 dark:text-white'],
  [/\bbg-red-50 text-red-700\b/g, 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'],
  [/\bbg-red-100 text-red-800\b/g, 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300'],
  [/\bbg-red-600 text-white\b/g, 'bg-red-600 text-white dark:bg-red-500 dark:text-white'],
  [
    /\bbg-green-50 text-green-700\b/g,
    'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300'
  ],
  [
    /\bbg-green-100 text-green-800\b/g,
    'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300'
  ],
  [
    /\bbg-yellow-50 text-yellow-700\b/g,
    'bg-yellow-50 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300'
  ],
  [
    /\bbg-yellow-100 text-yellow-800\b/g,
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300'
  ]
]

// Phrases that are ambiguous and need human review.
const REVIEW_FLAGS = [/\bbg-white\b/]

const BG_WHITE_TO_CARD = /\bbg-white\b/g

export function transformClassString(input) {
  let output = input
  const flags = []

  // 1. Apply idiom expansions first (avoid breaking them with substring rules).
  for (const [matcher, replacement] of COLORED_IDIOMS) {
    if (output.match(matcher)) {
      // Skip if dark: variants already present (idempotent).
      const darkProbe = replacement.match(/dark:\S+/)?.[0]
      if (darkProbe && output.includes(darkProbe)) continue
      output = output.replace(matcher, replacement)
    }
  }

  // 2. Substitutions for unambiguous neutrals.
  for (const { from, to } of SUBSTITUTIONS) {
    output = output.replace(from, to)
  }

  // 3. bg-white → bg-card with review flag (engineer disambiguates surface vs page bg).
  if (REVIEW_FLAGS.some((r) => r.test(output))) {
    flags.push('bg-white')
    output = output.replace(BG_WHITE_TO_CARD, 'bg-card')
  }

  return { output, flags }
}

// Match `className="..."` or `className={`...`}` (template literal).
// We only rewrite the literal parts; we don't touch interpolations.
const CLASSNAME_RE = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g

export function transformFile(source) {
  let touched = false
  const reviewMarkers = new Set()

  const next = source.replace(CLASSNAME_RE, (match, dq, tpl) => {
    const original = dq ?? tpl
    if (original == null) return match
    const { output, flags } = transformClassString(original)
    if (output === original) return match
    touched = true
    flags.forEach((f) => reviewMarkers.add(f))
    if (dq != null) return `className="${output}"`
    return `className={\`${output}\`}`
  })

  return { source: next, touched, reviewMarkers: [...reviewMarkers] }
}

function walk(path) {
  const stat = statSync(path)
  if (stat.isFile()) return [path]
  if (!stat.isDirectory()) return []
  const out = []
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    out.push(...walk(join(path, entry)))
  }
  return out
}

function main() {
  const target = process.argv[2]
  if (!target) {
    console.error('Usage: node scripts/theme-codemod.js <file-or-dir>')
    process.exit(1)
  }
  const files = walk(target).filter((f) => extname(f) === '.jsx')
  const summary = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const { source, touched, reviewMarkers } = transformFile(src)
    if (touched) {
      writeFileSync(file, source)
      summary.push({ file, reviewMarkers })
    }
  }
  console.log(`Modified ${summary.length} file(s).`)
  for (const { file, reviewMarkers } of summary) {
    if (reviewMarkers.length) {
      console.log(`  ${file}  THEME-REVIEW: ${reviewMarkers.join(', ')}`)
    } else {
      console.log(`  ${file}`)
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scripts/theme-codemod.test.js`
Expected: 11 tests passed.

- [ ] **Step 5: Smoke-test the script on a copy**

Run on a single file as a smoke test:

```bash
cp src/renderer/src/base.jsx /tmp/base.jsx.before
node scripts/theme-codemod.js src/renderer/src/base.jsx
git diff src/renderer/src/base.jsx | head -40
```

Expected: diff shows `bg-white` → `bg-card`, `text-gray-700` → `text-foreground`, `border-gray-200` → `border-border`, etc. No template-literal classNames mangled.

Revert before continuing:

```bash
git checkout src/renderer/src/base.jsx
```

- [ ] **Step 6: Commit**

```bash
git add scripts/theme-codemod.js test/scripts/theme-codemod.test.js
git commit -m "tools(theme): add theme migration codemod

Walks .jsx files, applies neutral-token substitutions and pairs colored
utility idioms with dark: variants. Tags ambiguous bg-white sites for
manual review."
```

---

## Phase 4 — Migration (Per-Directory)

Each task in this phase follows the same pattern:

1. Run codemod on a directory.
2. Inspect `git diff`.
3. Manually resolve any `THEME-REVIEW` flags (decide `bg-card` vs `bg-background`).
4. Manually pair `dark:` variants for any colored utilities the codemod missed (the codemod handles common idioms but ad-hoc combinations need eyes).
5. Run dev, force `<html class="dark">`, verify the touched pages render correctly in both themes.
6. Commit.

The migration order is chosen so the smallest leaf modules go first, surfacing edge cases in low-blast-radius areas before reaching the top-level pages.

### Task 8: Migrate `src/renderer/src/ui/`

**Files:** all `.jsx` under `src/renderer/src/ui/`.

- [ ] **Step 1: Run the codemod**

```bash
node scripts/theme-codemod.js src/renderer/src/ui
```

Expected output: a list of modified files. Note any `THEME-REVIEW: bg-white` flags.

- [ ] **Step 2: Review the diff**

```bash
git diff src/renderer/src/ui
```

Read every change. Look for:

- Wrong context for `bg-white` → `bg-card`. If it's used as a page-level surface (rare in `ui/`), edit to `bg-background`.
- Hardcoded hex/rgb in `style={{ backgroundColor: ... }}` (codemod doesn't touch these). Note for Task 15.
- Status-pill colors (e.g., `bg-yellow-50 text-yellow-800`) — verify the dark variant the codemod added has acceptable contrast.

- [ ] **Step 3: Resolve THEME-REVIEW flags manually**

For each flagged file: open it, find the `bg-card` site that came from `bg-white`, decide if it should stay `bg-card` (component is a card-like surface) or become `bg-background` (it's the page-level surface). Edit if needed.

- [ ] **Step 4: Manual sweep for missed colored utilities**

Search the directory for any remaining bare colored utilities:

```bash
grep -rEn 'bg-(red|blue|green|yellow|orange|purple|pink)-[0-9]+|text-(red|blue|green|yellow|orange|purple|pink)-[0-9]+' src/renderer/src/ui
```

For each hit: if there's no paired `dark:` variant on the same `className`, append one following the pattern from `theme-codemod.js`'s `COLORED_IDIOMS`. (Mid-tone backgrounds like `bg-red-500` typically pair with no change in dark mode; soft backgrounds like `bg-red-50` typically pair with `dark:bg-red-500/15 dark:text-red-300`.)

- [ ] **Step 5: Visual verification**

Run `npm run dev`. In DevTools:

```js
await window.api.setThemeSource('dark')
```

Click through every interactive element that lives in `src/renderer/src/ui/` (tabs, tooltips, hover cards, marker hover cards, observation rail, behavior selector, species tooltip, study hover card). Look for:

- White rectangles inside dark cards (missed `bg-white` → `bg-card`).
- Black-on-black text or white-on-white (token mismatch).
- Borders disappearing (`border-gray-X` not converted).

Then:

```js
await window.api.setThemeSource('light')
```

Confirm light mode is unchanged from before the task.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/ui
git commit -m "refactor(theme): convert ui/ to semantic tokens + dark variants"
```

---

### Task 9: Migrate `src/renderer/src/overview/`

Same pattern as Task 8.

- [ ] **Step 1:** `node scripts/theme-codemod.js src/renderer/src/overview`
- [ ] **Step 2:** `git diff src/renderer/src/overview` — review.
- [ ] **Step 3:** Resolve `THEME-REVIEW` flags (likely several `bg-white` sites for cards in `KpiTile`, `EditorialHeader`, etc.).
- [ ] **Step 4:** Grep for bare colored utilities and pair `dark:` variants.
- [ ] **Step 5:** Visual verification — open a study, click Overview tab, toggle dark/light.
- [ ] **Step 6:** Commit:

```bash
git add src/renderer/src/overview
git commit -m "refactor(theme): convert overview/ to semantic tokens + dark variants"
```

---

### Task 10: Migrate `src/renderer/src/deployments/`

Same pattern.

- [ ] **Step 1:** `node scripts/theme-codemod.js src/renderer/src/deployments`
- [ ] **Step 2:** `git diff src/renderer/src/deployments` — review.
- [ ] **Step 3:** Resolve `THEME-REVIEW` flags.
- [ ] **Step 4:** Grep + pair.
- [ ] **Step 5:** Open a study, click Deployments tab, exercise the gear-icon popover, location editor, settings popover. Verify both themes.
- [ ] **Step 6:** Commit:

```bash
git add src/renderer/src/deployments
git commit -m "refactor(theme): convert deployments/ to semantic tokens + dark variants"
```

---

### Task 11: Migrate `src/renderer/src/media/`

Same pattern.

- [ ] **Step 1:** `node scripts/theme-codemod.js src/renderer/src/media`
- [ ] **Step 2:** `git diff src/renderer/src/media` — review.
- [ ] **Step 3:** Resolve `THEME-REVIEW` flags.
- [ ] **Step 4:** Grep + pair.
- [ ] **Step 5:** Open a study, click Media tab, scroll the grid, open the best-capture modal, link-deployment modal. Verify both themes.
- [ ] **Step 6:** Commit:

```bash
git add src/renderer/src/media
git commit -m "refactor(theme): convert media/ to semantic tokens + dark variants"
```

---

### Task 12: Migrate `models/`, `SettingsInfo/`, `hooks/`, `utils/`, `undo/`, `assets/`

These are smaller leaf directories; bundle them in one task.

- [ ] **Step 1: Run codemod over each**

```bash
for dir in models SettingsInfo hooks utils undo; do
  echo "--- $dir"
  node scripts/theme-codemod.js src/renderer/src/$dir
done
```

(`assets/` contains `main.css` only — codemod ignores it.)

- [ ] **Step 2:** Review combined diff: `git diff src/renderer/src/{models,SettingsInfo,hooks,utils,undo}`.

- [ ] **Step 3:** Resolve `THEME-REVIEW` flags.

- [ ] **Step 4:** Grep + pair.

- [ ] **Step 5:** Visual verification: Settings → AI Models, Settings → Info, custom model card, model card. Verify both themes.

- [ ] **Step 6:** Commit:

```bash
git add src/renderer/src/{models,SettingsInfo,hooks,utils,undo}
git commit -m "refactor(theme): convert models/SettingsInfo/hooks/utils/undo to semantic tokens"
```

---

### Task 13: Migrate top-level renderer pages

The top-level `.jsx` files: `base.jsx`, `import.jsx`, `study.jsx`, `overview.jsx`, `deployments.jsx`, `media.jsx`, `activity.jsx`, `sources.jsx`, `settings.jsx`, `export.jsx`, `Diagnostics.jsx`, `StudySettings.jsx`, modal files (`AddSourceModal.jsx`, `DeleteStudyModal.jsx`, `CountryPickerModal.jsx`, `CamtrapDPExportModal.jsx`, `CamtrapDPImportProgress.jsx`, `DemoImportProgress.jsx`, `ExportProgressModal.jsx`, `GbifImportProgress.jsx`, `LilaImportProgress.jsx`, `ImageDirectoriesExportModal.jsx`), `CacheSection.jsx`, `main.jsx`.

- [ ] **Step 1: Run codemod on the top-level**

```bash
node scripts/theme-codemod.js src/renderer/src
```

This processes everything in the directory; sub-directories already migrated are idempotent (the codemod doesn't double-apply when dark variants already exist for idioms it knows; for simple substitutions, the gray utilities are gone so nothing to substitute).

Verify nothing in the previously migrated subdirectories changed:

```bash
git diff --stat src/renderer/src/{ui,overview,deployments,media,models,SettingsInfo,hooks,utils,undo}
```

Expected: zero lines of diff in those directories. If any subdirectory has a diff, investigate before continuing.

- [ ] **Step 2:** Review diff: `git diff src/renderer/src/*.jsx`. This is the largest changeset of the migration — review it carefully.

- [ ] **Step 3:** Resolve `THEME-REVIEW` flags. The biggest concentration of these will be:
  - `base.jsx`'s sidebar (`bg-white` doesn't apply but `bg-gray-100` for hover, `bg-blue-50` for active link). The main content `<div className="flex-col bg-white shadow w-full rounded-xl ...">` is a _card surface_ → keep as `bg-card`.
  - Modal containers — typically `bg-card` (the modal panel) inside an overlay (`bg-black/50` keeps as-is, that's deliberate).
  - `ErrorFallback` panels — `bg-red-50 text-red-700` already gets paired by the codemod.

- [ ] **Step 4:** Grep + pair across the top-level files.

- [ ] **Step 5:** Visual verification: launch dev, click through every top-level route in dark mode. Pay special attention to:
  - The studies sidebar (active state, hover, search input, empty state, context menu).
  - The main `<main>` panel that wraps every page (`base.jsx` line ~472).
  - All modals (open via UI actions or by stubbing the open state via DevTools).

- [ ] **Step 6:** Commit:

```bash
git add src/renderer/src
git commit -m "refactor(theme): convert top-level renderer pages to semantic tokens + dark variants"
```

---

### Task 14: Sweep `THEME-REVIEW` tags

The codemod doesn't insert `// THEME-REVIEW:` comments into the source — the flags are in the script's stdout summary. This task is a final search for any leftover ambiguity.

- [ ] **Step 1:** Search for any explicit `THEME-REVIEW` comments left in code (in case a developer added them manually):

```bash
grep -rn 'THEME-REVIEW' src/renderer/src
```

Expected: no hits, or comments the engineer added during Tasks 8–13. Resolve them.

- [ ] **Step 2:** Final search for any remaining hardcoded gray utilities the codemod might have missed (e.g., inside template literals with interpolation that the regex skipped):

```bash
grep -rEn '\bbg-gray-[0-9]+|\btext-gray-[0-9]+|\bborder-gray-[0-9]+' src/renderer/src
```

Expected: zero or very few hits. Convert any remaining.

- [ ] **Step 3:** Search for any remaining bare colored utilities without paired `dark:` variants:

```bash
grep -rEn '"[^"]*bg-(red|blue|green|yellow)-[0-9]+[^"]*"' src/renderer/src \
  | grep -v 'dark:bg-' \
  | head -50
```

Expected: short list of edge cases. Pair them manually.

- [ ] **Step 4:** Visual sweep (manual).

Run dev, open every page in dark mode, look for any element that doesn't theme correctly. Note them, fix.

- [ ] **Step 5:** Commit:

```bash
git add src/renderer/src
git commit -m "refactor(theme): sweep remaining hardcoded color utilities"
```

(Skip if no changes needed.)

---

### Task 15: Inline styles + main.css literals

Inline `style={{ backgroundColor: '#xxx' }}` props and hex literals embedded in `assets/main.css` outside the `@theme` block need manual conversion.

**Files (search first to enumerate):**

```bash
grep -rn "style=" src/renderer/src --include='*.jsx' | grep -E 'background|color|border|fill|stroke' | head
```

Likely sites: `KpiTile.jsx` (inline backgrounds), Leaflet tooltip styling (`assets/main.css` line ~328), `recharts` `<Bar fill="#xxx" />`, etc.

- [ ] **Step 1: Convert `assets/main.css` literals**

In `src/renderer/src/assets/main.css`:

- Line ~327 `.leaflet-tooltip.species-map-tooltip { background: white; border: 1px solid #e5e7eb; ... }` → use `var(--color-card)` and `var(--color-border)`. Add a `.dark` override if needed (the variables already do the work, but double-check the `box-shadow` colors which use `rgba(0, 0, 0, 0.1)` — those are fine in both themes).

- The body rule `body { background-color: rgb(250, 250, 250); }` stays untouched (Task 1 added the dark counterpart). The literal light value preserves current appearance pixel-identically.

- The `.versions` block at line ~166: `background-color: #202127` is dark already. Add a light-mode counterpart? Not in scope — `.versions` isn't rendered (a debug-style block that may be vestigial). Leave it.

- Confirm with: `npm run dev`, light mode pages identical to before, dark mode species-map tooltip flips correctly.

- [ ] **Step 2: Convert inline JSX styles**

For each match from the grep above where the inline style hardcodes a color, convert to:

- A class instead of inline style if possible (preferred).
- Or `var(--color-…)` inside the inline style (e.g., `style={{ backgroundColor: 'var(--color-card)' }}`).

Common pattern in this codebase: `KpiTile.jsx` uses `style={{ background: '#fafafa' }}` — replace with the relevant Tailwind class (`bg-muted` if it's used as a muted surface, `bg-card` if it's a card surface).

Show diffs as you go: `git diff <file>`.

- [ ] **Step 3:** Visual verification in both themes for the affected pages.

- [ ] **Step 4:** Commit:

```bash
git add src/renderer/src
git commit -m "refactor(theme): convert inline styles and main.css literals to tokens"
```

---

## Phase 5 — Third-Party Libraries

### Task 16: Recharts color audit

Charts must read from `--color-chart-N` so dark-mode values automatically apply.

- [ ] **Step 1: Audit hardcoded chart colors**

Search:

```bash
grep -rEn '<(Bar|Line|Area|Pie|Cell|Sector)\b[^>]*(fill|stroke|color)=' src/renderer/src --include='*.jsx' | grep -E '"#[0-9a-fA-F]{3,6}"' | head -40
```

Expected: a list of sites passing hex literals into recharts components.

- [ ] **Step 2: Convert each site**

For each match, replace literal hex with `var(--color-chart-N)`. Where the component cycles through chart colors (e.g., a list of `Cell` components), use the existing `--color-chart-1` through `--color-chart-5` palette.

Example before:

```jsx
<Bar dataKey="count" fill="#3b82f6" />
```

Example after:

```jsx
<Bar dataKey="count" fill="var(--color-chart-3)" />
```

Tooltip backgrounds: replace `<Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb' }} />` with `style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', color: 'var(--color-card-foreground)' }}`.

- [ ] **Step 3: Verify charts in both themes**

Open a study with charts (Activity tab, Overview tiles, etc.). Toggle light/dark. Bars and lines should re-color visibly; backgrounds and grids should flip; legend text contrast should remain readable.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src
git commit -m "refactor(theme): pipe recharts colors through CSS variables"
```

---

### Task 17: Leaflet tile layer swap

Swap CartoDB Positron / OSM tiles to a dark equivalent in dark mode.

**Files:**

- Modify: `src/renderer/src/activity.jsx` (lines 416–432, the LayersControl block)
- Modify: `src/renderer/src/deployments.jsx` (TileLayer block around line 365)
- Modify: `src/renderer/src/study.jsx` (any TileLayer usage)
- Modify: `src/renderer/src/overview.jsx` (any TileLayer usage)
- Modify: `src/renderer/src/models/MapPane.jsx` (around line 127)
- Modify: `src/renderer/src/ui/PlaceholderMap.jsx`
- Modify: `src/renderer/src/ui/MarkerHoverCard.jsx`
- Modify: `src/renderer/index.html` (CSP — add `cartodb-basemaps-{a,b,c,d}.global.ssl.fastly.net` to `img-src`)

- [ ] **Step 1: Update Content-Security-Policy**

Open `src/renderer/index.html`. The `meta http-equiv="Content-Security-Policy"` tag's `img-src` already allows `https:` so CartoDB is permitted. The `connect-src` lists `https://*.tile.openstreetmap.org` but not CartoDB — tiles are loaded via `<img>` elements so `img-src https:` covers them. Verify by reviewing the meta tag; no change needed.

- [ ] **Step 2: Update `activity.jsx` Street Map TileLayer**

In `src/renderer/src/activity.jsx`, locate the `Street Map` `TileLayer` (around line 426–430):

```jsx
<TileLayer
  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  crossOrigin=""
/>
```

Replace with theme-aware URL. At the top of the component, add:

```jsx
import { useTheme } from './hooks/useTheme'
```

Inside the component body (near other hooks):

```jsx
const { resolved } = useTheme()
const streetMapUrl =
  resolved === 'dark'
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const streetMapAttribution =
  resolved === 'dark'
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
```

Replace the TileLayer with:

```jsx
<TileLayer
  key={resolved} // force remount on theme change
  attribution={streetMapAttribution}
  url={streetMapUrl}
  crossOrigin=""
/>
```

The `key` prop forces React-Leaflet to remount the tile layer when the theme changes — a `<TileLayer>` does not always pick up a new `url` prop in-place.

- [ ] **Step 3: Apply the same change to other files using TileLayer**

For each of `deployments.jsx`, `models/MapPane.jsx`, `ui/PlaceholderMap.jsx`, `ui/MarkerHoverCard.jsx`, and any other file flagged by:

```bash
grep -rln 'TileLayer' src/renderer/src --include='*.jsx'
```

apply the same pattern (import `useTheme`, derive `streetMapUrl`/`streetMapAttribution`, set `key={resolved}` on the `TileLayer`). The Satellite layer (`server.arcgisonline.com`) does not need a dark variant — satellite imagery is theme-neutral.

- [ ] **Step 4: Verify markers remain visible on dark tiles**

Run dev, switch to dark, open a map. Look for camera markers, pie-chart markers, and species hover cards. If markers visibly lose contrast against `dark_all`, add a 1px white outer stroke to the marker SVG. (The marker SVG lives in `src/renderer/src/ui/PieChartMarker.jsx` or similar — search `grep -rln 'svg.*camera' src/renderer/src/ui`).

If contrast is acceptable, no change needed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src
git commit -m "feat(theme): swap leaflet tile layer based on resolved theme

Dark mode uses CartoDB dark_all tiles; light mode keeps OpenStreetMap.
TileLayer remounts on theme change via the resolved-keyed prop."
```

---

### Task 18: sonner Toaster theme prop

**Files:**

- Modify: `src/renderer/src/base.jsx` (around line 524, the `<Toaster>` element)

- [ ] **Step 1: Pipe theme into Toaster**

Open `src/renderer/src/base.jsx`. The existing line is `<Toaster position="top-right" richColors />` (around line 524). Currently `useTheme()` is already mounted in `AppContent` (Task 6) but `<Toaster>` lives in `App` (the outer wrapper) — and `AppContent` is rendered inside `App`. To get theme into the Toaster which is a sibling of `AppContent`, lift `useTheme` to `App`.

Refactor `App` to use `useTheme`:

```jsx
export default function App() {
  const { resolved } = useTheme()
  return (
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={200} skipDelayDuration={0}>
        <Toaster position="top-right" richColors theme={resolved} />
        <HashRouter>
          <ErrorBoundary FallbackComponent={ErrorFallback}>
            <AppContent />
          </ErrorBoundary>
        </HashRouter>
      </Tooltip.Provider>
    </QueryClientProvider>
  )
}
```

Remove the `useTheme()` call from `AppContent` since it's now in `App` (one source of HTML-class management is enough; subscribers higher in the tree win re-renders).

- [ ] **Step 2: Verify**

Run dev, trigger a toast (e.g., delete a study). Toggle theme. Toasts retheme without restart.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/base.jsx
git commit -m "feat(theme): pipe resolved theme into sonner Toaster"
```

---

## Phase 6 — Settings UI

### Task 19: ThemeSegmentedControl component

**Files:**

- Create: `src/renderer/src/ui/ThemeSegmentedControl.jsx`

- [ ] **Step 1: Implement the component**

Create `src/renderer/src/ui/ThemeSegmentedControl.jsx`:

```jsx
import { Monitor, Sun, Moon } from 'lucide-react'

const SEGMENTS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon }
]

export default function ThemeSegmentedControl({ value, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-lg border border-border bg-card p-1"
    >
      {SEGMENTS.map(({ value: segValue, label, icon: Icon }) => {
        const selected = value === segValue
        return (
          <button
            key={segValue}
            role="radio"
            aria-checked={selected}
            data-testid={`theme-segment-${segValue}`}
            onClick={() => onChange(segValue)}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
              selected
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            ].join(' ')}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run `npm run dev`. The component isn't mounted yet — Task 20 mounts it.

No commit yet; combined with Task 20.

---

### Task 20: Appearance settings panel + tab

**Files:**

- Create: `src/renderer/src/settings/Appearance.jsx`
- Modify: `src/renderer/src/settings.jsx` (full file — add Appearance route and tab)

- [ ] **Step 1: Implement the panel**

Create `src/renderer/src/settings/Appearance.jsx`:

```jsx
import { useTheme } from '../hooks/useTheme'
import ThemeSegmentedControl from '../ui/ThemeSegmentedControl'

export default function Appearance() {
  const { source, resolved, setSource } = useTheme()

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-foreground mb-1">Appearance</h2>
      <p className="text-sm text-muted-foreground mb-6">Choose how Biowatch looks.</p>

      <div className="mb-2">
        <ThemeSegmentedControl value={source} onChange={setSource} />
      </div>

      {source === 'system' && (
        <p className="text-sm text-muted-foreground">
          Following system preference (currently {resolved === 'dark' ? 'Dark' : 'Light'}).
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add the Appearance tab to the Settings page**

Open `src/renderer/src/settings.jsx`. Add the import at the top with the other tab-page imports:

```jsx
import { BrainCircuit, Info, Loader2, Palette, Settings2 } from 'lucide-react'
import Appearance from './settings/Appearance'
```

In the `<nav>` section (around line 113), add the Appearance tab as the first tab (before AI Models):

```jsx
<Tab to="/settings/appearance" icon={Palette}>
  Appearance
</Tab>
```

In the `<Routes>` block (around line 137), add the route as the first child:

```jsx
<Route
  path="appearance"
  element={
    <ErrorBoundary FallbackComponent={ErrorFallback} key={'appearance'}>
      <div className="min-h-full flex flex-col">
        <Appearance />
        <SettingsFooter className="mt-auto" onRevealAdvanced={handleRevealAdvanced} />
      </div>
    </ErrorBoundary>
  }
/>
```

The default redirect at the bottom of the Routes block (`<Route path="*" element={<Navigate to="/settings/ml_zoo" replace />} />`) keeps `ml_zoo` as the landing default for users who deep-link to `/settings`. New users navigating via the sidebar `Settings` link still land on AI Models — Appearance is one click away. (If different default desired, swap to `/settings/appearance`.)

In `base.jsx`, the sidebar Settings NavLink points to `/settings/ml_zoo` (around line 460); leave that alone — it's the existing default landing. Users find Appearance via the tab strip.

- [ ] **Step 3: Verify the toggle works end-to-end**

Run `npm run dev`. Click Settings in the sidebar → click the Appearance tab. The segmented control should be visible with the current source highlighted.

Click each segment in turn:

- **Dark** → `<html>` gains `class="dark"`, page goes dark instantly. Helper text below the control disappears.
- **Light** → `dark` class removed, page back to light.
- **System** → matches OS preference. Helper text reappears: "Following system preference (currently Dark/Light)."

Quit and relaunch the app. Expected: the previously-selected source persists (visible in Appearance tab and in `<html class>`).

- [ ] **Step 4: Verify OS preference reactivity (System mode only)**

With the toggle on **System**, change the OS dark/light preference (System Settings on macOS, Personalization on Windows, gsettings on GNOME). Expected: the app re-themes within a second, the Appearance helper text updates.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/ui/ThemeSegmentedControl.jsx src/renderer/src/settings/Appearance.jsx src/renderer/src/settings.jsx
git commit -m "feat(theme): add Appearance settings tab with tri-state toggle

ThemeSegmentedControl (System/Light/Dark) wired to useTheme. Lives
under Settings → Appearance, the new first tab in the settings page.
Helper text below the control shows what System resolves to."
```

---

## Phase 7 — Tests, Docs, QA

### Task 21: E2E test for theme toggle

**Files:**

- Create: `test/e2e/theme.spec.js`

- [ ] **Step 1: Write the test**

Create `test/e2e/theme.spec.js`:

```js
const { test, expect } = require('./fixtures')

test.describe('Theme toggle', () => {
  test.beforeEach(async ({ window }) => {
    await expect(window.getByTestId('studies-sidebar')).toBeVisible({ timeout: 30000 })
  })

  test('selecting Dark adds dark class to html', async ({ window }) => {
    // Navigate to Settings → Appearance via the sidebar Settings link
    await window.locator('a[href="#/settings/ml_zoo"]').click()
    await window.locator('a[href="#/settings/appearance"]').click()

    // Click Dark
    await window.getByTestId('theme-segment-dark').click()

    // <html> should have the dark class
    await expect(window.locator('html')).toHaveClass(/dark/)
  })

  test('selecting Light removes dark class', async ({ window }) => {
    await window.locator('a[href="#/settings/appearance"]').click()
    await window.getByTestId('theme-segment-light').click()
    await expect(window.locator('html')).not.toHaveClass(/dark/)
  })

  test('selecting System shows resolved helper text', async ({ window }) => {
    await window.locator('a[href="#/settings/appearance"]').click()
    await window.getByTestId('theme-segment-system').click()

    // Helper text appears with the resolved theme name
    const helperText = window.getByText(/Following system preference \(currently (Light|Dark)\)/)
    await expect(helperText).toBeVisible()
  })
})
```

- [ ] **Step 2: Build the app for e2e**

```bash
npm run build
```

Expected: build completes, `out/main/index.js` produced.

- [ ] **Step 3: Run the new test**

```bash
npx playwright test test/e2e/theme.spec.js
```

Expected: 3 tests pass. If a test fails because the demo study isn't seeded (shared `.e2e-test-data` directory), run the demo-import spec first per the existing fixture pattern:

```bash
npx playwright test
```

(Runs all e2e in alphabetical order; demo-import seeds, then theme test runs.)

- [ ] **Step 4: Commit**

```bash
git add test/e2e/theme.spec.js
git commit -m "test(theme): e2e coverage for the appearance toggle"
```

---

### Task 22: Documentation updates

**Files:**

- Modify: `docs/architecture.md`
- Modify: `docs/ipc-api.md`
- Modify: `docs/troubleshooting.md`
- Modify: `docs/development.md`

- [ ] **Step 1: Update `architecture.md`**

Read `docs/architecture.md`. Find the section describing main-process services. Add a brief paragraph documenting the theme service:

```markdown
**Theme service** (`src/main/services/theme.js`) — wraps Electron's
`nativeTheme` and a JSON-backed preferences store
(`src/main/services/preferences.js` writing to
`userData/preferences.json`). Initializes during app startup before
window creation so the BrowserWindow's `backgroundColor` matches the
resolved theme. Broadcasts `theme:changed` on OS preference changes
and on user-initiated changes via the Appearance settings tab.
```

If the doc has a Mermaid or ASCII diagram of services, add the theme service node next to other init-time services (preferences, migrations).

- [ ] **Step 2: Update `ipc-api.md`**

Add a new section:

```markdown
## Theme

| Channel         | Direction       | Payload                         | Returns                                                                  |
| --------------- | --------------- | ------------------------------- | ------------------------------------------------------------------------ |
| `theme:get`     | renderer → main | (none)                          | `{ source: 'system' \| 'light' \| 'dark', resolved: 'light' \| 'dark' }` |
| `theme:set`     | renderer → main | `'system' \| 'light' \| 'dark'` | `{ source, resolved }` (post-set state)                                  |
| `theme:changed` | main → renderer | `{ source, resolved }`          | (broadcast)                                                              |

**Renderer API:** `window.api.getTheme()`, `window.api.setThemeSource(source)`,
`window.api.onThemeChanged(handler)` (returns an unsubscribe function),
`window.api.themeInitial` (sync, populated from preload args).

`theme:set` rejects if `source` is not one of the three valid values.
`theme:changed` broadcasts both on user-initiated changes and on OS
preference changes when source is `'system'`.
```

- [ ] **Step 3: Update `troubleshooting.md`**

Add a new entry:

```markdown
## Theme stuck on light/dark, or not following system

The theme preference persists in `preferences.json` inside the user data
directory:

- macOS: `~/Library/Application Support/biowatch/preferences.json`
- Windows: `%APPDATA%\biowatch\preferences.json`
- Linux: `~/.config/biowatch/preferences.json`

To reset, quit Biowatch, delete the `theme` key from `preferences.json`,
relaunch. The app falls back to `'system'`.

If the toggle responds in Settings but the page doesn't visually
re-theme, force-quit and relaunch — a stuck WebContents won't pick up
new CSS variables until a reload.
```

- [ ] **Step 4: Update `development.md`**

Add a brief section under tooling:

```markdown
### Theme codemod

`scripts/theme-codemod.js` walks `.jsx` files and converts hardcoded
color utilities to semantic tokens or paired `dark:` variants. Run it
on a directory:

    node scripts/theme-codemod.js src/renderer/src/<dir>

Review with `git diff`, resolve any `THEME-REVIEW: bg-white` flags
(printed to stdout) by deciding `bg-card` vs `bg-background` in
context, and commit per directory.

Tests: `node --test test/scripts/theme-codemod.test.js`.
```

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs(theme): document theme service, IPC API, codemod, and troubleshooting"
```

---

### Task 23: Manual QA pass

**Files:** none.

This task is a manual sweep against the spec's QA checklist. Each step is "exercise this surface in both modes; fix any issues found in a follow-up commit."

- [ ] **Step 1: Settings sub-tabs (both modes)** — Appearance, AI Models, Info.

- [ ] **Step 2: Sidebar (both modes)** — active study, hover states, search input, "no studies" empty state, context menu (right-click a study).

- [ ] **Step 3: Pages (both modes)** — for a study with data, click through Overview, Deployments, Media, Activity, Sources, Export tabs. Compare to a screenshot taken in light mode pre-migration to verify light parity. (If no pre-migration screenshots exist, skip the parity check and verify dark mode looks coherent.)

- [ ] **Step 4: Modals (both modes)** — Add Source, Delete Study, Country Picker, Camtrap import progress, GBIF import progress, Demo import progress, Lila import progress, Export progress, Best Capture, Link Deployment, Cache section, ImageDirectories Export.

- [ ] **Step 5: Toasts (both modes)** — trigger a success toast (delete a study) and an error toast (try an invalid action). Verify both color variants flip with theme.

- [ ] **Step 6: Charts (both modes)** — bar/line/pie color contrast on Activity tab, Overview tiles. Tooltip backgrounds and grid lines flip. Legend text readable.

- [ ] **Step 7: Maps (both modes)** — Leaflet tiles, camera markers, pie-chart markers, species hover-card. Verify markers visible against `dark_all` tiles.

- [ ] **Step 8: ErrorFallback (both modes)** — temporarily throw an error (add `throw new Error('test')` to a component), verify the red-themed panel re-themes correctly. Revert.

- [ ] **Step 9: OS reactivity (System mode)** — set toggle to System, change OS preference, verify app re-themes within ~1s and the helper text updates.

- [ ] **Step 10: Persistence** — set to Dark, quit (Cmd-Q / Ctrl-Q), relaunch. Verify dark mode is active immediately on launch (no light flash) and the toggle reflects Dark.

- [ ] **Step 11:** If any issues found, fix them in focused commits with messages like `fix(theme): <thing>`.

- [ ] **Step 12: Final commit (if any QA fixes)**

```bash
git add <changed-files>
git commit -m "fix(theme): manual QA fixes"
```

---

## Done

The app now ships with a working tri-state Appearance toggle that follows the OS preference, persists across launches, paints without FOUC on relaunch, and themes the entire renderer in dark mode without altering light-mode appearance.

Spec: `docs/specs/2026-05-06-dark-theme-design.md`.
Plan: `docs/plans/2026-05-06-dark-theme.md`.
