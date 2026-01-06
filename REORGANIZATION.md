# src/main/ Reorganization Plan (Single PR) - Final

## Goal
Reorganize `src/main/` to improve maintainability using a clean layered architecture:
- **Presentation layer**: `ipc/` (IPC handlers)
- **Business logic layer**: `services/` (import, export, cache, ml, utilities)
- **Data layer**: `database/`

Break up the 1,864-line `index.js` monolith into focused modules.

## Target Directory Structure

```
src/main/
├── index.js                      # MINIMAL (~100 lines): Entry point
├── app/                          # Electron app lifecycle
│   ├── index.js
│   ├── lifecycle.js              # createWindow, app events, shutdown
│   ├── protocols.js              # local-file://, cached-image:// handlers
│   └── session.js                # CORS setup
├── ipc/                          # ALL IPC handlers (presentation layer)
│   ├── index.js                  # registerAllIPCHandlers()
│   ├── species.js
│   ├── deployments.js
│   ├── media.js
│   ├── observations.js
│   ├── activity.js
│   ├── study.js
│   ├── import.js
│   ├── export.js
│   ├── files.js
│   ├── dialog.js
│   ├── shell.js
│   └── ml.js                     # ML model IPC handlers
├── services/                     # ALL business logic
│   ├── index.js
│   ├── paths.js                  # getStudyPath, getStudyDatabasePath
│   ├── progress.js               # Progress broadcaster utilities
│   ├── extractor.js              # Zip extraction logic
│   ├── download.ts               # File download utilities
│   ├── study.js                  # Study management logic
│   ├── cache/                    # Caching infrastructure
│   │   ├── index.js
│   │   ├── image.js              # (from image-cache.js)
│   │   ├── video.js              # (from transcoder.js)
│   │   └── cleanup.js            # (from cache-cleanup.js)
│   ├── import/                   # Import business logic
│   │   ├── index.js
│   │   ├── importer.js
│   │   └── parsers/
│   │       ├── index.js
│   │       ├── camtrapDP.js      # (renamed from camtrap.js)
│   │       ├── wildlifeInsights.js  # (renamed from wildlife.js)
│   │       ├── deepfaune.js
│   │       └── lila.js
│   ├── export/                   # Export business logic
│   │   ├── index.js
│   │   ├── exporter.js           # (renamed from export.js)
│   │   ├── schemas.js            # (renamed from camtrapDPSchemas.js)
│   │   └── sanitizers.js
│   └── ml/                       # ML model services
│       ├── index.js
│       ├── paths.ts              # Path utilities for models/environments
│       ├── server.ts             # Server lifecycle (start/stop/health)
│       ├── download.ts           # Download and installation management
│       └── classification.js     # (moved from videoClassification.js)
├── utils/                        # Small utility modules
│   ├── index.js
│   └── bbox.js                   # (from transformers/index.js)
├── database/                     # UNCHANGED
└── migrations/                   # UNCHANGED
```

## Implementation Steps

### Step 1: Create new directories
```bash
mkdir -p src/main/app src/main/ipc src/main/services/cache src/main/services/import/parsers src/main/services/export src/main/services/ml src/main/utils
```

### Step 2: Create utils/
- Move `src/main/transformers/index.js` → `src/main/utils/bbox.js`
- Delete `src/main/transformers/`
- Create `src/main/utils/index.js` re-export hub

### Step 3: Move and reorganize import/
- Move `src/main/import/` → `src/main/services/import/`
- Rename parsers:
  - `camtrap.js` → `parsers/camtrapDP.js`
  - `wildlife.js` → `parsers/wildlifeInsights.js`
  - `deepfaune.js` → `parsers/deepfaune.js`
  - `lila.js` → `parsers/lila.js`
- Create `parsers/index.js` re-export hub
- Update imports in `importer.js`

### Step 4: Move and reorganize export/
- Move `src/main/export/` → `src/main/services/export/`
- Rename files:
  - `export.js` → `exporter.js`
  - `camtrapDPSchemas.js` → `schemas.js`
- Create `src/main/services/export/index.js` re-export hub

### Step 5: Create services/ utilities
Extract from `index.js`:

**services/paths.js**:
- `getStudyDatabasePath(userDataPath, studyId)`
- `getStudyPath(userDataPath, studyId)`

**services/progress.js**:
- `sendGbifImportProgress(progressData)`
- `sendDemoImportProgress(progressData)`
- `sendLilaImportProgress(progressData)`

**services/extractor.js**:
- `processDataset(zipFilepath, tempDir, studyPath)` - zip extraction logic

**services/download.ts** (moved from root):
- Move `src/main/download.ts` → `src/main/services/download.ts`

**services/study.js** (from root studies.js):
- Move study management logic from `src/main/studies.js`
- IPC handlers will go to `ipc/study.js`

**services/index.js**: Re-export hub

### Step 6: Create services/ml/
- Move `src/main/models.ts` → split into:
  - `src/main/services/ml/paths.ts` (path utilities)
  - `src/main/services/ml/server.ts` (server lifecycle)
  - `src/main/services/ml/download.ts` (download management)
  - `src/main/ipc/ml.js` (IPC handlers)
