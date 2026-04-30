# Media observation rail — design

**Date:** 2026-04-30
**Status:** Draft
**Scope:** Replace the current observation editor (popover) and footer species labels in the media modal with a single persistent side-rail.

## Summary

Today, editing an observation on a media is split across three surfaces: a floating popover anchored to a `BboxLabel` (for bbox observations), a footer "species label" button (for image-level / video observations), and clickable chips on the bbox label itself (for jumping to specific attribute fields). The popover uses six unrelated hues — lime, rose, blue, violet, teal, amber, emerald — none of which match Biowatch's monochrome brand.

This redesign collapses all three editing surfaces into one **`ObservationRail`** — a ~300px persistent panel on the right side of the media modal, listing every observation on the current media as a row. The currently-focused row holds the editor inline (accordion pattern). The rail handles bbox observations and whole-image observations uniformly.

The redesign also restyles all editing controls to Biowatch's monochrome palette (`#030213` near-black + neutrals), uses one accent blue (`#2563eb`) only as a visual link between a selected row and its rectangle, and enforces a new invariant: a media is in **bbox mode** or **whole-image mode** — never both.

## Goals

1. **Workflow** — make species editing (the most-edited field) one click away from any observation, without popover open/close friction.
2. **Layout** — give the editor a fixed home that doesn't overlap the image and works identically for images, videos, and image-level observations.
3. **Visual** — align the editing surface with Biowatch's monochrome brand. No rainbow chips.
4. **Unify** — one component handles all observation editing on a media; remove the popover-vs-footer split.

## Non-goals

- Redesigning `EditableBbox` (the rectangle + 8 handles) — keep current blue palette and interaction.
- Redesigning `VideoBboxOverlay` — keep dashed-blue read-only rendering.
- Redesigning gallery thumbnail bboxes — different surface, recently aligned in commits `1290ec6` and `b46c310`.
- Bulk edit (apply species/attributes to multiple observations at once).
- Group-by-species view in the rail (deferred; revisit if real usage hits 20+ observations regularly).
- Migrating existing data with mixed bbox + whole-image observations on the same media.

## Current state

Today's editing surfaces in `src/renderer/src/media.jsx`:

| Surface | Location | Triggered by |
|---|---|---|
| `ObservationEditor` popover | Anchored to `BboxLabel` | Click species pill or sex/lifestage/behavior chip on a bbox label |
| Footer species label (image, no bboxes) | Modal footer | Click species text |
| Footer species label (video) | Modal footer | Click species text |

`ObservationEditor` is a 288px popover with two tabs (Species / Attributes). The Species tab uses lime as the accent. The Attributes tab uses rose/blue/gray for sex, violet/teal/amber for life-stage, and emerald for the behavior dropdown.

`BboxLabel` (in `media.jsx:760+`) is a small pill anchored above each bbox showing species name + confidence + clickable chips for sex (♀/♂), life-stage (A/SA/J), and behavior. Each chip is a click-target that opens the editor on a specific tab.

The data model (`observations` table, `src/main/database/models.js`):

- `observationID` (PK), `scientificName`, `commonName`, `observationType` (`animal` | `blank` | …), `sex`, `lifeStage`, `behavior` (JSON array)
- Nullable bbox columns: `bboxX`, `bboxY`, `bboxWidth`, `bboxHeight`, `detectionConfidence`, `classificationProbability`
- `classificationMethod` (`human` | model name)

Whole-image observations have null bbox columns.

## Design

### Architecture

A new persistent `ObservationRail` lives inside `ImageModal`, occupying ~300px on the right. Component tree:

```
ImageModal
├── (image area — narrowed by ~300px)
│   ├── EditableBbox            (geometry editing: unchanged)
│   ├── BboxLabelMinimal        (NEW: species name only, click selects row)
│   ├── VideoBboxOverlay        (unchanged)
│   └── DrawingOverlay          (unchanged)
└── ObservationRail             (NEW)
    ├── RailHeader              ("Observations · N")
    ├── ObservationList
    │   └── ObservationRow      (collapsed | expanded)
    │       └── ObservationEditor   (only on expanded row)
    │           ├── SpeciesPicker
    │           ├── SexSelector
    │           ├── LifeStageSelector
    │           └── BehaviorSelector
    └── AddObservationMenu      (Draw rectangle | Whole image)
```

