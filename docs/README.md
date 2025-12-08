# Biowatch Documentation

Developer documentation for the Biowatch camera trap analysis application.

## Quick Links

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | System design, process model, data flow |
| [Data Formats](./data-formats.md) | CamTrap DP, import/export formats |
| [Database Schema](./database-schema.md) | Tables, relationships, JSON fields |
| [Drizzle ORM](./drizzle.md) | Database migrations guide |
| [IPC API](./ipc-api.md) | Inter-process communication handlers |
| [HTTP ML Servers](./http-servers.md) | Model zoo, HTTP servers, adding new models |
| [Import/Export](./import-export.md) | Data pipeline stages |
| [Development](./development.md) | Setup, testing, building |
| [Troubleshooting](./troubleshooting.md) | Common issues and solutions |

## Project Overview

Biowatch is an Electron desktop application for wildlife researchers to analyze camera trap data. Key characteristics:

- **Frontend**: React 18 + TailwindCSS + TanStack Query
- **Backend**: Node.js main process with SQLite (Drizzle ORM)
- **ML Integration**: Python FastAPI HTTP servers for model inference
- **Data Standard**: CamTrap DP (Camera Trap Data Package)

## Key Concepts

### Study Isolation
Each study has its own SQLite database at `biowatch-data/studies/{studyId}/study.db`. Studies are completely isolated from each other.

### IPC Communication
The renderer process communicates with the main process via IPC channels exposed through the preload script. See [IPC API](./ipc-api.md).

### ML Model Servers
ML models run as local HTTP servers with a `/predict` endpoint. Models are downloaded on-demand from CDN. See [HTTP ML Servers](./http-servers.md).

## Directory Structure

```
src/
├── main/           # Electron main process
│   ├── db/         # Database (Drizzle ORM, migrations)
│   ├── index.js    # IPC handlers, app lifecycle
│   └── *.js        # Import/export/query modules
├── renderer/src/   # React frontend
│   ├── base.jsx    # App root, routing
│   └── *.jsx       # Page components
├── preload/        # IPC bridge
└── shared/         # Shared constants (model zoo)
```

## External Resources

- [CamTrap DP Specification](https://camtrap-dp.tdwg.org/)
- [Drizzle ORM Docs](https://orm.drizzle.team/)
- [Electron Documentation](https://www.electronjs.org/docs)
