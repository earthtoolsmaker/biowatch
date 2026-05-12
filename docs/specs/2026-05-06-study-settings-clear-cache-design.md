# Study Settings — Clear Cache section

**Date:** 2026-05-06
**Status:** Design — approved
**Area:** renderer (`src/renderer/src/StudySettings.jsx`, new `CacheSection.jsx`); main (new `src/main/services/cache/study.js`, two new IPC handlers in `src/main/ipc/study.js`); preload (`src/preload/index.js`).

## Summary

Add a new "Cache" section to the per-study Settings page that shows the
total disk used by the study's cache directory, lets the user clear it
with a single button, and offers an expandable per-type breakdown
(transcoded videos, video thumbnails, remote images, source videos).

A single read IPC returns total + breakdown; a single write IPC wipes
the whole `<study>/cache/` directory and returns what was freed.

## Motivation

Each study accumulates a `cache/` directory at
`<userData>/biowatch-data/studies/<studyId>/cache/`, containing four
known subdirectories:

- `transcodes/` — `.mp4` browser-playable copies of AVI/MKV/MOV/etc.
- `thumbnails/` — `.jpg` first-frame stills extracted from videos.
- `images/` — downloaded remote images (GBIF/Agouti).
- `videos/` — downloaded source files for remote video URLs.

For studies with many videos or remote media, this directory can grow
to several GB. Today, the only way to reclaim that disk space is the
30-day background cleanup in `src/main/services/cache/cleanup.js`,
which only handles `transcodes/` and `images/` and only files older
than 30 days. There is no user-facing way to inspect cache size or
trigger an immediate clear.

The Settings → Info tab's `StorageBreakdown` shows aggregate "Studies"
disk usage but doesn't break out cache vs. real data, and is not
per-study.

## Goals

- New "Cache" section in `src/renderer/src/StudySettings.jsx`, between
  Export and Danger Zone.
- One-line summary: total cache size and file count, with a single
  "Clear" button.
- Expandable breakdown listing the four cache subtypes with their
  individual sizes.
- Clearing requires no confirmation. Cache is fully regenerable; the
  worst case is re-transcoding/re-downloading on next view.
