# Architecture

System architecture and design patterns for Biowatch.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron App                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   Renderer Process                         │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │   React     │  │  TanStack   │  │    Tailwind     │   │  │
│  │  │   Router    │  │   Query     │  │      CSS        │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │  │
│  │                          │                                 │  │
│  │                    window.api.*                            │  │
│  └──────────────────────────┼────────────────────────────────┘  │
│                             │ IPC                                │
│  ┌──────────────────────────┼────────────────────────────────┐  │
│  │                   Preload Script                           │  │
│  │              src/preload/index.js                          │  │
│  └──────────────────────────┼────────────────────────────────┘  │
│                             │ ipcMain.handle()                   │
│  ┌──────────────────────────┼────────────────────────────────┐  │
│  │                    Main Process                            │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │  Database   │  │   Import/   │  │    ML Model     │   │  │
│  │  │  (Drizzle)  │  │   Export    │  │   Management    │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP (localhost)
                              ▼
              ┌───────────────────────────────┐
              │     Python ML Model Server    │
              │    (FastAPI /predict)         │
              └───────────────────────────────┘
```

## Process Model

### Renderer Process

- **Technology**: React 18 + React Router 7 + TailwindCSS 4
- **State**: TanStack Query for server state
- **Entry**: `src/renderer/src/base.jsx`
- **Communication**: Calls `window.api.*` methods exposed by preload

### Preload Script

- **Purpose**: Secure bridge between renderer and main process
- **Entry**: `src/preload/index.js`
- **Pattern**: Wraps `ipcRenderer.invoke()` calls into a clean API

### Main Process

- **Technology**: Node.js + Electron
- **Entry**: `src/main/index.js`
- **Responsibilities**:
  - IPC handlers for all data operations
  - Database management (Drizzle ORM)
  - File system access
  - ML model server lifecycle
  - Auto-updates
  - Theme service (wraps `nativeTheme`, persists user preference to
    `userData/preferences.json`, broadcasts `theme:changed` to renderers).
    Initialized before `BrowserWindow` creation so the window's
    `backgroundColor` matches the resolved theme on first paint.

### Worker Threads

`better-sqlite3` is fully synchronous: every query blocks the Node event loop. To keep the main process responsive (IPC, cancel buttons, progress events), heavy SQL workloads run in dedicated worker threads. Each worker is a separate rollup input in `electron.vite.config.mjs` and ships beside the main bundle.

| Worker | Source | Purpose |
| --- | --- | --- |
| `sequences-worker` | `src/main/services/sequences/worker.js` | Sequence-aware analytics (species distribution, timeseries, heatmap, daily activity, best-media). Spawned per request via `runInWorker`. |
| `merge-worker` | `src/main/services/merge/worker.js` | Streams source → target study merge with cancellation. |
| `merge-preflight-worker` | `src/main/services/merge/preflightWorker.js` | Pre-flight count + diff for the merge IPC. |
| `camtrap-import-worker` | `src/main/services/import/parsers/camtrapDPWorker.js` | CamtrapDP / GBIF import (CSV ingest + observation expansion). Spawned by `runCamtrapImportInWorker`. |

Cancel is uniformly `worker.terminate()`: SQLite WAL recovery rolls back any in-flight transaction on next DB open, leaving prior state intact. For imports, the IPC handler additionally calls `cleanupStudy(id)` to wipe the partial study directory.

### Python ML Servers

- **Technology**: FastAPI with conda environment
- **Pattern**: Spawned as child processes, communicate via HTTP
- **Endpoint**: `POST /predict` for inference
- **Lifecycle**: Started on-demand, stopped via shutdown API key

## Directory Structure

```
src/
├── main/                    # Electron main process
│   ├── index.js             # Minimal app entry point
│   ├── app/                 # Application lifecycle
│   │   ├── index.js         # Re-exports
│   │   ├── lifecycle.js     # Window creation, initialization
│   │   ├── protocols.js     # Custom protocol handlers
│   │   └── session.js       # Session configuration
│   ├── ipc/                 # IPC handlers (presentation layer)
│   │   ├── index.js         # Registers all handlers
│   │   ├── species.js       # Species-related handlers
│   │   ├── deployments.js   # Deployment handlers
│   │   ├── media.js         # Media handlers
│   │   ├── observations.js  # Observation handlers
│   │   ├── activity.js      # Activity handlers
│   │   ├── sequences.js     # Sequence-aware counting handlers
│   │   ├── study.js         # Study management handlers
│   │   ├── import.js        # Import handlers
│   │   ├── queue.js         # Queue status/pause/resume handlers
│   │   ├── files.js         # File operation handlers
│   │   ├── dialog.js        # Dialog handlers
│   │   └── shell.js         # Shell operation handlers
│   ├── services/            # Business logic layer
│   │   ├── paths.js         # Path utilities
│   │   ├── progress.js      # Progress reporting
│   │   ├── extractor.js     # Metadata extraction
│   │   ├── study.js         # Study metadata management
│   │   ├── download.ts      # File download utilities
│   │   ├── ffmpeg.js        # Shared FFmpeg binary path resolution
│   │   ├── queue.js          # Persistent job queue service
│   │   ├── queue-consumer.js # Base consumer (poll/claim/process loop)
│   │   ├── queue-scheduler.js# Singleton: ties consumers to active study
│   │   ├── server-manager.js # ML server lifecycle (one at a time)
│   │   ├── inference-consumer.js # ML inference consumer
│   │   ├── prediction.js    # Prediction utilities (insert, stream, EXIF)
│   │   ├── import/          # Data importers
│   │   │   ├── index.js     # Importer exports
│   │   │   ├── importer.js  # Media scanning + job enqueueing
│   │   │   ├── timestamp.js # Video timestamp extraction (FFmpeg → filename → mtime)
│   │   │   └── parsers/     # Format-specific parsers
│   │   │       ├── camtrapDP.js      # CamTrap DP importer
│   │   │       ├── wildlifeInsights.js # Wildlife Insights importer
│   │   │       ├── deepfaune.js      # DeepFaune CSV importer
│   │   │       └── lila.js           # LILA dataset importer
│   │   ├── export/          # Data exporters
│   │   │   ├── exporter.js  # Export handlers
│   │   │   ├── schemas.js   # CamTrap DP validation schemas
│   │   │   └── sanitizers.js
│   │   ├── ml/              # ML model services
│   │   │   ├── index.js     # Re-exports
│   │   │   ├── paths.ts     # Path utilities for models/environments
│   │   │   ├── server.ts    # Server lifecycle (start/stop/health)
│   │   │   ├── download.ts  # Download and installation management
│   │   │   └── classification.js  # Video classification logic
│   │   ├── sequences/       # Sequence grouping and counting
│   │   │   ├── index.js     # Re-exports
│   │   │   ├── grouping.js  # Media sequence grouping logic
│   │   │   └── speciesCounts.js  # Sequence-aware species counting
│   │   └── cache/           # Caching services
│   │       ├── video.js     # Video transcoding with FFmpeg
│   │       ├── image.js     # Image caching utilities
│   │       └── cleanup.js   # Cache cleanup
│   ├── utils/               # Pure utilities
│   │   ├── index.js         # Re-exports
│   │   └── bbox.js          # Bbox format conversions
│   ├── database/            # Database layer
│   │   ├── models.js        # Drizzle table definitions
│   │   ├── validators.js    # Zod validation schemas
│   │   ├── manager.js       # Connection pooling
│   │   ├── index.js         # Unified exports
│   │   ├── migrations-utils.js
│   │   ├── queries/         # Query functions by domain
│   │   │   ├── index.js     # Re-exports all queries
│   │   │   ├── media.js     # Media queries
│   │   │   ├── species.js   # Species analytics
│   │   │   ├── observations.js
│   │   │   ├── deployments.js
│   │   │   ├── best-media.js
│   │   │   └── utils.js
│   │   └── migrations/      # SQL migration files
│   └── migrations/          # App data migrations (not DB)
│       └── *.js             # Version upgrade scripts
├── renderer/src/            # React frontend
│   ├── base.jsx             # App root, routing, layout
│   ├── import.jsx           # Data import page
│   ├── study.jsx            # Study overview/selection
│   ├── deployments.jsx      # Map + deployment list + inline media pane on selection
│   ├── deployments/         # Deployments-tab subcomponents
│   │   ├── DeploymentDetailPane.jsx  # Bottom pane mounted when a deployment is selected
│   │   ├── SectionHeader.jsx         # Always-expanded section header for co-located deployments
│   │   ├── Sparkline.jsx             # Activity sparkline renderer (bars/line/heatmap)
│   │   ├── SparklineToggle.jsx       # Sparkline mode toggle in timeline header
│   │   ├── LocationPopover.jsx       # Lat/lon editing popover in detail pane header
│   │   ├── coordinateParser.js       # Pure parser for "lat, lon" paste field
│   │   ├── groupDeployments.js       # Pure helper grouping deployments by location
│   │   └── urlState.js               # ?deploymentID=… URL state helpers
│   ├── media.jsx            # Media tab outer shell (filters, timeline, radar)
│   ├── media/               # Media subcomponents shared with the Deployments tab
│   │   ├── Gallery.jsx               # Sequence grid + ImageModal + bbox editor
│   │   └── DeploymentMediaGallery.jsx # Deployment-scoped wrapper around Gallery
│   ├── activity.jsx         # Explore tab — Map | Gallery | Both view toggle (reuses media/Gallery), temporal analysis (right-click map → Save as PNG)
│   ├── models/              # AI Models tab (split-view map + cards)
│   │   ├── index.jsx                  # MlZoo top-level (responsive split/stacked)
│   │   ├── MapPane.jsx                # Leaflet map + region overlays + worldwide chip
│   │   ├── ModelListPane.jsx          # Ordered model cards + custom row
│   │   ├── ModelCard.jsx              # One model card (Not / Downloading / Downloaded)
│   │   ├── SpeciesPanel.jsx           # Per-model species browser (chips or grouped)
│   │   ├── CustomModelCard.jsx        # "Custom model for your region" CTA
│   │   ├── regions.js                 # Region color/label/geojson registry
│   │   ├── speciesPanelHelpers.js     # Pure filter + class-summary helpers
│   │   └── useResponsiveLayout.js     # split (≥900px) vs stacked (<900px)
│   ├── settings.jsx         # Settings pages
│   ├── export.jsx           # Export UI
│   ├── sources.jsx          # Sources tab (per-importFolder rollup, multi-source aware)
│   ├── overview.jsx         # Editorial showcase tab (header, KPI band, captures, species)
│   ├── overview/            # Overview-tab subcomponents
│   │   ├── EditorialHeader.jsx       # Title + description + byline + map slot
│   │   ├── KpiBand.jsx, KpiTile.jsx  # 5-tile stats band
│   │   ├── ContributorByline.jsx, ContributorsModal.jsx
│   │   ├── BestCapturesSection.jsx   # Best media carousel + Featured species fallback
│   │   ├── CommonSpeciesFallback.jsx # Wikipedia thumbnails when no scored media
│   │   ├── SpeciesDistribution.jsx   # Full-width species list with IUCN legend
│   │   ├── SpanPicker.jsx            # Two-calendar date-range picker
│   │   └── utils/formatStats.js      # KPI formatters
│   ├── ui/                  # Reusable components
│   ├── undo/                # Undo/redo system for annotation edits
│   │   ├── UndoManager.js   # Stack class with bounded history + pulse/error events
│   │   ├── commands.js      # Command builders (create/delete/update-bbox/update-classification)
│   │   └── context.jsx      # UndoProvider + useUndo hook
│   └── hooks/               # Custom React hooks
│       └── useSparklineMode.js # Sparkline display mode state (bars/line/heatmap)
├── preload/
│   └── index.js             # IPC bridge API
└── shared/
    ├── mlmodels.js          # Model zoo configuration
    ├── countries.js         # Country codes for geofencing
    ├── commonNames/         # Scientific → common name dictionary
    └── speciesInfo/         # Per-species reference data (IUCN, blurb, image)