- Move `src/main/videoClassification.js` → `src/main/services/ml/classification.js`
- Create `src/main/services/ml/index.js` re-export hub

### Step 7: Create services/cache/
- Move `src/main/transcoder.js` → `src/main/services/cache/video.js`
- Move `src/main/image-cache.js` → `src/main/services/cache/image.js`
- Move `src/main/cache-cleanup.js` → `src/main/services/cache/cleanup.js`
- Create `src/main/services/cache/index.js` re-export hub
- Delete old files at root

### Step 8: Create app/
Extract from `index.js`:

**app/protocols.js**:
- `registerLocalFileProtocol()`
- `registerCachedImageProtocol()`

**app/session.js**:
- `setupRemoteMediaCORS()`

**app/lifecycle.js**:
- `createWindow()`
- `initializeMigrations()`
- Signal handlers, `before-quit` handler

**app/index.js**: Re-export hub

### Step 9: Create ipc/ handlers
Extract ALL IPC handlers from `index.js` (~50 handlers total):

| File | Handlers |
|------|----------|
| `ipc/species.js` | `species:get-distribution`, `species:get-blank-count`, `species:get-distinct` |
| `ipc/deployments.js` | `deployments:get`, `deployments:get-activity`, `deployments:set-*` |
| `ipc/media.js` | `media:get`, `media:get-bboxes*`, `media:set-*`, `media:count-*`, `media:get-best` |
| `ipc/observations.js` | `observations:update-*`, `observations:delete`, `observations:create` |
| `ipc/activity.js` | `activity:get-*`, `locations:get-activity` |
| `ipc/study.js` | `study:*`, `studies:list`, `studies:update` |
| `ipc/import.js` | `import:select-*`, `import:download-*`, `import:gbif-*`, `import:lila-*` |
| `ipc/export.js` | `export:*` handlers |
| `ipc/files.js` | `files:get-data` |
| `ipc/dialog.js` | `dialog:select-image` |
| `ipc/shell.js` | `shell:open-path` |

**ipc/index.js**: `registerAllIPCHandlers()` that calls all registration functions

### Step 10: Rewrite index.js
Final minimal entry point (~100 lines):
```javascript
import { app } from 'electron'
import log from 'electron-log'

import { initializeApp, createWindow } from './app/index.js'
import { registerAllIPCHandlers } from './ipc/index.js'

log.info('Starting Electron app...')

app.whenReady().then(async () => {
  await initializeApp()
  createWindow()
  registerAllIPCHandlers()
})
```

### Step 11: Update all imports
Files that need import path updates:
- `src/main/services/import/importer.js` - bbox, parser imports
- `src/main/services/export/exporter.js` - paths, schemas imports
- `src/main/app/protocols.js` - cache/image imports
- `src/main/services/ml/server.ts` - imports from paths.ts
- `src/main/services/ml/download.ts` - imports from paths.ts

### Step 12: Reorganize tests to match new structure
Create matching directory structure in `test/`:

```bash
mkdir -p test/services/ml test/services/cache test/services/import/parsers test/services/export test/database
```

Move test files:
| Test File | New Location |
|-----------|--------------|
| `video-classification.test.js` | `test/services/ml/classification.test.js` |
| `cache-cleanup.test.js` | `test/services/cache/cleanup.test.js` |
| `models.test.js` | `test/services/ml/models.test.js` |
| `deepfaune-import.test.js` | `test/services/import/parsers/deepfaune.test.js` |
| `camtrap-import.test.js` | `test/services/import/parsers/camtrapDP.test.js` |
| `wildlife-import.test.js` | `test/services/import/parsers/wildlifeInsights.test.js` |
| `studies-simple.test.js` | `test/services/study.test.js` |
| `export-sequence-grouping.test.js` | `test/services/export/sequenceGrouping.test.js` |
| `camtrap-dp-validation.test.js` | `test/services/export/schemas.test.js` |
| `queries.test.js` | `test/database/queries.test.js` |
| `database-schema.test.js` | `test/database/schema.test.js` |
| `migrations.test.js` | `test/migrations/migrations.test.js` |

Tests that stay in `test/` root (general/integration tests):
- `camtrap-null-fks.test.js`
- `sequenceGrouping.test.js`
- `selectDiverseMedia.test.js`
- `metadata-validation.test.js`
- `model-run-validation.test.js`
- `model-output-validation.test.js`
- `downloadState.test.js`
- `positioning.test.js`

Update imports in all moved test files to reference new source paths.

### Step 13: Run tests and fix imports
```bash
npm test
```
Fix any broken imports in test files.

### Step 14: Update documentation
- `docs/architecture.md` - New directory structure
- `docs/ipc-api.md` - Handler file locations

## Files to Modify/Move

