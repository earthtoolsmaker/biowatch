# SpeciesNet 4.0.1a → 4.0.2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SpeciesNet 4.0.1a entry in the model zoo with 4.0.2a, regenerate the common-names snapshot from the new labels file, and bump version strings in supporting code and docs.

**Architecture:** The tarball is already produced (`dist/4.0.2a.tar.gz`) and uploaded to `huggingface.co/earthtoolsmaker/speciesnet`. The implementation is a sequence of mechanical edits + one new extraction script (`scripts/extract-speciesnet-labels.py`) modeled on the existing `extract-deepfaune-labels.py`. Existing observations tagged `4.0.1a` keep working — only the active model in the picker changes.

**Tech Stack:** Node.js (model zoo + commonNames pipeline), Python 3.12 + stdlib (extraction script), Electron + React (renderer), ruff (Python lint/format), node:test (JS test runner).

**Reference spec:** [`docs/specs/2026-05-15-speciesnet-4.0.2a-update-design.md`](../specs/2026-05-15-speciesnet-4.0.2a-update-design.md).

**Testing approach:** The new extraction script is regression-tested by running it against the existing 4.0.1a labels file and diffing its output against the committed `speciesnet.json` — they must be identical (modulo expected source-string difference). Everything else is verified via the existing `npm test` suite (database/queue/validator tests reference `4.0.1a` as legacy fixture data, which should still pass) and a manual smoke test in the dev app.

---

## Files

| Action | File | Responsibility |
|---|---|---|
| Create | `scripts/extract-speciesnet-labels.py` | Convert `labels.txt` → `commonNames/sources/speciesnet.json` snapshot |
| Modify | `src/shared/commonNames/sources/speciesnet.json` | Regenerated snapshot for 4.0.2a |
| Modify | `src/shared/commonNames/dictionary.json` | Rebuilt from updated sources |
| Modify | `src/shared/mlmodels.js` | Bump SpeciesNet entry: version, downloadURL, size_in_MB |
| Modify | `python-environments/common/run_speciesnet_server.py` | Docstring example bump (line 28) |
| Modify | `src/main/database/models.js` | 3 inline comments: bump example version strings |
| Modify | `src/main/services/queue.js` | jsdoc example bump |
| Modify | `src/main/services/queue-scheduler.js` | jsdoc example bump |
| Modify | `src/main/services/server-manager.js` | jsdoc example bump |
| Modify | `src/main/services/inference-consumer.js` | jsdoc example bump |
| Modify | `src/main/services/import/importer.js` | comment block bump |
| Modify | `src/renderer/src/AddSourceModal.jsx` | state init comment bump |
| Modify | `python-environments/common/scripts/download_model.py` | Test-fixture download URL: `4.0.1a.tar.gz` → `4.0.2a.tar.gz` |
| Modify | `python-environments/common/Makefile` | `SPECIESNET_MODEL_PATH` test fixture: `…/4.0.1a` → `…/4.0.2a` |
| Modify | `docs/http-servers.md` | SpeciesNet config example (lines 287, 292, 608) |
| Modify | `CHANGELOG.md` | Release-note entry |

**Out of scope for this plan:** Test fixtures in `test/main/...` keep their `'4.0.1a'` literals — they represent legacy records and exercise generic version-string handling. The conda env and the `speciesnet` PyPI package version are NOT bumped (see spec non-goals).

---

## Task 1: Extraction script with regression check against 4.0.1a

**Files:**
- Create: `scripts/extract-speciesnet-labels.py`
- Reference: `python-environments/common/scripts/` (no — actually `scripts/extract-deepfaune-labels.py` is the style template)

- [ ] **Step 1: Ensure the 4.0.1a labels file is locally available**

If `dist/4.0.1a-extract/` doesn't exist, fetch and extract the HF tarball into a scratch dir:

```sh
mkdir -p /tmp/speciesnet-401 && \
  curl -sL "https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.1a.tar.gz?download=true" \
    | tar xz -C /tmp/speciesnet-401
ls /tmp/speciesnet-401/4.0.1a/
# expect to see: always_crop_*.labels.txt, taxonomy_release.txt, geofence_release.*.json, etc.
```

- [ ] **Step 2: Create the extraction script**