```

## Data Flow

### Import Flow

```
User selects dataset
        │
        ▼
┌─────────────────┐     ┌──────────────────┐
│  Dialog opens   │────▶│  IPC: import:*   │
└─────────────────┘     └────────┬─────────┘
                                 │
        ┌────────────────────────┼────────────────────────────┐
        │                        │                            │
        ▼                        ▼                            ▼
┌───────────────┐    ┌───────────────────┐    ┌──────────────────┐
│  camtrap.js   │    │   wildlife.js     │    │   importer.js    │
│ (CamTrap DP)  │    │(Wildlife Insights)│    │ (Images + Model) │
└───────┬───────┘    └─────────┬─────────┘    └────────┬─────────┘
        │                      │                       │
        └──────────────────────┼───────────────────────┘
                               ▼
                    ┌────────────────────┐
                    │   SQLite Database  │
                    │  (study.db)        │
                    └────────────────────┘
```

### Query Flow

```
React Component
        │
        │ useQuery({ queryFn: () => window.api.getSequences() })
        ▼
┌─────────────────┐
│   preload/      │
│   index.js      │
└────────┬────────┘
         │ ipcRenderer.invoke('sequences:get-paginated', studyId, options)
         ▼
┌─────────────────┐
│   main/         │
│   ipc/sequences │  ──▶ ipcMain.handle('sequences:get-paginated', ...)
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│  database/              │
│  queries/sequences      │
│  getMediaForSequence... │
└────────┬────────────────┘
         │
         ▼
