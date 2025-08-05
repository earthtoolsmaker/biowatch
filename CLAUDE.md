# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

- `npm install` - Install dependencies
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the application
- `npm run build:unpack` - Build and package without creating installer

### Testing

- `npm test` - Run all tests
- `npm run test:migrations` - Run migration tests only
- `npm run test:watch` - Run tests in watch mode

### Code Quality

- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

### Python Environment

- `npm run build:python-env-common` - Build Python ML model environment
- Requires `uv` package manager: `pipx install uv`

### Platform Builds

- `npm run build:win` - Build for Windows
- `npm run build:mac` - Build for macOS
- `npm run build:linux` - Build for Linux
- `npm run build:mac:no-sign` - Build for macOS without code signing

## Architecture

### Electron App Structure

- **Main Process** (`src/main/`): Node.js backend handling file system, database, ML model servers
- **Renderer Process** (`src/renderer/`): React frontend with TailwindCSS
- **Preload** (`src/preload/`): Secure bridge between main and renderer processes

### Key Components

- **Database**: SQLite with Umzug migrations (`src/main/db.js`, `src/main/migrations/`)
- **Data Import**: CamtrapDP and Wildlife CSV formats (`src/main/camtrap.js`, `src/main/wildlife.js`)
- **ML Models**: Python HTTP servers spawned from main process (`src/main/models.ts`)
- **Studies Management**: Local filesystem-based project organization (`src/main/studies.js`)

### Data Flow

1. Import camera trap datasets (CamtrapDP standard or Wildlife CSV)
2. Process images through ML models (DeepFaune, SpeciesNet) via HTTP APIs
3. Store results in SQLite database with spatial/temporal indexing
4. Visualize in React frontend with maps (Leaflet), charts (Recharts), and media viewers

### Python Integration

- ML models run as FastAPI servers in separate Python environments
- Main process spawns/manages Python processes on demand
- HTTP communication between Electron and Python servers
- Garbage collection for unused model servers

### File Structure

- Camera trap images stored in studies directory structure
- SQLite database per study for metadata and predictions
- Python environments in `python-environments/` with versioned dependencies