Write `scripts/extract-speciesnet-labels.py`:

```python
#!/usr/bin/env python3
"""Extract SpeciesNet common-name snapshot from a labels.txt file.

The labels.txt format (one row per UUID):
    uuid;class;order;family;genus;species;commonName

Outputs JSON in the shape consumed by scripts/lib/aliases.js:
    {
      "modelId": "speciesnet",
      "modelVersion": "<X.Y.Za>",
      "source": "<descriptive source string>",
      "entries": [
        # binomial entries (genus and species both filled):
        {"scientificName": "<genus> <species>", "label": null, "commonName": "..."},
        # higher-rank entries (no genus or no species):
        {"scientificName": null, "label": "<commonName verbatim>", "commonName": "..."},
        ...
      ]
    }

Usage:
    python3 scripts/extract-speciesnet-labels.py \\
        --labels-file /tmp/speciesnet-401/4.0.1a/always_crop_99710272_22x8_v12_epoch_00148.labels.txt \\
        --version 4.0.1a \\
        --source-name 4.0.1a/always_crop_99710272_22x8_v12_epoch_00148.labels.txt \\
        --output src/shared/commonNames/sources/speciesnet.json
"""

import argparse
import json
from pathlib import Path


def parse_labels(labels_file: Path) -> list[dict]:
    entries = []
    for line in labels_file.read_text().splitlines():
        if not line:
            continue
        parts = line.split(";")
        if len(parts) != 7:
            continue
        _uuid, _cls, _order, _family, genus, species, common_name = parts
        if not common_name:
            continue
        if genus and species:
            entries.append(
                {
                    "scientificName": f"{genus} {species}",
                    "label": None,
                    "commonName": common_name,
                }
            )
        else:
            entries.append(
                {
                    "scientificName": None,
                    "label": common_name,
                    "commonName": common_name,
                }
            )
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels-file", required=True, type=Path)
    parser.add_argument("--version", required=True, help="SpeciesNet version, e.g. 4.0.2a")
    parser.add_argument(
        "--source-name",
        required=True,
        help="Descriptive source string written into the snapshot, e.g. '4.0.2a/<labels-filename>'",
    )
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    entries = parse_labels(args.labels_file)
    snapshot = {
        "modelId": "speciesnet",
        "modelVersion": args.version,
        "source": f"{args.source_name} (earthtoolsmaker/speciesnet HF repo)",
        "entries": entries,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"Wrote {len(entries)} entries to {args.output}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Make it executable and run ruff format/lint**

```sh
chmod +x scripts/extract-speciesnet-labels.py
cd python-environments/common && \
  uv run ruff format ../../scripts/extract-speciesnet-labels.py && \
  uv run ruff check ../../scripts/extract-speciesnet-labels.py
```

Expected: `All checks passed!` and `1 file already formatted` (or `1 file reformatted`).

- [ ] **Step 4: Regression check — regenerate the 4.0.1a snapshot and diff against committed file**

```sh
cd /mnt/data/ssd_1/earthtoolsmaker/projects/biowatch
python3 scripts/extract-speciesnet-labels.py \
  --labels-file /tmp/speciesnet-401/4.0.1a/always_crop_99710272_22x8_v12_epoch_00148.labels.txt \
  --version 4.0.1a \
  --source-name 4.0.1a/always_crop_99710272_22x8_v12_epoch_00148.labels.txt \
  --output /tmp/regen-401.json
diff /tmp/regen-401.json src/shared/commonNames/sources/speciesnet.json | head -20
```

Expected: **empty diff** (the script reproduces the committed snapshot byte-for-byte). If the diff is non-empty:
- Inspect head/tail of both files; check for trailing newline, indent, or ordering differences.
- If only the `source` field differs (because the existing snapshot may have a slightly different source string), update `--source-name` to match exactly.
- Fix the script until the diff is empty before moving on. **Do not proceed otherwise.**

- [ ] **Step 5: Commit the script**

```sh
git add scripts/extract-speciesnet-labels.py
git commit -m "tools(speciesnet): script to regenerate commonNames snapshot from labels.txt"
```

---

## Task 2: Regenerate speciesnet.json for 4.0.2a

**Files:**
- Modify: `src/shared/commonNames/sources/speciesnet.json`

- [ ] **Step 1: Extract 4.0.2a tarball locally**

```sh
mkdir -p /tmp/speciesnet-402 && \
  curl -sL "https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.2a.tar.gz?download=true" \
    | tar xz -C /tmp/speciesnet-402
