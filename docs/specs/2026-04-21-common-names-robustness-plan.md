# Common-Name Resolution Robustness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Sciurus-vulgaris bug (GBIF mis-tags Spanish names as English) and stop leaving `commonName` null on ML-generated observations, by introducing a four-tier cascade: stored value → shipped dictionary → scored GBIF lookup → scientific-name fallback.

**Architecture:** Pure shared code in `src/shared/commonNames/` (dictionary + resolver + normalizer + GBIF scorer). Main-process write paths (`prediction.js`, `observations.js`) call the resolver synchronously. Renderer read path is a new `useCommonName` hook that consolidates the two existing duplicated GBIF implementations and adds a scorer that picks the real English name instead of the first mis-tagged entry.

**Tech Stack:** JavaScript (ES modules), Electron, SQLite via Drizzle ORM, React + TanStack Query, `node:test` for main-process tests, Vitest for renderer tests.

---

## File Structure

### New files

- `src/shared/commonNames/sources/speciesnet.json` — snapshot of SpeciesNet labels (scientific + common name pairs extracted from the SpeciesNet 4.0.1a tarball).
- `src/shared/commonNames/sources/deepfaune.json` — snapshot of DeepFaune labels (34 entries, extracted from `python-environments/common/run_deepfaune_server.py`).
- `src/shared/commonNames/sources/manas.json` — snapshot of Manas labels (extracted from the Manas 1.0 pickle file).
- `src/shared/commonNames/extras.json` — hand-curated overrides, seeded with `Sciurus vulgaris → Eurasian Red Squirrel`.
- `src/shared/commonNames/dictionary.json` — **generated** merged map of `{ normalizedScientificName: commonName }`.
- `src/shared/commonNames/normalize.js` — pure `normalizeScientificName(str) → string` function.
- `src/shared/commonNames/resolver.js` — pure `resolveCommonName(scientificName) → string | null`.
- `src/shared/commonNames/gbifScorer.js` — pure `pickEnglishCommonName(vernacularResults) → string | null`.
- `src/shared/commonNames/index.js` — barrel re-exporting the above.
- `scripts/build-common-names-dict.js` — reads the four JSON inputs, merges in priority order, writes `dictionary.json`.
- `scripts/extract-deepfaune-labels.py` — one-shot tool to parse `run_deepfaune_server.py` and write `sources/deepfaune.json`.
- `scripts/extract-manas-labels.py` — one-shot tool to unpickle Manas's classes file and write `sources/manas.json`.
- `scripts/extract-speciesnet-labels.py` — one-shot tool to parse SpeciesNet's taxonomy text file (extracted from the tarball) and write `sources/speciesnet.json`.
- `scripts/audit-common-names.js` — on-demand tool for designing the GBIF scorer (hits live GBIF for a curated species list, emits CSV).
- `scripts/audit-set.txt` — 200–300 species, one per line, committed so the audit is reproducible.
- `src/renderer/src/utils/commonNames.js` — `useCommonName` hook (wraps TanStack Query + in-memory GBIF Map + scorer).
- `test/shared/commonNames/normalize.test.js` — tests for `normalize.js`.
- `test/shared/commonNames/resolver.test.js` — tests for `resolver.js`.
- `test/shared/commonNames/gbifScorer.test.js` — tests for `gbifScorer.js`.
- `test/shared/commonNames/dictionary.integrity.test.js` — asserts no duplicates, no empties, canonical keys.
- `test/shared/commonNames/dictionary.coverage.test.js` — asserts every entry in each `sources/*.json` is present in `dictionary.json`.
- `test/fixtures/gbif/sciurusVulgaris.json` — captured GBIF response for the known-bad case.
- `test/renderer/utils/commonNames.test.js` — Vitest tests for `useCommonName`.
- `test/integration/commonNames/predictionWrite.test.js` — asserts `insertPrediction` now populates `commonName`.
- `test/integration/commonNames/observationUpdate.test.js` — asserts edit flow behaves correctly (picker, custom entry, species cleared).

### Modified files

- `src/main/services/prediction.js:258-352` (`insertPrediction`) and `:377-521` (`insertVideoPredictions`) — resolve and persist `commonName`.
- `src/main/database/queries/observations.js:31-101` (`updateObservationClassification`) — implement three-case write discrimination.
- `src/renderer/src/overview.jsx:181-221` — remove `fetchGbifCommonName`; consume `useCommonName`.
- `src/renderer/src/ui/speciesDistribution.jsx:7-150` — remove inline `commonNamesCache` and `fetchCommonName`; consume `useCommonName`.
- `package.json` — add `dict:build` script.

### Notes on conventions

- Main-process tests use `node:test` (`import { test } from 'node:test'`, `import assert from 'node:assert/strict'`).
- Renderer tests use Vitest (`import { describe, test, expect } from 'vitest'`).
- Module type is CommonJS by default (no `"type": "module"` in package.json), but the codebase uses ES-module syntax in `.js` files with Vite/Electron build tooling transpiling — follow existing files' import/export style.
- Test data lives under `test/fixtures/` and `test/data/`.
- Run all tests: `npm test`. Run a single file: `node --test test/path/to/file.test.js` (main) or `npx vitest run test/path/to/file.test.js` (renderer).

---

## Task 1: Normalization helper

Normalization is the foundation for every dictionary lookup. TDD it first, keep it pure, zero dependencies.

**Files:**
- Create: `src/shared/commonNames/normalize.js`
- Create: `test/shared/commonNames/normalize.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/shared/commonNames/normalize.test.js`:

```javascript
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeScientificName } from '../../../src/shared/commonNames/normalize.js'

describe('normalizeScientificName', () => {
  test('returns null for null input', () => {
    assert.equal(normalizeScientificName(null), null)
  })

  test('returns null for empty string', () => {
    assert.equal(normalizeScientificName(''), null)
  })

  test('returns null for whitespace-only string', () => {
    assert.equal(normalizeScientificName('   '), null)
  })

  test('lowercases', () => {
    assert.equal(normalizeScientificName('Sciurus Vulgaris'), 'sciurus vulgaris')
  })

  test('trims and collapses internal whitespace', () => {
    assert.equal(normalizeScientificName('  Sciurus    vulgaris  '), 'sciurus vulgaris')
  })

  test('strips author citation (Name, YYYY form)', () => {
    assert.equal(
      normalizeScientificName('Sciurus vulgaris Linnaeus, 1758'),
      'sciurus vulgaris'
    )
  })

  test('strips author citation (parenthesized form)', () => {
    assert.equal(
      normalizeScientificName('Capreolus capreolus (Linnaeus, 1758)'),
      'capreolus capreolus'
    )
  })

  test('preserves non-binomial single-word labels', () => {
    assert.equal(normalizeScientificName('chamois'), 'chamois')
    assert.equal(normalizeScientificName('bird'), 'bird')
  })

  test('NFC-normalizes combining characters', () => {
    // "é" as NFD (e + combining acute) should come out as single codepoint
    const nfd = 'café'
    const nfc = 'café'
    assert.equal(normalizeScientificName(nfd), nfc)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/shared/commonNames/normalize.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `normalize.js`**

Create `src/shared/commonNames/normalize.js`:

```javascript
/**
 * Normalize a scientific name for dictionary lookup.
 * Returns null for null/empty/whitespace input.
 * Steps: NFC normalize → trim → lowercase → collapse whitespace → strip author citation.
 */
