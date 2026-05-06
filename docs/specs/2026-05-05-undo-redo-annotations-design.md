# Undo/Redo for Annotation Edits — Design

**Date:** 2026-05-05
**Status:** Approved
**Branch:** `arthur/feat-undo-stack-editing`

## Problem

Users editing annotations in the `ImageModal` (bbox draws/moves/resizes, species/sex/life-stage/behavior changes, deletions) have no way to revert. This causes pain in three scenarios:

1. **Accidental destructive edits** — wrong observation deleted, bbox dragged by mistake.
2. **Exploratory editing** — wanting to try a species classification, see how it looks, back out.
3. **Muscle memory** — `Cmd+Z` is universal in editing apps; its absence feels broken.

Goal: a session-wide undo/redo stack covering the four observation-mutation IPCs, with redo, keyboard shortcuts, auto-navigation to the affected image, and bounded memory.

## Decisions (locked)

| Topic                | Decision                                                                      |
| -------------------- | ----------------------------------------------------------------------------- |
| Stack scope          | Study-session-wide; survives modal close; cleared on study switch / app quit  |
| Trigger context      | Keyboard shortcut active only while an `ImageModal` is mounted                |
| Cross-image behavior | Undo auto-navigates the modal to the affected image, then applies the inverse |
| Granularity          | One stack entry per IPC call; no coalescing in v1                             |
| Operations tracked   | Create / Delete / Update-bbox / Update-classification observation only        |
| Operations excluded  | ML inference, imports, view state (zoom/pan/visibility/navigation)            |
| Redo                 | `Cmd+Shift+Z` / `Ctrl+Y`; any new edit clears the redo stack                  |
| Visual feedback      | Subtle pulse on affected bbox; no toast on success                            |
| Failure handling     | Error toast + drop the entry from the stack                                   |
| Stack size           | 100 entries; oldest dropped on overflow                                       |
| In-flight races      | Don't bother; IPC is fast (revisit if observed)                               |

## Architecture

A single new module owns the stacks and command logic. A study-scoped singleton is exposed via React Context and torn down when the study unloads.

```
src/renderer/src/undo/
  UndoManager.js   // class: undo/redo stacks, exec/undo/redo, pulse events
  useUndo.js       // hook: subscribe, expose canUndo/canRedo + methods
  commands.js      // pure builders that produce stack entries with forward/inverse handlers
  context.jsx      // UndoProvider + context wiring
```

Mutation call sites in `Gallery.jsx` (the `ImageModal`) and `ObservationRow.jsx` route their writes through `undoManager.exec(command)` instead of calling the IPC directly.

```
              ┌──────────────────────┐
   user edit  │  Gallery.jsx (modal) │
  ──────────► │  + ObservationRail   │
              └─────────┬────────────┘
                        │ exec(command)
                        ▼
              ┌──────────────────────┐         ┌──────────────────┐
              │   UndoManager        │ ◄────── │  keyboard:       │
              │   undoStack: []      │         │  Cmd+Z / Cmd+⇧Z  │
              │   redoStack: []      │         └──────────────────┘
              └─────────┬────────────┘
                        │ IPC + cache invalidations
                        ▼
              ┌──────────────────────┐
              │  existing IPC + DB   │
              └──────────────────────┘
```

The manager is responsible for:

- Maintaining `undoStack` and `redoStack` (each capped at 100 entries; FIFO drop on overflow).
- Dispatching forward / inverse / redo IPC calls.
- Triggering modal navigation when the affected `mediaId` differs from the current view.
- Emitting a `pulse(observationId)` event for the visual feedback layer.
- Clearing the redo stack whenever a fresh `exec(...)` runs.
- Tearing down on study unload.

## Data model

Stack entry shape:

```js
{
  type: 'create' | 'delete' | 'update-bbox' | 'update-classification',
  mediaId,            // for auto-navigation
  observationId,
  before,             // null for 'create'; full row for 'delete'; field subset for updates
  after,              // null for 'delete'; full row for 'create'; field subset for updates
}
```

`before` / `after` contents per type:

| Op                      | `before`                                                                                                                                                                                                                 | `after`                                         | Undo dispatches                                 | Redo dispatches                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| `create`                | `null`                                                                                                                                                                                                                   | full obs row (incl. `observationID`, `eventID`) | `deleteObservation(id)`                         | `createObservation(after)` (with explicit IDs) |
| `delete`                | full obs row                                                                                                                                                                                                             | `null`                                          | `createObservation(before)` (with explicit IDs) | `deleteObservation(id)`                        |
| `update-bbox`           | `{ bboxX, bboxY, bboxWidth, bboxHeight, classificationMethod, classifiedBy, classificationTimestamp, classificationProbability }`                                                                                        | same shape                                      | `restoreObservation(before)`                    | `restoreObservation(after)`                    |
| `update-classification` | classification fields (`scientificName`, `commonName`, `observationType`, `sex`, `lifeStage`, `behavior`) plus metadata (`classificationMethod`, `classifiedBy`, `classificationTimestamp`, `classificationProbability`) | same                                            | `restoreObservation(before)`                    | `restoreObservation(after)`                    |