ls /tmp/speciesnet-402/4.0.2a/
# expect: always_crop_*.labels.20251208.txt, taxonomy_release.20251208.txt, geofence_release.20251208.json, ...
```

- [ ] **Step 2: Run the extraction script for 4.0.2a**

```sh
cd /mnt/data/ssd_1/earthtoolsmaker/projects/biowatch
python3 scripts/extract-speciesnet-labels.py \
  --labels-file /tmp/speciesnet-402/4.0.2a/always_crop_99710272_22x8_v12_epoch_00148.labels.20251208.txt \
  --version 4.0.2a \
  --source-name 4.0.2a/always_crop_99710272_22x8_v12_epoch_00148.labels.20251208.txt \
  --output /tmp/new-speciesnet.json
```

Expected stdout: `Wrote 2493 entries to /tmp/new-speciesnet.json`

- [ ] **Step 3: Inspect the delta**

```sh
python3 - <<'PY'
import json
old = json.load(open("src/shared/commonNames/sources/speciesnet.json"))
new = json.load(open("/tmp/new-speciesnet.json"))

def key(e):
    return (e.get("scientificName"), e.get("label"), e.get("commonName"))

old_keys = {key(e) for e in old["entries"]}
new_keys = {key(e) for e in new["entries"]}
added = new_keys - old_keys
removed = old_keys - new_keys

print(f"old={len(old_keys)} new={len(new_keys)} added={len(added)} removed={len(removed)}")
print("added:")
for k in sorted(added, key=lambda x: tuple(s or '' for s in x)):
    print(" ", k)
print("removed:")
for k in sorted(removed, key=lambda x: tuple(s or '' for s in x)):
    print(" ", k)
PY
```

Expected delta (3 added, 5 removed):

```
added:
  ('actinemys marmorata', None, 'western pond turtle')
  (None, 'artiodactyla order', 'artiodactyla order')
  (None, 'procyonidae family', 'procyonidae family')
removed:
  ('emys marmorata', None, 'western pond turtle')        # taxonomic rename
  (None, 'cetartiodactyla order', 'cetartiodactyla order') # split back to artiodactyla
  (None, 'coati family', 'coati family')                  # renamed to procyonidae
  (None, 'even-toed ungulate', 'even-toed ungulate')      # cetartiodactyla synonym
  # 'copsychus malabaricus' is filtered both runs (empty commonName); not in delta
