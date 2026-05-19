# Import/Export Pipelines

Data import and export workflows in Biowatch.

## Import Pipeline Overview

```
User Selection
      │
      ▼
┌─────────────────┐
│  File Dialog    │
│  or Drop Zone   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│   ZIP/Folder    │────►│    Extract      │
│   Detection     │     │    (if ZIP)     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│           Format Detection               │
│  ┌──────────┬──────────┬──────────┐     │
│  │ CamTrap  │ Wildlife │ DeepFaune│     │
│  │   DP     │ Insights │   CSV    │     │
│  └──────────┴──────────┴──────────┘     │
│  ┌──────────┬──────────┐                │
│  │   LILA   │   GBIF   │                │
│  │   COCO   │ CamtrapDP│                │
│  └──────────┴──────────┘                │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│             CSV Parsing                  │
│  - Stream large files                    │
│  - Transform to internal schema          │
│  - Validate required fields              │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│           Database Insert                │
│  - Batch inserts (1000 rows)            │
│  - Foreign key order: deployments →     │
│    media → observations                  │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│          Metadata Insert                 │
│  - Study UUID                           │
│  - Importer name                        │
│  - Contributors (JSON)                  │
└─────────────────────────────────────────┘
```

## CamTrap DP Import

**Format detection:** Looks for `datapackage.json` in directory.

**Process:**

1. Parse `datapackage.json` for metadata
2. Import CSVs in dependency order:
   - `deployments.csv` → deployments table
   - `media.csv` → media table
   - `observations.csv` → observations table
3. Transform file paths to absolute paths
4. Insert study metadata

**Key file:** `src/main/services/import/parsers/camtrapDP.js`

```javascript
// Import order matters for foreign keys
const filesToProcess = [
  { file: 'deployments.csv', table: deployments },
  { file: 'media.csv', table: media },
  { file: 'observations.csv', table: observations }
]
```

**Description sanitization.** Camtrap DP packages generated from GBIF/EML
metadata frequently contain DocBook inline markup (`<emphasis>`, `<para>`,
`<ulink url="…"><citetitle>…</citetitle></ulink>`, etc.) in the `description`
field. On import the description passes through
`src/main/services/import/sanitizeDescription.js`, which strips tags, decodes
common HTML entities, and rewrites `<ulink>` as `text (url)` so URLs survive
in the plain-text value stored in `studies.description`. The same helper is
applied to the Wildlife Insights `description` field as a no-op safety net.

**Synthesized `locationID` from coordinates.** Some Camtrap DP datasets ship
with `locationID` left blank but `latitude` / `longitude` populated (e.g.,
Norwegian Alpine Tundra Rodents, Forest First Mammals). On import, when
`locationID` is empty AND both coords are present, the parser writes
`locationID = "biowatch-geo:<lat.4>,<lon.4>"` (4-decimal precision, ~11 m
on the ground). Deployments at the same physical spot share the same
synthesized ID, so re-deployments correctly group in the Deployments tab and
the Overview's location count reflects physical reality. The
`biowatch-geo:` prefix is self-identifying; the CamTrap-DP exporter strips
it back to empty so synthesized values never leak into round-tripped
packages.

