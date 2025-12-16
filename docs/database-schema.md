# Database Schema

SQLite database schema using Drizzle ORM.

## Overview

Each study has its own isolated SQLite database at:
```
biowatch-data/studies/{studyId}/study.db
```

## Entity Relationship

```
┌─────────────────┐
│    metadata     │  1 per database (study info)
└─────────────────┘

┌─────────────────┐       ┌─────────────────┐
│   deployments   │◄──────│     media       │
│   (PK: ID)      │  1:N  │   (PK: ID)      │
└─────────────────┘       └────────┬────────┘
        │                          │
        │                          │ 1:N
        │ 1:N                      ├──────────────────┐
        │                 ┌────────▼────────┐        │
        └────────────────►│  observations   │        │ 1:N
                          │   (PK: ID)      │        │
                          └────────┬────────┘ ┌──────▼──────┐
                                   │          │  ocrOutputs │
                                   │ N:1      │  (PK: ID)   │
                          ┌────────▼────────┐ └─────────────┘
                          │  modelOutputs   │◄───┐
                          │   (PK: ID)      │    │
                          └─────────────────┘    │
                                                 │ 1:N
                          ┌─────────────────┐    │
                          │   modelRuns     │────┘
                          │   (PK: ID)      │
                          └─────────────────┘
```

## Tables

### deployments

Camera trap deployment information.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `deploymentID` | TEXT | PRIMARY KEY | Unique deployment identifier |
| `locationID` | TEXT | | Location grouping identifier |
| `locationName` | TEXT | | Human-readable location name |
| `deploymentStart` | TEXT | | ISO 8601 datetime |
| `deploymentEnd` | TEXT | | ISO 8601 datetime |
| `latitude` | REAL | | Decimal degrees |
| `longitude` | REAL | | Decimal degrees |
| `cameraModel` | TEXT | | Camera make-model from EXIF (CamtrapDP format: "Make-Model") |
| `cameraID` | TEXT | | Camera serial number from EXIF |
| `coordinateUncertainty` | INTEGER | | GPS horizontal error in meters from EXIF |

The EXIF-derived fields (`cameraModel`, `cameraID`, `coordinateUncertainty`) are automatically populated during import using mode aggregation (most common value) across all media in the deployment. This ensures CamtrapDP compliance.

```javascript
// src/main/database/models.js
export const deployments = sqliteTable('deployments', {
  deploymentID: text('deploymentID').primaryKey(),
  locationID: text('locationID'),
  locationName: text('locationName'),
  deploymentStart: text('deploymentStart'),
  deploymentEnd: text('deploymentEnd'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  // CamtrapDP fields extracted from EXIF
  cameraModel: text('cameraModel'),
  cameraID: text('cameraID'),
  coordinateUncertainty: integer('coordinateUncertainty')
})
```

---

### media

Media file metadata.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `mediaID` | TEXT | PRIMARY KEY | Unique media identifier |
| `deploymentID` | TEXT | FK → deployments | Parent deployment |
| `timestamp` | TEXT | | Capture timestamp (ISO 8601) |
| `filePath` | TEXT | | Absolute path or HTTP URL |
| `fileName` | TEXT | | Original file name |
| `importFolder` | TEXT | | Source import folder |
| `folderName` | TEXT | | Subfolder name within import |
| `fileMediatype` | TEXT | | IANA media type (e.g., `image/jpeg`, `video/mp4`) |
| `exifData` | TEXT | JSON | EXIF/metadata as JSON (see below) |
| `favorite` | INTEGER | DEFAULT 0 | User-marked favorite/best capture (CamtrapDP compliant) |

```javascript
export const media = sqliteTable('media', {
  mediaID: text('mediaID').primaryKey(),
  deploymentID: text('deploymentID').references(() => deployments.deploymentID),
  timestamp: text('timestamp'),
  filePath: text('filePath'),
  fileName: text('fileName'),
  importFolder: text('importFolder'),
  folderName: text('folderName'),
  fileMediatype: text('fileMediatype').default('image/jpeg'),
  exifData: text('exifData', { mode: 'json' }),
  favorite: integer('favorite', { mode: 'boolean' }).default(false)
})
```

#### exifData Field

The `exifData` field stores extracted metadata as JSON. All Date values are serialized as ISO 8601 strings.

**For images** (full EXIF extracted via exifr):
```json
{
  "Make": "RECONYX",
  "Model": "HP2X",
  "DateTimeOriginal": "2024-03-20T14:30:15.000Z",
  "ExposureTime": 0.004,
  "FNumber": 2.8,
  "ISO": 400,
  "FocalLength": 3.1,
  "latitude": 46.7712,
  "longitude": 6.6413,
  "GPSAltitude": 1250,
  "ImageWidth": 3840,
  "ImageHeight": 2160
}
```

**For videos** (extracted from ML model response):
```json
{
  "fps": 30,
  "duration": 60.5,
  "frameCount": 1815
}
```

---

### observations

