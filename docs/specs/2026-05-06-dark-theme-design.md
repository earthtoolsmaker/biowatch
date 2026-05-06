# Dark theme

**Date:** 2026-05-06
**Status:** Design — approved
**Area:** main (`src/main/services/preferences.js`, `src/main/services/theme.js`, `src/main/index.js`, `src/preload/index.js`); renderer (`src/renderer/src/assets/main.css`, new `src/renderer/src/hooks/useTheme.js`, new `src/renderer/src/settings/Appearance.jsx`, new `src/renderer/src/ui/ThemeSegmentedControl.jsx`, `src/renderer/src/settings.jsx`, `src/renderer/src/base.jsx`); a codemod-driven sweep across `src/renderer/src/**/*.jsx`.

## Summary

Add a dark theme toggle to Biowatch, configurable from the Settings page as
a tri-state control (System / Light / Dark) and matching the OS preference
when set to System. Light-mode appearance is preserved pixel-identical:
the change adds a dark counterpart to the existing token system rather than
re-tuning the current palette. Migration uses a codemod that converts only
neutral utilities (whites, grays, borders) to semantic tokens and pairs
colored utilities (blue/red/green/yellow) with explicit `dark:` variants.

## Motivation

Biowatch's UI is currently light-only. Users on dark-themed operating
systems (the default on macOS Sequoia and increasingly on Windows 11) get
a bright window in an otherwise dark workspace. Researchers also work
through long evening sessions reviewing camera trap imagery; an option
to dim the chrome reduces eye strain during media review.

The renderer already has a shadcn-style semantic-token block in
`assets/main.css` (`--color-background`, `--color-foreground`, `--color-card`,
`--color-muted`, `--color-border`, `--color-primary`, `--color-accent`,
`--color-destructive`, sidebar variants, chart colors), but components
mostly bypass it and hardcode Tailwind utilities (`bg-white`,
`text-gray-700`, `border-gray-200`, `bg-blue-600`). Roughly 760 such
hardcoded utilities exist across the renderer. Adding dark mode forces
the codebase to actually adopt the token system it already declared,
which is a long-term win independent of dark mode itself.

## Goals

- Tri-state toggle: **System** / **Light** / **Dark**.
- "System" follows the OS preference and reacts live when the OS preference
  changes (no app restart).
- Preference persists across launches.
- No flash of light content on launch when dark is active.
- Toggle lives in a new **Appearance** tab in the Settings page (first tab),
  using a segmented control with `Monitor` / `Sun` / `Moon` icons.
- Light-mode appearance after the migration is **pixel-identical** to today.
- Dark palette uses Tailwind's slate scale as a base, harmonising with
  Biowatch's existing blue accents.
- Dark mode covers the full app shell, all settings tabs, study pages
  (overview, deployments, media, activity, sources, export), modals,
  toasts, charts, and maps.

## Non-goals

- Per-study or per-page theme overrides.
- Changing any light-mode color values.
- A user-customisable accent color or font size — Appearance is a home
  for future visual prefs but v1 ships only the theme control.
- Visual regression test suite. Manual QA sweep is the v1 verification.
- Re-theming exported images (`html-to-image` chart exports). Whatever
  theme is active at export time is what the user gets. Followup decision.
- Keyboard shortcut to toggle the theme.
- A sidebar or header quick-toggle. The setting is set-once for most users.

## Architecture

### Source of truth

The **main process** owns theme state via Electron's built-in `nativeTheme`
module. `nativeTheme.themeSource` accepts `'system' | 'light' | 'dark'` and
controls how Chromium resolves `prefers-color-scheme`. `nativeTheme.shouldUseDarkColors`
exposes the resolved boolean, and `nativeTheme.on('updated', …)` fires
whenever the OS preference changes (when source is `'system'`).

### Persistence

A small JSON file at `path.join(app.getPath('userData'), 'preferences.json')`
holds user preferences. Initial schema:

```json
{ "theme": { "source": "system" } }
```

Reasons over `localStorage`:

- `base.jsx`'s `ErrorFallback` includes a "Clear all Data" button that calls
  `localStorage.clear()`. Storing the theme in `localStorage` would wipe the
  user's preference during error recovery — confusing.
- A main-process file is readable _before_ the BrowserWindow is created,
  which is what kills the flash-of-light-content (FOUC).
- It gives a clean home for future user prefs without inventing a second
  storage mechanism.

The preferences file is read at startup, written atomically (`fs.writeFile`
to a sibling temp file, then `fs.rename`) on every set. Missing or corrupt
files fall back to defaults silently and are rewritten on next set.

### Boot sequence (FOUC-free)

1. Main reads `preferences.json` and calls
   `nativeTheme.themeSource = stored.theme.source`.