**Orphan deploymentID recovery.** Camtrap DP datasets occasionally ship with
`media.csv` or `observations.csv` rows that reference `deploymentID`s missing
from `deployments.csv` — typically a curator oversight. Without recovery the
FK insert aborts mid-batch with `FOREIGN KEY constraint failed` and the entire
study is lost. The importer pre-scans these files after the deployments
insert (`src/main/services/import/parsers/orphanDeployments.js`), synthesizes
a stub deployment row for each orphan ID (with `locationID = deploymentID`,
NULL location/camera fields, and a `deploymentStart`/`deploymentEnd` window
derived from the referencing rows' min/max timestamps), then proceeds with
the media and observations inserts. Observation rows whose `mediaID` is
non-empty but missing from `media.csv` are dropped (cannot be recovered with
synthesized media — file path, mediatype, etc. cannot be fabricated). Counts
are returned on the import result and surfaced in the import-complete
progress payload as `synthesized.deployments`, `synthesized.orphanMediaRows`,
`synthesized.orphanObservationRows`, and `synthesized.droppedObservationRows`,
plus a per-stub `log.warn` line (capped at 50).

**Event-based observation expansion.** Some CamTrap DP datasets store
observations against an `event` (a time window over a deployment) rather than
directly against a media file. After CSV ingest, `expandObservationsToMedia`
paginates over the source observations (those with `mediaID IS NULL`) using
a rowid cursor (`batchSize=5000` source observations per batch). Each batch
runs an `INSERT INTO observations ... SELECT ... FROM observations o INNER
JOIN media m ...` scoped to that rowid window, then emits a progress event
with `phase: 'expanding'`, `insertedRows` (source observations processed so
far), and `totalRows` (total source observation count). After the loop, a
single DELETE removes original event-based observations that had at least
one matching media; orphan source observations (no matching media within
their event window) are intentionally preserved. The function yields the
event loop (`await new Promise(setImmediate)`) between batches so worker→main
`postMessage` calls and stdout flush in real time — without this yield, the
loop's microtask-only `await db.run(...)` calls (better-sqlite3 is synchronous)
would queue every progress event and log line until after the loop finished.

**Worker boundary (GBIF imports).** `better-sqlite3` is synchronous; on the
main process, every `db.run(...)` blocks the event loop. To keep the UI
responsive on large GBIF imports the entire `importCamTrapDatasetWithPath`
call (CSV ingest + observation expansion + metadata insert) runs in a
dedicated worker thread, `out/main/camtrap-import-worker.js`. Main spawns
the worker via `src/main/services/import/runCamtrapImportInWorker.js`, which
routes `progress` / `result` / `error` messages and listens for the IPC
handler's `AbortSignal` — when fired, it calls `worker.terminate()` and
rejects with `AbortError`. The IPC handler's existing AbortError branch
wipes the partial study directory via `cleanupStudy(id)`. The
download/extract phases stay on the main process (they are I/O-bound and
already non-blocking). Local-folder CamTrap DP imports (`import:select-camtrap-dp`)
and the demo import currently still run on main — only the GBIF path has
been moved to a worker so far.

## Wildlife Insights Import

**Format detection:** Looks for `projects.csv` in directory.

**Process:**

1. Parse `projects.csv` for study metadata
2. Import `deployments.csv` → deployments table
3. Import `images.csv` → both media AND observations tables
4. Generate observation IDs as `{image_id}_obs`
5. Construct scientificName from `genus + species`

**Key file:** `src/main/services/import/parsers/wildlifeInsights.js`

## LILA Dataset Import

**Format:** COCO Camera Traps JSON (from lila.science datasets)

**Process (small datasets <100K images):**

```
┌─────────────────┐
│  Select Dataset │
│  from Whitelist │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Download JSON  │
│  Metadata       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Parse COCO     │
│  Camera Traps   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│           Schema Mapping                 │
│  images[].location → deploymentID       │
│  images[].datetime → deploymentStart/End│
│    (MIN/MAX per location)               │
│  images[].file_name → HTTP URL          │
│  annotations[] + categories[] →         │
│    observations with normalized bbox    │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│           Database Insert               │
│  - Batch inserts (1000 rows)           │
│  - Images loaded via HTTP at runtime   │
└─────────────────────────────────────────┘
```

**Process (large datasets ≥100K images - Streaming):**

For large datasets like Snapshot Serengeti (7.1M images), a streaming architecture is used to avoid memory exhaustion:

```
┌─────────────────┐
│  Select Dataset │
│  from Whitelist │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Download JSON  │
│  (keep on disk) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│       Pass 1: Stream Categories          │
│  - Extract categories array              │
│  - Build category lookup map             │
│  - Memory: ~10MB                         │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│       Pass 2: Stream Images (5K chunks)  │
│  - Insert media to main DB               │
│  - Store image metadata in temp SQLite   │
│  - Compute sequence bounds incrementally │
│  - Compute deployment bounds             │
│  - Memory: ~100MB peak                   │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│   Pass 3: Stream Annotations (5K chunks) │
│  - Query temp DB for image metadata      │
│  - Transform to observations             │
│  - Insert to main DB                     │
│  - Memory: ~100MB peak                   │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│       Pass 4: Finalize                   │
│  - Insert deployments from temp DB       │
│  - Clean up temp database                │
│  - Insert study metadata                 │
└─────────────────────────────────────────┘
```

**Supported Datasets (24 total):**

- Biome Health Project Maasai Mara 2018 (37K images, Kenya)
- Snapshot Karoo (38K images, South Africa)
- Snapshot Serengeti (7.1M images, Tanzania) - uses streaming
- WCS Camera Traps (1.4M images, 675 species)
- NACTI (3.7M images)
- And 19 more...

**Key features:**

- Images loaded remotely via HTTP (no local download)
- COCO bbox normalized from pixels to 0-1 coordinates
- ZIP metadata extraction supported (e.g., Snapshot Karoo)
- Deployment temporal bounds derived from MIN/MAX image datetimes per location
- NaN values in JSON sanitized to null (handles Python/NumPy exports)
- **Streaming import for large datasets (≥100K images)** using:
  - `stream-json` library for memory-efficient JSON parsing
  - Temporary SQLite database for intermediate storage
  - Chunked processing (5000 records at a time)
  - WAL mode enabled for better write performance
- Sequence information imported (seq_id → eventID with eventStart/eventEnd bounds)
- `media.importFolder` is set to the dataset name (e.g., `"Snapshot Serengeti"`) so the Sources tab can group LILA media into a single source row.

**Key files:**

- `src/main/services/import/parsers/lila.js` — orchestrator
- `src/main/services/import/parsers/lila-helpers.js` — pure mapping helpers (testable without electron)

```javascript
// COCO bbox normalization
function normalizeBbox(bbox, imageWidth, imageHeight) {
  if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) return null
  const [x, y, width, height] = bbox
  return {
    bboxX: x / imageWidth,
    bboxY: y / imageHeight,
    bboxWidth: width / imageWidth,
    bboxHeight: height / imageHeight
  }
}

// Streaming threshold - datasets with more images use streaming
const STREAMING_THRESHOLD = 100000 // 100K images
```

## Image Folder Import with ML

Most complex import pipeline with streaming ML inference.

```
┌─────────────────┐
│  Select Folder  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Scan for       │
│  Images (EXIF)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Create Study DB │
│ + Model Run     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Batch Images   │────►│  HTTP Server    │
│  (5 at a time)  │     │  POST /predict  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │◄──────────────────────┘
         │  Streaming predictions
         ▼
┌─────────────────┐
│  Parse & Store  │
│  - modelOutputs │
│  - observations │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Update Status  │
│  (progress %)   │
└─────────────────┘
```

**Key file:** `src/main/services/import/importer.js`

### Video Timestamp Extraction

For images, timestamps are extracted from EXIF metadata (`DateTimeOriginal`, `CreateDate`, `MediaCreateDate`) using the `exifr` library. However, `exifr` does not support video container formats (MP4, MOV, AVI), so a dedicated fallback chain is used for video files:

1. **FFmpeg container metadata** — Reads `creation_time` from the video container using the bundled FFmpeg binary
2. **Filename pattern parsing** — Recognizes common camera trap naming conventions (e.g., `RCNX0001_20240315_143022.MP4`, `VID_20240315_143022.mp4`)
3. **File modification time** — Last resort fallback using filesystem mtime. Note: mtime may be unreliable when files are copied from SD cards. FAT32/exFAT (common on camera trap SD cards) stores timestamps at 2-second resolution in local time without timezone info, so copying across timezones can shift the time. Some copy tools or SD card readers may also reset timestamps entirely. This is why mtime is used only as a last resort.

Each extracted timestamp is validated to reject known-bad values: QuickTime epoch (1904-01-01), Unix epoch (1970-01-01), pre-2000 dates, and future dates. The source of the extracted timestamp is stored in `exifData.timestampSource` for auditability.

**Key file:** `src/main/services/import/timestamp.js`

### Prediction Flow

```javascript
// Streaming predictions generator
async function* getPredictions({ imagesPath, port, signal }) {
  const response = await fetch(`http://localhost:${port}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: imagesPath.map((path) => ({ filepath: path }))
    }),
    signal
  })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    // Parse newline-delimited JSON
    const chunk = decoder.decode(value)
    const lines = chunk.trim().split('\n')
    for (const line of lines) {
      if (line.trim()) {
        const response = JSON.parse(line)
        for (const pred of response.output.predictions) {
          yield pred
        }
      }
    }
  }
}
```

### Bbox Transformation

Different models output bboxes differently. All are normalized to CamTrap DP format:

```javascript
// src/main/utils/bbox.js

