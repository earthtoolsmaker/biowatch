# SpeciesNet 4.0.1a → 4.0.2a update — design

## Background

Upstream [google/cameratrapai](https://github.com/google/cameratrapai) released SpeciesNet v4.0.2a in December 2025. The release ships **identical classifier weights** to v4.0.1a (verified SHA256 match) but updates:

- The taxonomy hierarchy: `cetartiodactyla` order replaced with `artiodactyla` across the labels and taxonomy files (modern phylogenetic classification splits whales back out of the combined order).
- 7000+ diff lines across `taxonomy_release.txt` (+45 entries, 3493 → 3538).
- Geofence rules: 201 added, 218 removed, 54 modified across `geofence_release.*.json`.

The new model directory is published as `kaggle:google/speciesnet/pyTorch/v4.0.2a/1` and is the default in `speciesnet==5.0.3` (the PyPI version we already pin).

## Goals

1. Ship v4.0.2a as the only SpeciesNet model offered through the in-app model picker.
2. Keep historical observations classified by v4.0.1a fully functional in the UI (display, bounding boxes, common-name resolution).
3. Add a reproducible packaging script so future versions (4.0.3a, …) are a one-command rebuild.

## Non-goals

- No `speciesnet` PyPI bump (5.0.3 already supports v4.0.2a).
- No conda env bump (Python deps unchanged — env stays at `0.1.4`).
- No in-flight queue migration / soft fallback. User base is small; an app upgrade landing mid-import is treated as an out-of-band concern.
- No "reclassify existing media" feature.

## Source-of-truth diff (Kaggle 4.0.1a vs 4.0.2a)

| Asset | Change |
|---|---|
| Classifier weights `always_crop_*.pt` | **Identical** (SHA256 `d099632044e92a0446869e06e5eb282e24706d5266b4acf5b42f5f23e2b50ade`) |
| `labels.txt` | 650-line diff. UUIDs and common names unchanged; only the order field shifted (`cetartiodactyla` → `artiodactyla`). Renamed to `*.labels.20251208.txt`. |
| `taxonomy_release.txt` | +45 entries, ~7000 diff lines. Renamed to `taxonomy_release.20251208.txt`. |
| `geofence_release.*.json` | 201 added + 218 removed + 54 modified rules. Renamed to `geofence_release.20251208.json`. |
| `info.json` | Version string + three renamed filename fields. |
| `README.md` | Present upstream; dropped in our HF tarball. |
| `md_v5a.0.0.pt` (MegaDetector) | Not in Kaggle archive; we bundle it ourselves so the model is fully offline after first download. |

## Tarball layout

The HF tarball follows the existing `4.0.1a.tar.gz` shape: a single top-level `4.0.2a/` directory containing the six asset files. Filenames retain upstream's `20251208` date suffix.

```
4.0.2a/
  always_crop_99710272_22x8_v12_epoch_00148.labels.20251208.txt
  always_crop_99710272_22x8_v12_epoch_00148.pt
  geofence_release.20251208.json
  info.json                          ← detector URL replaced with local filename
  md_v5a.0.0.pt                      ← downloaded separately, bundled
  taxonomy_release.20251208.txt
```

`info.json` ships with the detector field rewritten to point at the bundled file:

```json
{
  "version": "4.0.2a",
  "type": "always_crop",
  "classifier": "always_crop_99710272_22x8_v12_epoch_00148.pt",
  "classifier_labels": "always_crop_99710272_22x8_v12_epoch_00148.labels.20251208.txt",
  "detector": "md_v5a.0.0.pt",
  "taxonomy": "taxonomy_release.20251208.txt",
  "geofence": "geofence_release.20251208.json"
}
```

## Packaging script

A new `scripts/build-speciesnet-tarball.py` codifies the recipe. Inputs are a Kaggle model identifier and an output directory; output is a tarball ready for HF upload.

Steps:

1. Download Kaggle archive from `https://www.kaggle.com/api/v1/models/google/speciesnet/pyTorch/v<VERSION>/1/download` (public unauthenticated endpoint — confirmed).
2. Extract into `<VERSION>/` directory.
3. Delete `<VERSION>/README.md`.
4. Download `md_v5a.0.0.pt` from `https://github.com/agentmorris/MegaDetector/releases/download/v5.0/md_v5a.0.0.pt` into the same directory.
5. Verify the MegaDetector SHA256 matches `94e88fe97c8050f2e3d0cc4cb4f64729d639d74312dcbe2f74f8eecd3b01b276` (the hash currently shipped in our 4.0.1a tarball).
6. Rewrite `info.json`'s `detector` field from URL to `"md_v5a.0.0.pt"`.
7. `tar -czf <VERSION>.tar.gz <VERSION>/`.
8. Print final size, SHA256, and file list to stdout for the manifest update.

The script uses only the Python standard library (`urllib`, `tarfile`, `hashlib`, `json`) — no new dependencies. Placed in `scripts/` next to `extract-deepfaune-labels.py`.

The upload step (`huggingface-cli upload …` to `earthtoolsmaker/speciesnet`) stays manual — credentials are user-scoped.

## Code changes

### `src/shared/mlmodels.js`

Replace the existing `speciesnet` entry:

```diff
- reference: { id: 'speciesnet', version: '4.0.1a' },
+ reference: { id: 'speciesnet', version: '4.0.2a' },
  pythonEnvironment: { id: 'common', version: '0.1.4' },
  name: 'SpeciesNet',
- size_in_MB: 468,
+ size_in_MB: <from packaging script output>,
  files: 6,
  downloadURL:
-   'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.1a.tar.gz?download=true',
+   'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.2a.tar.gz?download=true',
```

### `src/shared/commonNames/sources/speciesnet.json`

Regenerate from the new `labels.20251208.txt`. Fields:

- `modelVersion`: `'4.0.1a'` → `'4.0.2a'`
- `source`: update path string
- `entries[]`: UUIDs and common names are unchanged, so by-UUID lookups still resolve. Any entries that store the full taxonomic `label` string need their order field updated (`cetartiodactyla` → `artiodactyla`).

The build pipeline that produces this file (`scripts/build-common-names-dict.js` + `scripts/lib/aliases.js`) doesn't need code changes — it just reads from a new labels file.

### `run_speciesnet_server.py`

Doc-comment example at line 28:

```diff
- --model "v4.0.1a/"
+ --model "v4.0.2a/"
```

### Comment / jsdoc bumps

Cosmetic; references to `'speciesnet:4.0.1a'` or `'4.0.1a'` in example strings:

- `src/main/database/models.js` (3 inline comments)
- `src/main/services/queue.js` (jsdoc on `opts.topic`)
- `src/main/services/queue-scheduler.js` (jsdoc on `opts.topic`)
- `src/main/services/server-manager.js` (jsdoc on `topic`)
- `src/main/services/inference-consumer.js` (jsdoc on `opts.topic`)
- `src/main/services/import/importer.js` (example comment block)
- `src/renderer/src/AddSourceModal.jsx` (state init comment)

## Verification

1. **Tarball self-check**: after the packaging script runs, diff its output filenames against `4.0.1a.tar.gz` (minus the renamed labels/taxonomy/geofence). Same six files inside, same top-level dir wrapper.
2. **`npm test`**: covers `mlmodels.test.js`, `commonNames/resolver.test.js`, `downloadState.test.js`, and DB tests that reference the model version literal.
3. **`cd python-environments/common && make test`**: requires the new tarball to be unpacked into the local model cache. Runs the e2e SpeciesNet server tests.
4. **Manual smoke test**: fresh install → download SpeciesNet (fetches 4.0.2a) → import ~10 images of known species → verify in the DB that predictions land with `model_version='4.0.2a'`, common names resolve, and bbox rendering works.
5. **Old-study regression check**: open an existing 4.0.1a study (without re-importing). Confirm observations display, common names render, bounding boxes are correct, and exports work.

## Release notes

Call out three things in the user-facing changelog:

1. SpeciesNet model updated to v4.0.2a. Weights are unchanged from 4.0.1a; only geofencing rules and taxonomy were updated upstream.
2. Existing studies retain their `4.0.1a` predictions unchanged. New imports are classified by 4.0.2a.
3. If you import additional media into an existing 4.0.1a study, new predictions will be tagged `4.0.2a`. Geofence verdicts may differ between rows in the same study (e.g., bears in the UK are now blocked) — this is expected upstream behavior.

## Documentation updates

- `docs/http-servers.md` — bump any inline version examples to 4.0.2a.
- `docs/specs/2026-05-15-speciesnet-4.0.2a-update-design.md` — this document (checked in).

## Open dependencies on the user

1. Run `scripts/build-speciesnet-tarball.py` and upload the resulting `4.0.2a.tar.gz` to `huggingface.co/earthtoolsmaker/speciesnet/main`.
2. Provide back the final tarball size in MB for the `size_in_MB` field in `mlmodels.js`.
