# Add-source modal: "Starting import…" transitional state

**Date:** 2026-05-15
**Status:** Design — approved
**Area:** renderer (`src/renderer/src/AddSourceModal.jsx`; reads from `src/renderer/src/hooks/import.js`)

## Summary

After the user clicks **Import** in the Add Source modal, keep the modal
open in a transitional "Starting import…" view instead of closing
immediately. The view shows a spinner, the folder path being processed,
and a short panel explaining where progress and results will appear.
The modal auto-closes when the first job actually completes
(`importStatus.done > 0`), or when the user clicks
**Continue in background**.

## Motivation

A customer reported that the moment after clicking Import is confusing:

> Right after I selected a folder, it was a little unclear what was
> happening, or whether it was stuck, or had properly loaded my images,
> because the "starting" button in the upper-right is subtle. Once I
> saw results pop up it was more obvious that it wasn't stuck. Consider
> a more salient message at this stage.

There are two distinct gaps in the current flow:

1. **No UI feedback for ~1 second** between modal close and the first
   `getImportStatus` poll that returns `total > 0`. The header row only
   renders when `total > 0 && total > done`
   (`src/renderer/src/study.jsx:79-83`), so it is hidden during the
   first poll cycle.
2. **The header "Starting" state is intentionally compact** — a 28×28
   icon button in the page chrome
   (`src/renderer/src/study.jsx:114-138`). Users who are looking at the
   page body don't notice it.

This spec addresses (1) directly and converts (2) from a problem into
non-issue: by the time the modal closes, the user has been told
exactly where to look.

## Design

### Behavior

| Step | Trigger | Modal state |
|------|---------|-------------|
| 1 | User clicks **Import** | `submitting=true` (existing) — Import button text becomes "Starting…" (existing) |
| 2 | `addFolder` resolves successfully | Enter `waitingForFirstBatch`. Body swaps to the transitional view below. Cache update + invalidate run as today. |
| 3 | `addFolder` rejects | Stay on the form, show `error` (existing behaviour, unchanged) |
| 4 | `importStatus.done > 0` (polled via `useImportStatus`) | Call `onClose()` |
| 5 | User clicks **Continue in background** | Call `onClose()` immediately; import keeps running |
| 6 | User clicks `✕` or backdrop | Same as step 5 — dismiss only |
| 7 | 15s have elapsed in `waitingForFirstBatch` | Call `onClose()` (failsafe — backend is slow but the import is genuinely running) |

There is **no in-modal cancel** in the transitional state. To stop a
running import, the user pauses from the header (existing UX). This
keeps the modal scope tight and avoids needing a new backend cancel
hook.

### Transitional view

```
┌──────────────────────────────────────────────────┐
│ Starting import…                              ✕  │
├──────────────────────────────────────────────────┤
│                                                  │
│             ⟳   Queueing images for analysis     │
│                 ./trail-cam-2025-spring          │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ What happens next                          │  │
│  │                                            │  │
│  │ • A progress bar appears in the top-right  │  │
│  │   header — pause/resume from there.        │  │
│  │ • Images appear in the Media tab as they   │  │
│  │   get classified. No need to refresh.      │  │
│  │ • You can keep using the app while this    │  │
│  │   runs in the background.                  │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
├──────────────────────────────────────────────────┤
│                       [ Continue in background ] │
└──────────────────────────────────────────────────┘
```

- Modal width stays at the existing `w-[480px] max-w-[92vw]`.
- Header text changes from "Add images directory" to "Starting import…".
- Spinner is a `Loader2` from `lucide-react` with `animate-spin` (same
  icon already used for the header "Starting" state for consistency).
- Folder path is the value the user picked; truncate with the same
  RTL-direction trick used in the current folder display
  (`AddSourceModal.jsx:307-310`) so the tail of long paths is visible.
- The "What happens next" panel uses the muted card styling already
  used elsewhere in the modal (e.g. the disabled folder display) so it
  reads as informational, not interactive.
- Footer has a single primary-style button: **Continue in background**.
  The Cancel button is hidden during this state.

### Component changes

`AddSourceModal.jsx`:

- Add a new piece of state: `waitingForFirstBatch: boolean`. Distinct
  from `submitting`, which still covers only the `addFolder` round-trip.
- In `handleImport`, after `res?.success` and before the existing
  `onImported?.(); onClose()`:
  - Drop `onClose()` from this branch.
  - Set `waitingForFirstBatch = true`.
  - Keep `setSubmitting(false)` so the footer reflects the new state.
- New `useEffect` watching `importStatus.done` from
  `useImportStatus(studyId)`: when `waitingForFirstBatch && done > 0`,
  call `onImported?.(); onClose()`.
- Second `useEffect` for the 15s failsafe timer, started when
  `waitingForFirstBatch` flips to true; cleared on unmount/close.
- Existing reset effect (`AddSourceModal.jsx:82-88`) clears
  `waitingForFirstBatch` on close.
- ESC handler (`AddSourceModal.jsx:91-98`) already gates on
  `!submitting`; extend the gate to also allow ESC during
  `waitingForFirstBatch` (dismissing in this state is safe).

### Data the modal needs while open

Currently the modal doesn't subscribe to `useImportStatus`. It will
need to during `waitingForFirstBatch` so the auto-close trigger works.
Two acceptable shapes:

- **A. Always subscribe** (simplest): call `useImportStatus(studyId)`
  unconditionally. The hook is keyed on `studyId` and only polls while
  `isRunning`, so the cost when idle is one cache read.
- **B. Subscribe only after** `waitingForFirstBatch=true`: requires
  conditional hook usage (against React rules) or a wrapper sub-component.

**Choice: A.** It's simpler and the existing poll cadence (1s) is
exactly what we want anyway.

## Out of scope

- Header status-row changes. The recently-shipped icon-only button
  with behaviour tooltip stays as-is.
- Backend cancel API. There is no "Cancel import" affordance in this
  new state.
- Toast/banner alternatives outside the modal.
- Animations/transitions between the form view and the transitional
  view beyond the existing fade-in.

## Open questions

None remaining. The dismiss-only semantics for `✕` / backdrop / the
footer button were explicitly chosen during brainstorming.

## Risks

- **`addFolder` returns before jobs are visible to the queue**: if the
  backend resolves before `total` is queryable, the modal could sit on
  `done=0` for longer than expected. The 15s failsafe covers this; if
  it fires often we'll need to revisit the auto-close trigger.
- **First job slow to complete**: `done > 0` waits for the first ML
  inference to finish, which can take several seconds for the first
  batch (model warmup). Acceptable — the spinner + copy explains that
  work is in progress. If the wait is consistently too long, we can
  switch the trigger to `total > 0` (jobs queued, not yet processed)
  in a follow-up.
