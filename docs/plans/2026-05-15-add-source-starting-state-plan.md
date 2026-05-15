# Add-source modal: "Starting import…" transitional state — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Add Source modal open in a transitional "Starting import…" view from the moment Import is clicked until the first job completes (or the user dismisses), replacing the current insta-close behaviour.

**Architecture:** All changes are confined to `src/renderer/src/AddSourceModal.jsx`. The modal subscribes to the existing `useImportStatus(studyId)` hook so it can watch `importStatus.done` and auto-close on `done > 0`. A new `waitingForFirstBatch` state drives a swapped body + footer. A 15-second failsafe timer guarantees the modal never traps the user.

**Tech Stack:** React (Electron renderer), Radix-style Tailwind classes already in the file, `lucide-react` icons, `@tanstack/react-query` (already wired via the hook).

**Reference spec:** [`docs/specs/2026-05-15-add-source-starting-state-design.md`](../specs/2026-05-15-add-source-starting-state-design.md).

**Testing approach:** This project doesn't have React component tests for the renderer (see `test/`, which covers backend/shared modules). Each task pairs a lint pass with concrete manual verification steps via `npm run dev`. Don't skip the manual checks — they are the test plan.

---

## Files

- **Modify:** `src/renderer/src/AddSourceModal.jsx` (all changes live here)

The file is ~350 lines and already does a few things (form, validation, browse, submit). The new transitional state adds a body branch and a small piece of state — it does not justify splitting the file.

---

## Task 1: Add state + hook subscription scaffolding (no behaviour change yet)

**Files:**
- Modify: `src/renderer/src/AddSourceModal.jsx`

- [ ] **Step 1: Add imports**

Add `useRef` to the React import, the spinner icon, and the import status hook.

In `src/renderer/src/AddSourceModal.jsx`, change the first import:

```jsx
import { useEffect, useMemo, useState } from 'react'
```

to:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react'
```

Change the lucide import:

```jsx
import { Lock, FolderOpen, X } from 'lucide-react'
```

to:

```jsx
import { Lock, FolderOpen, X, Loader2 } from 'lucide-react'
```

And add this import below the existing `@tanstack/react-query` import:

```jsx
import { useImportStatus } from './hooks/import'
```

- [ ] **Step 2: Add `waitingForFirstBatch` state and the done-snapshot ref**

Add a new piece of state next to the existing `submitting` declaration (`AddSourceModal.jsx:29`), and a ref to snapshot `importStatus.done` at the moment we enter the transitional state:

```jsx
const [submitting, setSubmitting] = useState(false)
const [waitingForFirstBatch, setWaitingForFirstBatch] = useState(false)
const doneAtStartRef = useRef(0)
```

**Why the ref?** `importStatus.done` is study-wide. A study that already has completed imports (e.g. a previously-paused run, or a prior session) has `done > 0` the instant we flip `waitingForFirstBatch=true`. Without the snapshot, the auto-close in Task 2 would fire immediately. The ref captures the baseline so we can wait for a *new* completion.

- [ ] **Step 3: Subscribe to the import status hook**

Add the subscription right after `useQueryClient()` (around `AddSourceModal.jsx:23`):

```jsx
const { importStatus } = useImportStatus(studyId)
```

This is safe to call unconditionally — the hook is gated on `!!id` inside (see `src/renderer/src/hooks/import.js:55`), so it's a no-op when `studyId` is falsy, and it only polls while `isRunning`.

- [ ] **Step 4: Reset `waitingForFirstBatch` when the modal closes**

Extend the existing reset effect (`AddSourceModal.jsx:82-88`) to clear the new flag:

```jsx
useEffect(() => {
  if (!isOpen) {
    setFolder('')
    setError(null)
    setSubmitting(false)
    setWaitingForFirstBatch(false)
  }
}, [isOpen])
```

- [ ] **Step 5: Allow ESC during the transitional state**

The existing ESC handler (`AddSourceModal.jsx:91-98`) only blocks ESC while `submitting`. The transitional state is safely dismissable (the import keeps running), so no change is needed — but read the handler to confirm; it already does the right thing because `submitting` is `false` during `waitingForFirstBatch`.

No code change in this step; just verify by reading.

- [ ] **Step 6: Lint**

Run: `npx eslint src/renderer/src/AddSourceModal.jsx`
Expected: clean (no errors).

- [ ] **Step 7: Manual verification — no regression**

Run: `npm run dev`
- Open a study with a model and click "+ Add images directory".
- Confirm the form renders as before (model, country if applicable, folder picker).
- Confirm Browse → pick a folder → Cancel works.
- Confirm Import still closes the modal on success (we haven't changed that behaviour yet).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/AddSourceModal.jsx
git commit -m "refactor(add-source): scaffold waitingForFirstBatch state and import-status subscription"
```