┌─────────────────┐
│   Drizzle ORM   │
│   SQLite        │
└─────────────────┘
```

### ML Inference Flow (Queue-Based)

```
User selects folder + model
        │
        ▼
┌─────────────────────┐
│   importer.js       │  Scan folder, insert media, enqueue jobs
│   Importer.start()  │  into study.db `jobs` table
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  QueueScheduler     │  Singleton: manages active study consumer
│  (queue-scheduler)  │  Calls recoverStale() on start
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  InferenceConsumer  │  Polls jobs table: claimBatch → process → complete/fail
│  (inference-consumer)│  Creates modelRuns record, handles abort
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  ServerManager      │  One ML server at a time, reuses across batches
│  (server-manager)   │  Wraps startMLModelHTTPServer/stop
└──────────┬──────────┘
           │ HTTP localhost:{port}
           ▼
┌─────────────────────┐      ┌─────────────────┐
│   getPredictions()  │─────▶│  POST /predict  │
│   async generator   │      │  { filepaths }  │
└──────────┬──────────┘      └────────┬────────┘
           │                          │
           │◀─────────────────────────┘
           │  Stream: { predictions, bboxes }
           ▼
┌─────────────────────┐
│  insertPrediction() │  Per-image or insertVideoPredictions() per-video
│  → observations +   │  Jobs marked complete/failed in `jobs` table
│  modelOutputs       │
└─────────────────────┘
```

**Pause**: Instant — sets boolean flag, server stays running.
**Resume**: Instant — clears flag (or cold-starts from modelRuns if app restarted).
**Crash recovery**: `recoverStale()` resets `processing` → `pending` on next start.

## Study Isolation

Each study has its own SQLite database:

```
biowatch-data/
└── studies/
    ├── {uuid-1}/
    │   └── study.db
    ├── {uuid-2}/
    │   └── study.db
    └── {uuid-3}/
        └── study.db
