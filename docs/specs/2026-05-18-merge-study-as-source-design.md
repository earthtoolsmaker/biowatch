# Merge another local study as a new source — design

**Status:** Draft
**Date:** 2026-05-18
**Author:** Arthur

## Summary

Today the Sources tab of a study has one action: **"+ Add images directory"**, which scans a local folder. This spec generalizes that action to **"+ Add source"**, which opens a wizard letting the user pick between two source types:

1. **Images directory** — unchanged from today's flow.
2. **Another study** — pick a study from the local list and merge its data (deployments, media, observations, model runs) into the current study, with metadata (description, contributors, date range) merged on a single review screen.

Merge is **in-place** (target study A absorbs source study B's rows; B stays untouched), **forward-only** in v1 (no un-merge), and **one study at a time**. **No files are copied** — A's media rows reference B's original `filePath` values exactly as they were. The trade-off: deleting B after merging will make any of B's biowatch-owned files unavailable in A. A delete-time warning surfaces this when relevant.

## Goals & non-goals

**Goals**
- Surface a new "Merge another study" path as a peer of "Add images directory".
- Make merging safe by default: no PK collisions, no surprise metadata changes.
- Preserve provenance so the merged data is visible as its own source row in the Sources tab.
- Keep the implementation contained: no schema changes, no new DB tables, no new filesystem artifacts.

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

**Step 3 — Review.** A brief spinner runs while pre-flight checks complete (count of B's media files, count of B-owned files that would break on B-delete). Then the pre-filled defaults render:
- Summary card: from / into / counts being added (deployments, media, observations).
- Description (textarea, editable). Default = A's description + `"\n\n---\n\n## Merged from <B-title>\n\n"` + B's description.
- Contributors checklist. Default = union of A's and B's contributors deduped by email, all checked. Each row shows the contributor's name, role, and a small badge: "A + B", "A only", "B only". Unchecking removes from the resulting list.
- Date range preview: `min(A.startDate, B.startDate) → max(A.endDate, B.endDate)`, with a note showing the previous range.
- A heads-up note when B owns its media files: *"N files in this study live inside biowatch's own storage. They will remain available in A after this merge, but deleting B later will make them unavailable in A. You'll be warned at delete time."* Suppressed when the count is zero (folder imports, external CamTrap DP, LILA).
- A heads-up note if any IDs were renamed (e.g., "3 deployment IDs from B will be renamed to avoid collision"). Informational only — IDs are internal.

Confirming triggers the merge IPC. The merge is fast — DB-only — so the modal goes through a brief "writing rows" indicator and auto-closes.

### Sources tab after merge

A new source row appears, grouped by `media.importFolder = "merge:<B-uuid>"`. Its title is **B's current title** looked up from `getStudies()` at render time (e.g., "Yosemite 2023"), with a small "merged" indicator. The icon is **B's `importerName`** (so a merged CamtrapDP shows the Package icon, a merged folder shows the Folder icon), not A's. If B was deleted, both fall back to a generic "Merged source" label and Folder icon — see *Known limitations*.

## Data model

**No new tables. No new columns. No filesystem artifacts.** All required provenance is encoded in one place:

- `media.importFolder = "merge:<B-uuid>"` for every merged media row — a synthetic value, not a path. The Sources tab already groups by `importFolder` so no grouping change is needed; only the rendering layer learns about the `merge:` prefix.

PK collision safety: every `deploymentID`, `mediaID`, and `observationID` from B is prefixed with `"study:<B-uuid-short>:"` (e.g., `"study:b7f2a1c3:CAM_01"`), where `<B-uuid-short>` is the **first 8 characters** of B's UUID. Foreign keys (`media.deploymentID`, `observations.mediaID`, `observations.deploymentID`, `modelOutputs.mediaID`) are rewritten consistently. UUID-based PKs in `modelRuns` and `modelOutputs` don't need rewriting; only their FKs to renamed media. The prefix is purely local to A's DB — it's not part of any export.

**Flattening of nested provenance.** If B itself contains previously-merged sources (B was once a target of a merge), those inner `importFolder` values are **overwritten** to `"merge:<B-uuid>"` during step 3 below. B's nested source structure collapses into a single source row in A. This is a deliberate v1 simplification — a merged study reads as one source from A's perspective. B's own Sources tab is unaffected because B is untouched.

## Data flow

`mergeStudy(targetStudyId, sourceStudyId, reviewed)` runs the following. A separate pre-flight IPC, `mergePreflight(targetStudyId, sourceStudyId)`, runs during the wizard's Step 2 → Step 3 transition and returns `{ deploymentCount, mediaCount, observationCount, ownedByBiowatchCount, missingFileCount, renameCount, alreadyMerged }` for the review screen — it does not mutate anything.

The merge is **rows only — no files are touched, copied, or moved.** All operations happen inside a single SQLite transaction on A's DB.

### Steps

1. **Resolve & validate.** Both studies exist locally. Refuse self-merge. Detect prior merge by `SELECT 1 FROM media WHERE importFolder = 'merge:<B-uuid>' LIMIT 1` — if found, return `{ alreadyMerged: true }` (UI shows toast, modal closes, no-op).

2. **Build the prefix and the missing-file set.** `PREFIX = "study:<B-uuid-short>:"`. Open B's DB read-only. For each B media row whose `filePath` is a local path (not a URL), `fs.access` it; missing ones go into `missingMediaIDs` and their dependent rows are dropped in step 3.

3. **Read B, write to A — one SQLite transaction on A's DB.** Rows whose `mediaID` is in `missingMediaIDs` are skipped along with their dependent `modelOutputs` and `observations`. Order matters for FK constraints:
   - INSERT deployments with prefixed `deploymentID` (other fields copied as-is, including `locationID`).
   - INSERT media with prefixed `mediaID`, prefixed `deploymentID`, **`filePath` unchanged** from B, `importFolder = "merge:<B-uuid>"`. Skip media in `missingMediaIDs`.
   - INSERT modelRuns as-is. Rewrite `modelRuns.importPath = "merge:<B-uuid>"` so the multi-source spec's in-flight-run join continues to work (per `docs/specs/2026-04-29-sources-tab-multi-source-design.md:76`).
   - INSERT modelOutputs as-is, rewriting `mediaID` FK. Skip rows referencing missing media.
   - INSERT observations with prefixed `observationID`, `mediaID`, `deploymentID` (modelOutputID is a UUID, unchanged). Skip rows referencing missing media.
   - UPDATE `metadata` with reviewed values: `description` from textarea, `contributors` from checklist, `startDate = min(A,B)`, `endDate = max(A,B)`, `updatedAt = now`. `title` and `importerName` unchanged.
   - The `jobs` table is **not** copied — B's queue is transient processing state.

4. **Emit `merge:complete`** so the Sources tab re-queries; resolve.

If step 3 fails, SQLite rolls back. Nothing was written to disk in any previous step (no file copies), so there's no filesystem cleanup to consider.

### Idempotency & repeat behavior

Merging the same B into A a second time is a **safe no-op**, not an update.

- **UI path.** Step 2's study picker disables B's row with the "Already merged" badge; the user can't select it.
- **Backend path.** Step 1's prior-merge check returns `{ alreadyMerged: true }` immediately — no DB writes.
- **Recovery after crash.** SQLite transactions are atomic: either everything in step 3 committed or nothing did. If a previous attempt crashed mid-transaction, no rows from B exist yet, and the next attempt proceeds normally.

**Re-merge does not pick up B's changes** (newly added images, corrected classifications, etc.). Merge is a one-time snapshot in v1. The upcoming **resync** feature is the right vehicle for "B has changed; update A". For now the workaround would be to remove and re-merge — but "Remove source" is itself a deferred follow-up (see *Known limitations*).

### B-deletion warning

The warning fires only when deleting B would **actually break files** in another study — not just when B has been merged somewhere. The two conditions:

1. Some local study has `media WHERE importFolder = 'merge:<B-uuid>'` (B has been merged into it).
2. **Some of those media rows have `filePath LIKE '<biowatch-data>/studies/<B-uuid>/%'`** — i.e., they point at files inside B's own directory that `rmSync` would delete.

Concretely, this means **B is a CamtrapDP package downloaded into biowatch's own storage** (the only origin that places files inside `<biowatch-data>/studies/<B-uuid>/`). Local folder imports, external CamtrapDP packages, and LILA datasets do not trigger the warning because deleting B doesn't touch their files.

When both conditions hold, the delete-study handler returns a confirmation payload instead of deleting:

```
{
  needsConfirm: true,
  dependentBreaks: [
    { studyId: "aaa-…", title: "Site A 2023", brokenMediaCount: 12481 },
    { studyId: "ccc-…", title: "Sierra Pilot",  brokenMediaCount: 850 }
  ]
}
```

The renderer surfaces a confirmation modal. A subsequent call with `{ force: true }` proceeds with the original `rmSync`. After deletion the merged source rows in A and Sierra Pilot keep their DB rows but their `filePath` values now point at deleted files — same UX as a "file unavailable" state today.

**Secondary effect (no warning needed).** Even when files survive (the three non-warning cases), A's merged-source row loses live-lookup of B's title and falls back to "Merged source" + Folder icon. This is label degradation only, not a data issue — not worth a dialog. The user can deduce what happened.

## Sources tab rendering changes

The current `SourceIcon` in `sources.jsx:9-13` takes `importerName` as a study-level prop. After this change, it takes a per-row `importerName` resolved as follows in `getSourcesData`:

```
if importFolder starts with "merge:":
    extract B's UUID; look up B via getStudies()
    use B's importerName and title
    if B not found, fall back to "lila/coco" if media filePaths are URLs,
      else Folder icon + "Merged source" label
else if media filePaths in this source start with "http://" or "https://" → "lila/coco"
else → study A's importerName
```

This also resolves a pre-existing quirk: today's tab shows the study-wide icon on every row, so adding a local folder to a CamtrapDP-imported study shows the Package icon. Per-row resolution fixes that case too.

`sources.jsx`'s existing path-detection check at line 147 (`startsWith('/')`) handles real paths; the renderer learns to also recognize `startsWith('merge:')` and renders such rows with the resolved label rather than treating the literal string as a path.

## IPC contract

**New handlers.**

```js
// preload
window.api.mergePreflight(targetStudyId, sourceStudyId)
// → {
//     deploymentCount: number,
//     mediaCount: number,
//     observationCount: number,
//     ownedByBiowatchCount: number, // B media whose filePath is inside <biowatch-data>/studies/<B-uuid>/
//                                   // — these become unavailable if B is later deleted
//     missingFileCount: number,     // B media whose local file is missing on disk (URLs not checked)
//     renameCount: number,          // deployment IDs that will be prefixed
//     alreadyMerged: boolean
//   }
// Pure check; no mutations.

window.api.mergeStudy(targetStudyId, sourceStudyId, reviewed)
// reviewed: {
//   description: string,
//   contributorEmails: string[]  // emails surviving the checklist
// }
// →
//   { success: true, missingFileCount: number }
//   | { success: true, alreadyMerged: true }
//   | { success: false, error: string }
```

**Updated handlers.**

- `getSourcesData(studyId)` — augment each returned row with a per-row `importerName` (per the resolution above) and a per-row `displayLabel` for merged rows.
- `study:delete-database` (`src/main/ipc/study.js:31`) — before deletion, scan local studies for `media WHERE importFolder = 'merge:<B-uuid>' AND filePath LIKE '<biowatch-data>/studies/<B-uuid>/%'`. If any hits, return `{ needsConfirm: true, dependentBreaks: [...] }` instead of deleting. The renderer surfaces a confirmation modal; a confirmed second call with `{ force: true }` proceeds with the original deletion. Note the dual predicate: existence of merge-dependents alone is **not** enough to warn — files must actually be at risk.

**New event.**

- `merge:complete` `{ studyId }` — Sources tab re-queries on receipt. (No `merge:progress` — the merge is fast since no files are copied.)

## Error handling & edge cases

| Case | Behavior |
|---|---|
| B's DB unreadable / corrupt | Abort before any writes. Toast with error details. |
| Some of B's media files missing on disk | Counted at pre-flight (`missingFileCount` on review screen). Those rows (and their dependent observations) are skipped during the transaction. Completion toast: "N files were missing and skipped." URLs aren't disk-checked at pre-flight; broken URLs surface as render failures, not merge errors. |
| External drive unmounted / user moved referenced files | Same fragility as today's folder imports — biowatch only stores the path. The merged source row still renders; individual media that can't be opened fail at view time. Not a merge failure. |
| Transaction failure | SQLite rolls back. Nothing written to disk, no cleanup needed. Toast with failure reason. |
| App closed mid-merge | Transaction not yet committed → nothing persisted. User retries on next launch. |
| Double-submit | Modal `submitting` state disables the button — same pattern as today's `AddSourceModal`. |
| B deleted after merge — files survive (folder import, external CamtrapDP, LILA) | Silent delete; no warning. A's merged source row's label falls back to "Merged source" + Folder icon. Data intact. |
| B deleted after merge — B owns files (CamtrapDP downloaded into biowatch) | Delete-time warning fires (see *B-deletion warning*) listing affected studies and counts. If user confirms with `force: true`, B's files are gone; A's affected merged media rows have broken `filePath` values and show as "unavailable" in views. |
| A deleted after merge | `rmSync(studyPath, { recursive: true, force: true })` in `src/main/ipc/study.js:38` wipes A's whole dir. B untouched. |

## Testing strategy

**Unit:**
- `prefixRow(row, prefix, fkFields)` — PK + FK rewrite helper.
- `getSourcesData` row-augmentation: `merge:` prefix detection, B live-lookup, B-missing fallback, no-merge passthrough.
- `mergePreflight` correctness: counts match fixture sizes; `ownedByBiowatchCount` counts only B media with `filePath` inside `<biowatch-data>/studies/<B-uuid>/`; `missingFileCount` counts dangling local files (not URLs); `alreadyMerged` flips after a successful merge.
- B-deletion at-risk-file scan: returns dependents only when `filePath LIKE '<biowatch-data>/studies/<B-uuid>/%'` matches at least one row. Pure label-degradation cases (dependents exist but no owned files) yield an empty list.

**Integration (existing biowatch test setup, isolated SQLite DB per test):**
- Folder→folder merge: counts add up; PK prefix applied uniformly; B media filePaths unchanged in A; `ownedByBiowatchCount` is 0.
- CamtrapDP-on-external-drive → folder merge: PKs prefixed; FKs consistent; A's pre-existing data untouched; `ownedByBiowatchCount` is 0.
- CamtrapDP-downloaded-into-biowatch → folder merge: `ownedByBiowatchCount` matches B's media count; filePaths in A still point into B's directory.
- LILA→folder merge: B's URL filePaths copied verbatim; merged source row reports as Remote in Sources tab tests.
- Already-merged detection: second merge of same B is a no-op (`alreadyMerged: true`).
- Metadata merge: description concatenation, contributor union by email (case-insensitive), date-range extension.
- Forced transaction failure: A's DB unchanged.
- B-deletion with at-risk files (B is CamtrapDP-downloaded-into-biowatch and has been merged into A): delete handler returns `needsConfirm: true` with the `dependentBreaks` array populated; deletion succeeds on `force: true` retry.
- B-deletion with dependents but no at-risk files (B is folder import / external CamtrapDP / LILA and has been merged into A): delete handler proceeds silently — no confirmation prompt.

**Manual / E2E:**
- Full wizard flow for both paths.
- Sources tab shows merged source with correct icon, label, and counts.
- Delete A after merge → filesystem cleaned, B untouched.
- Delete B after merge — non-owned case → A's merged source label falls back to "Merged source".
- Delete B after merge — owned case → warning dialog appears; if confirmed, A's affected media show "unavailable".

## Known limitations (deferred follow-ups)

**Source-scoped deployment matching.** Today's `getDeployment(db, locationID)` in `src/main/services/prediction.js:542` is study-scoped, not source-scoped. After a merge, A's original deployment and B's merged deployment may share a `locationID` (e.g., `"CAM_01"`), and a subsequent "Add images directory" with a colliding subfolder name would misattribute new media to one of them at random. This is a **pre-existing fragility** — it can also be triggered today by adding two folders with identically-named subfolders to a single study — that merge makes more visible.

Workaround for v1: when adding a new local directory to a merged study, pick non-colliding subfolder names until the fix lands.

The follow-up adds `deployments.importFolder` (column + index + migration with backfill from `media`), changes `getDeployment`'s signature to `(db, importFolder, locationID)`, and updates `prediction.js`'s deployment-creation path. It benefits non-merge users too.

**No un-merge.** Removing a previously-merged source from A is not supported in v1. The user can delete A and recreate it. Adding "Remove source" later is trivial because the merge has no filesystem footprint: just `DELETE FROM media WHERE importFolder = 'merge:<B-uuid>'` (cascade through observations and modelOutputs).

**Deleting B can break A's merged source files.** When B owned its media files (CamtrapDP-downloaded-into-biowatch), deleting B removes those files from disk. A's merged media rows survive but their `filePath` values now point to deleted files. We mitigate with the *B-deletion warning* described in the Data flow section. For folder imports, external CamtrapDP, and LILA, this risk doesn't apply.

**Heterogeneous model runs.** A and B may have been scanned with different ML models. Both `modelRuns` are preserved in A's DB; observations keep their original linkage. The user can manually re-run a homogenizing model later; we don't offer that flow.

**Multi-merge.** One study at a time only. Repeat the wizard to merge more.

## Files touched (estimate)

- `src/renderer/src/sources.jsx` — button label; `SourceIcon` takes per-row `importerName`; renderer recognizes the `merge:` prefix.
- `src/renderer/src/AddSourceModal.jsx` — restructured as wizard; new step components.
- New: `src/renderer/src/MergeStudyWizard/StudyPicker.jsx`, `ReviewStep.jsx`.
- `src/main/services/merge.js` — new module owning the merge orchestration (DB-only; no file logic).
- `src/main/ipc/study.js` — `study:merge` and `study:merge-preflight` handlers, `merge:complete` event; `study:delete-database` updated to check for dependents and surface a confirmation.
- `src/preload/index.js` — expose `window.api.mergeStudy` and `window.api.mergePreflight`.
- `src/main/ipc/files.js` (`getSourcesData`) — per-row `importerName` and `displayLabel` augmentation via live B lookup.
- Tests: matching layout under `src/main/services/merge.test.js` + integration suite.
- Docs: update `architecture.md`, `data-formats.md`, `database-schema.md` (note on merged-source convention: `importFolder = 'merge:<uuid>'`), `import-export.md`, `ipc-api.md`.