```

If the delta doesn't match, stop and investigate — something is off in either the extraction or the source data.

- [ ] **Step 4: Replace committed snapshot**

```sh
mv /tmp/new-speciesnet.json src/shared/commonNames/sources/speciesnet.json
```

- [ ] **Step 5: Sanity check the new file's header**

```sh
head -4 src/shared/commonNames/sources/speciesnet.json
```

Expected:

```json
{
  "modelId": "speciesnet",
  "modelVersion": "4.0.2a",
  "source": "4.0.2a/always_crop_99710272_22x8_v12_epoch_00148.labels.20251208.txt (earthtoolsmaker/speciesnet HF repo)",
```

- [ ] **Step 6: Commit**

```sh
git add src/shared/commonNames/sources/speciesnet.json
git commit -m "feat(commonNames): regenerate SpeciesNet snapshot for 4.0.2a"
```

---

## Task 3: Rebuild common-names dictionary

**Files:**
- Modify: `src/shared/commonNames/dictionary.json`

- [ ] **Step 1: Run the dictionary builder**

```sh
cd /mnt/data/ssd_1/earthtoolsmaker/projects/biowatch
node scripts/build-common-names-dict.js
```

Expected: writes `src/shared/commonNames/dictionary.json`. Print output may report counts per source.

- [ ] **Step 2: Inspect the diff**

```sh
git diff --stat src/shared/commonNames/dictionary.json
git diff src/shared/commonNames/dictionary.json | head -40
```

Expected: small focused diff reflecting the entries that changed in Task 2 — `cetartiodactyla order` → `artiodactyla order`, `coati family` → `procyonidae family`, `emys marmorata` → `actinemys marmorata`. Big unrelated changes mean something is off — investigate before committing.

- [ ] **Step 3: Run the existing commonNames resolver tests**

```sh
npm test -- test/shared/commonNames/
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```sh
git add src/shared/commonNames/dictionary.json
git commit -m "chore(commonNames): rebuild dictionary after SpeciesNet 4.0.2a snapshot"
```

---

## Task 4: Bump mlmodels.js

**Files:**
- Modify: `src/shared/mlmodels.js:159-174`

- [ ] **Step 1: Edit the SpeciesNet model entry**

In `src/shared/mlmodels.js`, replace:

```js
    reference: { id: 'speciesnet', version: '4.0.1a' },
    pythonEnvironment: { id: 'common', version: '0.1.4' },
    name: 'SpeciesNet',
    size_in_MB: 468,
    files: 6,
    downloadURL:
      'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.1a.tar.gz?download=true',
```

with:

```js
    reference: { id: 'speciesnet', version: '4.0.2a' },
    pythonEnvironment: { id: 'common', version: '0.1.4' },
    name: 'SpeciesNet',
    size_in_MB: 468,
    files: 6,
    downloadURL:
      'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.2a.tar.gz?download=true',
```

Note: `size_in_MB: 468` is unchanged — HF reports 468,273,572 bytes (≈468 MB). The verified SHA256 on HF is `4d2841760f018fe82a18211894cb99cae77983fa914db656b98b19cb35da5040` (informational; not stored in the manifest).

- [ ] **Step 2: Run the mlmodels test**

```sh
npm test -- test/shared/mlmodels.test.js
```

Expected: all tests pass. If any test asserts version `'4.0.1a'` literally, that test is asserting a legacy version is registered — but since we're removing 4.0.1a entirely (hard cutover per spec), update the assertion to `'4.0.2a'`.

- [ ] **Step 3: Run the download-state test (downloadState reads from mlmodels)**

```sh
npm test -- test/shared/downloadState.test.js
```

Expected: pass. Same note as above for legacy literals.

- [ ] **Step 4: Commit**

```sh
git add src/shared/mlmodels.js test/shared/
git commit -m "feat(mlmodels): bump SpeciesNet to 4.0.2a"
```

---

## Task 5: Bump run_speciesnet_server.py docstring example

**Files:**
- Modify: `python-environments/common/run_speciesnet_server.py:28`

- [ ] **Step 1: Edit the docstring example**

In `python-environments/common/run_speciesnet_server.py`, replace:

```
  --model "v4.0.1a/"
```

with:

```
  --model "v4.0.2a/"
```

- [ ] **Step 2: Run lint + format check**

```sh
cd python-environments/common && make lint && make format-check
```

Expected: `All checks passed!` and `<N> files already formatted`.

- [ ] **Step 3: Commit**

```sh
git add python-environments/common/run_speciesnet_server.py
git commit -m "docs(speciesnet-server): bump docstring example to v4.0.2a"
```

---

## Task 6: Bump cosmetic version strings in source comments/jsdoc

**Files (8 spots):**
- Modify: `src/main/database/models.js:9` `:88` `:145`
- Modify: `src/main/services/queue.js:18`
- Modify: `src/main/services/queue-scheduler.js:28`
- Modify: `src/main/services/server-manager.js:19`
- Modify: `src/main/services/inference-consumer.js:28`
- Modify: `src/main/services/import/importer.js:121`
- Modify: `src/renderer/src/AddSourceModal.jsx:29`

- [ ] **Step 1: Edit `src/main/database/models.js`**

Replace:

```js
    topic: text('topic'), // Sub-grouping: 'speciesnet:4.0.1a', 'deepfaune:1.2', etc.
```

with:

```js
    topic: text('topic'), // Sub-grouping: 'speciesnet:4.0.2a', 'deepfaune:1.2', etc.
```

Replace:

```js
    modelVersion: text('modelVersion').notNull(), // '4.0.1a', '1.3'
```

with:

```js
    modelVersion: text('modelVersion').notNull(), // '4.0.2a', '1.3'
```

Replace:

```js
    classifiedBy: text('classifiedBy'), // 'SpeciesNet 4.0.1a' or 'John Doe'
```

with:

```js
    classifiedBy: text('classifiedBy'), // 'SpeciesNet 4.0.2a' or 'John Doe'
```

- [ ] **Step 2: Edit `src/main/services/queue.js`**

Replace:

```js
 * @param {string} [opts.topic] - Sub-grouping ('speciesnet:4.0.1a', etc.)
```

with:

```js
 * @param {string} [opts.topic] - Sub-grouping ('speciesnet:4.0.2a', etc.)
```

- [ ] **Step 3: Edit `src/main/services/queue-scheduler.js`**

Replace:

```js
   * @param {string} opts.topic - e.g. 'speciesnet:4.0.1a'
```

with:

```js
   * @param {string} opts.topic - e.g. 'speciesnet:4.0.2a'
```

- [ ] **Step 4: Edit `src/main/services/server-manager.js`**

Replace:

```js
   * @param {string} topic - e.g. 'speciesnet:4.0.1a'
```

with:

```js
   * @param {string} topic - e.g. 'speciesnet:4.0.2a'
```

- [ ] **Step 5: Edit `src/main/services/inference-consumer.js`**

Replace:

```js
   * @param {string} opts.topic - e.g. 'speciesnet:4.0.1a'
```

with:

```js
   * @param {string} opts.topic - e.g. 'speciesnet:4.0.2a'
```

- [ ] **Step 6: Edit `src/main/services/import/importer.js`**

Replace:

```js
//   model_version: '4.0.1a'
```

with:

```js
//   model_version: '4.0.2a'
```

- [ ] **Step 7: Edit `src/renderer/src/AddSourceModal.jsx`**

Replace:

```jsx
  const [pickedModelKey, setPickedModelKey] = useState('') // 'speciesnet-4.0.1a'
```

with:

```jsx
  const [pickedModelKey, setPickedModelKey] = useState('') // 'speciesnet-4.0.2a'
```

- [ ] **Step 8: Verify nothing broke with the existing test suite**

```sh
npm test
```

Expected: all tests pass. (Test fixtures still use `'4.0.1a'` literals, which is intentional — they exercise legacy version-string handling.)

- [ ] **Step 9: Commit**

```sh
git add src/main/database/models.js \
        src/main/services/queue.js \
        src/main/services/queue-scheduler.js \
        src/main/services/server-manager.js \
        src/main/services/inference-consumer.js \
        src/main/services/import/importer.js \
        src/renderer/src/AddSourceModal.jsx
git commit -m "chore(speciesnet): bump example version strings in comments to 4.0.2a"
```

---

## Task 7: Update docs/http-servers.md SpeciesNet config example

**Files:**
- Modify: `docs/http-servers.md:287, 292, 608`

- [ ] **Step 1: Edit lines 287 and 292 (Example: SpeciesNet Configuration)**

Replace:

```js
{
  reference: { id: 'speciesnet', version: '4.0.1a' },
```

with:

```js
{
  reference: { id: 'speciesnet', version: '4.0.2a' },
```

Replace:

```
  downloadURL: 'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.1a.tar.gz?download=true',
```

with:

```
  downloadURL: 'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.2a.tar.gz?download=true',
```

- [ ] **Step 2: Edit line 608 (server `/info` response example)**

Replace:

```json
    "version": "4.0.1a"
```

with:

```json
    "version": "4.0.2a"
```

- [ ] **Step 3: Confirm there are no more references**

```sh
grep -n "4\.0\.1a" docs/http-servers.md
```

Expected: empty output. Other docs (`docs/database-schema.md`, `docs/data-formats.md`) keep their `4.0.1a` references — those are generic schema/format examples where the version is illustrative.

- [ ] **Step 4: Commit**

```sh
git add docs/http-servers.md
git commit -m "docs(http-servers): bump SpeciesNet example to 4.0.2a"
```

---

## Task 8: Bump Python test fixture model paths

**Files:**
- Modify: `python-environments/common/scripts/download_model.py:19`
- Modify: `python-environments/common/Makefile:25` (the `export SPECIESNET_MODEL_PATH=…` line)

The Python e2e tests download the SpeciesNet tarball from HF and untar it; the Makefile then points `SPECIESNET_MODEL_PATH` at the resulting directory. Both must move from `4.0.1a` to `4.0.2a` together — otherwise `make test` downloads the new tarball but points at the wrong path (or vice-versa).

- [ ] **Step 1: Edit `download_model.py`**

In `python-environments/common/scripts/download_model.py`, replace:

```python
    "speciesnet": {
        "repo_id": "earthtoolsmaker/speciesnet",
        "filename": "4.0.1a.tar.gz",
    },
```

with:

```python
    "speciesnet": {
        "repo_id": "earthtoolsmaker/speciesnet",
        "filename": "4.0.2a.tar.gz",
    },
```

- [ ] **Step 2: Edit the Makefile**

In `python-environments/common/Makefile`, replace:

```make
export SPECIESNET_MODEL_PATH=/tmp/models/speciesnet/4.0.1a
```

with:

```make
export SPECIESNET_MODEL_PATH=/tmp/models/speciesnet/4.0.2a
```

- [ ] **Step 3: Lint + format check**

```sh
cd python-environments/common && make lint && make format-check
```

Expected: `All checks passed!` and `<N> files already formatted`.

- [ ] **Step 4: Commit**

```sh
git add python-environments/common/scripts/download_model.py python-environments/common/Makefile
git commit -m "chore(python-env): point SpeciesNet test fixtures at 4.0.2a"
```

---

## Task 9: Add CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Read the existing CHANGELOG top section**

```sh
head -15 CHANGELOG.md
```

Note the current most-recent version (e.g. `[1.9.1] - 2026-05-14`). The new entry goes ABOVE it, either under `[Unreleased]` (create that section if not present) or under the next version about to ship.

- [ ] **Step 2: Add an entry**

If an `## [Unreleased]` section exists, append under its `### Changed` subsection. Otherwise, insert a new section directly under the file's preamble:

```markdown
## [Unreleased]

### Changed

- **SpeciesNet upgraded to 4.0.2a**. Same classifier weights as 4.0.1a — only geofencing rules and taxonomy were updated upstream (e.g. `cetartiodactyla` → `artiodactyla`, `coati family` → `procyonidae family`, `emys marmorata` → `actinemys marmorata`). New imports use 4.0.2a; existing 4.0.1a predictions remain tagged historically and continue to display correctly.

### Notes

- If you continue importing media into an existing 4.0.1a study, new predictions are tagged `4.0.2a`. Geofence verdicts may differ between rows in the same study (e.g. bears in the UK are now blocked) — this is expected upstream behavior.
```

- [ ] **Step 3: Commit**

```sh
git add CHANGELOG.md
git commit -m "docs(changelog): note SpeciesNet 4.0.2a upgrade"
```

---

## Task 10: Verification

**No code changes — verification only.**

- [ ] **Step 1: Run the full JS test suite**

```sh
npm test
```

Expected: all tests pass. Pay attention to:
- `test/shared/mlmodels.test.js` — model zoo registration
- `test/shared/commonNames/resolver.test.js` — name resolution
- `test/shared/downloadState.test.js` — download progress accounting
- `test/main/database/validators/model-output.test.js` — validates SpeciesNet output shape

Any failure here likely means a fixture references a removed model entry. If a test specifically targets the `'4.0.1a'` registered model, update it to `'4.0.2a'`. If it tests generic version-string handling using `'4.0.1a'` as historical data, keep it as-is.

- [ ] **Step 2: Run the Python e2e tests**

The Makefile (now bumped in Task 8) downloads the SpeciesNet tarball from HF, extracts it to `/tmp/models/speciesnet/4.0.2a`, and runs the LitServe-backed e2e suite against the new model.

```sh
cd python-environments/common && make test
```

Expected: all tests pass. If a stale 4.0.1a directory exists at `/tmp/models/speciesnet/4.0.1a`, leaving it in place is harmless — the tests only read from the 4.0.2a path now.

- [ ] **Step 3: Manual smoke test in the dev app**

```sh
npm run dev
```

In the running app:

1. (Fresh-install scenario) Open **Models** tab → SpeciesNet card should show version **4.0.2a**. Click Download → succeeds, lands on disk.
2. (New study) Create a new study, add an Images source, pick SpeciesNet 4.0.2a as the model, point at a small folder (~10 known-species images).
3. Wait for import + classification to finish.
4. Open the new study's Observations tab → confirm `model_version` field shows `4.0.2a` in any debug pane / DB tooling; common names render (e.g. `cephalophus harveyi` → "harvey's duiker"); bounding boxes draw correctly.
5. Export the study to CSV → confirm classifications export with `classifiedBy: 'SpeciesNet 4.0.2a'`.

- [ ] **Step 4: Old-study regression check (optional but recommended)**

If you have an existing study in your local install that was classified with 4.0.1a:

1. Open it. Confirm observations display, common names render, bounding boxes are correct, exports work.
2. (Optional) Import additional media into it. Confirm new predictions tag `4.0.2a` and coexist with the legacy `4.0.1a` rows.

---

## Task 11: Final review

- [ ] **Step 1: Confirm branch is ready**

```sh
git log --oneline main..HEAD
```

Expected commits (approximate, in order):

```
docs(changelog): note SpeciesNet 4.0.2a upgrade
chore(python-env): point SpeciesNet test fixtures at 4.0.2a
docs(http-servers): bump SpeciesNet example to 4.0.2a
chore(speciesnet): bump example version strings in comments to 4.0.2a
docs(speciesnet-server): bump docstring example to v4.0.2a
feat(mlmodels): bump SpeciesNet to 4.0.2a
chore(commonNames): rebuild dictionary after SpeciesNet 4.0.2a snapshot
feat(commonNames): regenerate SpeciesNet snapshot for 4.0.2a
tools(speciesnet): script to regenerate commonNames snapshot from labels.txt
tools(speciesnet): ruff lint+format, document tarball script    [already done]
tools(speciesnet): script to build model tarball for HF upload  [already done]
docs(specs): design for SpeciesNet 4.0.1a → 4.0.2a update       [already done]
```

- [ ] **Step 2: Run lint/format checks one final time**

```sh
cd python-environments/common && make lint && make format-check && cd ../..
npm run lint 2>&1 || echo "(no lint script — skip)"
```

Expected: all checks pass.

- [ ] **Step 3: Open a PR**

```sh
GH_TOKEN="" gh pr create --title "SpeciesNet 4.0.1a → 4.0.2a" --body "$(cat <<'EOF'
## Summary

- Replace SpeciesNet 4.0.1a with 4.0.2a in the model zoo (`src/shared/mlmodels.js`)
- Regenerate the common-names snapshot from the new `labels.20251208.txt` via a new `scripts/extract-speciesnet-labels.py`
- Rebuild `commonNames/dictionary.json`
- Bump example version strings in comments, jsdoc, docs, and Python docstring
- Add CHANGELOG entry

Same classifier weights — only geofence + taxonomy refresh upstream. Existing 4.0.1a observations keep working unchanged.

Tarball is already on HF: `huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.2a.tar.gz`
(SHA256 `4d2841760f018fe82a18211894cb99cae77983fa914db656b98b19cb35da5040`).

Spec: `docs/specs/2026-05-15-speciesnet-4.0.2a-update-design.md`
Plan: `docs/plans/2026-05-15-speciesnet-4.0.2a-update-plan.md`

## Test plan

- [ ] `npm test` passes
- [ ] `cd python-environments/common && SPECIESNET_MODEL_PATH=/tmp/models/speciesnet/4.0.2a make test` passes
- [ ] Manual: fresh download of SpeciesNet via Models tab returns 4.0.2a artifact
- [ ] Manual: new import classifies and tags rows with `model_version='4.0.2a'`
- [ ] Manual: existing 4.0.1a study still displays observations + common names + bboxes correctly
EOF
)"
```

---

## Out-of-band dependencies (already complete)

- ✅ Spec written and committed: `docs/specs/2026-05-15-speciesnet-4.0.2a-update-design.md`
- ✅ Packaging script written and committed: `scripts/build-speciesnet-tarball.py`
- ✅ Tarball built: `dist/4.0.2a.tar.gz` (468.3 MB, SHA256 `4d2841760f018fe82a18211894cb99cae77983fa914db656b98b19cb35da5040`)
- ✅ Tarball uploaded to HF: `https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.2a.tar.gz` (verified byte-perfect)