// SpeciesNet: [x_min, y_min, x_max, y_max] → CamTrap DP
function transformSpeciesNetBbox(bbox) {
  const [x_min, y_min, x_max, y_max] = bbox
  return {
    bboxX: x_min,
    bboxY: y_min,
    bboxWidth: x_max - x_min,
    bboxHeight: y_max - y_min
  }
}

// DeepFaune: [x_center, y_center, width, height] → CamTrap DP
function transformDeepFauneBbox(bbox) {
  const [x_center, y_center, width, height] = bbox
  return {
    bboxX: x_center - width / 2,
    bboxY: y_center - height / 2,
    bboxWidth: width,
    bboxHeight: height
  }
}
```

---

## Merging another study as a source

The Sources tab's **+ Add source** wizard offers two paths:

1. **Images directory** — today's folder-scan import, unchanged.
2. **Another study** — copy another local study's rows (deployments, media, observations, model runs) into the current study.

The merge is **rows only — no files are copied or moved.** Implementation:

1. Pre-flight (`study:merge-preflight`) opens both DBs read-only, counts rows, walks `media.filePath` to count missing local files, and detects whether B is already merged into A.
2. The merge (`study:merge`) runs one SQLite transaction on A's DB:
   - Insert B's deployments / media / model_runs / model_outputs / observations, prefixing every primary key with `"study:<B-uuid-short>:"` so they don't collide with A's own rows. FKs are rewritten consistently.
   - Stamp every inserted media row with `importFolder = "merge:<B-uuid>"`. This is the only durable trace of the merge — no filesystem manifest, no new table.
   - Update A's `metadata` with the user-reviewed description and contributor list (union of A's and B's, deduped by email), and extend the date range (`min` of starts, `max` of ends).
3. Rows whose source `filePath` is a local path missing from disk are skipped (along with their dependent observations).
4. Re-merging the same study is a safe no-op.

The merge convention is **biowatch-internal and not exported** to Camtrap DP. On export the synthetic `"merge:"` `importFolder` values and `"study:"` PK prefixes are not part of the package — they exist only in A's local SQLite DB.

**Deleting study B after a merge.** The delete handler scans local studies for `media WHERE importFolder = 'merge:<B-uuid>' AND filePath LIKE '<biowatch-data>/studies/<B-uuid>/%'`. If matches are found, the handler returns `{ needsConfirm: true, dependentBreaks: [...] }` and the renderer surfaces a confirmation modal before proceeding with `{ force: true }`.

## Export Pipeline Overview

```
Export Request
      │
      ▼