Species observations linked to media.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `observationID` | TEXT | PRIMARY KEY | Unique observation identifier |
| `mediaID` | TEXT | FK → media | Parent media |
| `deploymentID` | TEXT | FK → deployments | Parent deployment |
| `eventID` | TEXT | | Event/sequence grouping |
| `eventStart` | TEXT | | Event start (ISO 8601) |
| `eventEnd` | TEXT | | Event end (ISO 8601) |
| `scientificName` | TEXT | | Latin species name |
| `observationType` | TEXT | | `animal`, `blank`, etc. |
| `commonName` | TEXT | | Common name |
| `classificationProbability` | REAL | | Classification probability (0-1) |
| `count` | INTEGER | | Number of individuals |
| `lifeStage` | TEXT | | `adult`, `juvenile`, etc. |
| `age` | TEXT | | Age descriptor |
| `sex` | TEXT | | `male`, `female`, `unknown` |
| `behavior` | TEXT | | Observed behavior |
| `bboxX` | REAL | | Bounding box X (normalized 0-1) |
| `bboxY` | REAL | | Bounding box Y (normalized 0-1) |
| `bboxWidth` | REAL | | Bounding box width (normalized 0-1) |
| `bboxHeight` | REAL | | Bounding box height (normalized 0-1) |
| `detectionConfidence` | REAL | | Detection confidence (bbox) |
| `modelOutputID` | TEXT | FK → modelOutputs | Link to ML prediction |
| `classificationMethod` | TEXT | | `machine` or `human` |
| `classifiedBy` | TEXT | | Model name or person name |
| `classificationTimestamp` | TEXT | | When classified (ISO 8601) |

```javascript
export const observations = sqliteTable('observations', {
  observationID: text('observationID').primaryKey(),
  mediaID: text('mediaID').references(() => media.mediaID),
  deploymentID: text('deploymentID').references(() => deployments.deploymentID),
  eventID: text('eventID'),
  eventStart: text('eventStart'),
  eventEnd: text('eventEnd'),
  scientificName: text('scientificName'),
  observationType: text('observationType'),
  commonName: text('commonName'),
  classificationProbability: real('classificationProbability'),
  count: integer('count'),
  lifeStage: text('lifeStage'),
  age: text('age'),
  sex: text('sex'),
  behavior: text('behavior'),
  bboxX: real('bboxX'),
  bboxY: real('bboxY'),
  bboxWidth: real('bboxWidth'),
  bboxHeight: real('bboxHeight'),
  detectionConfidence: real('detectionConfidence'),
  modelOutputID: text('modelOutputID').references(() => modelOutputs.id),
  classificationMethod: text('classificationMethod'),
  classifiedBy: text('classifiedBy'),
  classificationTimestamp: text('classificationTimestamp')
})
```

---

### metadata

Study-level metadata (one row per database).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Study UUID |
| `name` | TEXT | | Package name/slug |
| `title` | TEXT | | Human-readable title |
| `description` | TEXT | | Markdown description |
| `created` | TEXT | NOT NULL | Creation timestamp (ISO 8601) |
| `importerName` | TEXT | NOT NULL | Import source identifier |
| `contributors` | TEXT | JSON | Array of contributor objects |
| `updatedAt` | TEXT | | Last modification |
| `startDate` | TEXT | | Temporal coverage start |
| `endDate` | TEXT | | Temporal coverage end |

```javascript
export const metadata = sqliteTable('metadata', {
  id: text('id').primaryKey(),
  name: text('name'),
  title: text('title'),
  description: text('description'),
  created: text('created').notNull(),
  importerName: text('importerName').notNull(),
  contributors: text('contributors', { mode: 'json' }),
  updatedAt: text('updatedAt'),
  startDate: text('startDate'),
  endDate: text('endDate')
})
```

**importerName values:**
- `camtrap/datapackage` - CamTrap DP import
- `wildlife/folder` - Wildlife Insights import
- `local/images` - Image folder import
- `local/ml_run` - Local folder with ML model processing
- `deepfaune/csv` - DeepFaune CSV import

---

### modelRuns

ML model execution sessions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `modelID` | TEXT | NOT NULL | Model identifier (`speciesnet`, `deepfaune`) |
| `modelVersion` | TEXT | NOT NULL | Model version string |
| `startedAt` | TEXT | NOT NULL | Run start time (ISO 8601) |
| `status` | TEXT | DEFAULT 'running' | `running`, `completed`, `failed` |
| `importPath` | TEXT | | Source directory for this run |
| `options` | TEXT | JSON | Run configuration options |

```javascript
export const modelRuns = sqliteTable('model_runs', {
  id: text('id').primaryKey(),
  modelID: text('modelID').notNull(),
  modelVersion: text('modelVersion').notNull(),
  startedAt: text('startedAt').notNull(),
  status: text('status').default('running'),
  importPath: text('importPath'),
  options: text('options', { mode: 'json' })
})
```

---

### modelOutputs