2. Main computes the resolved boolean via `nativeTheme.shouldUseDarkColors`
   and creates the `BrowserWindow` with `backgroundColor` set to the
   resolved theme's background hex (`#ffffff` / `#0f172a`). The native
   window paints the right color before HTML loads.
3. The resolved value is exposed to the renderer via `contextBridge`
   in the preload (`window.api.themeInitial = { source, resolved }`).
4. An inline `<script>` at the top of `index.html` reads
   `window.api.themeInitial.resolved` and adds `class="dark"` to
   `document.documentElement` _before_ React mounts.

Step 4 means React's first render already sees the correct class — no
FOUC.

### Live updates

`nativeTheme.on('updated', …)` fires when the OS flips dark/light (only
relevant when `source === 'system'`) or when we set `themeSource`
ourselves. The handler:

1. Reads the new resolved value.
2. Broadcasts a `theme:changed` IPC event to all renderer windows with
   `{ source, resolved }`.

The renderer's `useTheme` hook subscribes once at mount, toggles the
`dark` class on `<html>`, and updates its internal state.

### IPC surface

Three new handlers, registered in `src/main/index.js` and exposed via
`src/preload/index.js`:

- `theme:get` → returns `{ source, resolved }`.
- `theme:set` (args: `'system' | 'light' | 'dark'`) → sets
  `nativeTheme.themeSource`, persists to `preferences.json`, broadcasts
  `theme:changed`.
- `theme:changed` → main → renderer broadcast event with `{ source, resolved }`.

### New files