export function normalizeScientificName(input) {
  if (input == null) return null
  if (typeof input !== 'string') return null

  let s = input.normalize('NFC').trim()
  if (s === '') return null

  s = s.toLowerCase().replace(/\s+/g, ' ')

  // Strip author citation. Two shapes:
  //   "genus species Author, YYYY"        -> drop from first capital-letter author onwards
  //   "genus species (Author, YYYY)"      -> drop from "(" onwards
  // The scientific name proper contains only lowercase words after our toLowerCase.
  // An author citation starts with either "(" or a year-like token or a capitalized token.
  // Since we already lowercased, we detect author by: a comma followed by a 4-digit year.
  s = s.replace(/\s*\(?[a-z.\-\s]+,\s*\d{4}\)?\s*$/, '')

  return s.trim() || null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/shared/commonNames/normalize.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/commonNames/normalize.js test/shared/commonNames/normalize.test.js
git commit -m "feat(commonNames): add scientific-name normalization helper"
```

---

## Task 2: Extract DeepFaune label snapshot

DeepFaune's labels are inline in `python-environments/common/run_deepfaune_server.py`. Values are already English common names, not binomials — so each entry is `label → commonName`, with `scientificName: null` (they're not species-level, they're informal labels like "red deer", "bird"). The write-path resolver will look these up by label when DeepFaune is the active model.

**Files:**
- Create: `scripts/extract-deepfaune-labels.py`
- Create: `src/shared/commonNames/sources/deepfaune.json`

- [ ] **Step 1: Write the extractor script**

Create `scripts/extract-deepfaune-labels.py`:

```python
#!/usr/bin/env python
"""Extract DeepFaune class labels from run_deepfaune_server.py and write JSON snapshot.

DeepFaune labels are informal common-name-ish English strings like "red deer",
"chamois", "bird". They are not binomial scientific names. The snapshot stores
each label with scientificName=null and commonName=titleCase(label).

Usage:
    python scripts/extract-deepfaune-labels.py \
        --server-file python-environments/common/run_deepfaune_server.py \
        --output src/shared/commonNames/sources/deepfaune.json
"""

import argparse
import ast
import json
from pathlib import Path


def extract_class_label_mapping(server_file: Path) -> dict[int, str]:
    """Parse run_deepfaune_server.py and return the CLASS_LABEL_MAPPING dict."""
    tree = ast.parse(server_file.read_text())
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == "CLASS_LABEL_MAPPING"
        ):
            return ast.literal_eval(node.value)
    raise RuntimeError("CLASS_LABEL_MAPPING not found in server file")


