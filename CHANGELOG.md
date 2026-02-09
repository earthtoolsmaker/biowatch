# Changelog

All notable changes to Biowatch will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2026-02-09

### Added

- Behavior annotation UI to media tab
- Lifestage annotation UI to media tab with color distinction
- Sex annotation to bbox observations
- Sequence gap slider to study settings page (persisted in SQLite)
- Sequence-aware species distribution counting
- Keyboard shortcuts info button to ImageModal zoom toolbar
- Zoom and pan functionality to media modal
- Navigation chevrons to media modal
- Image prefetching and coordinate bbox rendering with image load
- Progress modal for CamtrapDP dataset imports
- CamtrapDP controlled vocabularies for observation fields
- Hidden Advanced tab with diagnostics export
- Ability to rename deployment locations
- Hover tooltips to activity map pie chart markers
- Tooltip and active state to add study button
- Explanatory text when no AI models installed for Images Directory import
- Clear All button shown only when models are installed
- Tests for study database migrations at startup

### Changed

- Move sequence grouping to main process with paginated IPC
- Move sequence counting to main process
- Run Drizzle migrations for all study databases at app startup
- Simplify Images Directory and Demo Dataset card layouts for first-time users
- Change Classification Model label to "Choose a model"
- Increase ML server startup timeout from 2 to 4 minutes
- Set sequenceGap default at import time instead of in React component
- Improve map tooltip styling on overview page
- Improve sequence gap slider UX with tooltips
- Improve layout and design refinements across UI

### Fixed

- O(n²) filename deduplication causing export freeze
- Species selection not showing sequences in gallery
- Ordering of media with identical timestamps in sequences
- CamtrapDP import error handling for invalid directories
- Sidebar not updating after demo/LILA study import
- Prevent image shifting in media modal when navigating between images
- Infinite useEffect loop in Import component causing slow navigation
- Enable marker dragging when selecting deployment from table
- Display all species from multi-detection images in media grid and modal
- Invalidate thumbnail cache when editing species in modal
- Show deployment names in overview map tooltip
- Pencil icon clickable in detection list to select bbox for editing
- Resolve infinite loop in ModelRow callbacks
- Cache invalidation completes before navigation after import
- No-wrap on "Not downloaded" status badge
- CI test coverage and missing datapackage.json handling
- Python environment version extraction in CI workflow

### Removed

- Deprecated getMedia function
- Unnecessary useMemo from geoKey computation
- Dead code: original species query functions
- Footer in model zoo

## [1.6.1] - 2026-01-15

### Added

- Species image tooltip to Activity and Media tabs showing best capture on hover
- New reusable UI components: Button, Card, Input, Select
- TypeScript configuration support

### Changed

- Redesigned import screen with card-based layout
- Improved import page copy and documentation
- Moved Tab component to ui/ directory

### Fixed

- Escape apostrophe in import.jsx lint error

## [1.6.0] - 2026-01-15

### Added

- LILA datasets import with batch inserts, progress tracking, and remote video handling
- E2E testing with Playwright (Windows, macOS, Linux)
- Smart restart and error handling for ML servers
- UI navigation controls in media tab
- Species tooltip using Radix UI
- Blank media preview in media overview tab
- Prefetch next sequences when navigating for smoother experience
- Improved algorithm for selecting diverse best captures
- Cache best captures images from remote sources
- Toast notifications for ML model download completion
- Active state styling for Settings button
- Auto-adjust number of columns in media tab
- Improved deployment map pin selection
- Spinning wheel indicator on AI Models tab

### Changed

- Upgrade Electron from 34 to 39
- Upgrade to React 19 with compatible react-leaflet
- Upgrade to Vite 7
- Upgrade to electron-builder 26
- Upgrade eslint-plugin-react-hooks to 7
- Reorganize src/main with 3-layer architecture (app, ipc, services)
- Reorganize database code structure
- Reorganize test files to mirror src/ structure
- Use native tar extraction for faster imports
- Sort humans/vehicles last in species list
- Change demo dataset to GitHub-hosted camtrapDP zip
- Update dependencies: tailwindcss 4.1.18, drizzle-orm 0.45.1, zod 4.3.5, react-router 7.11.0, better-sqlite3 12.5.0, and more