| Path                                            | Responsibility                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/main/services/preferences.js`              | Read/write `preferences.json` with atomic write and fallback-on-corrupt.                         |
| `src/main/services/theme.js`                    | Wraps `nativeTheme`, persistence, IPC registration, OS-update broadcast.                         |
| `src/renderer/src/hooks/useTheme.js`            | `{ source, resolved, setSource }` — calls IPC, subscribes to broadcasts, toggles `<html>` class. |
| `src/renderer/src/settings/Appearance.jsx`      | Settings panel for the Appearance tab.                                                           |
| `src/renderer/src/ui/ThemeSegmentedControl.jsx` | Reusable segmented control with `Monitor` / `Sun` / `Moon`.                                      |

## Token system

### Tailwind v4 dark variant

`assets/main.css` adds:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

This makes `dark:` classes activate when `<html>` has `class="dark"`.
Tailwind v4 does not auto-enable a dark variant; this is the v4-idiomatic
way.

### Token definitions

Existing `@theme` block stays exactly as-is — every current value is
preserved. A new `.dark { … }` block declares dark counterparts:

```css
.dark {
  --color-background: #0f172a; /* slate-900 */
  --color-foreground: #f1f5f9; /* slate-100 */
  --color-card: #1e293b; /* slate-800 */
  --color-card-foreground: #f1f5f9;
  --color-popover: #1e293b;
  --color-popover-foreground: #f1f5f9;
  --color-primary: oklch(0.985 0 0); /* near-white — invert of #030213 */
  --color-primary-foreground: #030213;
  --color-secondary: #334155;
  --color-secondary-foreground: #f1f5f9;
  --color-muted: #334155; /* slate-700 */
  --color-muted-foreground: #94a3b8; /* slate-400 */
  --color-accent: #334155;
  --color-accent-foreground: #f1f5f9;
  --color-destructive: #f87171; /* red-400 — reads better on dark */
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
```

Exact dark hex values to be calibrated during implementation; the values
above are the starting point for the slate-flavored direction approved
during brainstorming.

### body background

`body { background-color: rgb(250, 250, 250); }` is currently a literal
rule in `assets/main.css`. The dark counterpart is added as a separate
`.dark body { background-color: var(--color-background); }` rule. The
literal light rule is left untouched so light-mode `body` paints
identically. (Var-ising the light rule would couple `body` to whatever
`--color-background` is, risking a one-pixel light-mode diff we want to
avoid for this migration.)

## Migration strategy

The renderer has roughly 760 sites of hardcoded color utilities. A small
codemod handles the safe rewrites; the remainder is reviewed manually.

### Codemod

A Node script (~80 lines) at `scripts/theme-codemod.js` walks
`src/renderer/src/**/*.jsx`, parses class strings (`className="…"` and
``className={`…`}`` template literals), and applies the rules below.
Output is a diff written to stdout, never auto-committed; the human
reviews and commits per-directory chunks.

### Conversion rules

**Neutral utilities** (the safe rewrites) — only applied where the existing
light token paints the same pixels:

| From                                                       | To                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `bg-white`                                                 | `bg-card` _(or `bg-background`; flagged for review when ambiguous)_ |
| `text-gray-900` / `text-gray-700`                          | `text-foreground`                                                   |
| `text-gray-500` / `text-gray-400` / `text-gray-600`        | `text-muted-foreground`                                             |
| `bg-gray-100` / `bg-gray-200` (when used as muted surface) | `bg-muted`                                                          |
| `hover:bg-gray-100` / `hover:bg-gray-200`                  | `hover:bg-accent`                                                   |
| `border-gray-200` / `border-gray-300`                      | `border-border`                                                     |

Where the existing token is not pixel-identical to the Tailwind utility,
the codemod leaves the literal class and appends a paired `dark:`
counterpart instead.

**Colored utilities** (blue/red/green/yellow) keep their light values and
get a paired `dark:` variant. Examples:

| From                           | To                                                                        |
| ------------------------------ | ------------------------------------------------------------------------- |
| `bg-blue-50 text-blue-700`     | `bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300`         |
| `bg-blue-600 text-white`       | `bg-blue-600 text-white dark:bg-blue-500 dark:text-white`                 |
| `bg-red-50 text-red-700`       | `bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300`             |
| `bg-green-100 text-green-800`  | `bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300`    |
| `bg-yellow-50 text-yellow-700` | `bg-yellow-50 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300` |

Concrete dark values are calibrated during implementation against contrast
checks; the pattern is "literal light + paired dark variant."

### Ambiguities flagged for manual review

`bg-white` is sometimes a _card surface_ and sometimes the _page background_.
Codemod tags ambiguous sites with `// THEME-REVIEW: bg-white → ?` and we
sweep tagged sites in a single pass.

### Promote-to-token rule

A literal pattern is promoted to a semantic token only when it appears
≥3 times in the codebase. Avoids inflating the palette for one-off
accent colors.

### Out of codemod scope (manual)

- `assets/main.css` — body background, scrollbar styling, ErrorFallback
  panel, recharts grid line stroke.
- Inline `style={{ backgroundColor: … }}` sites (e.g., `KpiTile`, leaflet
  tooltips). Grep, convert to classes or `var(--color-…)`.
- Hex/rgb literals in CSS keyframes and animations.
- Map tile selection (see Third-party section).

### Migration order (verifiable per chunk)

1. Add `@custom-variant dark`, the dark token block, and the
   `.dark body` rule to `assets/main.css`. _No visible change in light
   mode; dark mode is now active but most components still use literal
   utilities and won't yet reflect it._
2. Build the theme infrastructure (Section "Architecture"): preferences
   service, theme service, IPC, preload exposure, inline boot script,
   `useTheme` hook. Verify the toggle exists and changes the `<html>`
   class, even though most components don't yet respond.
3. Run codemod, review diff. Commit per-directory chunks: `ui/` →
   `overview/` → `deployments/` → `media/` → top-level pages → `models/`
   → `SettingsInfo/` → `hooks/`, etc.
4. Sweep `THEME-REVIEW` tags.
5. Convert inline-style sites.
6. Theme third-party libs (Recharts, Leaflet, sonner).
7. Build the Appearance settings UI and wire it to `useTheme`.

Verification per chunk: launch dev, force `<html class="dark">` via
DevTools, click through the chunk's pages, check contrast on both modes.

## Settings UI

A new **Appearance** tab is added to the Settings page, ordered first.

```
[Appearance]  AI Models  Info   (Advanced — hidden)
```

Tab icon: `Palette` from `lucide-react`. Placement first matches OS
conventions and is where users hunt for theme controls.

### Layout

```
Appearance
─────────────────────────────────────────
Theme
Choose how Biowatch looks.

  ┌──────────┬──────────┬──────────┐
  │ ☐ System │  ☐ Light │  ◼ Dark  │
  └──────────┴──────────┴──────────┘

  Following system preference (currently Dark).
```

The helper line below the segmented control appears only when **System**
is selected, showing what the OS resolved to ("currently Dark" or
"currently Light"). Updates live when the OS preference flips.

### Components

- **`Appearance.jsx`** — the panel. Reads `useTheme()`, renders the
  segmented control plus helper text. ~60 lines.
- **`ThemeSegmentedControl.jsx`** — reusable tri-state control. Three
  buttons in a single bordered row. Selected segment uses
  `bg-primary/10 text-primary`. Icons from `lucide-react`:
  `Monitor` / `Sun` / `Moon`.

### No app restart required

Toggling fires `window.api.setThemeSource(value)` → main updates
`nativeTheme.themeSource` → main broadcasts `theme:changed` → every
renderer's `useTheme` hook flips the `<html>` class. Every component
that uses semantic tokens or paired `dark:` variants re-paints in the
next frame.

## Third-party libraries

### Recharts

Charts already pull from `--color-chart-1`…`--color-chart-5` if
components reference these vars. Audit task: grep for hardcoded `fill="…"`
/ `stroke="…"` / `color: '#…'` props inside recharts components in
`src/renderer/src/**/*.jsx`; replace with `var(--color-chart-N)`. Tooltip
and grid colors (`stroke="--color-border"`, `background="var(--color-card)"`)
flip automatically once they reference vars.

Dark equivalents for the chart variables are defined in the dark token
block.

### sonner toasts

`base.jsx` instantiates `<Toaster position="top-right" richColors />`.
sonner accepts a `theme` prop. Replace with:

```jsx
const { resolved } = useTheme()
<Toaster position="top-right" richColors theme={resolved} />
```

One-line change. All toast variants retheme automatically.

### Leaflet

The map component currently uses one tile layer (CartoDB Positron). On
dark mode this leaves a bright rectangle inside a dark page, which most
users perceive as broken.

Switch tile layer based on theme:

- Light: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/...`
  (or the existing Positron — whichever is currently in use).
- Dark: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`.

Same provider, free, attribution unchanged. Implementation: a `useMemo`
keyed on `useTheme().resolved` returns the URL; the `<TileLayer>` `url`
prop reads from it. The `TileLayer` rerenders when `url` changes.

Custom camera markers and pie-chart markers may need a 1-px outer stroke
to maintain contrast against `dark_all`. Verify visually during the
Leaflet pass.

### Radix UI (`react-tooltip`, `react-select`, `react-hover-card`)

Unstyled — picks up our Tailwind classes. Auto-rethemes once consumer
components use semantic tokens or paired `dark:` variants. No special
work.

### `@tanstack/react-virtual`, `react-resizable-panels`, `react-error-boundary`, `html-to-image`

Pure logic, no colors. `html-to-image` exports whatever theme is currently
rendered; followup if we want exports to always be light-themed.

## Testing

### Unit tests (`test/**/*.test.js`)

`test/preferences.test.js`:

- Reading a missing file returns `{}` (graceful default).
- Reading a corrupt file returns `{}` and does not throw.
- Round-trip: write `{ theme: { source: 'dark' } }`, read returns same.
- Concurrent writes use temp-file + rename, never produce a partial file.

`test/theme.test.js` (mocking `electron`'s `nativeTheme`):

- Source `'system'` + mocked `shouldUseDarkColors === true` → `getResolved()` returns `'dark'`.
- Source `'light'` → resolved `'light'` regardless of OS.
- Source `'dark'` → resolved `'dark'` regardless of OS.
- Setting source persists to preferences and broadcasts `theme:changed`.
- Mocked OS-update event triggers a `theme:changed` broadcast.

The existing `services/logger.js` already falls back to `console` outside
Electron — same pattern applies for mocking `nativeTheme`.

### E2E (`test/e2e/theme.spec.js`)

Single happy-path scenario:

1. Launch app, navigate to **Settings → Appearance**.
2. Click **Dark** → assert `<html class="dark">` is set.
3. Click **Light** → assert `dark` class removed.
4. Click **System** → assert helper text shows "currently Light" or
   "currently Dark" matching `nativeTheme.shouldUseDarkColors` at test time.
5. Restart app → assert preference persisted (the `<html>` class on next
   launch matches the previously-selected mode).

This is the only e2e because asserting that every component themes
correctly without a visual regression suite is unrealistic.

### Manual QA checklist

Verify in both modes:

- All settings sub-tabs.
- Sidebar (active state, hover state, search input, "no studies" empty state, context menu).
- Pages: study overview, deployments, media, activity, sources, export.
- Modals: Add Source, Delete Study, Country Picker, Camtrap import progress, GBIF import progress, Export progress, Best Capture, Link Deployment.
- Toasts: success and error variants.
- Recharts: bar, line, pie color contrast on both backgrounds.
- Leaflet: map tiles, camera markers, pie markers, species hover-card.
- ErrorFallback red panel.
- Toggle OS preference at runtime → app follows when in System mode.
- Cmd-Q + relaunch → preference survives.

## Documentation updates

Per `CLAUDE.md`, update:

- `docs/architecture.md` — add the theme service to the main-process diagram.
- `docs/ipc-api.md` — document `theme:get`, `theme:set`, `theme:changed`.
- `docs/troubleshooting.md` — add a "theme stuck on light/dark or not
  following system" entry pointing at `~/Library/Application Support/biowatch/preferences.json`
  (and its Windows / Linux equivalents).
- `docs/development.md` — document the codemod script under tooling.

## Open questions

None blocking. Followup decisions noted under Non-goals (export theming,
keyboard shortcut, sidebar quick-toggle).