The `before` snapshot is sourced from the React Query cache (`['mediaBboxes', studyId, mediaId]`) immediately before the mutation runs.

## IPC changes

| Handler                                                                         | Change                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createObservation` (`src/main/database/queries/observations.js`)               | Accept optional `observationID` and `eventID` in `observationData`. If provided, use them instead of generating new UUIDs. Default behavior unchanged.                                                                                                                                                                         |
| `restoreObservation`                                                            | **New.** Plain `UPDATE` of the supplied fields on a given `observationID`. **No auto-stamping** of `classificationMethod`, `classifiedBy`, `classificationTimestamp`. Throws if 0 rows are affected (so an externally-deleted target triggers the failure path instead of silently doing nothing). Used only by the undo path. |
| `deleteObservation`, `updateObservationBbox`, `updateObservationClassification` | Unchanged.                                                                                                                                                                                                                                                                                                                     |

Why a separate `restoreObservation`: the existing update IPCs encode "user just made a manual edit" by stamping `classificationMethod='human'`, `classifiedBy='User'`, `classificationTimestamp=now()`. That semantic is wrong for undo — undoing a manual change to a value that was originally machine-classified should restore `classificationMethod='machine'`. Undo is "revert state", not "another user edit", so it gets its own stamp-free path.

The `createObservation` extension was validated on a real biowatch study DB: deleting an observation and re-inserting with the same `observationID` and `eventID` round-trips cleanly; SQLite's `UNIQUE` PK constraint still rejects a second insert with the same id.

The new `restoreObservation` handler must also be exposed via:

- `src/main/ipc/observations.js` — IPC channel registration
- `src/preload/index.js` — bridge function
- A React Query mutation hook (or direct caller) in the renderer

## Recording flow

Mutation sites call:

```js
const undo = useUndo()

undo.exec(
  commands.updateBbox({
    mediaId,
    observationId,
    before: snapshotFromCache(observationId),
    after: { bboxX, bboxY, bboxWidth, bboxHeight }
  })
)
```

`commands.updateBbox(...)` (and siblings) return:

```js
{
  entry: { type, mediaId, observationId, before, after },
  forward: () => ipc call (existing),
  inverse: () => ipc call (using `before`),
  redo:    () => ipc call (using `after`)
}
```

`UndoManager.exec(command)`:

1. Run `command.forward()` (existing optimistic update + IPC + React Query invalidation flow stays as-is).
2. On success: push `command` onto `undoStack`, clear `redoStack`, drop bottom if `undoStack.length > 100`.
3. On failure: do not push (existing rollback handles cache).

The four call sites:

- **Create** observation (drag-draw in `DrawingOverlay`, `Gallery.jsx`)
- **Delete** observation (Del/Backspace, delete button in `ObservationRail`)
- **Update bbox** (mouseup in `EditableBbox`, arrow-key nudge in `EditableBbox`)
- **Update classification** (species picker, sex/life-stage/behavior dropdowns in `ObservationRow`)

## Undo / redo execution

```
undo():
  if undoStack empty: return
  entry = undoStack.pop()
  if entry.mediaId !== currentModalMediaId:
    await navigateModalTo(entry.mediaId)
  await command.inverse()
  invalidate React Query keys for entry.mediaId
  redoStack.push(entry)
  emit pulse(entry.observationId)

redo():
  symmetric, using command.redo() and pushing back to undoStack
