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
│   │   ├── queue.js          # Persistent job queue service
│   │   ├── queue-consumer.js # Base consumer (poll/claim/process loop)
│   │   ├── queue-scheduler.js# Singleton: ties consumers to active study
│   │   ├── server-manager.js # ML server lifecycle (one at a time)
│   │   ├── inference-consumer.js # ML inference consumer
│   │   ├── prediction.js    # Prediction utilities (insert, stream, EXIF)
│   │   ├── import/          # Data importers
│   │   │   ├── index.js     # Importer exports
│   │   │   ├── importer.js  # Media scanning + job enqueueing
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
│   ├── deployments.jsx      # Map view
│   ├── media.jsx            # Media browser
│   ├── activity.jsx         # Temporal analysis
│   ├── models.jsx           # ML model manager UI
│   ├── settings.jsx         # Settings pages
│   ├── export.jsx           # Export UI
│   ├── files.jsx            # File statistics
│   ├── ui/                  # Reusable components
│   └── hooks/               # Custom React hooks
├── preload/
│   └── index.js             # IPC bridge API
└── shared/
    ├── mlmodels.js          # Model zoo configuration
    └── countries.js         # Country codes for geofencing
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

| File                                                   | Purpose                                               |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `src/main/index.js`                                    | Minimal app entry point                               |
| `src/main/app/lifecycle.js`                            | Window creation, app initialization                   |
| `src/main/ipc/index.js`                                | Registers all IPC handlers                            |
| `src/preload/index.js`                                 | IPC bridge, exposes `window.api`                      |
| `src/renderer/src/base.jsx`                            | React app root, routing                               |
| `src/main/database/models.js`                          | Drizzle table definitions                             |
| `src/main/database/validators.js`                      | Zod validation schemas                                |
| `src/main/database/manager.js`                         | Database connection pooling                           |
| `src/main/database/queries/`                           | Data query functions (split by domain)                |
| `src/shared/mlmodels.js`                               | Model zoo configuration                               |
| `src/main/services/ml/server.ts`                       | ML server lifecycle (start/stop/health)               |
| `src/main/services/ml/download.ts`                     | ML model download and installation                    |
| `src/main/ipc/ml.js`                                   | ML model IPC handlers                                 |
| `src/main/services/queue.js`                           | Persistent job queue (enqueue, claim, complete, fail) |
| `src/main/services/queue-consumer.js`                  | Base consumer class (poll loop, pause/resume)         |
| `src/main/services/queue-scheduler.js`                 | Singleton scheduler (active study, status)            |
| `src/main/services/server-manager.js`                  | ML server lifecycle (one server at a time)            |
| `src/main/services/inference-consumer.js`              | ML inference consumer (streams predictions)           |
| `src/main/ipc/queue.js`                                | Queue IPC handlers (status, pause, resume)            |
| `src/main/services/import/importer.js`                 | Media scanning + job enqueueing                       |
| `src/main/services/import/parsers/camtrapDP.js`        | CamTrap DP format importer                            |
| `src/main/services/import/parsers/wildlifeInsights.js` | Wildlife Insights format importer                     |
| `src/main/services/import/parsers/deepfaune.js`        | DeepFaune CSV format importer                         |
| `src/main/services/export/exporter.js`                 | CamTrap DP exporter                                   |
| `src/main/services/sequences/`                         | Sequence grouping and counting logic                  |
| `src/main/ipc/sequences.js`                            | Sequence-aware counting IPC handlers                  |
| `src/main/services/cache/video.js`                     | Video format conversion for browser playback          |
| `src/main/utils/bbox.js`                               | Bbox format conversions                               |

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
