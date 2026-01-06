# Data Formats

Supported import and export formats in Biowatch.

## CamTrap DP (Camera Trap Data Package)

Biowatch's primary data standard. Based on the [CamTrap DP specification](https://camtrap-dp.tdwg.org/).

### Structure

```
dataset/
├── datapackage.json    # Package metadata
├── deployments.csv     # Camera trap deployment info
├── media.csv           # Media file metadata
├── observations.csv    # Species observations
└── media/              # (Optional) Media files
```

### datapackage.json

```json
{
  "name": "dataset-slug",
  "title": "Human-readable Title",
  "description": "Dataset description (Markdown supported)",
  "version": "1.0.0",
  "created": "2024-01-15T10:30:00Z",
  "contributors": [
    {
      "title": "John Doe",
      "email": "john@example.com",
      "role": "contributor",
      "organization": "Wildlife Research Institute"
    }
  ],
  "licenses": [
    {
      "name": "CC-BY-4.0",
      "title": "Creative Commons Attribution 4.0",
      "path": "https://creativecommons.org/licenses/by/4.0/"
    }
  ],
  "temporal": {
    "start": "2023-01-01",
    "end": "2023-12-31"
  },
  "profile": "https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0/camtrap-dp-profile.json",
  "resources": [...]
}
```

### deployments.csv

| Column | Type | Description |
|--------|------|-------------|
| `deploymentID` | string | Unique deployment identifier (primary key) |
| `locationID` | string | Location identifier |
| `locationName` | string | Human-readable location name |
| `latitude` | number | Decimal degrees |
| `longitude` | number | Decimal degrees |
| `deploymentStart` | datetime | ISO 8601 with timezone |
| `deploymentEnd` | datetime | ISO 8601 with timezone |

### media.csv

| Column | Type | Description |
|--------|------|-------------|
| `mediaID` | string | Unique media identifier (primary key) |
| `deploymentID` | string | Foreign key to deployments |
| `timestamp` | datetime | Capture timestamp (ISO 8601) |
| `filePath` | string | Relative path to media file or HTTP URL |
| `filePublic` | boolean | Whether file is publicly accessible |
| `fileMediatype` | string | MIME type (e.g., `image/jpeg`, `video/mp4`) |
| `fileName` | string | Original file name |
| `exifData` | object | EXIF/metadata as JSON. For images: camera settings, GPS, timestamps (e.g., `{"Make": "RECONYX", "Model": "HP2X", "DateTimeOriginal": "2024-03-20T14:30:15.000Z", "latitude": 46.77, "longitude": 6.64}`). For videos: `{"fps": 30, "duration": 60, "frameCount": 1800}` |
| `favorite` | boolean | User-marked favorite/best capture (CamtrapDP standard field) |

### observations.csv

| Column | Type | Description |
|--------|------|-------------|
| `observationID` | string | Unique observation identifier (primary key) |
| `deploymentID` | string | Foreign key to deployments |
| `mediaID` | string | Foreign key to media |
| `eventID` | string | Event/sequence grouping |
| `eventStart` | datetime | Event start time |
| `eventEnd` | datetime | Event end time |
| `observationLevel` | string | Always `media` |
| `observationType` | string | `animal`, `human`, `vehicle`, `blank`, `unknown`, `unclassified` |
| `scientificName` | string | Latin species name |
| `count` | integer | Number of individuals (min: 1, null if unknown) |
| `lifeStage` | string | `adult`, `subadult`, `juvenile` |
| `sex` | string | `male`, `female` |
| `behavior` | string | Observed behavior |
| `bboxX` | number | Bounding box X (normalized 0-1) |
| `bboxY` | number | Bounding box Y (normalized 0-1) |
| `bboxWidth` | number | Bounding box width (normalized, min: 1e-15, max: 1) |
| `bboxHeight` | number | Bounding box height (normalized, min: 1e-15, max: 1) |
| `classificationMethod` | string | `human` or `machine` |
| `classifiedBy` | string | Model name or person |
| `classificationTimestamp` | datetime | When classification was made |
| `classificationProbability` | number | Confidence score (0-1) |

**Key files:**
- Import: `src/main/services/import/parsers/camtrapDP.js`
- Export: `src/main/services/export/exporter.js`
- Validation schemas: `src/main/services/export/schemas.js`
- Sanitization: `src/main/services/export/sanitizers.js`

### Export Validation