- Inline result message after clearing ("Cleared 240 MB · 1,142
  files") next to the button.
- Single read IPC returns total + breakdown in one call; single write
  IPC clears the whole `cache/` directory.

## Non-goals

- **Per-type clearing.** The user picked a single "Clear All" action.
  No "clear only thumbnails" affordance.
- **Confirmation modal.** Cleared files are regenerated automatically;
  modal ceremony is disproportionate to the action.
- **Cross-study / global cache management.** Section is scoped to one
  study, matching the rest of the Study Settings page. Settings →
  Info's `StorageBreakdown` is unchanged.
- **Replacing the 30-day background cleanup.** That cleanup keeps
  running independently for studies the user never opens.

## UI layout

The current `StudySettings.jsx` layout is three stacked sections:
Sequence Grouping → Export → Danger Zone. The new section sits between
Export and Danger Zone:

```
Sequence Grouping
─────────────────
Export
─────────────────
Cache                              ← new
─────────────────
Danger Zone
```

### Section content

```
┌─ Cache ──────────────────────────────────────────────────┐
│ Cached transcoded videos, thumbnails, and remote images. │
│ Cleared files are regenerated automatically when needed. │
│                                                          │
│  Total used        260 MB · 1,142 files     [Clear]      │
│                                                          │
│  ▸ Show breakdown                                        │
└──────────────────────────────────────────────────────────┘
```

Expanded:

```
  ▾ Hide breakdown
    Transcoded videos    240 MB · 38 files
    Video thumbnails       8 MB · 38 files
    Remote images         12 MB · 1,066 files
    Source videos          0 B  · 0 files
```

Visual style follows the existing `Sequence Grouping` and `Export`
sections: `<h2 className="text-base font-medium text-gray-900 mb-1">`
heading, `<p className="text-sm text-gray-500 mb-4">` description.

The total row uses the same key/value layout as
`SettingsInfo/StorageBreakdown.jsx` rows:

- Left: label "Total used" (sm gray-700).
- Right cluster: size + file count (sm tabular-nums gray-900) and the
  Clear button (small button, gray border, hover bg-gray-50). Spacing
  matches the right-cluster of `StorageRow`.

The "Show breakdown" / "Hide breakdown" toggle is a `<button>` styled
like a link (text-sm text-gray-500 hover:text-gray-700) with a
chevron icon (lucide `ChevronRight` / `ChevronDown`).

### States

| State                       | Total                  | Button                                   | Notes                                                                              |
| --------------------------- | ---------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Loading (initial fetch)     | "…" placeholder        | disabled                                 | spinner not required; brief query                                                  |
| Empty (`total.bytes === 0`) | "0 B · 0 files" gray   | disabled                                 | no breakdown toggle shown                                                          |
| Populated                   | "260 MB · 1,142 files" | enabled                                  | breakdown toggle shown                                                             |
| Clearing                    | unchanged              | disabled, label "Clearing…" with spinner | breakdown toggle disabled                                                          |
| Cleared (success)           | refetched (zeros)      | enabled                                  | green inline "Cleared 240 MB · 1,142 files" next to button, persists until unmount |
| Cleared (error)             | unchanged              | enabled                                  | red inline "Failed to clear cache: <message>"                                      |

## Component architecture

New file: `src/renderer/src/CacheSection.jsx`, sibling to
`StudySettings.jsx`. Follows the pattern already established by
`Export` and `DeleteStudyModal` (each in their own file).

```jsx
// CacheSection.jsx
export default function CacheSection({ studyId }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['study-cache-stats', studyId],
    queryFn: () => window.api.getStudyCacheStats(studyId)
  })
  const [clearing, setClearing] = useState(false)
  const [lastResult, setLastResult] = useState(null) // { freedBytes, clearedFiles } or { error }
  const [expanded, setExpanded] = useState(false)

  const handleClear = async () => {
    setClearing(true)
    setLastResult(null)
    try {
      const result = await window.api.clearStudyCache(studyId)
      setLastResult(result)
      await refetch()
    } catch (e) {
      setLastResult({ error: e.message })
    } finally {
      setClearing(false)
    }
  }

  // render: heading, description, total row + Clear button,
  // breakdown toggle, optional breakdown rows, inline result
}
```

Mounted from `StudySettings.jsx` between the Export `<section>` and
the Danger Zone `<section>`:

```jsx
<CacheSection studyId={studyId} />
```

## Data flow

### Main process: `src/main/services/cache/study.js` (new)

Two exported functions, both implemented synchronously / using
async fs as needed:

```js
/**
 * @returns {Promise<{
 *   total: { bytes: number, files: number },
 *   breakdown: {
 *     transcodes: { bytes: number, files: number },
 *     thumbnails: { bytes: number, files: number },
 *     images:     { bytes: number, files: number },
 *     videos:     { bytes: number, files: number }
 *   }
 * }>}
 */
export async function getStudyCacheStats(studyId)

/**
 * Removes <userData>/biowatch-data/studies/<studyId>/cache/ entirely.
 * @returns {Promise<{ freedBytes: number, clearedFiles: number, error?: string }>}
 */
export async function clearStudyCache(studyId)
```

`getStudyCacheStats`:

1. Resolves the cache dir as
   `join(getBiowatchDataPath(), 'studies', studyId, 'cache')`. Reuses
   the existing path helper from `src/main/services/paths.js` rather
   than re-using the per-subdir helpers in `cache/video.js` and
   `cache/image.js`.
2. If the cache dir does not exist (`ENOENT`), returns all zeros.
3. Lists immediate children of `cache/`. For each known subtype name
   in `{transcodes, thumbnails, images, videos}` that is a directory,
   walks it once with `fs.readdir` + `fs.stat` (mirroring the helper
   in `services/storage-usage.js:dirSize`) and accumulates `bytes`
   and `files`.
4. Files in `cache/` that don't fall under one of the four known
   subdirs are ignored for the breakdown but counted toward `total`.
   This keeps `total` truthful even if a future subdir is added
   without updating this file.
5. Returns the shape above.

`clearStudyCache`:

1. Calls `getStudyCacheStats(studyId)` first to capture totals (so we
   can return `freedBytes` / `clearedFiles` without re-walking).
2. If the cache dir exists, `rmSync(cacheDir, { recursive: true,
force: true })`. We do **not** recreate the empty `cache/`
   directory; the per-subdir `ensure*Dir` helpers in `cache/video.js`
   and `cache/image.js` already create their subdirs lazily on next
   write.
3. Returns `{ freedBytes: total.bytes, clearedFiles: total.files }`.
4. On error, logs via `services/logger.js` and returns `{
freedBytes: 0, clearedFiles: 0, error: e.message }`.

### Main process: IPC handlers

Added to `src/main/ipc/study.js`, alongside the existing study IPCs:

```js
ipcMain.handle('study:get-cache-stats', async (_event, studyId) => {
  return await getStudyCacheStats(studyId)
})

ipcMain.handle('study:clear-cache', async (_event, studyId) => {
  return await clearStudyCache(studyId)
})
```

### Preload

Add to the api object in `src/preload/index.js`, near the existing
`deleteStudyDatabase` / `getSequenceGap` / `setSequenceGap`:

```js
getStudyCacheStats: async (studyId) =>
  electronAPI.ipcRenderer.invoke('study:get-cache-stats', studyId),
clearStudyCache: async (studyId) =>
  electronAPI.ipcRenderer.invoke('study:clear-cache', studyId),
```

(The existing per-cache APIs `imageCache.*` and `transcode.*` stay as
they are — their stats/clear handlers continue to serve any internal
callers; the new study-level API supersedes them only for the UI.)

### Renderer fetch

`useQuery` with the key `['study-cache-stats', studyId]`. No
`staleTime` override — default behavior is fine since the user
typically only opens Settings explicitly. After a successful clear,
the component calls `refetch()` so the total snaps to zeros.

## Shared `formatBytes`

`SettingsInfo/StorageBreakdown.jsx:4–14` already defines a
`formatBytes` helper. The new `CacheSection.jsx` needs the same. We
lift `formatBytes` out to a shared util:

- New file: `src/renderer/src/utils/formatBytes.js` — exports
  `formatBytes(bytes)` with the same body as the existing function.
- `SettingsInfo/StorageBreakdown.jsx` — replace its inline definition
  with `import { formatBytes } from '../utils/formatBytes.js'`.
- `CacheSection.jsx` — imports it.

This keeps the two formatters in sync and follows the project's "lift
to shared util when used in two places" convention.

## Error handling

- **Cache dir missing on read.** Treat as zeros. Do not throw, do not
  log at error level. `storage-usage.js` follows the same pattern.
- **Subdir unreadable mid-walk.** Log a warning via
  `services/logger.js`, treat the failing entry as 0 bytes / 0
  files, continue. Mirrors `storage-usage.js:dirSize`.
- **`rmSync` failure.** Caught at the `clearStudyCache` boundary;
  returns `{ freedBytes: 0, clearedFiles: 0, error: message }`. The
  renderer renders that as the red inline error.
- **Concurrent clears.** Renderer button is disabled while
  `clearing === true`. Cross-window races aren't guarded — a second
  `rmSync` on an already-empty dir is a no-op.

## Testing

Unit tests for the new service in
`test/main/services/cache/study.test.js`, matching the existing
`test/main/services/cache/cleanup.test.js` location:

- `getStudyCacheStats`
  - cache dir doesn't exist → all zeros, no throw.
  - empty cache dir → all zeros.
  - mixed contents across all four subdirs → correct per-subtype and
    total bytes/files.
  - extra subdir (`other/`) → counted in `total`, not in any
    breakdown bucket.
  - permission error on one subdir → that subdir is zero, others
    correct, no throw.
- `clearStudyCache`
  - cache dir doesn't exist → `{ freedBytes: 0, clearedFiles: 0 }`.
  - populated cache → returns matching `freedBytes` / `clearedFiles`,
    cache dir removed afterward.
  - subsequent `getStudyCacheStats` call returns zeros.

Tests use `tmp` or `os.tmpdir()` for the studies root, the same
pattern as `cleanup.test.js`. No Electron mocks required — the
service takes the studies path as a parameter (or via dependency
injection) so it stays testable outside the Electron runtime.

> Implementation note: `cleanExpiredTranscodeCacheImpl` /
> `cleanExpiredImageCacheImpl` already follow this pattern — the
> Electron-aware wrapper lives next to it and only calls
> `app.getPath('userData')`. `study.js` will follow the same split:
> a pure `getStudyCacheStatsImpl(studiesPath, studyId)` /
> `clearStudyCacheImpl(studiesPath, studyId)` that the tests call,
> and the exported wrappers that resolve `studiesPath` via
> `getBiowatchDataPath()`.

No renderer tests — the project's renderer test setup
(`test/renderer/`) is for pure-function utilities; the section's
behavior is integration-level and will be verified manually.

## File touch list

- `src/main/services/cache/study.js` — **new**: `getStudyCacheStats`,
  `clearStudyCache`, plus pure `*Impl` variants for testing.
- `src/main/services/cache/index.js` — re-export the two new
  functions.
- `src/main/ipc/study.js` — register `study:get-cache-stats` and
  `study:clear-cache` handlers.
- `src/preload/index.js` — expose `getStudyCacheStats` and
  `clearStudyCache`.
- `src/renderer/src/StudySettings.jsx` — import and mount
  `<CacheSection />` between Export and Danger Zone.
- `src/renderer/src/CacheSection.jsx` — **new**.
- `src/renderer/src/utils/formatBytes.js` — **new**: lifted from
  `SettingsInfo/StorageBreakdown.jsx`.
- `src/renderer/src/SettingsInfo/StorageBreakdown.jsx` — replace
  inline `formatBytes` with the shared import.
- `test/main/services/cache/study.test.js` — **new**.
- `docs/ipc-api.md` — document the two new handlers.
- `docs/architecture.md` — only if the cache subdir naming is
  documented there; otherwise no change.

## Open questions

None at design time. Defer to implementation:

- Whether the inline "Cleared X · Y" message should auto-dismiss
  after a few seconds. Default: persists until unmount; revisit if
  it feels stale.
