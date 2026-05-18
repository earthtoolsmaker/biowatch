# Merge another local study as a new source — design

**Status:** Draft
**Date:** 2026-05-18
**Author:** Arthur

## Summary

Today the Sources tab of a study has one action: **"+ Add images directory"**, which scans a local folder. This spec generalizes that action to **"+ Add source"**, which opens a wizard letting the user pick between two source types:

1. **Images directory** — unchanged from today's flow.
2. **Another study** — pick a study from the local list and merge its data (deployments, media, observations, model runs) into the current study, with metadata (description, contributors, date range) merged on a single review screen.

Merge is **in-place** (target study A absorbs source study B's data; B stays untouched), **forward-only** in v1 (no un-merge), and **one study at a time**. Image files from B are physically copied into A's directory so A is self-contained.

## Goals & non-goals

**Goals**
- Surface a new "Merge another study" path as a peer of "Add images directory".
- Make merging safe by default: no PK collisions, no surprise metadata changes, predictable file storage.
- Preserve provenance so the merged data is visible as its own source row in the Sources tab.
- Keep the implementation contained: no schema changes; no DB tables added.

**Non-goals**
- Un-merge / "remove this source" — out of scope.
- Multi-select merge (merging several studies in one operation) — out of scope.
- Reconciling heterogeneous ML model runs across A and B — both runs are preserved as-is.
- Source-scoped deployment matching — needed long-term, deferred to follow-up (see *Known limitations*).
- Resync of an existing source — separate upcoming feature; this spec is forward-compatible with it.

## UX

### Button and modal

The Sources tab's `+ Add images directory` button (`src/renderer/src/sources.jsx:285`) becomes **`+ Add source`**. The existing `AddSourceModal` is restructured as a wizard:

**Step 1 — Type picker.** Two cards: "Images directory" and "Another study". Selecting "Images directory" advances to today's form (model, folder, optional country). Selecting "Another study" advances to Step 2.

**Step 2 — Study picker.** Searchable list of all local studies from `listStudies()` except A itself. Each row shows title, importer-type icon (Folder / Package / Globe), deployment count, media count, and date range. Studies already merged into A appear in the list but are disabled with a small "Already merged" badge.

**Step 3 — Review.** A brief spinner runs while pre-flight checks complete (file-size sum, disk-space query). Then the pre-filled defaults render:
- Summary card: from / into / counts being added (deployments, media, observations) / **disk: "Adding ~X · ~Y free"** (color-coded green when sufficient, red when not).
- Description (textarea, editable). Default = A's description + `"\n\n---\n\n## Merged from <B-title>\n\n"` + B's description.
- Contributors checklist. Default = union of A's and B's contributors deduped by email, all checked. Each row shows the contributor's name, role, and a small badge: "A + B", "A only", "B only". Unchecking removes from the resulting list.
- Date range preview: `min(A.startDate, B.startDate) → max(A.endDate, B.endDate)`, with a note showing the previous range.
- A heads-up note if any IDs were renamed (e.g., "3 deployment IDs from B will be renamed to avoid collision"). Informational only — IDs are internal.

The Merge button is **disabled with an inline error** when pre-flight checks fail (e.g., insufficient disk). Confirming triggers the merge IPC. Modal shows a copy-progress indicator, then a brief "writing rows" step, then auto-closes (same pattern as today's import completion).

### Sources tab after merge

A new source row appears, grouped by `media.importFolder = <A-dir>/merged/<B-uuid>`. Its title is **B's current title** looked up from `getStudies()` at render time (e.g., "Yosemite 2023"), with a small "merged" indicator. If B was deleted, the title comes from a `_merge-info.json` manifest snapshot (see below); if both are gone, fall back to "Merged source". The icon is **B's `importerName`** (so a merged CamtrapDP shows the Package icon, a merged folder shows the Folder icon), not A's.

## Data model

**No new tables. No new columns.** All required provenance is encoded in two places:

1. `media.importFolder = <A-dir>/merged/<B-uuid>` for every merged media row — naturally fits the existing Sources-tab grouping (which already keys on `importFolder`).
2. `<A-dir>/merged/<B-uuid>/_merge-info.json` written alongside the auto-copied files:
   ```json
   {
     "sourceStudyId": "b7f2a1c3-…",
     "sourceStudyTitle": "Yosemite 2023",
     "sourceImporterName": "camtrap/datapackage",
     "mergedAt": "2026-05-18T10:23:00Z"
   }
   ```
   Survives B being deleted. Read by `getSourcesData` to label and icon the row.

PK collision safety: every `deploymentID`, `mediaID`, and `observationID` from B is prefixed with `"study:<B-uuid-short>:"` when copied into A — where `<B-uuid-short>` is the **first 8 characters** of B's UUID (e.g., `"study:b7f2a1c3:CAM_01"`). The directory path uses the **full** UUID (`<A-dir>/merged/b7f2a1c3-…/`); the short prefix is only used in PK strings to keep them compact. Foreign keys (`media.deploymentID`, `observations.mediaID`, `observations.deploymentID`, `modelOutputs.mediaID`) are rewritten consistently. UUID-based PKs in `modelRuns` and `modelOutputs` don't need rewriting; only their FKs to renamed media. The prefix is purely local to A's DB — it's not part of any export.

**Flattening of nested provenance.** If B itself contains previously-merged sources (B was once a target of a merge), those inner `importFolder` values are **overwritten** to `<A-dir>/merged/<B-uuid>` during step 4 below. B's nested source structure collapses into a single source row in A. This is a deliberate v1 simplification — a merged study reads as one source from A's perspective. B's own Sources tab is unaffected because B is untouched.

## Data flow

`mergeStudy(targetStudyId, sourceStudyId, reviewed)` runs the following. A separate pre-flight IPC, `mergePreflight(targetStudyId, sourceStudyId)`, runs during the wizard's Step 2 → Step 3 transition and returns `{ totalBytes, freeBytes, missingFileCount, renameCount }` for the review screen — it does not mutate anything. The Merge button is disabled if `totalBytes * 1.05 > freeBytes`.

1. **Resolve & validate.** Both studies exist locally. Refuse self-merge. Detect prior merge by `SELECT 1 FROM media WHERE importFolder LIKE '<A-dir>/merged/<B-uuid>/%' LIMIT 1` — if found, return `{ alreadyMerged: true }` (UI shows toast, modal closes, no-op). Re-check free disk space (pre-flight value may be stale); abort with a clear error if insufficient.

2. **Copy files.** Open B's DB read-only. Gather distinct directories from `media.filePath` values. For each file: if the source file does not exist on disk, record it in a `missingMediaIDs` set (its media + observation rows will be skipped in step 4) and continue. Otherwise copy to `<A-dir>/merged/<B-uuid>/<basename-of-source-dir>/<filename>`, preserving subfolder structure (the EXIF/parentFolder deployment heuristic in `prediction.js:600` needs subfolder layout intact). Concurrency cap ~8 in-flight copies. Skip-if-destination-exists for idempotency on retry. Track bytes for the progress event.

3. **Build a path map.** For each B media row, compute `newFilePath`. Build the single prefix `PREFIX = "study:<B-uuid-short>:"`.

4. **Read B, write to A — one SQLite transaction on A's DB.** Rows whose `mediaID` is in `missingMediaIDs` (from step 2) are skipped, along with any `modelOutputs` and `observations` that reference them. Order matters for FK constraints:
   - INSERT deployments with prefixed `deploymentID` (other fields copied as-is, including `locationID`).
   - INSERT media with prefixed `mediaID`, prefixed `deploymentID`, `filePath` from path map, `importFolder = <A-dir>/merged/<B-uuid>`. Skip media in `missingMediaIDs`.
   - INSERT modelRuns as-is. Rewrite `modelRuns.importPath = <A-dir>/merged/<B-uuid>` so the multi-source spec's in-flight-run join still works (per `docs/specs/2026-04-29-sources-tab-multi-source-design.md:76`).
   - INSERT modelOutputs as-is, rewriting `mediaID` FK. Skip rows referencing missing media.
   - INSERT observations with prefixed `observationID`, `mediaID`, `deploymentID` (modelOutputID is a UUID, unchanged). Skip rows referencing missing media.
   - UPDATE `metadata` with reviewed values: `description` from textarea, `contributors` from checklist, `startDate = min(A,B)`, `endDate = max(A,B)`, `updatedAt = now`. `title` and `importerName` unchanged.
   - The `jobs` table is **not** copied — B's queue is transient processing state.

5. **Write `_merge-info.json`** inside `<A-dir>/merged/<B-uuid>/`.

6. **Emit `merge:complete`** so the Sources tab re-queries; resolve with the new `importFolder` value.

If step 4 fails, SQLite rolls back. Files already copied in step 2 remain on disk; the skip-if-exists rule makes retry idempotent.

### Idempotency & repeat behavior

Merging the same B into A a second time is a **safe no-op**, not an update.

- **UI path.** Step 2's study picker disables B's row with the "Already merged" badge; the user can't select it.
- **Backend path.** Step 1's prior-merge check returns `{ alreadyMerged: true }` immediately — no file copy, no DB writes.
- **Recovery after crash.**
  - If the previous attempt crashed *before* step 4 committed, no media rows from B exist yet; the next attempt proceeds normally and reuses already-copied files (skip-if-exists).
  - If step 4 committed but step 5 (manifest write) failed, media rows exist and the merge is correctly detected as complete. The Sources-tab label falls back to live-lookup of B until the manifest is recreated. Manifest is a UX hint, not a correctness requirement.

**Re-merge does not pick up B's changes** (newly added images, corrected classifications, etc.). Merge is a one-time snapshot in v1. The upcoming **resync** feature is the right vehicle for "B has changed; update A". For now the workaround would be to remove and re-merge — but "Remove source" is itself a deferred follow-up (see *Known limitations*).

## Sources tab rendering changes

The current `SourceIcon` in `sources.jsx:9-13` takes `importerName` as a study-level prop. After this change, it takes a per-row `importerName` resolved as follows in `getSourcesData`:

```
if importFolder starts with "http://" or "https://" → "lila/coco"
else if importFolder matches "<A-dir>/merged/<B-uuid>/":
    read _merge-info.json once (cached); use sourceImporterName
    if file missing, look up B via getStudies(); use B's importerName
    if both missing, fall back to study A's importerName
else → study A's importerName
```

The row label for merged sources comes from the same lookup (`sourceStudyTitle` from the manifest, or B's current title, or "Merged source" as final fallback). Label fallback is independent from icon fallback.

This also resolves a pre-existing quirk: today's tab shows the study-wide icon on every row, so adding a local folder to a CamtrapDP-imported study shows the Package icon. Per-row resolution fixes that case too.

## IPC contract

**New handlers.**

```js
// preload
window.api.mergePreflight(targetStudyId, sourceStudyId)
// → {
//     totalBytes: number,        // sum of file sizes for B's media
//     freeBytes: number,         // available bytes on A's volume
//     missingFileCount: number,  // B media whose file is missing on disk
//     renameCount: number,       // deployment IDs that will be prefixed
//     alreadyMerged: boolean
//   }
// Pure check; no mutations.

window.api.mergeStudy(targetStudyId, sourceStudyId, reviewed)
// reviewed: {
//   description: string,
//   contributorEmails: string[]  // emails surviving the checklist
// }
// →
//   { success: true, mergedImportFolder: string, missingFileCount: number }
//   | { success: true, alreadyMerged: true }
//   | { success: false, error: string }
```

**Updated handlers.**

- `getSourcesData(studyId)` — augment each returned row with a per-row `importerName` (per the resolution above) and a per-row `displayLabel` for merged rows.

**New event.**

- `merge:progress` `{ phase: 'copying-files'|'writing-rows', done: number, total: number }` — the modal subscribes during the merge.
- `merge:complete` `{ studyId }` — already-existing convention (mirrors the `import:complete` pattern); Sources tab re-queries on receipt.

## Error handling & edge cases

| Case | Behavior |
|---|---|
| B's DB unreadable / corrupt | Abort before file copy. Toast: error details. |
| Insufficient disk space at pre-flight | Merge button disabled with inline error "Adding ~3.2 GB needs ~3.4 GB free; only 1.4 GB available." User frees space or cancels. |
| Some of B's media files missing on disk | Counted at pre-flight (`missingFileCount` shown on review screen). At copy time, those files are skipped and their media/observation rows are not written. Completion toast: "N files were missing and skipped." |
| Disk full during copy (race with other writers) | Failsafe path — pre-flight should have caught it, but if it didn't: stop copies; transaction never begins, A's DB unchanged. Partial copies remain (idempotent retry). Toast with current free bytes. |
| Transaction failure | SQLite rolls back. Copied files remain on disk; retry is safe. Toast with failure reason. |
| App closed mid-merge | Files copied so far remain; DB unchanged (transaction not yet committed). User retries on next launch. |
| Double-submit | Modal `submitting` state disables the button — same pattern as today's `AddSourceModal`. |
| B deleted after merge | A self-contained; manifest covers label/icon. Sources tab keeps working. |
| A deleted after merge | `rmSync(studyPath, { recursive: true, force: true })` in `src/main/ipc/study.js:38` wipes A's whole dir, including auto-copied B files. B untouched. |

## Testing strategy

**Unit:**
- `transformFilePath(oldPath, sourceDirs, destRoot)` — path-mapping helper. Table tests for typical EXIF folder layouts and CamtrapDP package layouts.
- `prefixRow(row, prefix, fkFields)` — PK + FK rewrite helper.
- `getSourcesData` row-augmentation: pattern recognition for `merged/<uuid>/`, manifest read, manifest-missing fallback, no-merge passthrough.
- `mergePreflight` correctness: totalBytes sums match the test-fixture sizes; missingFileCount counts dangling rows; `alreadyMerged` flips after a successful merge.

**Integration (existing biowatch test setup, isolated SQLite DB per test):**
- Folder→folder merge: counts add up; UUIDs don't trigger visible renames; PK prefix still applied uniformly.
- CamtrapDP→folder merge: PKs prefixed; FKs consistent; A's pre-existing data untouched.
- Already-merged detection: second merge of same B is a no-op (`alreadyMerged: true`).
- Metadata merge: description concatenation, contributor union by email (case-insensitive), date-range extension.
- File-copy idempotency: pre-existing copied files are skipped without error; retry-after-crash equivalent.
- Forced transaction failure: A's DB unchanged.

**Manual / E2E:**
- Full wizard flow for both paths.
- Sources tab shows merged source with correct icon, label, and counts.
- Delete A after merge → filesystem cleaned, B untouched.
- Delete B after merge → A still functional; label falls back to manifest.

## Known limitations (deferred follow-ups)

**Source-scoped deployment matching.** Today's `getDeployment(db, locationID)` in `src/main/services/prediction.js:542` is study-scoped, not source-scoped. After a merge, A's original deployment and B's merged deployment may share a `locationID` (e.g., `"CAM_01"`), and a subsequent "Add images directory" with a colliding subfolder name would misattribute new media to one of them at random. This is a **pre-existing fragility** — it can also be triggered today by adding two folders with identically-named subfolders to a single study — that merge makes more visible.

Workaround for v1: when adding a new local directory to a merged study, pick non-colliding subfolder names until the fix lands.

The follow-up adds `deployments.importFolder` (column + index + migration with backfill from `media`), changes `getDeployment`'s signature to `(db, importFolder, locationID)`, and updates `prediction.js`'s deployment-creation path. It benefits non-merge users too.

**No un-merge.** Removing a previously-merged source from A is not supported in v1. The user can delete A and recreate it. Adding "Remove source" later is straightforward: delete rows where `media.importFolder = <A-dir>/merged/<B-uuid>` (cascade through observations and modelOutputs) and `rm -r` the directory.

**Heterogeneous model runs.** A and B may have been scanned with different ML models. Both `modelRuns` are preserved in A's DB; observations keep their original linkage. The user can manually re-run a homogenizing model later; we don't offer that flow.

**Multi-merge.** One study at a time only. Repeat the wizard to merge more.

## Files touched (estimate)

- `src/renderer/src/sources.jsx` — button label; `SourceIcon` takes per-row `importerName`.
- `src/renderer/src/AddSourceModal.jsx` — restructured as wizard; new step components.
- New: `src/renderer/src/MergeStudyWizard/StudyPicker.jsx`, `ReviewStep.jsx`.
- `src/main/services/merge.js` — new module owning the merge orchestration.
- `src/main/ipc/study.js` — `study:merge` and `study:merge-preflight` handlers, `merge:progress` / `merge:complete` events.
- `src/preload/index.js` — expose `window.api.mergeStudy` and `window.api.mergePreflight`.
- `src/main/ipc/files.js` (`getSourcesData`) — per-row `importerName` and `displayLabel` augmentation; manifest read.
- Tests: matching layout under `src/main/services/merge.test.js` + integration suite.
- Docs: update `architecture.md`, `data-formats.md`, `database-schema.md` (note on merged-source convention), `import-export.md`, `ipc-api.md`.