During CamTrap DP export, the datapackage.json, deployments, observations, and media are validated against the [official TDWG CamtrapDP 1.0 specification](https://camtrap-dp.tdwg.org/). Validation is non-blocking - warnings are logged but don't prevent export.

**Datapackage sanitization rules:**
- `name` is converted to lowercase (must be alphanumeric with hyphens only)
- `profile` is set to the official CamtrapDP 1.0 profile URL
- `created` timestamps without timezone get `Z` (UTC) appended
- Contributor `role` of `author` is mapped to `contributor` (spec-compliant roles: `contact`, `principalInvestigator`, `rightsHolder`, `publisher`, `contributor`)
- Empty `email`, `path`, `organization` in contributors converted to `null`
- Default contributor `{ title: 'Biowatch User', role: 'contributor' }` added if none provided

**Deployments sanitization rules:**
- Timestamps (`deploymentStart`, `deploymentEnd`) without timezone get `Z` (UTC) appended
- `latitude` must be in range -90 to 90
- `longitude` must be in range -180 to 180
- Empty `locationID`/`locationName` converted to `null`

**Observations sanitization rules:**
- Timestamps without timezone get `Z` (UTC) appended
- `count` values of 0 or negative become `null`
- `bboxWidth`/`bboxHeight` of 0 are clamped to `1e-15` (minimum positive)
- `lifeStage` values are mapped to enum (`baby`/`young`/`immature` → `juvenile`, `sub-adult` → `subadult`)
- `sex` values are mapped to enum (`f`/`F` → `female`, `m`/`M` → `male`)
- `classificationMethod` values are mapped (`ai`/`ml`/`auto` → `machine`, `manual` → `human`)

**Media sanitization rules:**
- Timestamps without timezone get `Z` (UTC) appended
- `fileMediatype` must match pattern `^(image|video|audio)/.*$`

**Validation summary returned:**
```json
{
  "validation": {
    "datapackage": {
      "validated": 1,
      "withIssues": 0,
      "isValid": true,
      "sampleErrors": []
    },
    "deployments": {
      "validated": 10,
      "withIssues": 0,
      "isValid": true,
      "sampleErrors": []
    },
    "observations": {
      "validated": 1000,
      "withIssues": 5,
      "isValid": false,
      "sampleErrors": [...]
    },
    "media": {
      "validated": 500,
      "withIssues": 0,
      "isValid": true,
      "sampleErrors": []
    },
    "isValid": false
  }
}
```

---

## Wildlife Insights

Export format from [Wildlife Insights](https://www.wildlifeinsights.org/).

### Structure

```
dataset/
├── projects.csv        # Project metadata
├── deployments.csv     # Camera deployments
└── images.csv          # Images with species IDs
```

### projects.csv

| Column | Maps to |
|--------|---------|
| `project_short_name` | Study name |
| `project_objectives` | Description |
| `project_admin` | Contributor name |
| `project_admin_organization` | Contributor organization |
| `project_admin_email` | Contributor email |

### deployments.csv

| Column | Maps to |
|--------|---------|
| `deployment_id` | deploymentID |
| `latitude` | latitude |
| `longitude` | longitude |
| `start_date` | deploymentStart (SQL date format) |
| `end_date` | deploymentEnd (SQL date format) |

### images.csv

Combined media + observations in one file:

| Column | Maps to |
|--------|---------|
| `image_id` | mediaID |
| `deployment_id` | deploymentID |
| `timestamp` | timestamp (SQL format) |
| `location` | filePath |
| `filename` | fileName |
| `genus` + `species` | scientificName |
| `common_name` | commonName |
| `cv_confidence` | classificationProbability |
| `number_of_objects` | count |
| `age` | lifeStage |
| `sex` | sex |
| `behavior` | behavior |
| `sequence_id` | eventID |

**Key file:** `src/main/services/import/parsers/wildlifeInsights.js`

---

## DeepFaune CSV

Export format from [DeepFaune](https://www.deepfaune.cnrs.fr/) desktop application.

### Structure

Single CSV file with image paths and predictions.

| Column | Description |
|--------|-------------|
| `filename` | Image file path |
| `prediction` | Species prediction |
| `score` | Classification probability |

**Key file:** `src/main/services/import/parsers/deepfaune.js`

---

## LILA / COCO Camera Traps

Import from [LILA BC](https://lila.science/) datasets using the [COCO Camera Traps format](https://github.com/agentmorris/MegaDetector/blob/main/megadetector/data_management/README.md#coco-camera-traps-format).

### Structure

Single JSON file following COCO Camera Traps format:

```json
{
  "info": { "version": "1.0", "description": "Dataset name" },
  "images": [image],
  "categories": [category],
  "annotations": [annotation]
}
```

### Image Object

| Field | Type | Maps to | Description |
|-------|------|---------|-------------|
| `id` | string | mediaID | Unique image identifier |
| `file_name` | string | fileName | Image filename |
| `location` | string | deploymentID | Camera location identifier |
| `datetime` | string | timestamp | Capture timestamp |
| `width` | int | (used for bbox normalization) | Image width in pixels |
| `height` | int | (used for bbox normalization) | Image height in pixels |
| `seq_id` | string | eventID | **Sequence identifier** |
| `seq_num_frames` | int | (not stored) | Total images in sequence |
| `frame_num` | int | (not stored) | Zero-indexed frame position |

### Category Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | int | Category identifier (0 = empty) |
| `name` | string | Species/category name |

### Annotation Object

| Field | Type | Maps to | Description |
|-------|------|---------|-------------|
| `id` | string | observationID | Annotation identifier |
| `image_id` | string | mediaID | Foreign key to image |
| `category_id` | int | scientificName | Category lookup |
| `bbox` | [x,y,w,h] | bboxX/Y/Width/Height | Bounding box (pixels, converted to normalized) |

### Sequence/Event Handling

Many LILA datasets include sequence information where images are grouped into "bursts" or "events":

- `seq_id` is mapped to `eventID` for sequence grouping
- `eventStart` and `eventEnd` are computed from the min/max datetime across all images in a sequence
- For datasets without `seq_id`, `eventID` is `null` and event timestamps default to image timestamp

**Datasets with sequence info:**
- Snapshot Serengeti (2.65M sequences)
- SWG Camera Traps (436K sequences)
- Snapshot Safari datasets (Karoo, Kruger, Enonkishu, etc.)
- California Small Animals
- Wellington Camera Traps

**Datasets without sequence info:**
- Biome Health Project Maasai Mara 2018
- ENA24 Detection

### Import Behavior

- Images are loaded via HTTP at runtime (not downloaded locally)
- Categories named `empty`, `blank`, or `nothing` do not create observations
- Bounding boxes are converted from pixel coordinates to normalized (0-1)
- Invalid JSON containing Python `NaN` values is automatically sanitized

**Key file:** `src/main/services/import/parsers/lila.js`

---

## Image Folder Import

Direct import from a folder of images with optional ML inference.

### Requirements

- Directory containing image files (JPG, PNG, etc.)
- Optional: Subdirectory structure (used as deployment grouping)

### Process

1. Recursively scan directory for images
2. Extract EXIF metadata (timestamp, GPS)
3. Optionally run ML model for species identification
4. Create deployments from folder structure
5. Generate media and observation records

**Key file:** `src/main/services/import/importer.js`

---

## Internal JSON Structures

### Metadata Contributors

Stored in `metadata.contributors` (JSON column):

```json
[
  {
    "title": "Jane Smith",
    "email": "jane@research.org",
    "role": "contributor",
    "organization": "Wildlife Lab",
    "path": "https://orcid.org/0000-0001-2345-6789"
  }
]
```

Valid CamtrapDP spec roles: `contact`, `principalInvestigator`, `rightsHolder`, `publisher`, `contributor`

### Model Run Options

Stored in `model_runs.options` (JSON column):

```json
{
  "country": "FR",
  "geofence": true,
  "batchSize": 5
}
```

### Raw Model Output

Stored in `model_outputs.rawOutput` (JSON column):

```json
{
  "predictions": [
    {
      "filepath": "/path/to/image.jpg",
      "prediction": "Vulpes vulpes",
      "prediction_score": 0.95,
      "classifications": {
        "classes": ["Vulpes vulpes", "Canis lupus"],
        "scores": [0.95, 0.03]
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

## Bounding Box Formats

Different models output bounding boxes in different formats. All are converted to CamTrap DP format for storage.

### CamTrap DP Format (Internal)

```
bboxX, bboxY, bboxWidth, bboxHeight
```

- Origin: top-left corner
- Values: normalized (0-1)
- Example: `0.1, 0.2, 0.3, 0.4`

### SpeciesNet Format

```
[x_min, y_min, x_max, y_max]
```

- Origin: top-left corner
- Values: normalized (0-1)
- Conversion: `width = x_max - x_min`, `height = y_max - y_min`

### DeepFaune Format

```
[x_center, y_center, width, height]
```

- Origin: center point
- Values: normalized (0-1)
- Conversion: `x = x_center - width/2`, `y = y_center - height/2`

**Transformation code:** `src/main/utils/bbox.js`

---

## GBIF Integration

Biowatch can download CamTrap DP datasets directly from [GBIF](https://www.gbif.org/).

### Process

1. User provides GBIF dataset key
2. App fetches dataset metadata from GBIF API
3. Finds `CAMTRAP_DP` endpoint in dataset endpoints
4. Downloads and extracts the dataset
5. Imports using standard CamTrap DP importer

**API endpoint:** `https://api.gbif.org/v1/dataset/{datasetKey}`

---

## Export Options

### CamTrap DP Export

| Option | Type | Description |
|--------|------|-------------|
| `includeMedia` | boolean | Copy media files to `media/` subdirectory |
| `selectedSpecies` | string[] | Filter to specific species |
| `includeBlank` | boolean | Include blank observations |

Output structure:
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

### Image Directory Export

| Option | Type | Description |
|--------|------|-------------|
| `selectedSpecies` | string[] | Species to export |
| `includeBlank` | boolean | Include blank images |

Output structure:
```
export/
├── Vulpes vulpes/
│   ├── image1.jpg
│   └── image2.jpg
├── Canis lupus/
│   └── image3.jpg
└── blank/              # If includeBlank=true
    └── image4.jpg
```

**Key file:** `src/main/services/export/exporter.js`