| File | Action |
|------|--------|
| `src/main/index.js` | Decompose from 1,864 → ~100 lines |
| `src/main/transcoder.js` | Move to `services/cache/video.js` |
| `src/main/image-cache.js` | Move to `services/cache/image.js` |
| `src/main/cache-cleanup.js` | Move to `services/cache/cleanup.js` |
| `src/main/download.ts` | Move to `services/download.ts` |
| `src/main/models.ts` | Split into `services/ml/{paths,server,download}.ts` + `ipc/ml.js` |
| `src/main/videoClassification.js` | Move to `services/ml/classification.js` |
| `src/main/studies.js` | Split: logic → `services/study.js`, IPC → `ipc/study.js` |
| `src/main/transformers/index.js` | Move to `utils/bbox.js` |
| `src/main/import/` | Move to `services/import/` |
| `src/main/import/camtrap.js` | Rename to `parsers/camtrapDP.js` |
| `src/main/import/wildlife.js` | Rename to `parsers/wildlifeInsights.js` |
| `src/main/export/` | Move to `services/export/` |
| `src/main/export/export.js` | Rename to `exporter.js` |
| `src/main/export/camtrapDPSchemas.js` | Rename to `schemas.js` |
| `docs/architecture.md` | Update structure |
| `docs/ipc-api.md` | Update handler locations |
| `test/video-classification.test.js` | Move to `test/services/ml/classification.test.js` |
| `test/cache-cleanup.test.js` | Move to `test/services/cache/cleanup.test.js` |
| `test/models.test.js` | Move to `test/services/ml/models.test.js` |
| `test/deepfaune-import.test.js` | Move to `test/services/import/parsers/deepfaune.test.js` |
| `test/camtrap-import.test.js` | Move to `test/services/import/parsers/camtrapDP.test.js` |
| `test/wildlife-import.test.js` | Move to `test/services/import/parsers/wildlifeInsights.test.js` |
| `test/studies-simple.test.js` | Move to `test/services/study.test.js` |
| `test/export-sequence-grouping.test.js` | Move to `test/services/export/sequenceGrouping.test.js` |
| `test/camtrap-dp-validation.test.js` | Move to `test/services/export/schemas.test.js` |
| `test/queries.test.js` | Move to `test/database/queries.test.js` |
| `test/database-schema.test.js` | Move to `test/database/schema.test.js` |
| `test/migrations.test.js` | Move to `test/migrations/migrations.test.js` |

## New Files to Create

| File | Purpose |
|------|---------|
| `src/main/app/index.js` | Re-export hub |
| `src/main/app/lifecycle.js` | Window creation, app events |
| `src/main/app/protocols.js` | Custom protocol handlers |
| `src/main/app/session.js` | CORS setup |
| `src/main/ipc/index.js` | Register all IPC handlers |
| `src/main/ipc/species.js` | Species IPC handlers |
| `src/main/ipc/deployments.js` | Deployment IPC handlers |
| `src/main/ipc/media.js` | Media IPC handlers |
| `src/main/ipc/observations.js` | Observation IPC handlers |
| `src/main/ipc/activity.js` | Activity IPC handlers |
| `src/main/ipc/study.js` | Study IPC handlers |
| `src/main/ipc/import.js` | Import IPC handlers |
| `src/main/ipc/export.js` | Export IPC handlers |
| `src/main/ipc/files.js` | Files IPC handlers |
| `src/main/ipc/dialog.js` | Dialog IPC handlers |
| `src/main/ipc/shell.js` | Shell IPC handlers |
| `src/main/services/index.js` | Re-export hub |
| `src/main/services/paths.js` | Path utilities |
| `src/main/services/progress.js` | Progress broadcasters |
| `src/main/services/extractor.js` | Zip extraction |
| `src/main/services/study.js` | Study management logic |
| `src/main/services/cache/index.js` | Re-export hub |
| `src/main/services/import/index.js` | Re-export hub |
| `src/main/services/import/parsers/index.js` | Re-export all parsers |
| `src/main/services/export/index.js` | Re-export hub |
| `src/main/services/ml/index.js` | Re-export hub |
| `src/main/services/ml/paths.ts` | Path utilities for models/environments |
| `src/main/services/ml/server.ts` | Server lifecycle (start/stop/health) |
| `src/main/services/ml/download.ts` | Download and installation management |
| `src/main/services/ml/classification.js` | Video classification (moved) |
| `src/main/ipc/ml.js` | ML model IPC handlers |
| `src/main/utils/index.js` | Re-export hub |
| `src/main/utils/bbox.js` | Bbox transformations (moved) |

## Architecture Summary

```
Presentation Layer (IPC)     Business Logic Layer (Services)     Data Layer
─────────────────────────    ───────────────────────────────    ──────────
ipc/species.js          →    database/queries/species.js    →   database/
ipc/media.js            →    database/queries/media.js      →   database/
ipc/import.js           →    services/import/importer.js    →   database/
ipc/export.js           →    services/export/exporter.js    →   database/
```

## Testing Checklist
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] App starts without errors
- [ ] Import CamTrap DP dataset works
- [ ] Import Wildlife Insights works
- [ ] ML model classification works
- [ ] Export CamTrap DP works
- [ ] Video playback (transcoding) works
- [ ] Remote images load (GBIF/Agouti)
- [ ] All dashboard views load data
