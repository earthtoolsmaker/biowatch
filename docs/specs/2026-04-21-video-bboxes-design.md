# Video Bounding Boxes — Display Design

**Date:** 2026-04-21
**Status:** Design approved, pending spec review
**Scope:** Read-only bounding-box overlay for videos in the main media modal

## Problem

The media modal renders bounding boxes on images by reading from the
`observations` table. Videos today have no bbox overlay: the detector runs
per-frame at 1 fps during classification, but only one aggregated, bbox-less
observation is written per video. Frame-level detections are preserved in
`modelOutputs.rawOutput.frames[]` but never surfaced to the UI.

We want to display those frame-level detections over the video, synchronized
with playback, using the same confidence threshold rule as images.

## Goals

- Display bounding boxes over the playing video in the main media modal.
- Synchronize boxes with `<video>.currentTime` by floor-rounding to the
  nearest sampled frame (1 fps).
- Apply the same confidence filter as images: keep the top detection per
  frame always, drop others below `0.5`.
- Reuse the existing `showBboxes` toggle and visual style (lime `#84cc16`).
- Zero changes to the classification write path.

## Non-goals (out of scope)

- Editing video bboxes.
- Bbox labels (species, confidence badges, detector class).
- Bbox overlay in `BestMediaCarousel` (dashboard / best-captures flow).
- Cross-frame identity / tracking.
- Interpolating box positions between sampled frames.
- Schema changes or a new denormalized table for frame detections.
- Changes to `insertVideoPredictions` aggregation logic.

## Scope boundary: what this feature does not change

The write path (`insertVideoPredictions` in `src/main/services/prediction.js`)
is untouched. One observation per video continues to be created using the
existing majority-voting classifier logic. The raw frame data already stored
in `modelOutputs.rawOutput` is the read-only source for this feature.

## Architecture

### Data source

`modelOutputs.rawOutput` is a JSON column containing `{ frames: [...] }` for
video predictions. Each frame entry carries:

```js
{
  frame_number: number,
  detections: [ { bbox|xywhn, conf, category, ... }, ... ],
  prediction: string,
  prediction_score: number,
  metadata: { fps, duration }
}
```

No schema change. No backfill required.

### IPC layer (main process)

New handler alongside `getMediaBboxes` in `src/main/ipc/media.js`:

```
getVideoFrameDetections(studyId, mediaID) → { data: [...] }
```

Behavior:

1. Load the `modelOutputs` row for the given `mediaID` (only `rawOutput`).
2. If no row exists, or `rawOutput.frames` is absent/empty, return
   `{ data: [] }`.
3. Resolve `modelType` for the transform. Prefer `detectModelType(frames[0])`
   from `src/main/utils/bbox.js` — it already inspects `model_version` and
   detection shape to pick `speciesnet` / `deepfaune` / `manas`. Avoids an
   extra join.
4. For each frame in `rawOutput.frames`:
   - Sort `detections` by `conf` descending.
   - Always keep the top detection.
   - Keep additional detections only if `conf >= 0.5`.
5. Normalize each kept detection via `transformBboxToCamtrapDP(detection,
   modelType)` so coordinates are top-left, normalized 0–1.
6. Emit a flat array sorted by `frameNumber` ascending.

Response shape:

```js
{ data: [ { frameNumber, bboxX, bboxY, bboxWidth, bboxHeight, conf }, ... ] }
```

Threshold `0.5` is a single `const` at the top of the handler. Every model
currently in `src/shared/mlmodels.js` uses `0.5`, so per-model lookup would
be premature complexity; the extension point is obvious if it ever matters.

No `fps` is returned — the renderer reads `media.exifData.fps` directly
(already populated by `insertVideoPredictions`, falls back to `1`). No `label`
is returned — the UI does not display it.

### Renderer layer

Modifications happen inside the existing video branch of the media modal
(`src/renderer/src/media.jsx` around line 2057), within the same component
that already handles video transcoding.

1. Fetch frame detections via React Query:
   - key: `['videoFrameDetections', studyId, mediaID]`
   - enabled: `isOpen && isVideo && !!mediaID`
2. Track `currentTime` via `onTimeUpdate` on the `<video>` element, storing
   it in local state throttled to ~250ms (use `useRef` + a timestamp check
   or `requestAnimationFrame` coalescing). Browsers fire `timeupdate` at
   4–60Hz; throttling prevents unnecessary rerenders.
3. Derive `currentFrameNumber = Math.floor(currentTime * fps)` where
   `fps = media.exifData?.fps || 1`.
