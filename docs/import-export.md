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

**Key file:** `src/main/import/camtrap.js`

```javascript
// Import order matters for foreign keys
const filesToProcess = [
  { file: 'deployments.csv', table: deployments },
  { file: 'media.csv', table: media },
  { file: 'observations.csv', table: observations }
]
```

## Wildlife Insights Import

**Format detection:** Looks for `projects.csv` in directory.

**Process:**
1. Parse `projects.csv` for study metadata
2. Import `deployments.csv` → deployments table
3. Import `images.csv` → both media AND observations tables
4. Generate observation IDs as `{image_id}_obs`
5. Construct scientificName from `genus + species`

**Key file:** `src/main/import/wildlife.js`

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

**Key file:** `src/main/import/importer.js`

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
// src/main/transformers/index.js

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

**Key file:** `src/main/export.js`

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
    licenses: [{
      name: 'CC-BY-4.0',
      path: 'https://creativecommons.org/licenses/by/4.0/'
    }],
    profile: 'tabular-data-package',
    resources: [/* CSV schemas */]
  }
}
```

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
  estimatedTimeRemaining: 120,  // seconds
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

**Key file:** `src/main/image-cache.js`

```javascript
// Protocol flow
// 1. Renderer loads: cached-image://cache?studyId=X&url=https://example.com/img.jpg
// 2. Main process:
//    - Check cache: {studyId}/cache/images/{hash}_img.jpg
//    - If exists: serve from disk
//    - If not: redirect to original URL, start background download
```

## Cancellation

Exports support cancellation:

```javascript
// Request cancellation
await window.api.cancelExport()

// In export loop
if (activeExport.isCancelled) {
  break
}
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/main/import/camtrap.js` | CamTrap DP import |
| `src/main/import/wildlife.js` | Wildlife Insights import |
| `src/main/import/deepfaune.js` | DeepFaune CSV import |
| `src/main/import/importer.js` | Image folder import with ML |
| `src/main/import/index.js` | Re-exports all import functions |
| `src/main/export.js` | All export functionality |
| `src/main/download.ts` | File download with retry |
| `src/main/transformers/index.js` | Bbox format conversions |
| `src/main/image-cache.js` | Remote image caching for Best Captures |
| `src/main/cache-cleanup.js` | Cache expiration cleanup |