Raw ML model predictions linked to media.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `mediaID` | TEXT | NOT NULL, FK → media | Parent media (CASCADE delete) |
| `runID` | TEXT | NOT NULL, FK → modelRuns | Parent run (CASCADE delete) |
| `rawOutput` | TEXT | JSON | Full model response JSON |

```javascript
export const modelOutputs = sqliteTable(
  'model_outputs',
  {
    id: text('id').primaryKey(),
    mediaID: text('mediaID')
      .notNull()
      .references(() => media.mediaID, { onDelete: 'cascade' }),
    runID: text('runID')
      .notNull()
      .references(() => modelRuns.id, { onDelete: 'cascade' }),
    rawOutput: text('rawOutput', { mode: 'json' })
  },
  (table) => [unique().on(table.mediaID, table.runID)]
)
```

**Unique constraint:** One output per media per run.

---

### ocrOutputs

OCR extraction results for media files. Used to extract burned-in timestamps from camera trap images when EXIF data is missing.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `mediaID` | TEXT | NOT NULL, FK → media | Parent media (CASCADE delete) |
| `modelID` | TEXT | NOT NULL | OCR engine identifier (e.g., `tesseract`) |
| `modelVersion` | TEXT | NOT NULL | OCR engine version (e.g., `5.1.1`) |
| `createdAt` | TEXT | NOT NULL | Extraction timestamp (ISO 8601) |
| `rawOutput` | TEXT | JSON | Full OCR results JSON |

```javascript
export const ocrOutputs = sqliteTable(
  'ocr_outputs',
  {
    id: text('id').primaryKey(),
    mediaID: text('mediaID')
      .notNull()
      .references(() => media.mediaID, { onDelete: 'cascade' }),
    modelID: text('modelID').notNull(),
    modelVersion: text('modelVersion').notNull(),
    createdAt: text('createdAt').notNull(),
    rawOutput: text('rawOutput', { mode: 'json' })
  },
  (table) => [index('idx_ocr_outputs_mediaID').on(table.mediaID)]
)
```

**Index:** `idx_ocr_outputs_mediaID` for efficient media lookups.

---

## JSON Field Formats

### contributors (metadata.contributors)

```json
[
  {
    "title": "Jane Smith",
    "email": "jane@research.org",
    "role": "author",
    "organization": "Wildlife Research Lab",
    "path": "https://orcid.org/0000-0001-2345-6789"
  }
]
```

### options (modelRuns.options)

```json
{
  "country": "FR",
  "geofence": true,
  "batchSize": 5,
  "confidenceThreshold": 0.5
}
```

### rawOutput (modelOutputs.rawOutput)

```json
{
  "predictions": [
    {
      "filepath": "/path/to/image.jpg",
      "prediction": "Vulpes vulpes",
      "prediction_score": 0.95,
      "classifications": {
        "classes": ["Vulpes vulpes", "Canis lupus", "blank"],
        "scores": [0.95, 0.03, 0.02]
      },
      "detections": [
        {
          "label": "animal",
          "conf": 0.98,
          "bbox": [0.1, 0.2, 0.5, 0.6]
        }
      ],
      "model_version": "4.0.1a"
    }
  ]
}
```

### rawOutput (ocrOutputs.rawOutput)

```json
{
  "topRegion": {
    "text": "03/20/24 02:32:15 PM",
    "confidence": 0.45
  },
  "bottomRegion": {
    "text": "03/20/24 02:32:15 PM  22°C",
    "confidence": 0.91
  },
  "parsedDate": "2024-03-20T14:32:15.000Z",
  "dateFormat": "MM/DD/YY hh:mm:ss A",
  "selectedRegion": "bottom"
}
```

**Fields:**
- `topRegion` / `bottomRegion` - OCR results from top/bottom 15% of image
- `text` - Raw OCR text extracted
- `confidence` - Tesseract confidence score (0-1)
- `parsedDate` - Extracted timestamp in ISO 8601 format (null if parsing failed)
- `dateFormat` - Detected date format pattern
- `selectedRegion` - Which region was used for the final timestamp (`top` or `bottom`)

---

## Key Files

| File | Purpose |
|------|---------|
| `src/main/database/models.js` | Table definitions (Drizzle ORM) |
| `src/main/database/validators.js` | Zod validation schemas |
| `src/main/database/manager.js` | Connection pooling |
| `src/main/database/index.js` | Unified database exports |
| `src/main/database/queries/` | Query functions by domain |
| `src/main/database/queries/media.js` | Media queries |
| `src/main/database/queries/species.js` | Species analytics queries |
| `src/main/database/queries/observations.js` | Observation CRUD |
| `src/main/database/queries/deployments.js` | Deployment queries |
| `src/main/database/queries/best-media.js` | Best media selection |
| `src/main/database/queries/utils.js` | Query utilities |
| `src/main/database/migrations/` | SQL migration files |

---

## Migrations

See [Drizzle ORM Guide](./drizzle.md) for migration workflow.

Key points:
- Migrations are forward-only (no rollbacks)
- Each study database migrates independently
- Migrations run automatically on first access after app update