┌─────────────────┐
│  Select Dest    │
│  Directory      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Query Data     │
│  (with filters) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│           Export Type                    │
│  ┌──────────────┬──────────────────┐    │
│  │  CamTrap DP  │  Image Directories│    │
│  └──────────────┴──────────────────┘    │
└────────────────────┬────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│  Generate CSV   │     │  Copy/Download  │
│  + JSON files   │     │  Media Files    │
└─────────────────┘     └─────────────────┘
```

## CamTrap DP Export

**Options:**

- `includeMedia` - Copy media files to export
- `selectedSpecies` - Filter to specific species
- `includeBlank` - Include blank observations
- `sequenceGap` - Sequence grouping gap in seconds (default: 0)
  - When `0` (Off): Preserves existing `eventID`, `eventStart`, `eventEnd` from database (imported values)
  - When `> 0`: Generates new sequences by grouping observations within the gap threshold per deployment
  - Generated eventID format: `{deploymentID}_seq_{paddedIndex}` (e.g., `CAM001_seq_0001`)

**Output structure:**

```
export/
├── datapackage.json
├── deployments.csv
├── media.csv
├── observations.csv
└── media/              # If includeMedia=true
    ├── image1.jpg
    └── ...
```

**Key file:** `src/main/services/export/exporter.js`

### datapackage.json Generation

```javascript
function generateDataPackage(studyId, studyName, metadata) {
  return {
    name: slugify(studyName),
    title: metadata?.title || studyName,
    description: metadata?.description || 'Camera trap dataset exported from Biowatch',
    version: '1.0.0',
    created: new Date().toISOString(),
    contributors: metadata?.contributors || [{ title: 'Biowatch User', role: 'author' }],
    licenses: [
      {
        name: 'CC-BY-4.0',
        path: 'https://creativecommons.org/licenses/by/4.0/'
      }
    ],
    profile: 'tabular-data-package',
    resources: [
      /* CSV schemas */
    ]
  }
}
```

## Activity Map PNG Export

Saves the Activity tab's species distribution map (Leaflet basemap + pie chart markers + legend) as a PNG file. Triggered from a right-click context menu on the map.

**Flow:**

1. Renderer (`src/renderer/src/activity.jsx` → `SpeciesMap`) listens for Leaflet's `contextmenu` event via a `useMapEvents` controller.
2. Right-click renders a small fixed-position menu (`src/renderer/src/ui/ActivityMapContextMenu.jsx`) with **Save map as PNG…**.
3. On click, `html-to-image` rasterises `map.getContainer()` at `pixelRatio: 2` with a filter that strips the zoom and layer-toggle controls (attribution stays for OSM/Esri compliance).
4. The base64 PNG data URL is sent to main via `window.api.exportActivityMapPng({ dataUrl, defaultFilename })`.
5. Main (`src/main/ipc/activity.js`) shows `dialog.showSaveDialog`, then `fs.promises.writeFile`s the decoded buffer.

**Default filename:** `activity-map-<study-slug>-<YYYY-MM-DD>.png`, written to the OS Downloads folder unless the user picks elsewhere.

**Tile CORS:** both `<TileLayer>` components in `SpeciesMap` set `crossOrigin=""` so the Esri World_Imagery and OSM tiles can be rendered onto the canvas without tainting it.

## Deployments CSV (locations + names)

Round-trip flow for bulk-editing deployment coordinates and location
names. Triggered from the always-visible **Export CSV** / **Import CSV**
buttons in the Deployments-tab list panel header (sibling of the
conditional timeline header, so the controls stay reachable for studies
where `hasTimestamps === false`).

### Export

Writes one row per deployment with the canonical columns:

```
deploymentID,locationID,locationName,latitude,longitude
```

Default filename: `deployments-<study-slug>-<YYYY-MM-DD>.csv`. Rows are
sorted by `deploymentID` using `Intl.Collator({ numeric: true })` so
numeric IDs come out as `1, 2, …, 10, 11` rather than lexicographic.
Null DB values become empty cells. Synthesized `biowatch-geo:`
`locationID` prefixes are preserved as-is (unlike the CamtrapDP
exporter which strips them for spec compliance) so the round-trip is
byte-stable.

### Import (two-call flow)

1. **`deployments:parse-csv-for-import`** — pure read. Loads the CSV
   via `csv-parser`, fetches the current `deployments` snapshot, and
   classifies every cell into one of `unchanged | change | warning |