The `ObservationEditor` name is reused but its scope changes: it's now the contents of an expanded row, not a floating popover. The four selectors (`SpeciesPicker`, `SexSelector`, `LifeStageSelector`, `BehaviorSelector`) keep the same shape and behavior as today, restyled with the monochrome palette. `BehaviorSelector` keeps its grouped-checkbox dropdown with local-state-then-save-on-close.

### Mode invariant

A media is in exactly one of three modes:

| Mode | Condition | Constraint |
|---|---|---|
| Empty | 0 observations | Both create options available |
| Bbox | 1+ bbox observations, 0 whole-image | Only "Draw rectangle" available |
| Whole-image | exactly 1 whole-image observation, 0 bbox | "+ Add observation" affordance hidden; existing draw-bbox affordances disabled |

Switching between bbox and whole-image mode requires deleting all observations of the current type first.

**Edge case (mixed-mode media):** existing data may already have both bbox and whole-image observations on the same media (from imports). The rail renders both as it finds them, but the "+ Add observation" affordance is **hidden** in this state — the user must delete one type to enter a valid mode before adding more. Cleanup is the user's responsibility.

### State

`ImageModal` holds:

- `selectedObservationId: string | null` — replaces today's `selectedBboxId` and `showObservationEditor`. `null` only when the media has zero observations.

When the media has 1+ observations and the modal first opens, `selectedObservationId` defaults to the first observation in document order. (Today: nothing is auto-selected.)

### Two-way coupling: image ↔ rail

| User action | Effect |
|---|---|
| Click a bbox rectangle on the image | Sets `selectedObservationId`. Rail row scrolls into view, expands. Rectangle gets the "selected" stroke. |
| Click `BboxLabelMinimal` on the image | Same as clicking the rectangle. |
| Click a row header in the rail | Sets `selectedObservationId`. Corresponding rectangle gets the "selected" stroke. |
| Click empty image area | No change. Selection is sticky. |

Whole-image observations have no rectangle, so only "click row" applies.

### Save semantics (preserved from today)

- **Species pick** is committal: clicking a result or pressing Enter saves the species, collapses the picker, and leaves the row selected (body still expanded, attribute pills visible).
- **Attribute pills** (sex, life-stage) save **live** on click. Re-clicking a selected pill clears it (sets to `null`).
- **Behavior dropdown** keeps its current local-state-then-save-on-close pattern.
- **Mark as Blank** (the `×` next to the current species chip) saves immediately, sets `observationType: 'blank'` and clears `scientificName` / `commonName`.
- **Custom species** ("Add 'X' as custom species" when no results match a 3+ char query) — preserved.

### Keyboard