```

**Benefits**:

- Complete data isolation between studies
- Easy backup/restore (copy folder)
- Independent migrations per study
- No cross-study query complexity

**Cross-study merges.** The Sources tab's "+ Add source → Another study" path copies one study's rows into another's DB. Despite the name, no files move on disk and isolation is preserved: the source study is read-only during the merge and untouched afterward. Merged rows in the target carry the synthetic marker `media.importFolder = "merge:<source-uuid>"` plus a PK prefix (`study:<short-uuid>:`) so they can be identified later (Sources tab grouping, delete-time safety check). See `docs/import-export.md` for the full data flow and `docs/database-schema.md` for the column-level details.

**Database path resolution**:

```javascript
// src/main/services/paths.js
function getStudyDatabasePath(userDataPath, studyId) {
  return join(getStudyPath(userDataPath, studyId), 'study.db')
}

function getStudyPath(userDataPath, studyId) {
  return join(userDataPath, 'biowatch-data', 'studies', studyId)
}
```

## Key Files Reference

| File                                                    | Purpose                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| `src/main/index.js`                                     | Minimal app entry point                                     |
| `src/main/app/lifecycle.js`                             | Window creation, app initialization                         |
| `src/main/ipc/index.js`                                 | Registers all IPC handlers                                  |
| `src/preload/index.js`                                  | IPC bridge, exposes `window.api`                            |
| `src/renderer/src/base.jsx`                             | React app root, routing                                     |
| `src/renderer/src/deployments.jsx`                      | Deployments tab — map + list + inline media pane            |
| `src/renderer/src/deployments/DeploymentDetailPane.jsx` | Bottom pane (header + close) mounted on selection           |
| `src/renderer/src/deployments/urlState.js`              | `?deploymentID=…` URL state helpers                         |
| `src/renderer/src/activity.jsx`                         | Explore tab — Map \| Gallery \| Both view toggle (reuses Gallery), map + temporal filters |
| `src/renderer/src/media.jsx`                            | Media tab — filters, timeline, daily-activity radar (separate page, pending rework) |
| `src/renderer/src/media/Gallery.jsx`                    | Shared sequence grid + ImageModal + bbox editor             |
| `src/renderer/src/media/DeploymentMediaGallery.jsx`     | Deployment-scoped wrapper around Gallery                    |
| `src/main/database/models.js`                           | Drizzle table definitions                                   |
| `src/main/database/validators.js`                       | Zod validation schemas                                      |
| `src/main/database/manager.js`                          | Database connection pooling                                 |
| `src/main/database/queries/`                            | Data query functions (split by domain)                      |
| `src/shared/mlmodels.js`                                | Model zoo configuration                                     |
| `src/shared/commonNames/`                               | Scientific → common name dictionary + resolver              |
| `src/shared/speciesInfo/`                               | IUCN status, Wikipedia blurb, fallback image (script-built) |
| `src/main/services/ml/server.ts`                        | ML server lifecycle (start/stop/health)                     |
| `src/main/services/ml/download.ts`                      | ML model download and installation                          |
| `src/main/ipc/ml.js`                                    | ML model IPC handlers                                       |
| `src/main/services/queue.js`                            | Persistent job queue (enqueue, claim, complete, fail)       |
| `src/main/services/queue-consumer.js`                   | Base consumer class (poll loop, pause/resume)               |
| `src/main/services/queue-scheduler.js`                  | Singleton scheduler (active study, status)                  |
| `src/main/services/server-manager.js`                   | ML server lifecycle (one server at a time)                  |
| `src/main/services/inference-consumer.js`               | ML inference consumer (streams predictions)                 |
| `src/main/ipc/queue.js`                                 | Queue IPC handlers (status, pause, resume)                  |
| `src/main/services/import/importer.js`                  | Media scanning + job enqueueing                             |
| `src/main/services/import/timestamp.js`                 | Video timestamp extraction (FFmpeg -> filename -> mtime)    |
| `src/main/services/import/parsers/camtrapDP.js`         | CamTrap DP format importer                                  |
| `src/main/services/import/parsers/wildlifeInsights.js`  | Wildlife Insights format importer                           |
| `src/main/services/import/parsers/deepfaune.js`         | DeepFaune CSV format importer                               |
| `src/main/services/export/exporter.js`                  | CamTrap DP exporter                                         |
| `src/main/services/sequences/`                          | Sequence grouping and counting logic                        |
| `src/main/ipc/sequences.js`                             | Sequence-aware counting IPC handlers                        |
| `src/main/services/cache/video.js`                      | Video format conversion for browser playback                |
| `src/main/utils/bbox.js`                                | Bbox format conversions                                     |

## IPC Pattern

All renderer ↔ main communication follows this pattern:

```javascript
// 1. Preload exposes API (src/preload/index.js)
const api = {
  getSequences: async (studyId, options = {}) => {
    return await electronAPI.ipcRenderer.invoke('sequences:get-paginated', studyId, options)
  }
}
contextBridge.exposeInMainWorld('api', api)

// 2. Main handles IPC (src/main/ipc/sequences.js)
ipcMain.handle('sequences:get-paginated', async (_, studyId, options = {}) => {
  const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
  const result = await getPaginatedSequences(dbPath, options)
  return { data: result }
})

// 3. Renderer calls API (src/renderer/src/*.jsx)
const { data } = await window.api.getSequences(studyId, { limit: 20 })
```

## Technology Stack

| Layer              | Technology              |
| ------------------ | ----------------------- |
| Desktop Runtime    | Electron 34             |
| Build Tool         | electron-vite           |
| Frontend Framework | React 18                |
| Routing            | React Router 7          |
| Styling            | TailwindCSS 4           |
| State Management   | TanStack Query 5        |
| Database           | SQLite (better-sqlite3) |
| ORM                | Drizzle ORM             |
| ML Runtime         | Python 3.11 + FastAPI   |
| ML Environment     | Conda (packed)          |
| Icons              | Lucide React            |
| Maps               | Leaflet + react-leaflet |
| Charts             | Recharts                |
