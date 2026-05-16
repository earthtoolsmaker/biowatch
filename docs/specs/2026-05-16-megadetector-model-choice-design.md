# MegaDetector as a Biowatch model choice — design

## Background

Biowatch currently offers three model choices in the AI Models tab: SpeciesNet (worldwide), DeepFaune (Europe), and Manas (Himalayas). All three combine an object detector with a species classifier.

[MegaDetector](https://github.com/agentmorris/MegaDetector) is Microsoft AI for Earth's open-source detector for camera trap images. It locates animals, people, and vehicles in any image worldwide, with **no species classification**. Inside Biowatch it would fill a different role: a fast blank-filter that lets a user separate frames with subjects from empty frames, then manually annotate species on the non-blank frames using Biowatch's existing annotation UI.

MegaDetector v6 (`MDV6-yolov10x.pt`) is already bundled inside the DeepFaune and Manas tarballs and loaded via `ultralytics.YOLO` in `run_deepfaune_server.py`. The Python loading code is therefore already proven inside our `common` conda environment.

## Goals

1. Ship MegaDetector v6 (YOLOv10x) as a standalone model choice in the AI Models tab.
2. Match the established model-integration pattern (one Python server script, one `switch` case in `server.ts`, one HF tarball, one `mlmodels.js` entry).
3. Map MD's detector labels (`animal`/`person`/`vehicle` + implicit `blank`) into Biowatch's species-centric data model with **zero changes** to the observation/annotation/export pipelines — by treating the three labels as pseudo-species.
4. Suppress UI affordances that only make sense for true species classifiers (the "View species" panel) via an opt-out flag, not a special-case in every consumer.

## Non-goals

- No conda env bump. MD reuses `common/0.1.4` — `ultralytics` and `torch` are already pinned for DeepFaune/Manas.
- No detector-weight sharing across models. MegaDetector ships its own tarball; the copy bundled inside DeepFaune/Manas is untouched. The marginal ~110 MB is acceptable in exchange for the model-isolation property the codebase keeps today.
- No "MD-then-classifier" workflow primitive. MD is a standalone model; chaining is out of scope.
- No MDv5a packaging. Only MDv6 (YOLOv10x) ships. If a user needs v5 for reproducibility, that becomes a separate model entry later.
- No automated reclassification of existing observations.

## Source-of-truth artifact

Upstream weights: `https://github.com/agentmorris/MegaDetector/releases/download/v6.0/MDV6-yolov10x.pt`.

We rehost this single file on `huggingface.co/earthtoolsmaker/megadetector` (repo already created by the maintainer), as a tarball `6.0.tar.gz` containing a top-level `6.0/` directory with `MDV6-yolov10x.pt` inside it. This matches the layout convention of the other three model tarballs and gives us a stable, offline-deterministic download URL.

Re-hosting is permitted: MegaDetector is MIT-licensed.

## Tarball layout

```
6.0/
  MDV6-yolov10x.pt
```

Top-level directory name (`6.0/`) matches the model version. No `README.md` shipped (consistent with how `build-speciesnet-tarball.py` strips Kaggle's README).

## Output schema

The MD server emits one prediction object per image, matching the shape `inference-consumer.js` and `prediction.js` already consume:

```json
{
  "filepath": "/path/to/image.jpg",
  "detections": [
    { "label": "animal", "conf": 0.94, "xywhn": [0.5, 0.6, 0.3, 0.4], "xyxy": [...] }
  ],
  "classifications": {},
  "prediction": "animal",
  "prediction_score": 0.94,
  "model_version": "6.0"
}
```

- `prediction` is the label of the highest-confidence detection that passes `detectionConfidenceThreshold` (0.2 — MD's official default for v6). When no detection passes the threshold, `prediction` is `"blank"` and `prediction_score` is `null`. This mirrors how `run_deepfaune_server.py` emits `"blank"` when there are no detections.
- `classifications` is always an empty object — there is no classifier. Existing consumers already tolerate empty classifications (DeepFaune emits `{}` for blank frames).
- `detections[].xywhn` is the same center-format normalized bbox as DeepFaune/Manas, so the existing `xywhn` branch in `src/main/utils/bbox.js` handles it unchanged.

## Pseudo-species mapping

The three MD labels are stored as if they were species:

| `prediction` field | Treated as scientific name | Common name |
|---|---|---|
| `animal` | `animal` | `Animal` |
| `person` | `person` | `Person` |
| `vehicle` | `vehicle` | `Vehicle` |
| `blank` | `blank` | (existing blank handling) |

A new common-names source file resolves these:

`src/shared/commonNames/sources/megadetector.json`:

```json
{
  "modelId": "megadetector",
  "modelVersion": "6.0",
  "source": "MegaDetector v6 categories (animal / person / vehicle)",
  "entries": [
    { "scientific": "animal",  "common": "Animal" },
    { "scientific": "person",  "common": "Person" },
    { "scientific": "vehicle", "common": "Vehicle" }
  ]
}
```

User-facing consequence: in the Media tab the user filters `species = animal`, finds the non-blank frames, opens each one, and assigns the real species via the existing annotation UI. The MD prediction stays as the model's raw output in `model_outputs`; the user's annotation lives on the observation, same as any model.

## Code changes

### `python-environments/common/run_megadetector_server.py` (NEW)

Structurally a stripped DeepFaune runner. CLI flags: `--filepath-detector-weights` and `--detection-confidence-threshold` (default 0.2). Reuses `VideoCapableLitAPI`, `safe_imread`, `to_detection_record`, and `propagate_extra_fields` from `utils.py` / `detection_utils.py`. **Does not** reuse `select_best_animal_detection`: that helper filters specifically for the `animal` class, but MD needs the best detection across all three classes (`animal`, `person`, `vehicle`). The server selects the top-confidence detection inline. No classifier import, no classifier load, no classifier inference.

The `predict()` path:

1. Run YOLO detector on the image.
2. Read class labels from the YOLO model's `names` attribute (same pattern as `run_deepfaune_server.py` line 440 — `class_names = detections.names`). For MDv6 these are `{0: "animal", 1: "person", 2: "vehicle"}`, but reading from the model rather than hard-coding the mapping insulates us if upstream ever renumbers.
3. Build `detection_records` from the YOLO output.
4. Pick the highest-confidence detection whose `conf >= --detection-confidence-threshold` — `prediction` becomes that detection's `label`, `prediction_score` becomes its `conf`. Default to `prediction: "blank"`, `prediction_score: null` when no detection passes.
5. Yield the dict shape shown in "Output schema" above.

**Why the threshold appears in two places.** `mlmodels.js` carries `detectionConfidenceThreshold: 0.2` as it does for every other model — `inference-consumer.js` reads it from there (`this.model.detectionConfidenceThreshold` at server.ts/inference-consumer.js:154) to filter which detections become observations. The Python server *also* needs the threshold, because for MD the `prediction` field is itself derived from "is there a detection above threshold?" — there's no classifier to fall back on as a separate signal of "blank vs. not". The two values must agree; both are 0.2 for MD. `server.ts` passes the JS-side value through to the Python script via the CLI flag, so they stay in sync.

### `src/main/services/ml/server.ts`

Add `startMegaDetectorHTTPServer()` modeled on `startDeepFauneHTTPServer()`:

```ts
interface MegaDetectorServerOptions {
  port: number
  detectorWeightsFilepath: string
  detectionConfidenceThreshold: number
  timeout: number
  pythonEnvironment: { reference: { id: string; version: string } }
}

export async function startMegaDetectorHTTPServer({
  port,
  detectorWeightsFilepath,
  detectionConfidenceThreshold,
  timeout,
  pythonEnvironment
}: MegaDetectorServerOptions): Promise<{ process: ChildProcess; shutdownApiKey: string }> {
  // mirrors startDeepFauneHTTPServer; script path → run_megadetector_server.py
}
```

Add a new `case 'megadetector'` in the `switch` inside `startMLModelHTTPServer()`:

```ts
case 'megadetector': {
  const port = await resolveServerPort(is.dev ? 8003 : null)
  const localInstallPath = getMLModelLocalInstallPath({ ...modelReference })
  const detectorWeightsFilepath = join(localInstallPath, 'MDV6-yolov10x.pt')
  const model = findModel({ ...modelReference })
  const { process: pythonProcess, shutdownApiKey } = await startMegaDetectorHTTPServer({
    port,
    detectorWeightsFilepath,
    detectionConfidenceThreshold: model.detectionConfidenceThreshold,
    timeout: 30,
    pythonEnvironment
  })
  registerActiveServer({ pid: pythonProcess.pid, port, shutdownApiKey, modelId: modelReference.id })
  return { port, process: pythonProcess, shutdownApiKey }
}
```

Dev port `8003` extends the existing fixed-port sequence (`8000` SpeciesNet, `8001` DeepFaune, `8002` Manas).

### `src/shared/mlmodels.js`

Add a fourth entry to `modelZoo`:

```js
{
  reference: { id: 'megadetector', version: '6.0' },
  pythonEnvironment: { id: 'common', version: '0.1.4' },
  name: 'MegaDetector',
  size_in_MB: <from build script output>,
  files: 1,
  downloadURL:
    'https://huggingface.co/earthtoolsmaker/megadetector/resolve/main/6.0.tar.gz?download=true',
  description:
    "MegaDetector is Microsoft AI for Earth's open-source detector for camera trap images. It locates animals, people, and vehicles in any image worldwide, without identifying species. Useful as a fast blank-filter before manual species annotation.",
  website: 'https://github.com/agentmorris/MegaDetector',
  logo: 'megadetector',
  detectionConfidenceThreshold: 0.2,
  region: 'worldwide',
  species_count: 3,
  detectionOnly: true
}
```

The new `detectionOnly: true` flag is the *only* place the rest of the app needs to special-case MD. No `species_data` key — `detectionOnly` short-circuits the species panel before it would try to load one.

### `src/main/utils/bbox.js`

`megadetector` joins `manas` and `deepfaune` in the existing `xywhn` case — three labels falling through to the same block:

```js
case 'manas':
case 'megadetector':
case 'deepfaune': {
  // existing xywhn → top-left conversion
}
```

`detectModelType()` already has a generic xywhn fallback, but for clarity we add an explicit branch: `if (version === '6.0' && prediction.detections?.[0]?.xywhn) return 'megadetector'`.

### `src/renderer/src/models/ModelCard.jsx`

One conditional on `model.detectionOnly`:

- Replace the `v{version} · {size} · {species_count} species` line with `v{version} · {size} · Detection only · 3 categories`.
- Skip the `▸ View {species_count} species` toggle and the `<SpeciesPanel>` mount.

### `src/renderer/src/models/ModelSelect.jsx`

Same conditional in the rich-card dropdown rows — show "Detection only" instead of the species count.

### `src/renderer/src/models/SpeciesPanel.jsx`

No changes. `detectionOnly: true` means the panel is never mounted for MD.

### Logo asset

Add `src/renderer/src/assets/logos/megadetector.png` (maintainer provides). The existing logo resolution code is data-driven on the `logo` field — no code change needed beyond placing the file.

## Build script

`scripts/build-megadetector-tarball.py` — same shape as `build-speciesnet-tarball.py`, using only the Python standard library:

1. Download `MDV6-yolov10x.pt` from `https://github.com/agentmorris/MegaDetector/releases/download/v6.0/MDV6-yolov10x.pt`.
2. Verify SHA256 against the hash of the copy already shipped in the DeepFaune tarball (locked at build time after first run — encoded as a constant in the script the same way `MEGADETECTOR_SHA256` is in `build-speciesnet-tarball.py`).
3. Place the weights at `6.0/MDV6-yolov10x.pt`.
4. `tar -czf dist/6.0.tar.gz 6.0/`.
5. Print final size + SHA256 + file list for the `mlmodels.js` update.

The upload step (`huggingface-cli upload …` to `earthtoolsmaker/megadetector`) stays manual — credentials are user-scoped. Maintainer (Arthur) uploads.

## Verification

1. **Build script self-check**: tarball contains exactly one file at `6.0/MDV6-yolov10x.pt`; SHA256 of inner file matches the hash also shipped in the DeepFaune tarball.
2. **`npm test`**: covers `mlmodels.test.js` (new entry valid), `bbox.test.js` (new megadetector case routes to xywhn), `downloadState.test.js`, common-names resolver tests (megadetector source loads).
3. **`cd python-environments/common && make lint && make format && make test`**: includes a new `tests/test_megadetector_server.py`. Test cases:
   - Start the server with the bundled weights.
   - POST a known-animal image → `prediction == "animal"`, `prediction_score > 0.2`, at least one detection with `label == "animal"`.
   - POST a known-blank image → `prediction == "blank"`, `prediction_score is None`, `detections == []` (or all below threshold).
4. **Manual smoke test**: fresh install → download MegaDetector (model card shows "Detection only · 3 categories", no "View species" link) → import ~20 mixed images (animals + people + a vehicle + blanks) → Sources tab shows correct counts per pseudo-species → open one `animal` frame → re-annotate it with a real species via the existing annotation UI → confirm the user's annotation persists and the original MD prediction is preserved in `model_outputs`.
5. **Multi-model regression check**: with MegaDetector installed alongside SpeciesNet, kick off an import using SpeciesNet, then a second import using MegaDetector. Confirm both servers can coexist (different ports) and predictions land under the correct topic in the queue.

## Release notes

User-facing changelog should call out:

1. **New model: MegaDetector v6.** Worldwide animal/person/vehicle detector. Useful as a fast blank-filter before manual species annotation.
2. MegaDetector does not identify species — it only detects whether a frame contains an animal, a person, or a vehicle. Use it to triage large folders, then annotate species manually inside Biowatch.
3. ~110 MB download. Reuses the existing `common` Python environment, so no extra environment install if you already have SpeciesNet/DeepFaune/Manas.

## Documentation updates

- `docs/http-servers.md` — add MegaDetector to the "Supported Models" table (Focus: "Blank filter / worldwide detection"; Species Coverage: "3 categories (animal, person, vehicle)"). Add `run_megadetector_server.py` to the project-structure listing.
- `docs/specs/2026-05-16-megadetector-model-choice-design.md` — this document (checked in).

## Open dependencies on the user

1. Run `python scripts/build-megadetector-tarball.py` once it lands.
2. Upload the resulting `6.0.tar.gz` to `huggingface.co/earthtoolsmaker/megadetector/main`.
3. Provide the final tarball size in MB for `size_in_MB` in `mlmodels.js`.
4. Provide a `megadetector.png` logo for `src/renderer/src/assets/logos/`.