4. Compute `currentFrameBboxes` with a `useMemo` keyed on
   `[currentFrameNumber, frameDetections]`:
   `frameDetections.filter(d => d.frameNumber === currentFrameNumber)`.
5. Render an absolutely-positioned SVG overlay over the `<video>` element,
   mirroring the image overlay at `media.jsx:2126`:
   - Each bbox is a plain `<rect>` with lime stroke (`#84cc16`) and
     transparent fill.
   - React key: `${frameNumber}-${detectionIndex}`.
6. Gate the overlay on `showBboxes && currentFrameBboxes.length > 0`.

### Coordinate mapping

Videos use `object-contain` letterboxing like images. The existing helpers in
`src/renderer/src/utils/bboxCoordinates.js` compute rendered-media bounds
given a container and a media element's natural dimensions. If these helpers
are coupled to `HTMLImageElement`, generalize them to accept any element
exposing natural dimensions (`videoWidth`/`videoHeight` for video,
`naturalWidth`/`naturalHeight` for image).

The video branch has no zoom UI, so the zoom-transform code path can be
skipped entirely for videos.

### Data flow

```
modelOutputs.rawOutput.frames[]  (DB)
  → IPC getVideoFrameDetections (filter by conf + normalize)
  → React Query cache
  → useMemo for current-frame slice
  → SVG <rect> overlay positioned over <video>
       ↑
  currentTime (throttled onTimeUpdate) → floor(t * fps) → frameNumber
```

## Edge cases

- **No `modelOutputs` row** (not yet classified, or failed): IPC returns
  `{ data: [] }`. Video plays without overlay. No error surfaced.
- **`rawOutput` exists but no `frames` field**: treat as empty.
- **`media.exifData.fps` missing or zero**: fall back to `fps = 1`, matching
  `insertVideoPredictions` at `prediction.js:453`.
- **`currentFrameNumber` beyond last sampled frame**: filter returns empty
  array. No boxes. Natural.
- **Frame with no detections passing threshold**: empty array. No boxes.
- **Video still transcoding**: overlay sits inside the video-element branch
  which isn't mounted until `transcodeState === 'ready'`. Nothing to do.
- **Video metadata not loaded yet** (`videoWidth`/`videoHeight` are 0): gate
  overlay on `onLoadedMetadata` having fired, mirroring `isCurrentImageReady`
  for images.
- **Seek / scrub**: `onTimeUpdate` fires during seeks, so boxes follow the
  scrubber naturally.

## Error handling

- IPC handler: wrap DB access in try/catch, log via existing logger, return
  `{ data: [], error }` on failure.
- Renderer: React Query consumer falls back to `data = []` on query error,
  so the video still plays with no overlay.
- Malformed `rawOutput` (defensive): wrap frame iteration in try/catch, log,
  return empty array rather than crash.

## Testing

### Unit tests

IPC handler in `src/main/ipc/media.js` (alongside existing `getMediaBboxes`
tests):

- Returns `{ data: [] }` when no `modelOutputs` row exists.
- Returns `{ data: [] }` when `rawOutput.frames` is absent/empty.
- Applies `0.5` threshold per frame: always keeps top detection, drops
  others below threshold.
- Preserves frame ordering (sorted ascending by `frameNumber`).
- Correct normalized coordinates for a known input (spot-check one SpeciesNet
  and one DeepFaune/Manas `xywhn` case).

Frame-lookup pure helper — extract the filter logic so it can be tested
without mounting the component:

- Exact frame match returns that frame's detections.
- No match returns empty array.
- Multi-detection frame returns all of them.

### Manual / integration testing (PR checklist)

- Open a classified video in the media modal; boxes appear and follow playback.
- Seek forward and backward; boxes follow.
- Toggle `showBboxes` off — boxes hide; toggle on — boxes return.
- Video with no detections anywhere — no boxes, no errors.
- Video still transcoding — no errors; boxes appear when video is ready.
- Resize window during playback — boxes stay aligned with letterboxed video.

## Follow-ups (separate specs / PRs)

- Investigate whether `insertVideoPredictions` should gate frames on
  detection confidence before voting. A frame whose classifier labeled
  "chamois" but whose detector found nothing above `0.5` arguably should
  not contribute a vote. This is a correctness change to the write path
  and deserves its own design discussion.
- Extend overlay to `BestMediaCarousel` video viewer.
- Per-model detector threshold lookup (resolve via
  `modelOutputs → runs → model` against `mlmodels.js`) if a model ships
  with a value other than `0.5`.
- Optional bbox labels (detector class and/or confidence) if reviewers
  ask for them.