def title_case(label: str) -> str:
    """Simple title-casing for display: 'red deer' -> 'Red Deer'."""
    return " ".join(word.capitalize() for word in label.split())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--server-file", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    mapping = extract_class_label_mapping(args.server_file)
    entries = [
        {"scientificName": None, "label": label, "commonName": title_case(label)}
        for _, label in sorted(mapping.items())
    ]

    snapshot = {
        "modelId": "deepfaune",
        "modelVersion": "1.3",
        "source": str(args.server_file),
        "entries": entries,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"Wrote {len(entries)} entries to {args.output}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the extractor**

```bash
mkdir -p src/shared/commonNames/sources
python scripts/extract-deepfaune-labels.py \
    --server-file python-environments/common/run_deepfaune_server.py \
    --output src/shared/commonNames/sources/deepfaune.json
```

Expected: `Wrote 34 entries to src/shared/commonNames/sources/deepfaune.json`

- [ ] **Step 3: Sanity-check the output**

```bash
head -20 src/shared/commonNames/sources/deepfaune.json
```

Expected: JSON starting with `{"modelId": "deepfaune", "modelVersion": "1.3", ...`, followed by entries with `scientificName: null, label: "bison", commonName: "Bison"` etc.

- [ ] **Step 4: Commit**

```bash
git add scripts/extract-deepfaune-labels.py src/shared/commonNames/sources/deepfaune.json
git commit -m "feat(commonNames): extract DeepFaune label snapshot"
```

---

## Task 3: Extract Manas label snapshot

Manas's labels live in a Python pickle file shipped with the Manas 1.0 model tarball. The tarball is downloaded from HuggingFace on demand — we do this once, unpickle, write the snapshot JSON, commit it.

**Files:**
- Create: `scripts/extract-manas-labels.py`
- Create: `src/shared/commonNames/sources/manas.json`

- [ ] **Step 1: Write the extractor script**

Create `scripts/extract-manas-labels.py`:

```python
#!/usr/bin/env python
"""Extract Manas class labels from the classes pickle file and write JSON snapshot.

The Manas model ships a pickle file at <model_dir>/classes.pkl containing either
a list of class names (index is the class ID) or a dict {int: str}. Labels are
informal English common names (e.g., "tiger", "asian elephant") — not binomials.

Usage:
    python scripts/extract-manas-labels.py \
        --classes-pkl /path/to/manas/classes.pkl \
        --output src/shared/commonNames/sources/manas.json
"""

import argparse
import json
import pickle
from pathlib import Path


def load_classes(path: Path) -> dict[int, str]:
    with open(path, "rb") as f:
        data = pickle.load(f)
    if isinstance(data, list):
        return dict(enumerate(data))
    if isinstance(data, dict):
        return data
    raise ValueError(f"Unexpected pickle content type: {type(data)}")


def title_case(label: str) -> str:
    return " ".join(word.capitalize() for word in label.split())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--classes-pkl", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    mapping = load_classes(args.classes_pkl)
    entries = [
        {"scientificName": None, "label": label, "commonName": title_case(label)}
        for _, label in sorted(mapping.items())
    ]

    snapshot = {
        "modelId": "manas",
        "modelVersion": "1.0",
        "source": str(args.classes_pkl),
        "entries": entries,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"Wrote {len(entries)} entries to {args.output}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Download Manas and locate classes.pkl**

```bash
cd python-environments/common
uv run python scripts/download_model.py --model manas --output /tmp/manas-1.0
find /tmp/manas-1.0 -name "classes*" -o -name "*.pkl" | head -5
```

Expected: a path ending in `classes.pkl` (exact location depends on the tarball layout).

- [ ] **Step 3: Run the extractor**

Substitute the path found in Step 2 for `<pkl-path>`:

```bash
cd ../..
python scripts/extract-manas-labels.py \
    --classes-pkl <pkl-path> \
    --output src/shared/commonNames/sources/manas.json
```

Expected: `Wrote N entries to src/shared/commonNames/sources/manas.json` (N ≈ 30).

- [ ] **Step 4: Sanity-check the output**

```bash
head -15 src/shared/commonNames/sources/manas.json
```

Expected: JSON starting with `{"modelId": "manas", "modelVersion": "1.0", ...`.

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-manas-labels.py src/shared/commonNames/sources/manas.json
git commit -m "feat(commonNames): extract Manas label snapshot"
```

---

## Task 4: Extract SpeciesNet label snapshot

SpeciesNet ships labels as a text file with lines like `uuid;class;order;family;genus;species;common_name`. The exact path inside the tarball depends on the release; the extractor accepts a path argument and handles the parse.

**Files:**
- Create: `scripts/extract-speciesnet-labels.py`
- Create: `src/shared/commonNames/sources/speciesnet.json`

- [ ] **Step 1: Write the extractor script**

Create `scripts/extract-speciesnet-labels.py`:

```python
#!/usr/bin/env python
"""Extract SpeciesNet labels from its taxonomy text file and write JSON snapshot.

Each line has the form:  uuid;class;order;family;genus;species;common_name
- When genus+species are both non-empty, scientificName = "genus species".
- When either is empty, scientificName stays null and the raw common_name is the label.

Usage:
    python scripts/extract-speciesnet-labels.py \
        --labels-file /path/to/speciesnet/labels.txt \
        --output src/shared/commonNames/sources/speciesnet.json
"""

import argparse
import json
from pathlib import Path


def parse_line(line: str) -> dict | None:
    parts = line.strip().split(";")
    if len(parts) < 7:
        return None
    _, _, _, _, genus, species, common_name = parts[:7]
    genus, species, common_name = genus.strip(), species.strip(), common_name.strip()
    if not common_name:
        return None

    scientific_name = f"{genus} {species}".strip() if genus and species else None
    label = common_name if scientific_name is None else None
    return {
        "scientificName": scientific_name,
        "label": label,
        "commonName": common_name,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--labels-file", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    entries = []
    seen_keys = set()  # Dedup by (scientificName, label)
    with args.labels_file.open() as f:
        for line in f:
            entry = parse_line(line)
            if entry is None:
                continue
            key = (entry["scientificName"], entry["label"])
            if key in seen_keys:
                continue
            seen_keys.add(key)
            entries.append(entry)

    snapshot = {
        "modelId": "speciesnet",
        "modelVersion": "4.0.1a",
        "source": str(args.labels_file),
        "entries": entries,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"Wrote {len(entries)} entries to {args.output}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Download SpeciesNet and locate the labels file**

```bash
cd python-environments/common
uv run python scripts/download_model.py --model speciesnet --output /tmp/speciesnet-4.0.1a
find /tmp/speciesnet-4.0.1a -name "*.txt" -not -path "*/\.*" | head -10
# Identify the taxonomy file: a .txt with lines starting with UUIDs and containing semicolons.
```

Expected: a `.txt` file path inside the extracted tarball. If multiple match, use the one whose first line matches `^[0-9a-f-]{36};`.

- [ ] **Step 3: Run the extractor**

```bash
cd ../..
python scripts/extract-speciesnet-labels.py \
    --labels-file <labels-txt-path> \
    --output src/shared/commonNames/sources/speciesnet.json
```

Expected: `Wrote N entries to src/shared/commonNames/sources/speciesnet.json` (N ≈ 2000).

- [ ] **Step 4: Sanity-check the output**

```bash
python -c "import json; d=json.load(open('src/shared/commonNames/sources/speciesnet.json')); print(len(d['entries']), 'entries'); print(d['entries'][:3])"
```

Expected: roughly 2000 entries, each with `scientificName`, `label`, `commonName`.

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-speciesnet-labels.py src/shared/commonNames/sources/speciesnet.json
git commit -m "feat(commonNames): extract SpeciesNet label snapshot"
```

---

## Task 5: Seed `extras.json`

A hand-curated map for known-bad cases (the Sciurus one for sure) and any species we want to override. Seeded minimally; grows via PRs.

**Files:**
- Create: `src/shared/commonNames/extras.json`

- [ ] **Step 1: Create the file**

Create `src/shared/commonNames/extras.json`:

```json
{
  "_comment": "Hand-curated overrides for common-name resolution. Keys are normalized scientific names. Later entries in the build pipeline win, so these override model-snapshot values.",
  "entries": [
    {
      "scientificName": "sciurus vulgaris",
      "commonName": "Eurasian Red Squirrel",
      "reason": "GBIF returns multiple Spanish names mis-tagged as language='eng'"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/commonNames/extras.json
git commit -m "feat(commonNames): seed extras.json with Sciurus vulgaris override"
```

---

## Task 6: Dictionary build script

Merges the four JSON inputs (three source snapshots + extras) into `dictionary.json` in priority order: SpeciesNet < DeepFaune < Manas < extras (later sources win on conflict). Keys are normalized scientific names OR raw labels. Values are common names.

**Files:**
- Create: `scripts/build-common-names-dict.js`
- Modify: `package.json`
- Generates: `src/shared/commonNames/dictionary.json`

- [ ] **Step 1: Write the build script**

Create `scripts/build-common-names-dict.js`:

```javascript
#!/usr/bin/env node
/**
 * Build src/shared/commonNames/dictionary.json by merging the four source JSONs.
 *
 * Priority order (later wins on conflict):
 *   SpeciesNet → DeepFaune → Manas → extras.json
 *
 * Keys in the output are either:
 *   - normalized scientific names (lowercase, single-space, NFC-normalized); or
 *   - raw model labels, for entries whose scientificName is null.
 *
 * Values are common names as provided by the source (NOT lowercased — we keep
 * display casing like "Eurasian Red Squirrel").
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeScientificName } from '../src/shared/commonNames/normalize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SOURCES_DIR = path.join(ROOT, 'src/shared/commonNames/sources')
const EXTRAS_PATH = path.join(ROOT, 'src/shared/commonNames/extras.json')
const OUTPUT_PATH = path.join(ROOT, 'src/shared/commonNames/dictionary.json')

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function keyFor(entry) {
  if (entry.scientificName) {
    return normalizeScientificName(entry.scientificName)
  }
  if (entry.label) {
    return normalizeScientificName(entry.label)
  }
  return null
}

function mergeEntries(target, entries) {
  for (const entry of entries) {
    const key = keyFor(entry)
    if (!key) continue
    if (!entry.commonName || !entry.commonName.trim()) continue
    target[key] = entry.commonName.trim()
  }
}

function main() {
  const dictionary = {}

  // Load in priority order (later wins).
  const order = ['speciesnet.json', 'deepfaune.json', 'manas.json']
  for (const filename of order) {
    const p = path.join(SOURCES_DIR, filename)
    const snapshot = loadJson(p)
    mergeEntries(dictionary, snapshot.entries)
  }

  const extras = loadJson(EXTRAS_PATH)
  mergeEntries(dictionary, extras.entries)

  // Write sorted for deterministic diffs.
  const sortedKeys = Object.keys(dictionary).sort()
  const sorted = {}
  for (const k of sortedKeys) sorted[k] = dictionary[k]

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`Wrote ${sortedKeys.length} entries to ${OUTPUT_PATH}`)
}

main()
```

- [ ] **Step 2: Add npm script**

Modify `package.json`. Locate the `"scripts"` block and add:

```json
"dict:build": "node scripts/build-common-names-dict.js"
```

(Keep the surrounding scripts in alphabetical order if that's the file's convention; otherwise add after the last existing script.)

- [ ] **Step 3: Run the build**

```bash
npm run dict:build
```

Expected: `Wrote N entries to .../dictionary.json` (N ≈ 2050–2100 — roughly the SpeciesNet count plus a handful of unique DeepFaune/Manas labels).

- [ ] **Step 4: Sanity-check the output**

```bash
node -e "const d = require('./src/shared/commonNames/dictionary.json'); console.log('sciurus vulgaris ->', d['sciurus vulgaris']); console.log('chamois ->', d['chamois']); console.log('size:', Object.keys(d).length)"
```

Expected: `sciurus vulgaris -> Eurasian Red Squirrel` (proves extras override), `chamois -> Chamois` (proves DeepFaune label is present).

- [ ] **Step 5: Commit**

```bash
git add scripts/build-common-names-dict.js package.json src/shared/commonNames/dictionary.json
git commit -m "feat(commonNames): add dictionary build script + generated dictionary.json"
```

---

## Task 7: Dictionary integrity test

Guards against typos, duplicates, and malformed entries.

**Files:**
- Create: `test/shared/commonNames/dictionary.integrity.test.js`

- [ ] **Step 1: Write the test**

Create `test/shared/commonNames/dictionary.integrity.test.js`:

```javascript
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeScientificName } from '../../../src/shared/commonNames/normalize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DICT_PATH = path.resolve(
  __dirname,
  '../../../src/shared/commonNames/dictionary.json'
)

describe('dictionary.json integrity', () => {
  const raw = fs.readFileSync(DICT_PATH, 'utf8')
  const dictionary = JSON.parse(raw)

  test('is a non-empty object', () => {
    assert.equal(typeof dictionary, 'object')
    assert.ok(!Array.isArray(dictionary))
    assert.ok(Object.keys(dictionary).length > 0)
  })

  test('has no empty or whitespace-only values', () => {
    for (const [key, value] of Object.entries(dictionary)) {
      assert.equal(typeof value, 'string', `value for "${key}" is not a string`)
      assert.notEqual(value.trim(), '', `value for "${key}" is empty`)
    }
  })

  test('all keys are canonically normalized', () => {
    for (const key of Object.keys(dictionary)) {
      const normalized = normalizeScientificName(key)
      assert.equal(normalized, key, `key "${key}" is not canonically normalized`)
    }
  })

  test('has no duplicate keys (verified via raw JSON parse)', () => {
    // JSON.parse silently drops duplicates; detect by re-parsing with a reviver
    // that counts occurrences per key path.
    const seen = new Set()
    const dupes = []
    JSON.parse(raw, function (k, v) {
      if (this && k !== '' && seen.has(k)) dupes.push(k)
      if (k !== '') seen.add(k)
      return v
    })
    assert.deepEqual(dupes, [], `found duplicate keys: ${dupes.join(', ')}`)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `node --test test/shared/commonNames/dictionary.integrity.test.js`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add test/shared/commonNames/dictionary.integrity.test.js
git commit -m "test(commonNames): add dictionary integrity test"
```

---

## Task 8: Dictionary coverage test

Fails if any entry in any `sources/*.json` snapshot is missing from `dictionary.json` — catches "someone edited a snapshot and forgot `npm run dict:build`".

**Files:**
- Create: `test/shared/commonNames/dictionary.coverage.test.js`

- [ ] **Step 1: Write the test**

Create `test/shared/commonNames/dictionary.coverage.test.js`:

```javascript
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeScientificName } from '../../../src/shared/commonNames/normalize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCES_DIR = path.resolve(
  __dirname,
  '../../../src/shared/commonNames/sources'
)
const DICT_PATH = path.resolve(
  __dirname,
  '../../../src/shared/commonNames/dictionary.json'
)

function keyFor(entry) {
  if (entry.scientificName) return normalizeScientificName(entry.scientificName)
  if (entry.label) return normalizeScientificName(entry.label)
  return null
}

describe('dictionary.json coverage', () => {
  const dictionary = JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'))
  const snapshots = fs
    .readdirSync(SOURCES_DIR)
    .filter((f) => f.endsWith('.json'))

  for (const filename of snapshots) {
    test(`all entries from ${filename} appear in dictionary.json`, () => {
      const snapshot = JSON.parse(
        fs.readFileSync(path.join(SOURCES_DIR, filename), 'utf8')
      )
      const missing = []
      for (const entry of snapshot.entries) {
        const key = keyFor(entry)
        if (!key) continue
        if (!(key in dictionary)) {
          missing.push({ key, label: entry.label, scientificName: entry.scientificName })
        }
      }
      assert.equal(
        missing.length,
        0,
        `${missing.length} entries missing from dictionary:\n` +
          missing
            .slice(0, 20)
            .map((m) => `  - ${m.key}`)
            .join('\n') +
          (missing.length > 20 ? `\n  ... and ${missing.length - 20} more` : '')
      )
    })
  }
})
```

- [ ] **Step 2: Run the test**

Run: `node --test test/shared/commonNames/dictionary.coverage.test.js`
Expected: PASS (3 tests, one per snapshot).

- [ ] **Step 3: Commit**

```bash
git add test/shared/commonNames/dictionary.coverage.test.js
git commit -m "test(commonNames): add dictionary coverage test across model snapshots"
```

---

## Task 9: Resolver

Pure, synchronous. Reads `dictionary.json` at module load, exposes `resolveCommonName`.

**Files:**
- Create: `src/shared/commonNames/resolver.js`
- Create: `test/shared/commonNames/resolver.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/shared/commonNames/resolver.test.js`:

```javascript
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCommonName } from '../../../src/shared/commonNames/resolver.js'

describe('resolveCommonName', () => {
  test('returns null for null input', () => {
    assert.equal(resolveCommonName(null), null)
  })

  test('returns null for empty string', () => {
    assert.equal(resolveCommonName(''), null)
  })

  test('resolves a binomial scientific name', () => {
    assert.equal(resolveCommonName('Sciurus vulgaris'), 'Eurasian Red Squirrel')
  })

  test('resolves with extras override beating SpeciesNet entry', () => {
    // Sciurus vulgaris exists in SpeciesNet (returns "eurasian red squirrel")
    // and in extras ("Eurasian Red Squirrel") — extras wins.
    assert.equal(resolveCommonName('Sciurus vulgaris'), 'Eurasian Red Squirrel')
  })

  test('resolves a DeepFaune non-binomial label', () => {
    assert.equal(resolveCommonName('chamois'), 'Chamois')
  })

  test('resolves case-insensitively', () => {
    assert.equal(resolveCommonName('SCIURUS VULGARIS'), 'Eurasian Red Squirrel')
  })

  test('returns null for unknown scientific name', () => {
    assert.equal(resolveCommonName('Foobar nonexistentium'), null)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/shared/commonNames/resolver.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

Create `src/shared/commonNames/resolver.js`:

```javascript
import dictionary from './dictionary.json' with { type: 'json' }
import { normalizeScientificName } from './normalize.js'

/**
 * Resolve a scientific name (or raw model label) to an English common name
 * via the shipped dictionary. Pure, synchronous, no network.
 *
 * @param {string | null | undefined} scientificName
 * @returns {string | null} The English common name, or null on miss.
 */
export function resolveCommonName(scientificName) {
  const key = normalizeScientificName(scientificName)
  if (!key) return null
  return dictionary[key] ?? null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/shared/commonNames/resolver.test.js`
Expected: PASS (8 tests).

Note: if Node's JSON import assertion syntax is rejected (depends on Node version in the repo), switch to:

```javascript
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dictionary = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'dictionary.json'), 'utf8')
)
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/commonNames/resolver.js test/shared/commonNames/resolver.test.js
git commit -m "feat(commonNames): add resolveCommonName helper"
```

---

## Task 10: Barrel export

Single entry point for consumers.

**Files:**
- Create: `src/shared/commonNames/index.js`

- [ ] **Step 1: Create the barrel**

Create `src/shared/commonNames/index.js`:

```javascript
export { resolveCommonName } from './resolver.js'
export { normalizeScientificName } from './normalize.js'
export { pickEnglishCommonName } from './gbifScorer.js'
```

Note: `gbifScorer.js` doesn't exist yet; the export line is pre-wired and starts working after Task 13. If your build tooling complains about the missing export before Task 13, skip Step 1 and add the `pickEnglishCommonName` re-export at the end of Task 13 instead. Otherwise leave it — a missing import from a barrel only errors when someone imports that specific symbol.

- [ ] **Step 2: Commit**

```bash
git add src/shared/commonNames/index.js
git commit -m "feat(commonNames): add barrel export"
```

---

## Task 11: Wire resolver into ML write path (`insertPrediction`)

Populate `commonName` at insert time so ML-generated observations are no longer born with `commonName: null`. Purely additive — does not change existing fields.

**Files:**
- Modify: `src/main/services/prediction.js` (around `insertPrediction`, currently `:258-352`)
- Create: `test/integration/commonNames/predictionWrite.test.js`

- [ ] **Step 1: Write the failing integration test**

Create `test/integration/commonNames/predictionWrite.test.js`:

```javascript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { insertPrediction } from '../../../src/main/services/prediction.js'
import {
  getDrizzleDb,
  createImageDirectoryDatabase,
  insertMedia
} from '../../../src/main/database/index.js'

