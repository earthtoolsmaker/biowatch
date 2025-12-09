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
        │ 1:N                      │
        │                 ┌────────▼────────┐
        └────────────────►│  observations   │
                          │   (PK: ID)      │
                          └────────┬────────┘
                                   │
                                   │ N:1
                          ┌────────▼────────┐
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

```javascript
// src/main/db/schema.js
export const deployments = sqliteTable('deployments', {
  deploymentID: text('deploymentID').primaryKey(),
  locationID: text('locationID'),
  locationName: text('locationName'),
  deploymentStart: text('deploymentStart'),
  deploymentEnd: text('deploymentEnd'),
  latitude: real('latitude'),
  longitude: real('longitude')
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

```javascript
export const media = sqliteTable('media', {
  mediaID: text('mediaID').primaryKey(),
  deploymentID: text('deploymentID').references(() => deployments.deploymentID),
  timestamp: text('timestamp'),
  filePath: text('filePath'),
  fileName: text('fileName'),
  importFolder: text('importFolder'),
  folderName: text('folderName')
})
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

---

## Key Files

| File | Purpose |
|------|---------|
| `src/main/db/schema.js` | Table definitions |
| `src/main/db/manager.js` | Connection pooling |
| `src/main/db/index.js` | Database interface exports |
| `src/main/db/queries.js` | Common query functions |
| `src/main/db/migrations/` | SQL migration files |

---

## Migrations

See [Drizzle ORM Guide](./drizzle.md) for migration workflow.

Key points:
- Migrations are forward-only (no rollbacks)
- Each study database migrates independently
- Migrations run automatically on first access after app update