readonly`. Returns a `PreviewPayload` (see
   [ipc-api.md](./ipc-api.md#deployments-csv-importexport)) plus
   aggregate counts (`applyCount`, `rowsBlockedByWarningCount`,
   `rowSkipCount`). A row with any `warning` cell is blocked from apply
   entirely — partial-row application is not supported.
   Required column is `deploymentID`; missing it returns
   `{ error: "Required column 'deploymentID' not found in CSV." }`
   before the modal opens.
2. **`deployments:apply-csv-import`** — runs a single Drizzle
   transaction. Defensive re-validation drops out-of-range coords
   silently. Coordinate updates apply per `deploymentID`; `locationName`
   updates propagate to every deployment sharing the resolved
   `locationID` (matching the inline `set-location-name` semantics).
   On rollback the modal stays open with an inline error banner.

### Validation rules (per cell)

| Rule | Effect | Tooltip |
| --- | --- | --- |
| `deploymentID` empty | row skipped | `deploymentID is required.` |
| `deploymentID` not in DB | row skipped | `No deployment with this ID in the study.` |
| `locationID` differs from DB | cell warning | `locationID is read-only. Existing value will be kept; CSV value ignored.` |
| `latitude` non-numeric | cell warning | `'X' is not a valid number.` |
| `latitude` ∉ [-90, 90] | cell warning | `Latitude X is outside [-90, 90].` |
| `longitude` non-numeric | cell warning | `'X' is not a valid number.` |
| `longitude` ∉ [-180, 180] | cell warning | `Longitude X is outside [-180, 180].` |
| Duplicate `deploymentID` rows in CSV | earlier change cells → warning | `Overridden by row N below.` |
| Intra-`locationID` name conflict in CSV | earlier name cells → warning | `Conflicting names for LOC_A; row N below wins.` |

Empty cell semantics: empty = leave existing DB value untouched. There
is no sentinel for "clear" — clearing remains a per-row action via
`LocationPopover`. Unknown CSV columns are silently ignored.

### Preview modal UI

Virtualized via `@tanstack/react-virtual` so studies with thousands of
deployments stay responsive. The three summary tiles double as filter
toggles:

- **N rows will update** — filters to rows with at least one change cell.
- **N cells skipped** — filters to rows containing at least one warning cell.
- **N rows unknown ID** — filters to fully-skipped rows.

Click an active tile to clear; a `Show all` chip appears whenever a
filter is engaged. Row backgrounds reinforce the state: green for
change rows, amber for cell-warning rows, gray + opacity for skipped
rows. Change cells render as `old → new`; warning cells render as
`db-value · csv-value (strikethrough)` so the user sees both what stays
and what was rejected.

### Coord/name asymmetry (intentional)

Coordinates are applied **per deploymentID** (matches
`setDeploymentLatitude` / `setDeploymentLongitude`). `locationName`
propagates across the resolved `locationID`. This mirrors the existing
inline-edit behavior, so a CSV doesn't introduce a stricter invariant
than the rest of the UI. Per a 28-study audit, no real-world study has
ever exhibited intra-`locationID` coord divergence — the asymmetry
exists in the schema but doesn't fire in practice.

### Key files

- `src/main/services/export/deploymentsCsv.js` — pure CSV renderer
- `src/main/services/import/parsers/deploymentsCsv.js` — parser + validator
- `src/main/services/import/applyDeploymentsCsv.js` — transactional applier
- `src/main/ipc/deploymentsCsv.js` — IPC handlers (export, parse, apply, pick)
- `src/renderer/src/deployments/DeploymentsCsvActions.jsx` — Export/Import buttons + flow state
- `src/renderer/src/deployments/DeploymentsImportPreviewModal.jsx` — virtualized preview modal

## Image Directory Export

Organizes images into species-named folders.

**Options:**

- `selectedSpecies` - Which species to export
- `includeBlank` - Create `blank/` folder

**Output structure:**

```
export/
├── Vulpes vulpes/
│   ├── image1.jpg
│   └── image2.jpg
├── Canis lupus/
│   └── image3.jpg
└── blank/
    └── image4.jpg
