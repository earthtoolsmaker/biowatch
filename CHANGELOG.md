# Changelog

All notable changes to Biowatch will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **SpeciesNet upgraded to 4.0.2a**. Same classifier weights as 4.0.1a — only geofencing rules and taxonomy were updated upstream (e.g. `cetartiodactyla` → `artiodactyla`, `coati family` → `procyonidae family`, `emys marmorata` → `actinemys marmorata`). New imports use 4.0.2a; existing 4.0.1a predictions remain tagged historically and continue to display correctly.

### Notes

- If you continue importing media into an existing 4.0.1a study, new predictions are tagged `4.0.2a`. Geofence verdicts may differ between rows in the same study (e.g. bears in the UK are now blocked) — this is expected upstream behavior.
- If you have a SpeciesNet import in progress when you upgrade, let it finish (or cancel it) before updating the app. Resumed 4.0.1a jobs can't find their model after the upgrade.

## [1.9.1] - 2026-05-14

### Added

- **Deployments CSV import/export** on the Deployments tab: always-visible header strip with segmented Export / Import actions, visible even when a study has no timestamps (LILA, COCO — the studies that most need this). Export opens a preview modal (read-only table + editable-column hints) then writes a CSV. Import opens a drag-and-drop picker modal → virtualised diff-preview modal (`old → new` cells, row-level highlighting, cell tooltips, clickable summary tiles that filter rows) → single-transaction apply. Edits `latitude`, `longitude`, and `locationName`; `locationName` propagates across `locationID`. Backed by a pure parser/validator + Drizzle transactional applier with 24 unit/integration tests. (#519)

### Changed

- CSV import gating switched from cell-level skipping to row-level blocking: any row with a warning is excluded from apply. Preview counts, row highlighting, legend, and `Apply (N)` button reflect the row-level model; parser exposes `applyCount` + `rowsBlockedByWarningCount` as the single source of truth. (#524, #532)
- Study-page tabs: tighter vertical padding; map-only top padding on the Deployments tab
- Deployments actions strip aligned with the timeline header (padding, right edge to the sparkline toggle)

### Fixed

- Study layout `gap-4` restored after deployments-specific offsets had been over-reverted

## [1.9.0] - 2026-05-13

### Added

- **Sources tab** (renamed from Files tab): rebuilt around a per-source view with image/video/observation/deployment counts, last model used, in-flight progress bars, deployment sub-rows, host-server line for remote sources, and a skeleton loader; tab is always visible
- **"Add images directory" modal** with model/country/folder picker, enabled for all study types (including CamTrap-DP and LILA); locked-model warnings and an empty-state CTA when no models are installed
- **Dark theme** with a new Appearance settings tab (System / Light / Dark); `useTheme` hook syncs `<html class="dark">` from a preload script, leaflet dark tiles, sonner toast theming, `matchMedia` fallback for Linux when `nativeTheme` lags, and a persisted preferences store backed by a JSON file
- **Day-period preset chips** (Dawn / Day / Dusk / Night) on Media and Activity tabs with rich tooltips, contiguous-arc merging, and full-day default; backed by a multi-range `timeRange` filter in `getSequenceAwareHeatmap`, `getMediaForSequencePagination`, and `hasTimestampedMedia`
- **DailyActivityLine**: x-y twin of the polar clock chart, switchable via a segmented `ChartShapeToggle`; drag-to-select custom hour range when chips are inactive, pan-the-band that wraps midnight, draggable start/end edges, dynamic cursor (move / ew-resize / crosshair), drag continues outside the chart area
- **Timeline brush + zoom** on the Deployments tab: scroll-wheel zoom, live pan, line+dot handles with filled band, native-event gesture model, a filter pill summarising the active date range, and per-study persistence
- **Best-captures modal redesign**: species overlay, deployment link pill, and modal chrome aligned with the media modal
- **Media-modal → deployment link** via a shared `DeploymentLinkPill` (also used in the best-captures modal); `sequences:get-paginated`, `getBestMediaForSpecies` and `getFavoriteBestMedia` now return `locationID` / `locationName`
- **Deployment settings popover** in the Deployments pane header showing media + observation counts (`deployments:get-stats` IPC, `getMediaCountForDeployment` / `getObservationCountForDeployment` queries)
- **Study settings → Cache section** with per-study cache stats and a Clear-cache action (`study:get-cache-stats`, `study:clear-cache` IPC)
- **Filter-charts row toggle** on Media and Activity tabs (from the gap-slider strip), with active-filter blue dot indicator and the strip mirrored across both tabs
- **Activity tab**: export species-distribution map as PNG
- Pseudo-species (Blank, Vehicle) styled with hover-card descriptions in the species list
- Year included in the media grid-cell timestamp overlay

### Changed

- Files tab → Sources tab; `getFilesData` removed and `getSourcesData` runs in a worker thread, rewritten to avoid `COUNT(DISTINCT)` over joins, on a readonly DB connection, with model rows aggregated by `(folder, run)`
- Sources rows merge transient duplicate deployments by label, sort alphabetically, render basename + full path, and show `activeRun` so in-flight model runs surface a progress bar
- Sources: videos classified by file extension (fixes LILA studies that lacked `fileMediatype`); deployment label coalesces to `(unknown)` when all rows are null; max width bounded and counts wrap below the name on narrow windows
- Demo + GBIF imports extract into the persistent study directory instead of `/tmp` so media keeps resolving after restart
- CamTrap-DP import: more resilient to spec deviations; `media.importFolder` set to the package directory (LILA import sets it to the dataset name)
- Overview KPI band becomes a horizontal carousel on narrow viewports; `getBestImagePerSpecies` moved to the sequences worker
- Sequence filter helpers: new `normalizeTimeRange` util; `getMediaForSequencePagination` and `hasTimestampedMedia` accept multi-range `timeRange`
- `getSequenceAwareHeatmap` arg shape switched from positional `startHour` / `endHour` to a `timeRange` object
- Leaflet attribution prefix hidden on all maps
- GBIF picker: "Forest First Mammals" dataset hidden
- Study settings: Export / Clear cache / Delete buttons unified to `h-9`, flat, with sources-style hover and default cursor

### Fixed

- Species distribution bar widths match across Media and Activity tabs; selected row clarified and italic-clip avoided
- Species list hover / active background reaches the pseudo-species divider; pseudo-species hover styling aligned
- Filter row: mount-time ease-in suppressed when navigating between Media and Activity tabs
- Sequence-gap slider thumb dimmed when the slider is off
- Activity-line: cursor styled inline, recharts cursor inheritance forced, latest drag state committed on release, text selection suppressed during drag
- Polar clock: chart-shape toggle floats absolutely, hour labels move inside the SVG for predictable spacing, drag-arc suppressed at full-day, contiguous chip arcs merge correctly
- Chart-shape toggle: segmented control with a theme-blue active state
- Filter chip tooltips: rich time-range + wildlife description, anchored above the chip, no arrow chevron
- Best-media modal: scientific name readable on the dark heading pill; species-row scientific-only fallback no longer italic and first letter capitalised
- Add-study and sequence-grouping tooltips use the shared theme-aware popover style
- Gallery: `timeRange.ranges` included in the React Query key so chip changes invalidate the cache
- Import: status polling fires unconditionally so the global progress bar catches new imports; import-status polling scoped and modal invalidates queries on Import
- Deployments tab lists deployments without timestamps (LILA Biome Health support)
- Sources: when a study's locked model has been uninstalled, Import is blocked with a warning; country pre-selection skipped when the study has no prior run
- Many dark-theme polish fixes: sidebar contrast and breathing room, AI Models species panel, annotation rail, media modal top/bottom bars, deployments hover + sparkline empty period, AddSourceModal, species hovercard, sex/life-stage pill text, activity-map pie marker hovercard contrast

### Removed

- `getFilesData` query (replaced by `getSourcesData`)
- `selectMoreImagesDirectory` IPC (replaced by `importer:add-folder`)

### Chore

- Documentation updates across architecture, IPC API, troubleshooting, development, and import/export for the dark theme, Sources tab, and new IPC handlers (`importer:add-folder`, `study:get-latest-model-options`, `deployments:get-stats`, `study:get-cache-stats`, `study:clear-cache`)

## [1.8.7] - 2026-05-05

### Added

- AI Models tab redesigned in Settings as a split / always-stacked view: new `ModelCard` with all download states, `MapPane` with region overlays + worldwide chip, `SpeciesPanel` with species chip and grouped variants, `CustomModelCard` slot for user models, and an intro copy explaining how to pick a model
- Region registry with colors and per-region GeoJSON; hand-traced Europe MultiPolygon (mainland + Scandinavia + British Isles, including Finland, Corsica, Sardinia) and a broadened Himalayas (Tien Shan, Pamir, Hindu Kush, Karakoram, Kashmir, Ladakh); Manas region broadened
- Per-model species data files (`speciesnet`, `deepfaune`, `manas`) and `region` + `species_count` fields on `mlmodels`; SpeciesNet species list populated with 2,493 entries for search
- Map interactivity in the AI Models tab: auto-fit on region selection, full-width zoom for world view, species hovercards on the species panel
- Undo/redo for annotation edits: `UndoProvider` + `useUndo` wired through the four observation mutations (create, delete, classification, bbox), with bounded per-study stacks, bbox-pulse animation on undo/redo, and failed operations surfaced as a sonner toast
- `observations:restore` IPC and `restoreObservation` query backing the undo path; `createObservation` now accepts optional `observationID` and `eventID` for restore-with-same-id behavior; `getMediaBboxes` returns `mediaID`/`deploymentID`/`eventID`/`eventStart` for undo
- `SpeciesPicker` browse mode opens the dropdown on bbox-label click

### Changed

- Old `models.jsx` removed; `MlZoo` is now the AI Models tab
- `ModelCard` chrome toned down to match the app palette; Download/Delete moved to the top-right of the card header; Worldwide chip pinned top-right to clear zoom controls
- AI Models species search caps results at 50

### Fixed

- AI Models: species hovercard suppressed when no Wikipedia info exists; search hidden when the species list is empty; browser tooltip dropped from region chips
- Annotation undo: optimistic bbox patch held until the canonical `bboxes` prop catches up (no flicker); bboxes cache patched synchronously; queries invalidated after every undo/redo; pre-state read from the live `bboxes` array; undo stack cleared on study switch; failed undo/redo rolls back navigation and surfaces a buffer pulse; empty-fields restore rejected with a clear error; `delete_` inverse collapsed to a single IPC
- `BehaviorSelector`: nested `<button>` removed for DOM validity; mirrors external value changes when the dropdown is closed
- `EditableBbox`: keep local override until the bbox prop catches up
- Truncated duplicate `bbox-pulse` keyframes block in CSS

### Removed

- Arrow-key bbox nudge in `EditableBbox`

### Chore

- Documentation updated for the AI Models tab split-view structure, the undo system, the `observations:restore` IPC, and `observationID` reuse

## [1.8.6] - 2026-05-04

### Added

- Deployments tab list revamp: compact 40px rows (lat/lon dropped from row), location-based grouping with always-expanded `SectionHeader` (click flies map to group bounds), interleaved alphabetical sort, and a per-deployment `Sparkline` (bars / line / heatmap) toggled via `SparklineToggle` with localStorage persistence
- `LocationPopover` for inline lat/lon editing on the Deployments detail pane, with a coordinate paste parser and a top-right "Place on map" affordance
- Deployments timeline hover crosshair showing the date range under the cursor, plus a floating observation-count pill anchored to the cursor for the selected row
- Activity tab: common names rendered alongside scientific names on the map, with a React hovercard
- `Vehicle` pseudo-species entry in the species filter (Library + Deployments) alongside `Blank`, with a new `VEHICLE_SENTINEL` constant + `isVehicle` helper and a `getVehicleMediaCount` query/IPC
- Mouse-wheel chevron centering on the Overview carousels (vertical-center on the image)

### Changed

- Overview tab: all sections fit at default viewport, tightened for small screens
- Scientific-name display normalized to ICZN binomial form across the UI
- Empty-species observations labeled `Blank` / `Vehicle` (instead of `—`); `getBlankMediaCount` redefined as "media without animal/vehicle observations"; gallery labels vehicle media as `Vehicle`; annotation rail labels `Vehicle` via `observationType` on `media-bboxes`
- Deployments detail pane: name editor is underline-only with auto-save on blur/Enter (check/cancel icons dropped); name column tightened from 200px to 140px to free sparkline width; row hover deepened to gray-100/200 for heatmap contrast
- `groupDeploymentsByLocation` extracted into a util; `scientific→common` map builder extracted into a shared util

### Fixed

- Sequences: deterministic dedup, `VEHICLE_SENTINEL` handling, and `EXISTS` probe for blank/vehicle classification
- Sequences: tiebreak by `fileName` instead of `filePath` for stable ordering
- `media-bboxes`: include `observationType` so the annotation rail can label vehicles correctly
- Gallery: vehicle media labeled `Vehicle` instead of `Blank`

### Performance

- `observationType` index added; blank-media query now uses a covering index
- `getBlankMediaCount` runs in the sequences worker

### Chore

- Drop redundant `observationType != 'blank'` proxy filter in queries
- Document blank/vehicle pseudo-species semantics; document new deployments components in architecture overview

## [1.8.5] - 2026-05-02

### Added

- Deployments tab inline media workspace: selected deployment opens an inline `Gallery` pane below the list/map with `?deploymentID` URL state, `Esc` to close, and click-selected-row to toggle off; `sequences:get-paginated` gains an optional `deploymentID` filter
- Species filter popover on the Deployments detail pane, scoped to species present at the deployment, showing common name + scientific + count with hover card on filter rows
- Inline-edit deployment name from the detail pane header
- IUCN Red List CTA on threatened-species hover with rationale text and accent-border palette; new IUCN link-id builder script and bundled IDs for 2k+ species
- Hover card on study list rows in the sidebar showing stats, description, and contributors
- Mouse-wheel scrolling on the Overview best captures and featured species carousels
- Description sanitization for Wildlife Insights and Camtrap DP imports (strips DocBook tags via new `sanitizeDescription` helper)
- Reusable `Gallery` extracted into a shared module with `DeploymentMediaGallery` wrapper and embedded mode (no controls / outer border)

### Changed

- Overview tab revamp: KPI tiles (Deployments, Observations, Media) navigate to their tabs and are center-aligned with bottom-anchored sub details and compact formatting (e.g. 1.1k camera-days); description column fills the column height and "Show more" opens a modal with inline edit; vertical resize handle and map grows with panel height; "Cameras" tile renamed to "Deployments"; best captures and featured species cards bumped to w-56/h-40
- Overview tab max width capped at 1950px and aligned left on wide screens
- Deployments tab: list moved left of the map; subtle fade+slide animation on detail-pane open/close; thin resize handles; map matches Overview's `rounded-xl` + `shadow-md` and is capped at 500px tall; detail-pane header padding aligned with list-row padding (`px-2`); `'— media'` suffix dropped; widened vertical-handle margin
- Media modal: zoom control moved into the top toolbar
- Species filter sorts non-species entries to the bottom; common names capitalized
- Sequence grouping `eventID` included in the no-species select

### Fixed

- Overview: threatened-species popover stays open when clicking inside its hover-card tooltip; hover card skipped on best captures lacking a Wikipedia image and blurb; domestic species excluded from the Featured species fallback; Span and threatened popovers portaled so panel overflow no longer clips them; IUCN legend stays aligned with the NE badge and uses a 2-col grid on narrow widths
- Media modal: "No detections" badge dropped from the copy
- Media: `ImageModal` raised above Leaflet map controls
- Deployments: selection preserved when entering place mode on the active row

### Chore

- Expand species dictionary and blurbs

## [1.8.4] - 2026-04-30

### Added

- Media modal revamp: persistent right-side `ObservationRail` (replaces the bbox popover) with collapsed/expanded `ObservationRow` inline editor, `AddObservationMenu` (Draw / Whole-image), and `BboxLabelMinimal` species-only image label
- Reusable monochrome UI components extracted from the media editor: `SpeciesPicker`, `BehaviorSelector`, `LifeStageSelector`, `SexSelector`
- Keyboard shortcuts: `?` toggles the shortcuts panel, `Ctrl+arrow` navigates sequences, `Tab`/`Shift+Tab` cycle observations even when the species picker is focused
- Whole-image observation creation wired from the rail menu
- Best-captures modal aligned with the media-modal chrome
- Media grid cell: timestamp overlay and slim footer for `ThumbnailCard` and `SequenceCard`, with new `formatGridTimestamp` utility and `getSpeciesCountsFromSequence` helper for ×N counts
- `getMediaMode` helper to keep the whole-image vs. bbox observation-mode invariant in one place

### Changed

- Image viewer area uses a black background; detection chrome and palette aligned across modal and gallery thumbnails
- "Mark as blank" surfaced as an inline link for whole-image observations only; Delete is the consistent path for marking media blank
- Species results float as an absolute dropdown (no more row jumping) and stay hidden until the user searches
- Shortcuts panel pinned in the rail above observations with lightened `kbd` styling; arrow glyphs replaced with text words for portability
- `Tab` / `Shift+Tab` relabelled "next / previous observation"; next/previous chevrons moved to the top toolbar; redundant top-bar draw button removed
- Keyboard-shortcuts info icon moved to the top toolbar next to Heart / Eye
- Files tab: long import paths truncate from the start so the filename stays visible
- Study bar: tab labels hidden below the `lg` breakpoint, with compact tabs forced while an import is running
- Deployments timeline adapts to screen width

### Fixed

- Sequence species counts use max-per-frame instead of summing across frames (bursts no longer inflate counts)
- Clicking outside the modal always closes it (no deselect-first dance); clicking empty image area deselects the current observation
- Empty-state flash suppressed in the rail during media navigation
- Auto-select scoping (only in whole-image mode), IME handling in the species picker, label fallback, and assorted dead-code cleanup from review

### Chore

- Bump `pytest` in `python-environments/common` (dependabot)

## [1.8.3] - 2026-04-28

### Added

- Settings → Info tab redesigned with about blurb, last 3 release notes parsed from `CHANGELOG.md`, disk-usage breakdown (AI Models, Studies, Logs) with reveal-in-folder, support/links section, and a license summary with bundled-text modal
- `CHANGELOG.md` bundled with the packaged app so release notes are available offline

### Changed

- Create-study page restructured into tiered sources: slim recommended hero, primary slim rows, "Online datasets" section, and a collapsed "More import formats" disclosure
- AI Models table width capped on wide screens

### Fixed

- Long dataset names truncate correctly in the import slim row selects (`min-w-0` lets `flex-1` shrink below content width)

## [1.8.2] - 2026-04-28

### Added

- Resizable map/list split on the Deployments tab with persisted layout

### Changed

- Study settings page redesigned with a minimalistic rule-divided layout
- Edge-to-edge light blue hover style on species list rows
- Dropped sequence-grouping slider description in study settings

### Fixed

- Deployment rows cap height and truncate long names to keep the table tidy

## [1.8.1] - 2026-04-28

### Added

- Species tooltip with blurb, IUCN Red List badge, Wikipedia fallback image, and Wikipedia link
- Species-info module with GBIF and Wikipedia response parsers, species-candidate pre-filter, pure synchronous resolver, and build script CLI; ships initial `data.json` covering 2054 species
- Inline IUCN Red List badge in species list rows
- "Show more" toggle on tooltip blurb (default 5 lines)
- Species hover tooltip shown whenever any image (study or Wikipedia) is available

### Changed

- Species hover migrated from Tooltip to HoverCard
- Wikipedia fallback images letterboxed on black to avoid awkward crops
- Inline IUCN badge aligned to the right of the row, left of the count

### Fixed

- HoverCard closes on scroll instead of riding with the row
- Inline IUCN badge hidden on media and activity sidebars
- Species-info build flushes progress every 25 entries and on SIGTERM; atomic `data.json` writes (temp + rename) so SIGKILL can't corrupt the file
- Species-info rejects unknown IUCN codes, maps verbose IUCN strings to codes, and hardens rate-limit handling
- Wikipedia thumbnail cache shared app-wide instead of per-study

## [1.8.0] - 2026-04-27

### Added

- Common-name dictionary built from SpeciesNet, DeepFaune, and Manas label snapshots, with GBIF English-detection scorer and `extras.json` overrides
- `useCommonName` hook + `resolveCommonName` helper, used across Overview, Species Distribution, and Media tabs
- Common-name-first species row with in-study dot badge in the Media species picker
- Fuzzy species search via Fuse.js with debounced `dictionarySearch`, arrow-key navigation, and Enter-to-select
- Custom-species chip and delete mode in ObservationEditor; Enter commits custom species in zero-results state
- Per-frame bbox overlay for videos in the media modal, with `getVideoFrameDetections` IPC and bbox toggle for videos with detections
- Deployment marker clustering on the Overview map
- GBIF import progress with pre-counted CSV rows so `current/total` reflects real progress

### Changed

- Kruger demo dataset rewritten with real scientific names and `commonName` column
- GBIF dataset titles improved; unavailable datasets hidden in importer
- Species hover tooltip and best-captures carousel show common names
- Species list rows truncate long names with ellipsis
- Common-name dictionary values lowercased at build time
- Worker thread takes over sequence pagination, best-media selection, deployments activity, and SQL-aggregated species counts on Overview
- SQL fast-paths for sequence-aware weekly/daily/hourly aggregations and heatmap
- Indefinite caching for blank-media count, species distribution, best-media carousel/tooltip, and sequence-aware activity queries
- Sequence-gap slider commits on release instead of every drag tick; sequence-aware queries gated on resolved gap
- Overview map switched to lightweight deployments query
- FFmpeg ffmpeg-static now unpacked in the packaged app

### Fixed

- Cache invalidation for species/count queries on delete and import complete; sequence-aware heatmap invalidates on class edit; best-media cache gaps closed
- Heatmap routes unparseable timestamps through the null-timestamp branch
- Deployments map keyed by `deploymentID` instead of `locationID`; un-deduped and renamed `getDeployments` → `getDeploymentLocations`
- Daily activity falls back to `fullExtent` when `dateRange` is null
- Species dropdown anchored over media to prevent clipping
- Backspace/Delete no longer bubble out of the species editor
- Video class is editable and grid/filter stay in sync
- `ThumbnailBboxOverlay` skips bbox-less observations
- bbox queries select `commonName` so labels prefer it
- GBIF cache scoping tightened; lint unblocked in CI
- Create Release workflow has write permissions

## [1.7.2] - 2026-04-01

### Added

- Video timestamp extraction with layered fallback chain (FFmpeg metadata, filename parsing, mtime)
- SQLite-backed persistent job queue for async ML inference work
- Queue consumer, server manager, and inference consumer for ML pipeline
- Queue scheduler wired to app, replacing old importer IPC handlers
- Documentation website with MkDocs Material
- CI docs build check for website changes

### Changed

- Move sequence computations to worker threads to unblock main thread
- Cache FFmpeg binary path resolution across batch imports
- Read only container header in FFmpeg timestamp extraction
- Extract prediction utilities to break circular dependency
- Bump pygments, requests, picomatch, pyasn1, brace-expansion dependencies

### Fixed

- Replace dynamic import of ffmpeg.js with static import
- Add non-digit anchors to filename timestamp regexes
- Use local-time getFullYear() in isValidTimestamp for consistency
- Parse FFmpeg creation_time as UTC instead of local time
- Restore speed and ETA in queue-based import status
- Store importPath in modelRuns for provenance tracking
- Include cancelled jobs in queue status totals
- Reset scheduler state when consumer exits
- Await consumer teardown in QueueScheduler.stopStudy

## [1.7.1] - 2026-03-19

### Added

- Unit tests for detection_utils functions

### Changed

- Register local-file as a privileged scheme with startup helper
- Bump python common environment to 0.1.4
- Bump torch from 2.6.0 to 2.7.0
- Bump speciesnet from 5.0.0 to 5.0.3
- Extract shared detection functions into detection_utils module
- Rename video_utils.py to utils.py and use safe_imread in all servers
- Remove importer after completion

### Fixed

- Unpack ffmpeg-static in electron app package
- Skip duplicate media on re-import to prevent UNIQUE constraint errors
- Stream local-file responses and support suffix byte ranges
- Fallback to a free port when preferred port is occupied
- Handle error predictions in speciesnet parseScientificName
- Skip macOS resource fork files and handle corrupt images gracefully

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

[1.9.1]: https://github.com/earthtoolsmaker/biowatch/compare/v1.9.0...v1.9.1
[1.9.0]: https://github.com/earthtoolsmaker/biowatch/compare/v1.8.7...v1.9.0
[1.8.7]: https://github.com/earthtoolsmaker/biowatch/compare/v1.8.6...v1.8.7
[1.8.6]: https://github.com/earthtoolsmaker/biowatch/compare/v1.8.5...v1.8.6
[1.8.5]: https://github.com/earthtoolsmaker/biowatch/compare/v1.8.4...v1.8.5
[1.8.4]: https://github.com/earthtoolsmaker/biowatch/compare/v1.8.3...v1.8.4
[1.8.3]: https://github.com/earthtoolsmaker/biowatch/compare/v1.8.2...v1.8.3
[1.8.2]: https://github.com/earthtoolsmaker/biowatch/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/earthtoolsmaker/biowatch/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/earthtoolsmaker/biowatch/compare/v1.7.2...v1.8.0
[1.7.2]: https://github.com/earthtoolsmaker/biowatch/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/earthtoolsmaker/biowatch/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/earthtoolsmaker/biowatch/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/earthtoolsmaker/biowatch/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/earthtoolsmaker/biowatch/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/earthtoolsmaker/biowatch/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/earthtoolsmaker/biowatch/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/earthtoolsmaker/biowatch/releases/tag/v1.3.0
