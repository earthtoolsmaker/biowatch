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
│   ├── index.js             # App entry, IPC handlers
│   ├── database/            # Database layer
│   │   ├── models.js        # Drizzle table definitions
│   │   ├── validators.js    # Zod validation schemas
│   │   ├── manager.js       # Connection pooling
│   │   ├── index.js         # Unified exports (tables + validators + queries)
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
│   ├── import/              # Data importers
│   │   ├── index.js         # Importer exports
│   │   ├── camtrap.js       # CamTrap DP importer
│   │   ├── wildlife.js      # Wildlife Insights importer
│   │   ├── deepfaune.js     # DeepFaune CSV importer
│   │   ├── lila.js          # LILA dataset importer
│   │   └── importer.js      # Image folder importer with ML
│   ├── export/              # Data exporters
│   │   ├── camtrapDPSchemas.js
│   │   └── sanitizers.js
│   ├── export.js            # Export handlers
│   ├── migrations/          # App data migrations (not DB)
│   │   └── *.js             # Version upgrade scripts
│   ├── transformers/        # Bbox format conversions
│   │   └── index.js
│   ├── models.ts            # ML model management
│   ├── studies.js           # Study metadata management
│   ├── download.ts          # File download utilities
│   ├── transcoder.js        # Video transcoding with FFmpeg
│   ├── cache-cleanup.js     # Transcode cache management
│   ├── image-cache.js       # Image caching utilities
│   └── videoClassification.js  # Video classification logic
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
        │ useQuery({ queryFn: () => window.api.getMedia() })
        ▼
┌─────────────────┐
│   preload/      │
│   index.js      │
└────────┬────────┘
         │ ipcRenderer.invoke('media:get', studyId, options)
         ▼
┌─────────────────┐
│   main/         │
│   index.js      │  ──▶ ipcMain.handle('media:get', ...)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  database/      │
│  queries/media  │
│   getMedia()    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Drizzle ORM   │
│   SQLite        │
└─────────────────┘
```

### ML Inference Flow
```
User starts model import
        │
        ▼
┌─────────────────────┐
│  model:start-http-  │
│  server             │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Spawn Python       │
│  FastAPI server     │
└──────────┬──────────┘
           │ HTTP localhost:{port}
           ▼
┌─────────────────────┐      ┌─────────────────┐
│   importer.js       │─────▶│  POST /predict  │
│   stream images     │      │  { image_path } │
└──────────┬──────────┘      └────────┬────────┘
           │                          │
           │◀─────────────────────────┘
           │  { predictions, bboxes }
           ▼
┌─────────────────────┐
│  Store in           │
│  observations +     │
│  modelOutputs       │
└─────────────────────┘
```

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
// src/main/index.js:93-98
function getStudyDatabasePath(userDataPath, studyId) {
  return join(getStudyPath(userDataPath, studyId), 'study.db')
}

function getStudyPath(userDataPath, studyId) {
  return join(userDataPath, 'biowatch-data', 'studies', studyId)
}
```

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/main/index.js` | Main process entry, all IPC handlers |
| `src/preload/index.js` | IPC bridge, exposes `window.api` |
| `src/renderer/src/base.jsx` | React app root, routing |
| `src/main/database/models.js` | Drizzle table definitions |
| `src/main/database/validators.js` | Zod validation schemas |
| `src/main/database/manager.js` | Database connection pooling |
| `src/main/database/queries/` | Data query functions (split by domain) |
| `src/shared/mlmodels.js` | Model zoo configuration |
| `src/main/models.ts` | ML model download/server management |
| `src/main/import/importer.js` | Image import with ML inference |
| `src/main/import/camtrap.js` | CamTrap DP format importer |
| `src/main/import/wildlife.js` | Wildlife Insights format importer |
| `src/main/import/deepfaune.js` | DeepFaune CSV format importer |
| `src/main/export.js` | CamTrap DP exporter |
| `src/main/transcoder.js` | Video format conversion for browser playback |
| `src/main/transformers/index.js` | Bbox format conversions |

## IPC Pattern

All renderer ↔ main communication follows this pattern:

```javascript
// 1. Preload exposes API (src/preload/index.js)
const api = {
  getMedia: async (studyId, options = {}) => {
    return await electronAPI.ipcRenderer.invoke('media:get', studyId, options)
  }
}
contextBridge.exposeInMainWorld('api', api)

// 2. Main handles IPC (src/main/index.js)
ipcMain.handle('media:get', async (_, studyId, options = {}) => {
  const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
  const media = await getMedia(dbPath, options)
  return { data: media }
})

// 3. Renderer calls API (src/renderer/src/*.jsx)
const { data } = await window.api.getMedia(studyId, { limit: 100 })
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| Desktop Runtime | Electron 34 |
| Build Tool | electron-vite |
| Frontend Framework | React 18 |
| Routing | React Router 7 |
| Styling | TailwindCSS 4 |
| State Management | TanStack Query 5 |
| Database | SQLite (better-sqlite3) |
| ORM | Drizzle ORM |
| ML Runtime | Python 3.11 + FastAPI |
| ML Environment | Conda (packed) |
| Icons | Lucide React |
| Maps | Leaflet + react-leaflet |
| Charts | Recharts |