```

## Parallel File Processing

Both exports use parallel file processing for performance:

```javascript
const DOWNLOAD_CONCURRENCY = 5

async function processFilesInParallel(files, processFile, tracker, concurrency) {
  let currentIndex = 0

  const workers = Array(Math.min(concurrency, files.length))
    .fill(null)
    .map(async () => {
      while (currentIndex < files.length) {
        if (activeExport.isCancelled) break

        const index = currentIndex++
        const file = files[index]

        try {
          await processFile(file, index, tracker)
          tracker.incrementProcessed()
        } catch (error) {
          tracker.incrementError()
        }
      }
    })

  await Promise.all(workers)
}
```

## Progress Tracking

Export progress is reported via IPC events:

```javascript
// Main process sends progress
sendExportProgress({
  type: 'file',
  currentFile: 150,
  totalFiles: 1000,
  fileName: 'IMG_0042.jpg',
  speciesName: 'Vulpes vulpes',
  isDownloading: true,
  downloadPercent: 45,
  errorCount: 2,
  estimatedTimeRemaining: 120, // seconds
  overallPercent: 15
})

// Renderer listens
const unsubscribe = window.api.onExportProgress((progress) => {
  setProgress(progress)
})
```

## Remote File Handling

Exports handle both local and remote (HTTP) file paths:

```javascript
function isRemoteUrl(filePath) {
  return filePath && (filePath.startsWith('http://') || filePath.startsWith('https://'))
}