---

## Task 2: Keep the modal open after Import — auto-close on first completion

**Files:**
- Modify: `src/renderer/src/AddSourceModal.jsx`

- [ ] **Step 1: Stop closing the modal in `handleImport`**

Replace the success branch in `handleImport` (`AddSourceModal.jsx:134-145`). The cache update + invalidate stay; remove `onImported?.()` and `onClose()` here, and flip `waitingForFirstBatch` on. Also keep `submitting=true` until we enter the waiting state, then drop it so the new footer renders normally.

Old (`AddSourceModal.jsx:134-145`):

```jsx
if (res?.success) {
  // Kick the import-status query so the global progress bar picks up the
  // new run on its next refetch. Setting isRunning=true here also
  // re-arms the polling interval (hooks/import.js refetches only while
  // isRunning is truthy).
  queryClient.setQueryData(['importStatus', studyId], (prev) => ({
    ...(prev || { total: 0, done: 0 }),
    isRunning: true
  }))
  queryClient.invalidateQueries({ queryKey: ['importStatus', studyId] })
  onImported?.()
  onClose()
} else {
```

New:

```jsx
if (res?.success) {
  // Kick the import-status query so the global progress bar picks up the
  // new run on its next refetch. Setting isRunning=true here also
  // re-arms the polling interval (hooks/import.js refetches only while
  // isRunning is truthy).
  queryClient.setQueryData(['importStatus', studyId], (prev) => ({
    ...(prev || { total: 0, done: 0 }),
    isRunning: true
  }))
  queryClient.invalidateQueries({ queryKey: ['importStatus', studyId] })
  doneAtStartRef.current = importStatus?.done ?? 0
  setWaitingForFirstBatch(true)
  setSubmitting(false)
} else {
```

- [ ] **Step 2: Auto-close when the first new job completes**

Add a new effect below the ESC handler (after `AddSourceModal.jsx:98`). Compare against the snapshotted `done` so we close on the first *new* completion, not on any pre-existing progress for this study:

```jsx
// Auto-close once a new job completes — gives the user concrete
// evidence the import is making progress before dismissing the modal.
// Compares against the snapshot taken when we entered the transitional
// state, because importStatus.done is study-wide and may already be
// non-zero from prior runs.
useEffect(() => {
  if (!waitingForFirstBatch) return
  if ((importStatus?.done ?? 0) > doneAtStartRef.current) {
    onImported?.()
    onClose()
  }
}, [waitingForFirstBatch, importStatus?.done, onImported, onClose])
```

- [ ] **Step 3: Lint**

Run: `npx eslint src/renderer/src/AddSourceModal.jsx`
Expected: clean.

- [ ] **Step 4: Manual verification — modal stays open until first result**

Run: `npm run dev`
- Open the modal, pick a small folder (~10–20 images), click Import.
- Expect: modal does **not** close immediately. It stays open while jobs queue up.
- Expect: within a few seconds (after the first job completes), the modal auto-closes.
- Expect: the header progress bar appears and continues filling normally.
- Optional but valuable: pick a larger folder (200+ images), verify modal still auto-closes when the first job lands (not when all do).

Note: at this point the modal body still shows the *form*, not the transitional view. That's the next task. We're verifying the timing first.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/AddSourceModal.jsx
git commit -m "feat(add-source): keep modal open until first import job completes"
```

---

## Task 3: Render the transitional view (body, header text, footer)

**Files:**
- Modify: `src/renderer/src/AddSourceModal.jsx`

- [ ] **Step 1: Swap the modal header text in the transitional state**

Replace the header `<h3>` (`AddSourceModal.jsx:168`):

Old:

```jsx
<h3 className="text-base font-medium text-foreground">Add images directory</h3>
```

New:

```jsx
<h3 className="text-base font-medium text-foreground">
  {waitingForFirstBatch ? 'Starting import…' : 'Add images directory'}
</h3>
```

- [ ] **Step 2: Replace the form body with the transitional view when waiting**

Wrap the existing body block (`AddSourceModal.jsx:178-335` — the `<div className="px-5 py-4 space-y-4">` containing all form fields) so it only renders when `!waitingForFirstBatch`. Insert the transitional view as the alternative branch.

The cleanest edit is to wrap the existing body in a ternary at the parent. Locate this line (`AddSourceModal.jsx:178`):

```jsx
        <div className="px-5 py-4 space-y-4">