### Fixed

- Map and timeline fixed while deployment list scrolls
- Prevent error notification when pausing ML model run
- Cross-platform path splitting for database connections on Windows
- Close database connection before deleting study on Windows
- Remove best captures that do not have a scientific name
- Arrow navigation for null timestamp media
- Sequence grouping for null timestamp observations
- Button text wrapping issues

## [1.5.0] - 2025-12-15

### Added

**Video Support**
- Full video handling for camtrapDP import/export
- Video transcoder service for playback
- Hover-to-play sequences in media tab
- Video support in best captures carousel
- Video information display in Files tab
- Ability to update class predictions on videos

**Favorites**
- Favorite media feature with toggle in media tab
- Favorites displayed in best captures

**Export**
- CamtrapDP export with spec validation
- Warning notice in camtrapDP export
- Export modal with options (include media, species/blank selection)
- Image directory export modal
- Export directories for camtrapDP formats
- Export sequence information as events

**Import**
- Timestamp null handling for imports
- Relative filepaths support
- Event information import from camtrapDP
- Parse EXIF data to populate deployments
- Import exifData and fileMediatype from camtrapDP

**Deployments & Maps**
- Satellite views for all maps (overview, activity, deployments)
- Deployment location marker option (place mode)
- Deployments grouping by location
- Deployments clustering
- Improved timescale in deployments tab
- Loading states for deployment components

**Media Tab**
- Bounding box creation, editing, and deletion
- Grid view and crop modes
- Boxes toggle and persistent display options
- Same cell dimensions for grid
- Placeholder for media not found
- Progress bar for importing demo dataset

**ML Models**
- Manas model integration
- Display model provenance for each folder
- Multi bbox creation on ML runs
- Re-render best captures during model run

**UI/UX**
- Move export to settings tab
- Move "Add study" to top right
- Delete study with danger zone
- Right-click context menu for study rename
- Improved contributor editing flow
- Country selection modal improvements
- Tab style improvements
- Media grouping in sequences

**Performance**
- SQLite indices for faster joins and lookups
- Cache remote media with cleanup based on date
- Migrate to React Query (useQuery) for data fetching
- Migrate to Drizzle ORM
- Graceful HTTP server shutdown

**Documentation**
- Architecture documentation
- Database schema documentation
- IPC API documentation
- HTTP servers documentation
- Data formats documentation
- Import/export documentation
- Development guide
- Troubleshooting guide
- Improved README with installation instructions and badges

**Chore**
- CI for JS lint/format and Python lint
- Linux .deb build with proper icons
- Makefile for common tasks
- Python linting with ruff
- Zod schema validation

### Fixed

- Dark theme in settings
- App version display in dev mode and settings
- Grid dimensions when few elements in media tab
- Cache invalidation for activity map and study title
- Remote images cache
- Heatmap loading flicker
- DeepFaune and Manas on greyscale images
- Bbox label positioning and falsey values when 0
- Overview map updates when deployments change
- Demo dataset SQL query
- Sequence grouping by deployment ID

## [1.4.0] - 2025-12-04

### Added

- DeepFaune model support
- Bbox visualization in media tab
- AI Models as default settings tab
- Pulse effect when downloading model
- Spinning effect on pangolin logo
- Pause/resume for DeepFaune
- Unit tests for model management
- Test suite CI on PRs
- LICENCE file

### Changed

- Export UI improvements
- Export to directories
- Use useQuery instead of useEffect for data fetching
- Keep only one observation when running SpeciesNet
- Use LitServe with programmatic shutdown

### Fixed

- Graceful shutdown
- Timeseries query week start dates calculation
- Failing tests

## [1.3.0] - 2025-11-24

### Added

- Initial public release
- SpeciesNet model integration
- CamtrapDP import
- Wildlife Insights import
- Basic media viewing and annotation
- Deployments management
- Activity heatmaps
- Overview statistics

[1.7.0]: https://github.com/earthtoolsmaker/biowatch/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/earthtoolsmaker/biowatch/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/earthtoolsmaker/biowatch/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/earthtoolsmaker/biowatch/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/earthtoolsmaker/biowatch/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/earthtoolsmaker/biowatch/releases/tag/v1.3.0
