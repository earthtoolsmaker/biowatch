# Sources Tab — Multi-Source Design

**Status:** Draft
**Date:** 2026-04-29
**Replaces:** Approach attempted in [PR #347](https://github.com/earthtoolsmaker/biowatch/pull/347)

## Problem

The "Files" tab today is gated on `importerName?.startsWith('local/')`. It was designed around the local-ML-run mental model: each row is a folder on disk, and progress is computed as `count(media with any observation) / count(media)`.

That model breaks for non-local imports:

- **CamtrapDP packages** import with observations already attached. The "media without observation = unprocessed" heuristic shows them as partly-processed even when nothing is running.
- **LILA imports** never set `media.importFolder` or `media.folderName`, so rows show as null.
- **GBIF datasets** arrive as CamtrapDP packages whose `media.filePath` values are `https://` URLs; the existing path-derived folder logic produces nonsense labels.

PR #347 patched these symptoms (synthetic blank observations, `Add Folder` modal, mediatype inference, etc.) but the underlying conflation between "has observations from import" and "has been run through our model" stayed unresolved.

## Goal

Always show the tab. Make it source-agnostic — local folders, CamtrapDP packages (local or remote), and LILA datasets all render in one consistent layout. Lay groundwork for a follow-up "sync & rerun a model run" feature without committing to it now.

## Non-goals

The following are explicitly out of scope for this PR (left to future work):

- Sync / rerun a model on a specific source (follow-up PR).
- Distinct GBIF labelling — GBIF imports are treated as plain `camtrap/datapackage`.
- Schema changes or migrations of any kind.
- Reworking how `model_runs` track in-progress state.
- Reworking the global running-import progress widget in the study header (it stays as it is today — see decision **D7** below).

## Decisions

### D1 — Tab name: "Sources" (was "Files")

A folder is one specific kind of source, not the parent concept. "Sources" reads naturally for both local folders and remote datasets and pairs well with future affordances ("Add source", "Sync source").

### D2 — Always show the tab

Remove the `importerName?.startsWith('local/')` gate in `study.jsx`. Every study type renders the Sources tab.

### D3 — A "source" = a distinct value of `media.importFolder`

We do not introduce a new `imports`/`sources` table or a `sourceID` column. Sources are derived at query time from existing fields. Each distinct `importFolder` value across a study's media becomes one row.

This requires fixing two parsers that don't currently set `importFolder` sensibly:

- `lila/coco`: must set `importFolder` to the LILA dataset name (e.g., `"Snapshot Serengeti"`) at import time. Currently null.
- `camtrap/datapackage`: keep PR #347's behavior (`importFolder` = absolute package directory path).

### D4 — GBIF treated identically to plain CamtrapDP

GBIF is not a distinct importer. The current import flow's "Gbif" awareness lives in the import UI only; the resulting study is `camtrap/datapackage`. The Sources tab does not differentiate. Whether a CamtrapDP study's media is local or remote URLs is reflected via a row-level **Local / Remote** badge derived from `media.filePath` (`startsWith('http')`).

### D5 — Per-row content (collapsed)

Each row shows:

| Element | Source |
| --- | --- |
| Expand chevron | only when sub-rows exist |
| Source-type icon (lucide SVG, gray) | `Folder` for local-style, `Globe` for LILA-remote, `Package` for CamtrapDP |
| Source name | for local: folder basename; for CamtrapDP: package basename; for LILA: `"LILA — <Dataset name>"` |
| **Local / Remote** badge | derived from any media's `filePath` in this source — `Remote` if the first matching row's path is a URL |
| Path / URL | `media.importFolder` truncated with `text-overflow: ellipsis`, full value on hover |
| Last-model info icon `ⓘ` | shown only when at least one model run has produced outputs for media in this source; tooltip shows `modelID + modelVersion` |
| Counts | `<bold>X</bold> images · <bold>Y</bold> videos · Z deployments` — drop the videos term when Y=0; drop the images term when X=0 (matches today's `files.jsx` convention) |
| Status | one of: ✓ pill, in-flight progress bar, or empty (see D6) |

### D6 — Status column has three states

| State | Condition | Display |
| --- | --- | --- |
| **✓** (green circle, 18px) | source has at least one observation row whose mediaID is in this source's media | hover tooltip shows `<count> observations` |
| **In-flight** (thin progress bar + `X / Y` text) | a `model_run` with `status='running'` exists whose `importPath` matches this source's `importFolder` | bar fill width = `processed / total` computed at render time, never hardcoded; `X / Y` is `count(model_outputs for this run, scoped to this source's media)` over `count(media in this source)` |
| empty cell | none of the above | nothing rendered |

The states are mutually exclusive and computed in the order above. **In-flight wins over ✓** if a model is running, even though observations may already exist on the source.

### D7 — Global running-import widget stays in study header

The existing Pause / Resume / ETA widget in `study.jsx` continues to show in the study header. It is also reflected per-row in the Sources tab (as the in-flight bar in D6). Some duplication is intentional — the user shouldn't have to navigate to Sources to see import status from the Media or Activity tab.

### D8 — Sub-rows: deployments, indented only

Each parent source row may expand to reveal one row per deployment whose media belongs to this source.

- Sub-row label: `deployments.locationName` if available, else `media.folderName`, else `deploymentID`.
- Sub-row content: name + `<bold>X</bold> images · <bold>Y</bold> videos` + status (same three states as D6).
- Sub-rows are indented with `margin-left: 56px` to align under the parent's name column. **No tree-glyph (`└`) marker, no icon column** — pure indentation, matching `deployments.jsx`.
- Sub-rows are leaves — no further expansion.

For sources with very many deployments (LILA-style, hundreds), the initial implementation may render all of them; pagination can be revisited only if it becomes a usability problem. Sub-rows for remote-CamtrapDP / LILA may be sparse if the dataset's deployment metadata is thin — that's acceptable.

### D9 — Tab header

Top of the tab:

- Left: `<bold>N sources · M media files</bold>` summary text.
- Right: `+ Add images directory` button — **enabled for every study type that has loaded** (any non-empty `importerName`). The flow opens an `AddSourceModal` that picks a model + country + folder and runs an importer on the chosen folder. The resulting study mixes the new local source with whatever was there before; the multi-source Sources tab handles that by design.

> **Note:** an earlier draft of this spec disabled the button for `lila/coco` and `deepfaune/csv` studies on the assumption that mixing remote-URL or pre-classified media with a fresh local-images run would be confusing. Implementation testing showed it is not — adding a folder to a LILA study just produces a second source row and an independent model run; nothing about the original LILA media changes. Gating was relaxed in commit `d60c845`.

### D10 — Drop the synthetic-blank-observation workaround

PR #347 added `createBlankObservationsForUnlinkedMedia()` to make CamtrapDP imports reach 100% in the existing Files tab. With D6, source progress no longer relies on observation existence as the "processed" signal — it uses `model_outputs` directly. The synthetic-blank step is no longer needed for the Sources tab.

**However:** PR #347 also adjusted blank-detection queries in `species.js` and `sequences.js` because synthesis would otherwise break the blank filter. Whether the synthesis step can be fully removed depends on whether the Media tab's "processed" filter still relies on `observationID IS NOT NULL`. **This needs to be verified during implementation** — if the Media tab still needs synthesis, keep it; the Sources tab does not.

The conservative default: **keep the synthesis logic in CamtrapDP parser for now**, and only restructure the Sources tab queries so they don't depend on it. Removing synthesis can come in a follow-up once the Media tab's "processed" semantics are revisited.

## Data flow

A new query (effectively a renamed `getFilesData` → `getSourcesData`) returns:

```ts
type SourceRow = {
  importFolder: string                // grouping key
  isRemote: boolean                   // any filePath in this source startsWith('http')
  imageCount: number
  videoCount: number
  deploymentCount: number
  observationCount: number            // for ✓ tooltip
  activeRun: {                        // null when no in-flight model run
    runID: string
    modelID: string
    modelVersion: string
    processed: number
    total: number
  } | null
  lastModelUsed: { modelID: string, modelVersion: string } | null  // most recent completed run
  deployments: Array<{                // sub-row data
    deploymentID: string
    label: string                     // locationName ?? folderName ?? deploymentID
    imageCount: number
    videoCount: number
    observationCount: number
    activeRun: { processed, total } | null
  }>
}
```

The renderer takes this list as the input to a presentational component. No new IPC channel beyond renaming the existing `window.api.getFilesData` to `window.api.getSourcesData` (or keeping `getFilesData` for one release for backwards compatibility).

## UI reference

Final mockup: `v11` of the brainstorming session (`.superpowers/brainstorm/.../sources-row-v11.html`). Key visual properties:

- Flat list, no card outlines per row, single bottom borders (matches `deployments.jsx`).
- Hover: `bg-gray-50`.
- Row icon: lucide SVG, `text-gray-400`.
- Badges: lightweight gray pill (`bg-gray-100 text-gray-500 text-xs rounded`).
- Sub-rows: pure indentation, no markers.
- Status indicator: small ✓ (18px), or 140px-wide thin progress bar with count above.
- Path: monospace, gray, ellipsised, full value on hover.

## Code changes (file-level)

| File | Change |
| --- | --- |
| `src/renderer/src/study.jsx` | Drop `local/*` gate on Sources tab and route. Update tab label to "Sources". Update icon import if desired (keep `FolderOpen` or switch to `Layers` / `Database`). |
| `src/renderer/src/files.jsx` | Rewrite for the new layout per the v11 mockup. Consider renaming the file to `sources.jsx`. |
| `src/main/database/queries/media.js` | Rewrite `getFilesData` (rename to `getSourcesData`) to return the `SourceRow[]` shape above. Drop the LIKE-based `lastModelUsed` correlated subquery in favor of an explicit join, scoped per source. |
| `src/main/services/import/parsers/lila.js` | Set `importFolder` = LILA dataset name and `folderName` = an appropriate sub-grouping (e.g., the imageBaseUrl path segment) at insert time. |
| `src/main/services/import/parsers/camtrapDP.js` | No required changes for the Sources tab itself; PR #347's `importFolder` / `folderName` derivation stays. **Re-evaluate** whether `createBlankObservationsForUnlinkedMedia` can be removed (see D10) — likely not in this PR. |
| `src/main/ipc/media.js`, `src/preload/index.js` | Rename API endpoint if `getFilesData` → `getSourcesData`. |
| `docs/architecture.md`, `docs/database-schema.md`, `docs/import-export.md` | Update references to "Files" → "Sources"; document derived-source semantics (D3). |

## Open implementation questions

- **Active-run detection.** The cleanest signal that "a model is running on this source" is `model_runs.status='running' AND importPath = importFolder`. Verify `importPath` is reliably populated by every code path that creates a `model_run`.
- **Remote/Local determination.** Computing the badge requires reading at least one `filePath` per source. A `MAX(CASE WHEN filePath LIKE 'http%' ...)` aggregation in the source query is sufficient; no new column needed.
- **LILA `folderName`.** Set to something useful or leave null? Probably not needed for the Sources tab itself (LILA studies likely render as a single-row source). Verify against the mockup before adding fields.
- **CamtrapDP-only studies with `Add source` enabled.** Confirm the existing PR #347 modal flow (model picker + country picker) works for CamtrapDP studies whose media is purely remote URLs — if not, this PR keeps the button enabled for local-CamtrapDP only.