```

…and the matching closing `</div>` that ends the form body (just before `<footer …>` at `AddSourceModal.jsx:337`).

Replace the entire body block with this structure:

```jsx
        {waitingForFirstBatch ? (
          <div className="px-5 py-6 space-y-4">
            <div className="flex items-start gap-3">
              <Loader2
                size={20}
                className="animate-spin text-blue-600 dark:text-blue-400 mt-0.5 shrink-0"
              />
              <div className="min-w-0">
                <p className="text-sm text-foreground font-medium">
                  Queueing images for analysis
                </p>
                <p
                  className="text-xs font-mono text-muted-foreground truncate mt-0.5"
                  style={folder ? { direction: 'rtl', textAlign: 'left' } : undefined}
                  title={folder || ''}
                >
                  {folder ? `‎${folder}` : ''}
                </p>
              </div>
            </div>

            <div className="rounded-md border border-border bg-muted/50 dark:bg-muted px-3 py-3">
              <p className="text-xs font-medium text-foreground mb-2">What happens next</p>
              <ul className="text-xs text-muted-foreground space-y-1.5 leading-relaxed">
                <li>
                  A progress bar appears in the top-right header — pause or resume from there.
                </li>
                <li>
                  Images appear in the Media tab as they get classified. No need to refresh.
                </li>
                <li>You can keep using the app while this runs in the background.</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* …existing form body, unchanged… */}
          </div>
        )}
```

When pasting, keep the *entire existing form body content* (the no-models CTA, Model section, Country section, Folder section, error block) verbatim inside the `else` branch's `<div>`. Do not edit any field markup.

- [ ] **Step 3: Swap the footer buttons in the transitional state**

Replace the footer block (`AddSourceModal.jsx:337-344`):

Old:

```jsx
<footer className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-border bg-gray-50 dark:bg-muted">
  <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
    Cancel
  </Button>
  <Button size="sm" onClick={handleImport} disabled={!canImport || submitting}>
    {submitting ? 'Starting…' : 'Import'}
  </Button>
</footer>
```

New:

```jsx
<footer className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-border bg-gray-50 dark:bg-muted">
  {waitingForFirstBatch ? (
    <Button size="sm" onClick={onClose}>
      Continue in background
    </Button>
  ) : (
    <>
      <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
        Cancel
      </Button>
      <Button size="sm" onClick={handleImport} disabled={!canImport || submitting}>
        {submitting ? 'Starting…' : 'Import'}
      </Button>
    </>
  )}
</footer>
```

- [ ] **Step 4: Lint and format**

Run: `npx eslint --fix src/renderer/src/AddSourceModal.jsx && npx eslint src/renderer/src/AddSourceModal.jsx`
Expected: clean (no errors, no warnings).

- [ ] **Step 5: Manual verification — full visual pass**

Run: `npm run dev`
- Open the modal, pick a folder, click Import.
- Expect: header text flips to "Starting import…".
- Expect: form is gone; you see a spinning blue Loader2, "Queueing images for analysis", and the folder path (truncated with the same tail-visible behaviour as the picker).
- Expect: a "What happens next" panel with three bullet points.
- Expect: footer shows a single "Continue in background" button.
- Click "Continue in background" → modal closes immediately. Header progress bar continues — the import is still running.
- Repeat in dark mode (toggle theme).
- Repeat: this time don't click "Continue in background"; wait. Once the first image finishes processing, the modal closes itself.

- [ ] **Step 6: Manual verification — error path still works**

Run: `npm run dev`
- Force `addFolder` to fail. Easiest path: pick a folder you don't have read permission for, or temporarily edit `src/main/index.js`'s `addFolder` handler to `throw new Error('forced')` and revert after.
- Expect: modal stays on the form view with the red error block. The transitional view never appears.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/AddSourceModal.jsx
git commit -m "feat(add-source): show transitional starting view with progress copy"
```

---

## Task 4: 15-second failsafe auto-close

**Files:**
- Modify: `src/renderer/src/AddSourceModal.jsx`

- [ ] **Step 1: Add the failsafe timer effect**

Add this effect immediately below the auto-close-on-done effect from Task 2:

```jsx
// Failsafe: if no job completes within 15s, dismiss the modal anyway.
// The import is genuinely running by this point (addFolder resolved),
// so trapping the user behind the spinner would be worse than closing.
useEffect(() => {
  if (!waitingForFirstBatch) return
  const id = setTimeout(() => {
    onImported?.()
    onClose()
  }, 15000)
  return () => clearTimeout(id)
}, [waitingForFirstBatch, onImported, onClose])
```

- [ ] **Step 2: Lint**

Run: `npx eslint src/renderer/src/AddSourceModal.jsx`
Expected: clean.

- [ ] **Step 3: Manual verification — failsafe fires**

Temporarily change the `15000` to `1500` (1.5 seconds) so you can confirm the effect without waiting a long time.