```

Auto-navigation reuses the existing `setCurrentMediaId` path in `Gallery.jsx` (the same one Left/Right arrow keys use) — no new navigation primitive is introduced. The `EditableBbox` already mounts on render after navigation, so the pulse can fire as soon as the bbox layer settles for the destination image.

Failure path (per the locked decision):

```
try {
  await command.inverse()
} catch (err) {
  toast.error(`Couldn't undo: ${err.message}`)
  // entry is dropped — not pushed to redo, not re-pushed to undo
  return
}
```

## UI integration

**Keyboard shortcuts** (bound in `Gallery.jsx`'s existing `handleKeyDown`):

- `Cmd+Z` / `Ctrl+Z` → `undo()`
- `Cmd+Shift+Z` / `Ctrl+Y` → `redo()`
- Skipped when the active element is an `<input>` / `<textarea>` / `[contenteditable]` so native text undo in the species-picker text field still works.

**Visual feedback**:

- A CSS class (`bbox--pulse`) added to the affected bbox's SVG element for ~600ms.
- 2-keyframe animation: `outline: 2px solid var(--accent); opacity 1 → 0`.
- Triggered via a manager-level pulse event listened to by `EditableBbox` (or its parent) so the pulse can fire on freshly-recreated bboxes too.
- No success toast.

**No new UI affordance in v1.** A title-bar "next undo" indicator is a possible v2 polish.

## Edge cases

| Case                                                           | Behavior                                                                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Stack empty                                                    | `Cmd+Z` is a silent no-op                                                                                            |
| Modal closed                                                   | No keyboard handler bound; stacks remain in memory                                                                   |
| Study switched                                                 | `UndoManager` torn down; both stacks cleared                                                                         |
| External mutation (ML run, import) invalidates a stacked entry | `inverse()` throws (`UPDATE 0 rows` or PK conflict on recreate) → toast + drop entry                                 |
| Same observation edited multiple times                         | Each edit is its own entry; undo unwinds in reverse order                                                            |
| Stack cap reached (101st edit)                                 | Drop oldest entry from `undoStack`; `redoStack` was already cleared by the new edit                                  |
| Race: second `Cmd+Z` while previous still in-flight            | Not handled in v1; IPC is fast enough that double-fires are rare. Revisit if observed.                               |
| Auto-navigation from undo lands on a now-deleted media         | Modal navigation already handles "no such media" via existing logic; manager treats this as a failure → toast + drop |

## Out of scope (v1)

- Coalescing rapid same-target edits (e.g., arrow-key bbox nudges) into single undo entries.
- Restoring the user's pre-undo image position on redo.
- Persisting the stack across app restarts.
- Tracking ML inference, imports, or other batch operations.
- A title-bar undo/redo button or "next action" indicator.
- Undoing edits made before the current study session began (no DB persistence).

## Testing

- **Unit** — `commands.test.js`: each command builder produces correct `before`/`after`/`forward`/`inverse`/`redo`. Pure functions.
- **Unit** — `undoManager.test.js`: stack push/pop semantics, cap, redo clearing on new exec, failure handling drops entry, pulse event emitted, `mediaId` mismatch triggers navigate hook.
- **Integration** — extend `observations.js` query tests:
  - `createObservation` with explicit `observationID` / `eventID` round-trips.
  - `createObservation` rejects duplicate `observationID`.
  - `restoreObservation` does not modify `classificationMethod` / `classifiedBy` / `classificationTimestamp` unless those fields are explicitly in the update payload.
- **Manual smoke** (per `CLAUDE.md` UI-testing rule):
  - All four ops × undo + redo on a single image.
  - Edit on image A → navigate to image B → `Cmd+Z` auto-navigates to A and reverts.
  - Cap behavior: do >100 edits, confirm oldest drops.
  - Failure: trigger an external delete (e.g., second app instance) then undo → toast + entry dropped.

## Files touched

**New**:

- `src/renderer/src/undo/UndoManager.js`
- `src/renderer/src/undo/useUndo.js`
- `src/renderer/src/undo/commands.js`
- `src/renderer/src/undo/context.jsx`
- `src/renderer/src/undo/UndoManager.test.js`
- `src/renderer/src/undo/commands.test.js`

**Modified**:

- `src/main/database/queries/observations.js` — extend `createObservation`, add `restoreObservation`
- `src/main/ipc/observations.js` — register `observations:restore` channel
- `src/preload/index.js` — expose `restoreObservation` bridge
- `src/renderer/src/media/Gallery.jsx` — wrap mutations in `undo.exec(...)`, bind shortcuts, auto-navigation hook, mount `UndoProvider`
- `src/renderer/src/ui/ObservationRail.jsx` — wrap delete mutation
- `src/renderer/src/ui/ObservationRow.jsx` — wrap classification mutation
- `src/renderer/src/ui/EditableBbox.jsx` — wrap bbox-update mutation; listen for pulse events
- Stylesheet for `.bbox--pulse` animation
- `docs/architecture.md` — note the new `undo/` module

## Documentation updates

Per `CLAUDE.md`, update:

- `docs/architecture.md` — new module + IPC channel.
- `docs/ipc-api.md` — `observations:restore` handler; extended `observations:create` payload.
- `docs/database-schema.md` — no schema change, but document that `observationID` reuse-after-delete is supported and relied on by the undo path.