// In processFile:
if (isRemote) {
  await downloadFileWithRetry(sourcePath, destPath, onProgress)
} else {
  await fs.copyFile(sourcePath, destPath)
}
```

## Remote Image Caching (Best Captures)

Remote images from GBIF, Agouti, and LILA imports are cached to disk for offline access and performance. This caching is **automatic and transparent** - no user action required.

**How it works:**

1. When Best Captures carousel displays remote images, it uses the `cached-image://` protocol
2. Main process checks if image is already cached
3. If cached → serves from local disk (instant)
4. If not cached → redirects to original URL + triggers background download
5. Next view → serves from cache

**Cache characteristics:**

- **Location:** `{userData}/biowatch-data/studies/{studyId}/cache/images/`
- **Key:** SHA256 hash of URL (first 16 characters)
- **Expiration:** 30 days (auto-cleaned at app startup)
- **Strategy:** Lazy caching (on first display, not eagerly)

**Key file:** `src/main/services/cache/image.js`

```javascript
// Protocol flow
// 1. Renderer loads: cached-image://cache?studyId=X&url=https://example.com/img.jpg
// 2. Main process:
//    - Check cache: {studyId}/cache/images/{hash}_img.jpg
//    - If exists: serve from disk
//    - If not: redirect to original URL, start background download
```

## Cancellation

### Export Cancellation

Exports support cancellation:

```javascript
// Request cancellation
await window.api.cancelExport()

// In export loop
if (activeExport.isCancelled) {
  break
}
```

### Import Cancellation (GBIF & LILA)

GBIF and LILA imports support cancellation via `AbortController`. When cancelled, the partially created study database is deleted.

```javascript
// Cancel active GBIF import (datasetKey must match the active import)
await window.api.cancelGbifImport(datasetKey)

// Cancel active LILA import (datasetId must match the active import)
await window.api.cancelLilaImport(datasetId)
```

The cancellation signal (`AbortSignal`) is threaded through the entire pipeline:

- **Downloads**: Aborts the fetch reader loop in `downloadFileWithRetry`
- **Extraction**: Destroys the unzipper read stream in `extractZip`
- **Database imports**: Checked between batch inserts (every 1000-2000 rows)

On cancellation:

1. The active operation throws an `AbortError`
2. The study database is closed and its directory is deleted
3. Temporary download/extraction files are cleaned up
4. A `stage: 'cancelled'` progress event is sent to the renderer

---

## Key Files

| File                                                   | Purpose                                               |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `src/main/services/import/parsers/camtrapDP.js`        | CamTrap DP import                                     |
| `src/main/services/import/parsers/wildlifeInsights.js` | Wildlife Insights import                              |
| `src/main/services/import/parsers/deepfaune.js`        | DeepFaune CSV import                                  |
| `src/main/services/import/parsers/lila.js`             | LILA dataset import (COCO Camera Traps)               |
| `src/main/services/import/parsers/lila-helpers.js`     | Pure helpers for LILA mapping (testable in isolation) |
| `src/main/services/import/importer.js`                 | Image folder import with ML                           |
| `src/main/services/import/timestamp.js`                | Video timestamp extraction with fallback chain        |
| `src/main/services/import/index.js`                    | Re-exports all import functions                       |
| `src/main/services/export/exporter.js`                 | All export functionality                              |
| `src/main/services/download.ts`                        | File download with retry                              |
| `src/main/utils/bbox.js`                               | Bbox format conversions                               |
| `src/main/services/cache/image.js`                     | Remote image caching for Best Captures                |
| `src/main/services/cache/cleanup.js`                   | Cache expiration cleanup                              |