Run: `npm run dev`
- Pick a folder, click Import.
- Expect: even if the first job hasn't completed yet, the modal auto-dismisses after ~1.5s.

Revert the timeout to `15000` after verifying.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/AddSourceModal.jsx
git commit -m "feat(add-source): add 15s failsafe to avoid trapping user on slow first batch"
```

---

## Task 5: Final pass — format, full lint, and end-to-end manual run

**Files:**
- Modify: (none — verification only)

- [ ] **Step 1: Prettier**

Run: `npm run format -- src/renderer/src/AddSourceModal.jsx`
Expected: file is already formatted (no diff), or a clean reformat.

- [ ] **Step 2: Project lint**

Run: `npm run lint -- src/renderer/src/AddSourceModal.jsx`
Expected: clean.

- [ ] **Step 3: End-to-end manual check**

Run: `npm run dev` and walk through these scenarios in order:

1. **Happy path, small folder**: Pick a folder with 5–10 images → click Import → see the transitional view → modal auto-closes within a few seconds when the first job completes → header progress bar runs to 100%.
2. **Happy path, large folder**: Pick 200+ images → same expectation; the modal closes after first job completes (not after all). Verify the header progress bar is doing its thing afterward.
3. **Dismiss during transition**: Pick a folder → click Import → click "Continue in background" before first job lands → modal closes; header progress bar still appears and progresses.
4. **ESC during transition**: Same as #3 but press ESC instead of clicking the button. Modal should close.
5. **Backdrop click during transition**: Same as #3 but click outside the modal. Modal should close.
6. **`addFolder` error path**: Force an error → form stays visible with the red error block; the transitional view never renders.
7. **Dark mode pass**: Repeat #1 in dark mode. Spinner is blue, copy is readable, panel border/background looks right.

- [ ] **Step 4: Commit if anything changed**

If steps 1–2 produced any formatting changes:

```bash
git add src/renderer/src/AddSourceModal.jsx
git commit -m "style(add-source): prettier pass"
```

Otherwise skip.

- [ ] **Step 5: Push**

```bash
git push -u origin $(git branch --show-current)
```

- [ ] **Step 6: Open the PR**

```bash
GH_TOKEN="" gh pr create --title "feat(add-source): keep modal open with starting-state view until first job lands" --body "$(cat <<'EOF'
## Summary

Address customer feedback that the moment after clicking Import is unclear — the upper-right "Starting" button is too subtle to be noticed when looking at the page body.

Instead of closing the modal immediately, keep it open in a transitional "Starting import…" view until the first job actually completes. Concrete copy tells the user where to look for ongoing progress (top-right) and results (Media tab), so by the time the modal closes the user already knows what to expect.

- Modal stays open after Import is clicked; switches header to "Starting import…" and body to a spinner + folder + "What happens next" panel.
- Auto-closes when \`importStatus.done > 0\` (first job done) or when the user clicks **Continue in background**.
- 15s failsafe so an unexpectedly-slow first batch can't trap the user.
- Dismiss-only semantics: ✕, ESC, backdrop click, and **Continue in background** all just close the modal; the import keeps running. To stop it, pause from the header (existing UX).
- All changes confined to \`src/renderer/src/AddSourceModal.jsx\`.

Spec: [docs/specs/2026-05-15-add-source-starting-state-design.md](docs/specs/2026-05-15-add-source-starting-state-design.md)

## Test plan

- [ ] Small folder happy path → modal auto-closes after first job completes
- [ ] Large folder happy path → same; header progress bar continues
- [ ] Continue in background → modal closes, import keeps running
- [ ] ESC during transitional state → closes; import keeps running
- [ ] Backdrop click during transitional state → closes; import keeps running
- [ ] \`addFolder\` error path → form stays visible with error block; no transitional view
- [ ] Dark mode visual pass
EOF
)"
```

---

## Self-Review (run after writing the plan)

- **Spec coverage:** All 7 behaviour-table rows from the spec map to tasks: rows 1–3 (existing/error path) are unchanged; row 2's transition is Task 2 + Task 3; row 4 auto-close on `done>0` is Task 2; row 5 "Continue in background" is Task 3; row 6 ✕/backdrop is unchanged (already calls `onClose`); row 7 failsafe is Task 4. The "What happens next" copy is in Task 3 Step 2.
- **Placeholders:** None. Every code block is complete.
- **Type consistency:** `waitingForFirstBatch` (boolean), `setWaitingForFirstBatch`, and `importStatus.done` are used consistently across Tasks 1–4. The hook returns `{ importStatus, resumeImport, pauseImport }` (see `src/renderer/src/hooks/import.js:75-79`), matching the destructure in Task 1 Step 3.
- **Scope:** All changes in one file; no spec section left without a task.