- **Esc** — collapses the expanded row's body if a picker dropdown is open; otherwise, second Esc closes the modal. (Today: Esc closes the popover, second Esc closes the modal.)
- **↑ / ↓** inside the species picker — navigate results.
- **Enter** inside the species picker — commit the highlighted result.
- **Backspace / Delete** inside the picker — does NOT trigger the modal-level "delete observation" shortcut (preserve today's guard).
- No new global shortcuts.

### Add-observation menu

Triggered by:
- Empty state: centered "+ Add observation" button in the rail body.
- Bbox mode: "+ Add observation" affordance at the bottom of the rail.
- Whole-image mode: affordance is hidden.

Menu contents are mode-aware:

| Mode | Menu items |
|---|---|
| Empty | `Draw rectangle`, `Whole image` |
| Bbox | `Draw rectangle` |
| Whole-image | n/a (menu never opens) |

**Draw rectangle:**
1. Closes the menu.
2. Sets `drawMode = true`. Existing `DrawingOverlay` runs.
3. On `onComplete`: creates a new bbox observation in the database; sets `selectedObservationId` to the new ID; rail auto-expands the new row with `SpeciesPicker` focused.

**Whole image:**
1. Closes the menu.
2. Creates a new whole-image observation in the database (null bbox columns).
3. Sets `selectedObservationId` to the new ID; rail auto-expands the new row with `SpeciesPicker` focused.

### Density at scale

Most media have 1–3 observations. Edge cases (15+ observations from a herd) are handled by:

- **Compact rows always** — collapsed rows are short (~36px). Mini-badges (`A` / `♂` / `J`) on the right show attributes at a glance.
- **Sticky focused row** — the expanded row uses `position: sticky` so it stays pinned at the top of the scroll region while the rest of the list scrolls. The editor never goes off-screen mid-edit.

No filter bar — in practice a single media almost always contains a single species, so filtering doesn't pay rent.

No "group by species" view — deferred. Revisit only if real usage demands it.

## Visual language

### Palette tokens

| Token | Value | Used for |
|---|---|---|
| `--bw-text` | `#030213` | Primary text, selected pill fill |
| `--bw-text-muted` | `#717182` | Field labels, secondary text |
| `--bw-text-faint` | `#9ca3af` | Confidence values, chevrons |
| `--bw-bg` | `#ffffff` | Rail background |
| `--bw-bg-row-selected` | `#f8f9fb` | Selected row background |
| `--bw-border` | `#e5e7eb` | Rail outline, pill borders |
| `--bw-border-soft` | `#f3f4f6` | Row separators |
| `--bw-accent-bbox` | `#2563eb` | Validated bbox stroke, selected-row left stripe |
| `--bw-accent-bbox-soft` | `#60a5fa` | Predicted bbox stroke (existing) |

These reuse Biowatch's existing tokens where they exist (`#030213` is the project's `--color-primary`); the rest are concrete values used directly. The bbox accent values match the recently-shipped `EditableBbox` palette so the rail and image agree.

The **only blue inside the rail UI** is the 2px left stripe on the selected row. Everything else is monochrome. The stripe matches the selected-bbox stroke on the image, visually linking row to rectangle.

### Type icons

- **`▣` Bbox observation** — 16×16 rounded box, 1.5px solid `--bw-accent-bbox` border, `rgba(37,99,235,0.08)` fill. Echoes the validated bbox stroke.
- **`⊡` Whole-image observation** — 16×16 rounded box, 1.5px **dashed** `--bw-text-muted` border, `--bw-border-soft` fill. Dashed means "no geometry".

Implementation note: these can be plain SVG components (no font-glyph dependency).

### Pills (sex, life-stage)

- **Unselected:** `--bw-bg`, 1px `--bw-border`, `--bw-text-muted` text.
- **Selected:** filled `--bw-text`, white text, `--bw-text` border.
- **Hover:** `--bw-bg-row-selected` background.

No color encoding for "female=rose, male=blue, juvenile=amber" etc. Sex/life-stage are distinguishable by their labels and icons; they do not need hue.

Pills sit in a horizontal row under their `field-label` (Sex, Life stage). Re-clicking a selected pill clears the value.

### Behavior dropdown

Restyled but keeps today's interaction:
- Trigger: `--bw-bg`, 1px `--bw-border`, shows count ("2 behaviors") or "None".
- Open state: white background, gray border (no emerald tint).
- Selected count badge: `--bw-text` background, white text — same treatment as pills.
- Category headers in the dropdown stay (gray uppercase).

### `BboxLabelMinimal`

Replaces today's `BboxLabel`. A small pill anchored above each bbox:

- **Validated** (human-classified): filled `--bw-accent-bbox`, white text.
- **Predicted** (model-classified): filled `--bw-accent-bbox-soft`, white text.
- **Selected** (matches `selectedObservationId`): filled `--bw-text` (near-black), white text, slightly larger.
- **Content:** species name only. No confidence, no chips, no attribute affordances.
- Truncates with ellipsis if name overflows the bbox width.
- Smart positioning preserved (today's `computeBboxLabelPosition` keeps labels visible near image edges).

Click handler: sets `selectedObservationId` (no editor open/close logic).

### Confidence display in the rail row

Confidence appears faintly to the right of the species name in both collapsed and expanded rows:

```
▣  European Hare    78%   A  ♂   ▾
                    ↑
                    --bw-text-faint
```

Format: `${Math.round(classificationProbability * 100)}%`. Hidden when `classificationProbability` is null (e.g., human-validated).

### Validation indicator

A small `✓` glyph (in `--bw-text-muted`) appears before the species name on rows where `classificationMethod === 'human'`. No glyph for model predictions — absence is the signal.

```
▣  ✓ European Hare         A  ♂   ▾
```

Same logical encoding as today's bbox stroke (solid = validated, dashed = predicted), just on the row instead of the rectangle.

### Empty-state body

When the media has zero observations:

- Center the rail body: dashed `⊡` icon (large), "No observations yet — Add one to start labelling this media." subtitle, primary "+ Add observation" button (filled `--bw-text`, white text).
- Clicking the button opens the `AddObservationMenu` with both options enabled (`Draw rectangle`, `Whole image`).

## Files affected

### New files

- `src/renderer/src/ui/ObservationRail.jsx` — top-level rail component. Owns the empty state, the list, and the bottom-row create affordance.
- `src/renderer/src/ui/ObservationRow.jsx` — collapsed/expanded row. Renders header (type icon, validation glyph, species name, confidence, summary mini-badges), and when expanded mounts the editor body.
- `src/renderer/src/ui/AddObservationMenu.jsx` — the two-item dropdown. Mode-aware; receives the current `mode` ('empty' | 'bbox' | 'whole-image') as a prop.
- `src/renderer/src/ui/BboxLabelMinimal.jsx` — extracted, simplified label. Replaces today's `BboxLabel`.
- `src/renderer/src/ui/SpeciesPicker.jsx` — extracted from today's `ObservationEditor` species tab; restyled. Includes search input, ranked list, custom-species fallback, and current-species chip with mark-blank affordance.
- `src/renderer/src/ui/SexSelector.jsx` — extracted from `media.jsx`, restyled to monochrome pills.
- `src/renderer/src/ui/LifeStageSelector.jsx` — same.
- `src/renderer/src/ui/BehaviorSelector.jsx` — same; keeps grouped-dropdown logic.

### Modified files

- `src/renderer/src/media.jsx` — major surgery:
  - Remove the inline `ObservationEditor`, `BboxLabel`, `SexSelector`, `LifeStageSelector`, `BehaviorSelector`, `FemaleIcon`/`MaleIcon`/etc., footer-species-label code paths.
  - Replace `selectedBboxId` + `showObservationEditor` + `editorInitialTab` with `selectedObservationId`.
  - Replace `BboxLabel` mount with `BboxLabelMinimal`.
  - Mount `ObservationRail` next to the image area; adjust modal layout to give the rail ~300px.
  - Update click handlers in the bbox/label layer to set `selectedObservationId` only.
  - Wire `AddObservationMenu`'s `Draw rectangle` action to the existing `setIsDrawMode(true)` path; on `DrawingOverlay.onComplete`, set `selectedObservationId` to the new observation.
  - Preserve `handleBboxUpdate`, geometry editing, sequence navigation, prefetching, zoom controls.

  After surgery, expect `media.jsx` to drop several hundred lines (today: 3845 lines).

### Documentation

- `docs/architecture.md` — update if the file references the modal's editor structure.
- No schema or IPC changes — `observationType`, nullable bbox columns, and `classificationMethod` are already in the data model.

### Out of scope (reaffirmed)

- `EditableBbox` rectangle + handles styling.
- `VideoBboxOverlay` rendering.
- Gallery thumbnail bboxes.
- Migration of existing media that have mixed bbox + whole-image observations.
- Group-by-species view.
- Bulk edit.

## Open questions

None at design time — all decisions are made above. Implementation will surface secondary details (animation timings, exact widths, whether to migrate the rail width to a CSS variable) that can be settled in the implementation plan.