describe('insertPrediction populates commonName via dictionary', () => {
  let tmp
  let dbPath

  beforeEach(async () => {
    tmp = join(tmpdir(), `biowatch-common-test-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
    dbPath = join(tmp, 'study.db')
    await createImageDirectoryDatabase(dbPath)
  })

  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  })

  test('SpeciesNet prediction gets commonName from dictionary', async () => {
    const db = await getDrizzleDb('test', dbPath)

    // Seed a media row that the prediction will attach to.
    await insertMedia(db, [
      {
        mediaID: 'media-1',
        filePath: '/fake/img1.jpg',
        timestamp: '2024-01-01T00:00:00Z',
        deploymentID: 'dep-1',
        fileMediatype: 'image/jpeg'
      }
    ])

    const prediction = {
      filepath: '/fake/img1.jpg',
      prediction:
        '00000000-0000-0000-0000-000000000001;mammalia;rodentia;sciuridae;sciurus;vulgaris;eurasian red squirrel',
      prediction_score: 0.95,
      detections: []
    }

    await insertPrediction(db, prediction, { modelID: 'speciesnet' })

    const result = await db.all(
      `SELECT scientificName, commonName FROM observations WHERE mediaID = 'media-1'`
    )
    assert.equal(result.length, 1)
    assert.equal(result[0].scientificName, 'sciurus vulgaris')
    assert.equal(result[0].commonName, 'Eurasian Red Squirrel')
  })

  test('DeepFaune non-binomial label gets commonName from dictionary', async () => {
    const db = await getDrizzleDb('test', dbPath)

    await insertMedia(db, [
      {
        mediaID: 'media-2',
        filePath: '/fake/img2.jpg',
        timestamp: '2024-01-01T00:00:00Z',
        deploymentID: 'dep-1',
        fileMediatype: 'image/jpeg'
      }
    ])

    const prediction = {
      filepath: '/fake/img2.jpg',
      prediction: 'chamois',
      prediction_score: 0.88,
      detections: []
    }

    await insertPrediction(db, prediction, { modelID: 'deepfaune' })

    const result = await db.all(
      `SELECT scientificName, commonName FROM observations WHERE mediaID = 'media-2'`
    )
    assert.equal(result.length, 1)
    assert.equal(result[0].scientificName, 'chamois')
    assert.equal(result[0].commonName, 'Chamois')
  })

  test('unknown species leaves commonName null', async () => {
    const db = await getDrizzleDb('test', dbPath)

    await insertMedia(db, [
      {
        mediaID: 'media-3',
        filePath: '/fake/img3.jpg',
        timestamp: '2024-01-01T00:00:00Z',
        deploymentID: 'dep-1',
        fileMediatype: 'image/jpeg'
      }
    ])

    const prediction = {
      filepath: '/fake/img3.jpg',
      prediction: 'unknown_labelium',
      prediction_score: 0.4,
      detections: []
    }

    await insertPrediction(db, prediction, { modelID: 'deepfaune' })

    const result = await db.all(
      `SELECT scientificName, commonName FROM observations WHERE mediaID = 'media-3'`
    )
    assert.equal(result.length, 1)
    assert.equal(result[0].commonName, null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/integration/commonNames/predictionWrite.test.js`
Expected: FAIL — the SpeciesNet and DeepFaune cases fail their `commonName` assertions (both return `null` today).

- [ ] **Step 3: Import and call the resolver in `prediction.js`**

Modify `src/main/services/prediction.js`:

1. At the top of the file, below the existing imports, add:

```javascript
import { resolveCommonName } from '../../shared/commonNames/index.js'
```

2. In `insertPrediction` (currently `:258-352`), locate the block that builds `baseObservationData` (currently `:297-310`) and add `commonName` to it:

```javascript
const resolvedCommonName = resolveCommonName(resolvedScientificName)
const baseObservationData = {
  mediaID: mediaRecord.mediaID,
  deploymentID: mediaRecord.deploymentID,
  eventID: eventID,
  eventStart: mediaRecord.timestamp,
  eventEnd: mediaRecord.timestamp,
  scientificName: resolvedScientificName,
  commonName: resolvedCommonName,
  classificationProbability: prediction.prediction_score,
  count: 1,
  modelOutputID: modelInfo.modelOutputID || null,
  classificationMethod: modelInfo.modelOutputID ? 'machine' : null,
  classifiedBy: classifiedBy,
  classificationTimestamp: classificationTimestamp
}
```

3. In `insertVideoPredictions`, locate the winner-insertion block (currently around `:471-491`) and add `commonName: resolveCommonName(winner)` alongside `scientificName: winner`:

```javascript
await db.insert(observations).values({
  observationID: crypto.randomUUID(),
  mediaID: mediaRecord.mediaID,
  deploymentID: mediaRecord.deploymentID,
  eventID: eventID,
  eventStart: eventStart,
  eventEnd: eventEnd,
  scientificName: winner,
  commonName: resolveCommonName(winner),
  confidence: winnerData.avgConfidence,
  count: 1,
  bboxX: null,
  bboxY: null,
  bboxWidth: null,
  bboxHeight: null,
  detectionConfidence: null,
  modelOutputID: modelOutputID,
  classificationMethod: 'machine',
  classifiedBy: classifiedBy,
  classificationTimestamp: classificationTimestamp
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/integration/commonNames/predictionWrite.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full main-process test suite**

Run: `node --test "test/main/**/*.test.js" "test/integration/**/*.test.js"`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/prediction.js test/integration/commonNames/predictionWrite.test.js
git commit -m "feat(prediction): populate commonName via shared dictionary"
```

---

## Task 12: Rework `updateObservationClassification` write logic

Implement the three-case discrimination from the spec: picker list (save both), custom entry (save scientific only, clear common), species cleared (clear both).

**Files:**
- Modify: `src/main/database/queries/observations.js:31-101`
- Create: `test/integration/commonNames/observationUpdate.test.js`

- [ ] **Step 1: Write the failing integration tests**

Create `test/integration/commonNames/observationUpdate.test.js`:

```javascript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { updateObservationClassification } from '../../../src/main/database/queries/observations.js'
import {
  getDrizzleDb,
  createImageDirectoryDatabase,
  insertMedia,
  insertObservations
} from '../../../src/main/database/index.js'

describe('updateObservationClassification: three-case write logic', () => {
  let tmp, dbPath

  beforeEach(async () => {
    tmp = join(tmpdir(), `biowatch-update-test-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
    dbPath = join(tmp, 'study.db')
    await createImageDirectoryDatabase(dbPath)
    const db = await getDrizzleDb('test', dbPath)
    await insertMedia(db, [
      {
        mediaID: 'm1',
        filePath: '/fake/img.jpg',
        timestamp: '2024-01-01T00:00:00Z',
        deploymentID: 'd1',
        fileMediatype: 'image/jpeg'
      }
    ])
    await insertObservations(db, [
      {
        observationID: 'obs1',
        mediaID: 'm1',
        deploymentID: 'd1',
        eventID: 'e1',
        eventStart: '2024-01-01T00:00:00Z',
        eventEnd: '2024-01-01T00:00:00Z',
        scientificName: 'capreolus capreolus',
        commonName: 'Roe Deer',
        count: 1
      }
    ])
  })

  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  })

  test('picker-list selection (both values provided) saves both', async () => {
    const result = await updateObservationClassification(dbPath, 'obs1', {
      scientificName: 'cervus elaphus',
      commonName: 'Red Deer'
    })
    assert.equal(result.scientificName, 'cervus elaphus')
    assert.equal(result.commonName, 'Red Deer')
  })

  test('custom entry (scientificName only, commonName absent) clears commonName', async () => {
    const result = await updateObservationClassification(dbPath, 'obs1', {
      scientificName: 'custom typed value'
    })
    assert.equal(result.scientificName, 'custom typed value')
    assert.equal(result.commonName, null)
  })

  test('custom entry (scientificName only, commonName: null) clears commonName', async () => {
    // This matches handleSelectSpecies(scientificName, null) — the default-param case.
    const result = await updateObservationClassification(dbPath, 'obs1', {
      scientificName: 'another custom value',
      commonName: null
    })
    assert.equal(result.scientificName, 'another custom value')
    assert.equal(result.commonName, null)
  })

  test('species cleared (scientificName: null) clears commonName too', async () => {
    const result = await updateObservationClassification(dbPath, 'obs1', {
      scientificName: null
    })
    assert.equal(result.scientificName, null)
    assert.equal(result.commonName, null)
  })

  test('species cleared (scientificName: "") clears commonName too', async () => {
    const result = await updateObservationClassification(dbPath, 'obs1', {
      scientificName: ''
    })
    assert.equal(result.scientificName, null)
    assert.equal(result.commonName, null)
  })

  test('unrelated field update (e.g. sex) does not touch scientificName or commonName', async () => {
    const result = await updateObservationClassification(dbPath, 'obs1', {
      sex: 'female'
    })
    assert.equal(result.scientificName, 'capreolus capreolus')
    assert.equal(result.commonName, 'Roe Deer')
    assert.equal(result.sex, 'female')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/integration/commonNames/observationUpdate.test.js`
Expected: FAIL on:
- "custom entry (scientificName only, commonName absent)" — today's code leaves commonName unchanged at "Roe Deer" instead of clearing.
- "species cleared" — today's code clears scientificName but leaves commonName at "Roe Deer".

- [ ] **Step 3: Update `updateObservationClassification`**

Modify `src/main/database/queries/observations.js:50-57`. Replace the existing `scientificName` / `commonName` blocks with the three-case logic:

```javascript
// Three-case discrimination for scientificName + commonName:
//   1. Species cleared: scientificName is null or empty string -> clear both.
//   2. Picker-list selection: scientificName provided AND commonName is a non-null string -> save both.
//   3. Custom entry: scientificName provided AND commonName is null/absent -> save scientificName, clear commonName.
if (updates.scientificName !== undefined) {
  const sci = updates.scientificName
  const sciIsCleared = sci === null || sci === ''
  if (sciIsCleared) {
    updateValues.scientificName = null
    updateValues.commonName = null
  } else {
    updateValues.scientificName = sci
    if (typeof updates.commonName === 'string' && updates.commonName.length > 0) {
      updateValues.commonName = updates.commonName
    } else {
      updateValues.commonName = null
    }
  }
} else if (updates.commonName !== undefined) {
  // scientificName not being updated, commonName-only update (rare — keep permissive).
  updateValues.commonName = updates.commonName
}
```

Remove the old `if (updates.scientificName !== undefined) { ... }` and `if (updates.commonName !== undefined) { ... }` blocks (lines 51-57 in the original).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/integration/commonNames/observationUpdate.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Run all main-process tests to check for regressions**

Run: `node --test "test/main/**/*.test.js" "test/integration/**/*.test.js"`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/main/database/queries/observations.js test/integration/commonNames/observationUpdate.test.js
git commit -m "feat(observations): three-case write logic for species edits"
```

---

## Task 13: GBIF scorer — audit set + exploration

Before writing the scorer, assemble the audit set and run the exploration script against live GBIF. This step is **manual review-driven**: you're gathering data to design the scorer against. The script itself is simple; the output needs human eyes.

**Files:**
- Create: `scripts/audit-set.txt`
- Create: `scripts/explore-gbif-vernaculars.js`
- Modify: `.gitignore` (add `scripts/output/`)

- [ ] **Step 1: Assemble the audit set**

Create `scripts/audit-set.txt` with approximately 230 species, one scientific name per line. Compose it from:

1. All 34 DeepFaune labels (open `src/shared/commonNames/sources/deepfaune.json`, take the `label` field of each entry — note these are informal like "red deer", but GBIF's match endpoint accepts them).
2. All Manas labels (from `src/shared/commonNames/sources/manas.json`).
3. ~150 SpeciesNet species, sampled from `src/shared/commonNames/sources/speciesnet.json` across classes/regions. Use this helper to pick:

```bash
node -e "
const d = require('./src/shared/commonNames/sources/speciesnet.json');
const species = d.entries.filter(e => e.scientificName);
// Round-robin sample 150, spread across the list to diversify taxonomy.
const step = Math.floor(species.length / 150);
const picked = [];
for (let i = 0; i < species.length && picked.length < 150; i += step) {
  picked.push(species[i].scientificName);
}
console.log(picked.join('\n'));
" > /tmp/speciesnet-sample.txt
```

4. ~40 high-risk species hand-added for multilingual-name noise. Suggested list (paste into the file):

```
Sciurus vulgaris
Sciurus carolinensis
Rattus rattus
Rattus norvegicus
Mustela nivalis
Mustela erminea
Capreolus capreolus
Cervus elaphus
Dama dama
Sus scrofa
Vulpes vulpes
Felis silvestris
Lynx lynx
Ursus arctos
Meles meles
Martes martes
Martes foina
Genetta genetta
Lepus europaeus
Oryctolagus cuniculus
Castor fiber
Alces alces
Rangifer tarandus
Rupicapra rupicapra
Ovis aries
Bos taurus
Canis lupus
Panthera leo
Panthera tigris
Panthera onca
Panthera pardus
Acinonyx jubatus
Loxodonta africana
Elephas maximus
Giraffa camelopardalis
Ceratotherium simum
Diceros bicornis
Hippopotamus amphibius
Pan troglodytes
Gorilla gorilla
```

Concatenate the three lists and dedupe:

```bash
cat /tmp/deepfaune-labels.txt /tmp/manas-labels.txt /tmp/speciesnet-sample.txt /tmp/high-risk.txt \
  | sort -u \
  > scripts/audit-set.txt
wc -l scripts/audit-set.txt
```

Expected: approximately 200–300 lines.

- [ ] **Step 2: Write the exploration script**

Create `scripts/explore-gbif-vernaculars.js`:

```javascript
#!/usr/bin/env node
/**
 * Fetch raw GBIF vernacularNames data for each species in scripts/audit-set.txt
 * and write one JSON file per species to scripts/output/gbif-dumps/.
 *
 * Goal: produce data to review when designing the English-detection scorer.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const AUDIT_SET = path.join(ROOT, 'scripts/audit-set.txt')
const OUT_DIR = path.join(ROOT, 'scripts/output/gbif-dumps')

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function fetchFor(scientificName) {
  const matchUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`
  const matchRes = await fetch(matchUrl)
  const matchData = await matchRes.json()
  if (!matchData.usageKey) {
    return { scientificName, matchData, vernacularData: null }
  }
  const vernUrl = `https://api.gbif.org/v1/species/${matchData.usageKey}/vernacularNames?limit=100`
  const vernRes = await fetch(vernUrl)
  const vernacularData = await vernRes.json()
  return { scientificName, matchData, vernacularData }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const species = fs
    .readFileSync(AUDIT_SET, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  console.log(`Fetching GBIF data for ${species.length} species...`)
  let i = 0
  for (const s of species) {
    i++
    const outPath = path.join(OUT_DIR, `${slug(s)}.json`)
    if (fs.existsSync(outPath)) {
      console.log(`[${i}/${species.length}] skip (cached): ${s}`)
      continue
    }
    try {
      const result = await fetchFor(s)
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n')
      console.log(`[${i}/${species.length}] ${s} -> ${outPath}`)
    } catch (e) {
      console.warn(`[${i}/${species.length}] FAIL ${s}: ${e.message}`)
    }
    // Be polite: 150ms between requests.
    await new Promise((r) => setTimeout(r, 150))
  }
}

main()
```

- [ ] **Step 3: Gitignore the output directory**

Modify `.gitignore`. Add:

```
# Common-names audit output (regenerated on demand)
scripts/output/
```

- [ ] **Step 4: Run the exploration (manual, ~5 minutes)**

```bash
node scripts/explore-gbif-vernaculars.js
```

Expected: ~200+ JSON files under `scripts/output/gbif-dumps/`.

- [ ] **Step 5: Review the data (manual)**

Spot-check ~20 random files. Specifically look for:

- Species where the `vernacularData.results` contains entries tagged `language: "eng"` that are not English (the Sciurus case — captured in Section 2 of the spec).
- Which `source` strings reliably produce correct English names (ITIS, "Mammal Species of the World") vs. which mislead (EUNIS, Catalogue of Life).
- Whether the `preferred: true` flag is populated often enough to be useful.
- Presence of non-English diacritics (`ñ`, `é`, `ô`, `ü`) as a negative signal.

Write down findings in a scratchpad — they'll drive the scorer weights in Task 14.

- [ ] **Step 6: Capture the Sciurus vulgaris fixture (and a couple more)**

Pick 3–5 instructive cases (Sciurus vulgaris definitely, plus 2–4 you identified in Step 5). Copy their dump files into test fixtures:

```bash
mkdir -p test/fixtures/gbif
cp scripts/output/gbif-dumps/sciurus-vulgaris.json test/fixtures/gbif/sciurusVulgaris.json
# Repeat for each selected case, naming files camelCase per species.
```

- [ ] **Step 7: Commit**

```bash
git add scripts/audit-set.txt scripts/explore-gbif-vernaculars.js .gitignore test/fixtures/gbif/
git commit -m "feat(commonNames): audit set + GBIF exploration script + captured fixtures"
```

---

## Task 14: GBIF scorer implementation

Implement `pickEnglishCommonName` using the signals identified in Task 13. Test against fixtures captured in Task 13.

**Files:**
- Create: `src/shared/commonNames/gbifScorer.js`
- Create: `test/shared/commonNames/gbifScorer.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/shared/commonNames/gbifScorer.test.js`:

```javascript
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pickEnglishCommonName } from '../../../src/shared/commonNames/gbifScorer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, '../../fixtures/gbif')

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'))
}

describe('pickEnglishCommonName', () => {
  test('returns null for null input', () => {
    assert.equal(pickEnglishCommonName(null), null)
  })

  test('returns null for empty results array', () => {
    assert.equal(pickEnglishCommonName([]), null)
  })

  test('returns null when no candidates have language="eng"', () => {
    const results = [
      { vernacularName: 'Ardilla roja', language: 'spa', source: 'EUNIS' }
    ]
    assert.equal(pickEnglishCommonName(results), null)
  })

  test('rejects candidates with Spanish/French diacritics', () => {
    const results = [
      { vernacularName: 'Ardilla Roja de Eurasia', language: 'eng', source: 'EUNIS' },
      { vernacularName: 'Eurasian Red Squirrel', language: 'eng', source: 'ITIS' }
    ]
    assert.equal(pickEnglishCommonName(results), 'Eurasian Red Squirrel')
  })

  test('prefers authoritative source (ITIS, Mammal Species of the World)', () => {
    const results = [
      { vernacularName: 'Funny Name', language: 'eng', source: 'Random Source' },
      { vernacularName: 'Eurasian Red Squirrel', language: 'eng', source: 'ITIS' }
    ]
    assert.equal(pickEnglishCommonName(results), 'Eurasian Red Squirrel')
  })

  test('respects preferred flag when set', () => {
    const results = [
      { vernacularName: 'Red Squirrel', language: 'eng', source: 'Random', preferred: false },
      { vernacularName: 'Eurasian Red Squirrel', language: 'eng', source: 'Random', preferred: true }
    ]
    assert.equal(pickEnglishCommonName(results), 'Eurasian Red Squirrel')
  })

  test('real Sciurus vulgaris fixture returns "Eurasian Red Squirrel" not "Ardilla Roja"', () => {
    const fixture = loadFixture('sciurusVulgaris.json')
    const result = pickEnglishCommonName(fixture.vernacularData.results)
    assert.ok(
      /eurasian.*squirrel/i.test(result),
      `expected a "Eurasian ... Squirrel" variant, got ${JSON.stringify(result)}`
    )
    assert.ok(
      !/ardilla/i.test(result),
      `must not pick the Spanish "Ardilla" variant, got ${JSON.stringify(result)}`
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/shared/commonNames/gbifScorer.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scorer**

Create `src/shared/commonNames/gbifScorer.js`. The weights below are a starting point; tune them using the data gathered in Task 13 Step 5.

```javascript
/**
 * Pick the most trustworthy English common name from a GBIF /vernacularNames
 * response's `results` array.
 *
 * GBIF's `language` field is unreliable — some sources mis-tag non-English
 * entries (e.g. Spanish/French) as `language: "eng"`. We score candidates
 * using multiple signals and return the highest-scored.
 *
 * Returns null if no candidate scores above zero.
 */

// Sources that, in our audit, reliably ship English English.
const TRUSTED_SOURCES = [
  /\bITIS\b/i,
  /Integrated Taxonomic Information System/i,
  /Mammal Species of the World/i
]

// Sources that, in our audit, frequently mis-tag language.
const UNTRUSTED_SOURCES = [/EUNIS/i, /Catalogue of Life/i]

// Characters that almost never appear in English common names.
const NON_ENGLISH_DIACRITICS = /[ñáéíóúüôêâîûç]/i

function scoreCandidate(entry) {
  if (!entry || typeof entry.vernacularName !== 'string') return -Infinity
  if (entry.language !== 'eng' && entry.language !== 'en') return -Infinity

  const name = entry.vernacularName.trim()
  if (name.length === 0) return -Infinity

  // Hard reject non-English character evidence.
  if (NON_ENGLISH_DIACRITICS.test(name)) return -Infinity

  let score = 1

  // Source trust.
  const src = entry.source || ''
  if (TRUSTED_SOURCES.some((r) => r.test(src))) score += 5
  if (UNTRUSTED_SOURCES.some((r) => r.test(src))) score -= 2

  // Preferred flag.
  if (entry.preferred === true) score += 3

  // Rough "looks like English" bonus: contains an ASCII space and only ASCII letters/hyphens.
  if (/^[A-Za-z][A-Za-z\s'\-]+$/.test(name)) score += 1

  return score
}

export function pickEnglishCommonName(results) {
  if (!Array.isArray(results) || results.length === 0) return null

  let best = null
  let bestScore = 0 // must beat zero — prevents picking something clearly bad
  for (const entry of results) {
    const s = scoreCandidate(entry)
    if (s > bestScore) {
      bestScore = s
      best = entry.vernacularName.trim()
    }
  }
  return best
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/shared/commonNames/gbifScorer.test.js`
Expected: PASS (7 tests).

If the Sciurus fixture test fails, examine the real data in `test/fixtures/gbif/sciurusVulgaris.json` and tune the scorer weights (e.g. increase TRUSTED_SOURCES score, add another matched source pattern). Iterate.

- [ ] **Step 5: Commit**

```bash
git add src/shared/commonNames/gbifScorer.js test/shared/commonNames/gbifScorer.test.js
git commit -m "feat(commonNames): add GBIF English-detection scorer"
```

---

## Task 15: Renderer `useCommonName` hook

Replace the two duplicated GBIF implementations with one hook. In-memory cache only (no persistence).

**Files:**
- Create: `src/renderer/src/utils/commonNames.js`
- Create: `test/renderer/utils/commonNames.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/renderer/utils/commonNames.test.js`:

```javascript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCommonName } from '../../../src/renderer/src/utils/commonNames'

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
  })
  // eslint-disable-next-line react/prop-types, react/display-name
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  global.fetch = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCommonName', () => {
  test('returns storedCommonName immediately when provided', () => {
    const { result } = renderHook(
      () => useCommonName('sciurus vulgaris', { storedCommonName: 'Eurasian Red Squirrel' }),
      { wrapper: wrapper() }
    )
    expect(result.current).toBe('Eurasian Red Squirrel')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('returns dictionary hit synchronously when no stored name', () => {
    const { result } = renderHook(
      () => useCommonName('Sciurus vulgaris', { storedCommonName: null }),
      { wrapper: wrapper() }
    )
    // Sciurus vulgaris is in the extras override.
    expect(result.current).toBe('Eurasian Red Squirrel')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('falls back to GBIF when dictionary misses, returns scored result', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ usageKey: 12345 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { vernacularName: 'Test Name', language: 'eng', source: 'ITIS' }
          ]
        })
      })

    const { result } = renderHook(
      () => useCommonName('Uncatalogued specius', { storedCommonName: null }),
      { wrapper: wrapper() }
    )

    // Initially (while fetching): falls back to scientific name.
    expect(result.current).toBe('Uncatalogued specius')

    await waitFor(() => {
      expect(result.current).toBe('Test Name')
    })
  })

  test('falls back to scientific name on GBIF failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))

    const { result } = renderHook(
      () => useCommonName('Another unknown', { storedCommonName: null }),
      { wrapper: wrapper() }
    )

    await waitFor(() => {
      expect(result.current).toBe('Another unknown')
    })
  })

  test('returns null for null scientificName', () => {
    const { result } = renderHook(
      () => useCommonName(null, { storedCommonName: null }),
      { wrapper: wrapper() }
    )
    expect(result.current).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/renderer/utils/commonNames.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `src/renderer/src/utils/commonNames.js`:

```javascript
import { useQuery } from '@tanstack/react-query'
import {
  resolveCommonName,
  pickEnglishCommonName
} from '../../../shared/commonNames/index.js'

// Module-level in-memory cache (not persisted, survives across component
// unmounts but not across reloads). Matches the pre-existing pattern.
const gbifCache = new Map()

async function fetchFromGbif(scientificName) {
  if (gbifCache.has(scientificName)) return gbifCache.get(scientificName)

  const matchRes = await fetch(
    `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`
  )
  const matchData = await matchRes.json()
  if (!matchData.usageKey) {
    gbifCache.set(scientificName, null)
    return null
  }

  const vernRes = await fetch(
    `https://api.gbif.org/v1/species/${matchData.usageKey}/vernacularNames`
  )
  const vernData = await vernRes.json()
  const picked = pickEnglishCommonName(vernData?.results ?? null)
  gbifCache.set(scientificName, picked)
  return picked
}

/**
 * Resolve a display common name via the four-tier cascade:
 *   1. storedCommonName (authoritative from DB).
 *   2. Shipped dictionary (synchronous).
 *   3. GBIF fallback via TanStack Query (in-memory cached, scored).
 *   4. Scientific name (ultimate fallback).
 *
 * @param {string | null | undefined} scientificName
 * @param {{ storedCommonName?: string | null }} options
 * @returns {string | null}
 */
export function useCommonName(scientificName, { storedCommonName } = {}) {
  const stored = typeof storedCommonName === 'string' && storedCommonName.trim() !== ''
    ? storedCommonName
    : null

  const dictHit = stored ? null : resolveCommonName(scientificName)

  const { data: gbifResult } = useQuery({
    queryKey: ['gbifCommonName', scientificName],
    queryFn: () => fetchFromGbif(scientificName),
    enabled: !!scientificName && !stored && !dictHit,
    staleTime: Infinity,
    retry: 1
  })

  if (stored) return stored
  if (dictHit) return dictHit
  if (gbifResult) return gbifResult
  return scientificName || null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/renderer/utils/commonNames.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/commonNames.js test/renderer/utils/commonNames.test.js
git commit -m "feat(renderer): add useCommonName hook with scored GBIF fallback"
```

---

## Task 16: Consume `useCommonName` in `ui/speciesDistribution.jsx`

Delete the inline `commonNamesCache` and `fetchCommonName`; replace the per-species lookup with the new hook. Because `useCommonName` is a hook, each row must be its own component (hooks can't live in a `.map` callback alongside conditional early returns).

**Files:**
- Modify: `src/renderer/src/ui/speciesDistribution.jsx`

- [ ] **Step 1: Remove imports and module state no longer needed**

Open `src/renderer/src/ui/speciesDistribution.jsx` and apply these edits.

Replace the import block at lines 1-5:

```javascript
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as Tooltip from '@radix-ui/react-tooltip'
import { sortSpeciesHumansLast, isBlank, BLANK_SENTINEL } from '../utils/speciesUtils'
import SpeciesTooltipContent from './SpeciesTooltipContent'
import { useCommonName } from '../utils/commonNames'
```

(`useEffect` and `useState` are no longer used after removing the GBIF code.)

Delete line 8 (the `commonNamesCache` module variable) entirely. It has no replacement — the new hook owns its cache.

- [ ] **Step 2: Remove the forceUpdate state and the GBIF effect**

Inside `SpeciesDistribution`, delete lines 19-20 (the `forceUpdate` call) and lines 65-150 (the `fetchCommonName` helper + the `useEffect` block that calls it). Keep `scientificToCommonMap` (lines 55-63) — it still provides authoritative CamtrapDP-sourced names.

- [ ] **Step 3: Extract a SpeciesRow component that calls the hook**

Immediately above the `SpeciesDistribution` function (or below it — order doesn't matter as long as the export stays on `SpeciesDistribution`), add:

```jsx
function SpeciesRow({
  species,
  index,
  isBlankEntry,
  storedCommonName,
  selectedSpecies,
  palette,
  totalCount,
  speciesImageMap,
  studyId,
  onToggle
}) {
  // Hook must be called unconditionally — pass null for blank entries so it short-circuits.
  const resolved = useCommonName(
    isBlankEntry ? null : species.scientificName,
    { storedCommonName }
  )
  const displayName = isBlankEntry
    ? 'Blank'
    : resolved || species.scientificName

  const isSelected = selectedSpecies.some(
    (s) => s.scientificName === species.scientificName
  )
  const colorIndex = selectedSpecies.findIndex(
    (s) => s.scientificName === species.scientificName
  )
  const color = colorIndex >= 0 ? palette[colorIndex % palette.length] : '#ccc'

  const hasImage = !isBlankEntry && !!speciesImageMap[species.scientificName]
  const enableTooltip = studyId && hasImage

  // Show scientific name in italics only when displayName differs from it
  const showScientificInItalic =
    !isBlankEntry &&
    species.scientificName &&
    displayName !== species.scientificName

  const rowContent = (
    <div className="cursor-pointer group" onClick={() => onToggle(species)}>
      <div className="flex justify-between mb-1 items-center cursor-pointer">
        <div className="flex items-center cursor-pointer">
          <div
            className={`w-2 h-2 rounded-full mr-2 border cursor-pointer ${isSelected ? `border-transparent bg-[${color}]` : 'border-gray-300'} group-hover:bg-gray-800 `}
            style={{ backgroundColor: isSelected ? color : null }}
          ></div>
          <span
            className={`text-sm ${isBlankEntry ? 'text-gray-500 italic' : 'capitalize'}`}
          >
            {displayName}
          </span>
          {showScientificInItalic && (
            <span className="text-gray-500 text-sm italic ml-2">
              {species.scientificName}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">{species.count}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="h-2 rounded-full"
          style={{
            width: `${(species.count / totalCount) * 100}%`,
            backgroundColor: isSelected ? color : '#ccc'
          }}
        ></div>
      </div>
    </div>
  )

  if (enableTooltip) {
    return (
      <Tooltip.Root key={species.scientificName || index}>
        <Tooltip.Trigger asChild>{rowContent}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="right"
            sideOffset={12}
            align="start"
            avoidCollisions={true}
            collisionPadding={16}
            className="z-[10000]"
          >
            <SpeciesTooltipContent
              imageData={speciesImageMap[species.scientificName]}
              studyId={studyId}
            />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    )
  }

  return <div key={species.scientificName || index}>{rowContent}</div>
}
```

- [ ] **Step 4: Replace the inline row rendering with SpeciesRow**

Find the `.map(...)` block (currently around lines 192-280) and replace it with:

```jsx
{sortSpeciesHumansLast(displayData).map((species, index) => {
  const isBlankEntry = isBlank(species.scientificName)
  const storedCommonName = isBlankEntry
    ? null
    : scientificToCommonMap[species.scientificName] || null
  return (
    <SpeciesRow
      key={species.scientificName || index}
      species={species}
      index={index}
      isBlankEntry={isBlankEntry}
      storedCommonName={storedCommonName}
      selectedSpecies={selectedSpecies}
      palette={palette}
      totalCount={totalCount}
      speciesImageMap={speciesImageMap}
      studyId={studyId}
      onToggle={handleSpeciesToggle}
    />
  )
})}
```

- [ ] **Step 5: Verify in the browser**

```bash
npm run dev
```

Open a study that has species. Check:
- Species the dictionary covers render their name immediately.
- Species the dictionary doesn't cover show scientific name briefly, then the GBIF result (visible via network tab or a state update).
- Sciurus vulgaris (if present in the study) shows "Eurasian Red Squirrel", not "Ardilla roja".

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/ui/speciesDistribution.jsx
git commit -m "refactor(renderer): use useCommonName in speciesDistribution"
```

---

## Task 17: Consume `useCommonName` in `overview.jsx`

Same surgery as Task 16: remove the inline GBIF fetcher, pull rendering of each row into its own component so `useCommonName` can be called per row.

**Files:**
- Modify: `src/renderer/src/overview.jsx`

- [ ] **Step 1: Add the hook import**

Near the top of `src/renderer/src/overview.jsx`, add to the imports:

```javascript
import { useCommonName } from './utils/commonNames'
```

- [ ] **Step 2: Delete the inline fetcher and its machinery**

Delete the following ranges:

1. Lines 181-221 — the entire `fetchGbifCommonName` helper function.
2. Lines 264-292 — the `speciesNeedingLookup` / `gbifQueries` / `gbifCommonNames` useMemo blocks.

Keep `scientificToCommonMap` — it still supplies authoritative CamtrapDP vernacular names.

- [ ] **Step 3: Add a SpeciesRow component inside `overview.jsx`**

Immediately above the `SpeciesDistribution` function (around line 224), add:

```jsx
function SpeciesRow({
  species,
  storedCommonName,
  speciesImageMap,
  studyId,
  totalCount,
  onRowClick
}) {
  const displayName =
    useCommonName(species.scientificName, { storedCommonName }) ||
    species.scientificName
  const hasImage = !!speciesImageMap[species.scientificName]
  const showScientific =
    species.scientificName && displayName !== species.scientificName

  return (
    <Tooltip.Root key={species.scientificName}>
      <Tooltip.Trigger asChild>
        <div
          className="cursor-pointer hover:bg-gray-50 transition-colors rounded py-1"
          onClick={() => onRowClick(species)}
        >
          <div className="flex justify-between mb-1 items-center">
            <div>
              <span className="capitalize text-sm">{displayName}</span>
              {showScientific && (
                <span className="text-gray-500 text-sm italic ml-2">
                  ({species.scientificName})
                </span>
              )}
            </div>
            <span className="text-xs text-gray-500">{species.count}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full"
              style={{ width: `${(species.count / totalCount) * 100}%` }}
            ></div>
          </div>
        </div>
      </Tooltip.Trigger>
      {hasImage && (
        <Tooltip.Portal>
          <Tooltip.Content
            side="right"
            sideOffset={12}
            align="start"
            avoidCollisions={true}
            collisionPadding={16}
            className="z-[10000]"
          >
            <SpeciesTooltipContent
              imageData={speciesImageMap[species.scientificName]}
              studyId={studyId}
            />
          </Tooltip.Content>
        </Tooltip.Portal>
      )}
    </Tooltip.Root>
  )
}
```

- [ ] **Step 4: Replace the inline row map**

Find the `.map` block in `SpeciesDistribution` (lines 306-359) and replace it with:

```jsx
{sortSpeciesHumansLast(data).map((species) => {
  const storedCommonName = scientificToCommonMap[species.scientificName] || null
  return (
    <SpeciesRow
      key={species.scientificName}
      species={species}
      storedCommonName={storedCommonName}
      speciesImageMap={speciesImageMap}
      studyId={studyId}
      totalCount={totalCount}
      onRowClick={handleRowClick}
    />
  )
})}
```

- [ ] **Step 5: Verify in the browser**

```bash
npm run dev
```

Open the overview page for a study containing Sciurus vulgaris. Check:
- Species names render immediately for dictionary-covered species.
- Species not in the dictionary briefly show scientific name, then the GBIF result.
- Sciurus vulgaris shows "Eurasian Red Squirrel", not "Ardilla roja".

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/overview.jsx
git commit -m "refactor(renderer): use useCommonName in overview"
```

---

## Task 18: Full-suite verification

Catch anything the per-task runs missed.

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Launch the app end-to-end (manual)**

```bash
npm run dev
```

Import a CamtrapDP study that includes Sciurus vulgaris, confirm the overview and species distribution both show "Eurasian Red Squirrel".

Run an ML inference on a small set of images with SpeciesNet, confirm observations get populated commonNames.

Edit an observation's species via the picker (existing list selection), confirm both fields update.
Edit via custom entry, confirm commonName is cleared.
Clear a species, confirm commonName also clears.

- [ ] **Step 3: No commit required if tests pass and manual checks pass.**

If anything fails, open a fresh task scoped to that specific regression — do not paper over with last-minute edits.

---

## Post-implementation (optional, not part of initial PR)

- **`scripts/audit-common-names.js`** — on-demand tool that runs the scorer against the audit set and emits a CSV for review. Useful when revising weights. Deferred until someone wants to use it; YAGNI for now.
- **Persistent GBIF cache table** — current design keeps the cache in memory. If users report repeated GBIF slowness, promote to a SQLite table later.
