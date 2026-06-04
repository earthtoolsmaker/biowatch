# IPC API Reference

Inter-process communication handlers between renderer and main process.

## Overview

Biowatch uses Electron's IPC for communication:

```
Renderer Process          Preload Script          Main Process
     │                         │                       │
     │ window.api.getSequences()│                       │
     ├────────────────────────►│                       │
     │                         │  ipcRenderer.invoke() │
     │                         ├──────────────────────►│
     │                         │                       │  ipcMain.handle()
     │                         │◄──────────────────────┤
     │◄────────────────────────┤                       │
     │                         │                       │
```

## How to Call

From renderer (React components):

```javascript
// All IPC methods are available on window.api
const { data, error } = await window.api.getSequences(studyId, { limit: 20 })
```

## Handler Reference

### Studies

| Method                                     | Channel                        | Parameters                                                                           | Returns                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getStudies()`                             | `studies:list`                 | -                                                                                    | `Study[]`                                                                                                                                                                                                                                                                                                                                                                                |
| `updateStudy(id, update)`                  | `studies:update`               | studyId, update object                                                               | `Study`                                                                                                                                                                                                                                                                                                                                                                                  |
| `getStudyMetadata(studyId)`                | `study:get-metadata`           | studyId                                                                              | The `metadata` row: `{ id, name, title, description, contributors, startDate, endDate, importerName, ... }` or `null` if the DB is missing.                                                                                                                                                                                                                                              |
| `deleteStudyDatabase(studyId, options?)`   | `study:delete-database`        | studyId, `{ force?: boolean }`                                                       | `{ success: boolean }` on success. Returns `{ needsConfirm: true, dependentBreaks: [{ studyId, title, brokenMediaCount }] }` instead of deleting when other studies have merged this one in **and** their `media.filePath` points inside this study's directory. The renderer surfaces a confirmation modal and retries with `{ force: true }` to proceed.                               |
| `listMergedSourceIds(targetStudyId)`       | `study:list-merged-source-ids` | targetStudyId                                                                        | `string[]` — UUIDs of studies already merged into `targetStudyId`, plus `__short:<8-char>` sentinels covering edge cases (used by the merge wizard's StudyPicker to mark candidates as "Already merged").                                                                                                                                                                                |
| `mergePreflight(targetId, sourceId)`       | `study:merge-preflight`        | targetStudyId, sourceStudyId                                                         | `{ deploymentCount, mediaCount, observationCount, ownedByBiowatchCount, missingFileCount, renameCount, alreadyMerged }`. Pure read; no mutations. Used by the review step of the merge wizard.                                                                                                                                                                                           |
| `mergeStudy(targetId, sourceId, reviewed)` | `study:merge`                  | targetStudyId, sourceStudyId, `{ description: string, contributorEmails: string[] }` | `{ success: true, missingFileCount }` on success, `{ success: true, alreadyMerged: true }` if already merged, `{ success: true, cancelled: true, exitCode }` if cancelled mid-flight, `{ success: false, error }` on failure. Runs in a worker thread (`out/main/merge-worker.js`). Emits `merge:progress` ticks during execution and a `merge:complete` event on successful completion. |
| `cancelMerge(targetStudyId)`               | `study:merge-cancel`           | targetStudyId                                                                        | `{ cancelled: boolean, reason?: string }`. Terminates the merge worker for the given study. SQLite WAL rolls back any uncommitted transaction on next DB open.                                                                                                                                                                                                                           |
| `onMergeProgress(callback)`                | `merge:progress` (event)       | callback                                                                             | Subscribes to `{ phase: 'scanning' \| 'inserting', done, total }` ticks while a merge is running. Emitted every ~2,000 rows. Returns an unsubscribe function.                                                                                                                                                                                                                            |
| `onMergeComplete(callback)`                | `merge:complete` (event)       | callback                                                                             | Subscribes to `{ studyId }` notifications after a successful merge; returns an unsubscribe function.                                                                                                                                                                                                                                                                                     |
| `checkStudyHasEventIDs(studyId)`           | `study:has-event-ids`          | studyId                                                                              | `{ data: boolean }`                                                                                                                                                                                                                                                                                                                                                                      |
| `getSequenceGap(studyId)`                  | `study:get-sequence-gap`       | studyId                                                                              | `{ data: number \| null }`                                                                                                                                                                                                                                                                                                                                                               |
| `setSequenceGap(studyId, sequenceGap)`     | `study:set-sequence-gap`       | studyId, sequenceGap (0-600)                                                         | `{ data: number }`                                                                                                                                                                                                                                                                                                                                                                       |
| `getStudyCacheStats(studyId)`              | `study:get-cache-stats`        | studyId                                                                              | `{ data: { total: { bytes, files }, breakdown: { transcodes, thumbnails, images, videos } } }` — each breakdown entry is `{ bytes, files }`. Files in `cache/` outside the four known subdirs are counted toward `total` only.                                                                                                                                                           |
| `clearStudyCache(studyId)`                 | `study:clear-cache`            | studyId                                                                              | `{ data: { freedBytes, clearedFiles, error? } }` — removes the entire `<study>/cache/` directory; subdirs are recreated lazily by per-cache services on next write.                                                                                                                                                                                                                      |

### Data Import

| Method                                | Channel                      | Parameters        | Returns                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ---------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selectCamtrapDPDataset()`            | `import:select-camtrap-dp`   | -                 | `{ path, data, id }`                                                                                                                                                                                                                                                                           |
| `selectWildlifeDataset()`             | `import:select-wildlife`     | -                 | `{ path, data, id }`                                                                                                                                                                                                                                                                           |
| `selectDeepfauneDataset()`            | `import:select-deepfaune`    | -                 | `{ path, data, id }`                                                                                                                                                                                                                                                                           |
| `downloadDemoDataset()`               | `import:download-demo`       | -                 | `{ path, data, id }`                                                                                                                                                                                                                                                                           |
| `importGbifDataset(datasetKey)`       | `import:gbif-dataset`        | GBIF dataset key  | `{ path, data, id }` or `null` if cancelled. The CSV ingest + observation-expansion phase runs in a worker thread (`out/main/camtrap-import-worker.js`) so the UI stays responsive on large imports. Cancel via `import:cancel-gbif` triggers `worker.terminate()` followed by `cleanupStudy`. |
| `cancelGbifImport(datasetKey)`        | `import:cancel-gbif`         | GBIF dataset key  | `boolean` (true if cancelled)                                                                                                                                                                                                                                                                  |
| `cancelLilaImport(datasetId)`         | `import:cancel-lila`         | LILA dataset ID   | `boolean` (true if cancelled)                                                                                                                                                                                                                                                                  |
| `onCamtrapDPImportProgress(callback)` | `camtrap-dp-import:progress` | callback function | unsubscribe function                                                                                                                                                                                                                                                                           |

### Species & Distribution

| Method                            | Channel                    | Parameters | Returns                    |
| --------------------------------- | -------------------------- | ---------- | -------------------------- |
| `getSpeciesDistribution(studyId)` | `species:get-distribution` | studyId    | `{ data: Distribution[] }` |
| `getDistinctSpecies(studyId)`     | `species:get-distinct`     | studyId    | `{ data: string[] }`       |

### Overview

| Method                      | Channel              | Parameters | Returns                   |
| --------------------------- | -------------------- | ---------- | ------------------------- |
| `getOverviewStats(studyId)` | `overview:get-stats` | studyId    | `{ data: OverviewStats }` |

`OverviewStats`:

```ts
{
  speciesCount: number
  threatenedCount: number
  threatenedSpecies: Array<{ scientificName: string; iucn: string }>
  cameraCount: number // distinct COALESCE(cameraID, deploymentID)
  locationCount: number // distinct deployments.locationID
  observationCount: number // animal/human (with species) + vehicle observations only;
  // excludes blank/unclassified/unknown empty-species rows
  cameraDays: number // sum of deployment durations, days
  mediaCount: number
  derivedRange: {
    // independently per side: override → observations
    start: string | null // → deployments → media → null
    end: string | null
  }
}
```

Runs in the sequences worker thread (off the main process). Threatened species are those whose bundled `speciesInfo.iucn` is in `{VU, EN, CR, EW, EX}`. The Span override lives in `metadata.startDate` / `metadata.endDate`; the Overview tab clears both via the `Reset to auto` link.

### Deployments

| Method                                                         | Channel                         | Parameters                        | Returns                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getDeploymentLocations(studyId)`                              | `deployments:get-locations`     | studyId                           | `{ data: Deployment[] }`                                                                                                                                                                                                                                                                                                                                                                                 |
| `getAllDeployments(studyId)`                                   | `deployments:get-all`           | studyId                           | `{ data: Deployment[] }`                                                                                                                                                                                                                                                                                                                                                                                 |
| `getDeploymentSpecies(studyId, deploymentID)`                  | `deployments:get-species`       | studyId, deploymentID             | `{ data: { scientificName, count }[] }`                                                                                                                                                                                                                                                                                                                                                                  |
| `getDeploymentDistribution(studyId)`                           | `deployments:get-distribution`  | studyId                           | `{ data: Composition[] }` — per-deployment, **sequence-aware**: `{ deploymentID, locationName, latitude, longitude, count, detectionCount, blankCount, vehicleCount, imageCount, videoCount }`, sorted by `count` desc. Counts are sequence units (matching the Media tab table). The Media tab derives the study-wide Blank/Vehicle quick-view counts by summing `blankCount`/`vehicleCount`.           |
| `getDeploymentStats(studyId, deploymentID)`                    | `deployments:get-stats`         | studyId, deploymentID             | `{ data: { mediaCount, observationCount, blankCount, sequenceCount } }` — `blankCount`/`sequenceCount` are **sequence-aware** (a blank sequence = a whole sequence with no detection), via `getDeploymentSequenceStats`; the popover's blank rate is `blankCount / sequenceCount`. `mediaCount` is raw media. Matches the species-filter popover's `BLANK_SENTINEL` pill and the gallery's Blank filter. |
| `getDeploymentsActivity(studyId, periodCount?)`                | `deployments:get-activity`      | studyId, periodCount (optional)   | `{ data: Activity[] }`                                                                                                                                                                                                                                                                                                                                                                                   |
| `setDeploymentLatitude(studyId, deploymentID, latitude)`       | `deployments:set-latitude`      | studyId, deploymentID, latitude   | `{ success: boolean }`                                                                                                                                                                                                                                                                                                                                                                                   |
| `setDeploymentLongitude(studyId, deploymentID, longitude)`     | `deployments:set-longitude`     | studyId, deploymentID, longitude  | `{ success: boolean }`                                                                                                                                                                                                                                                                                                                                                                                   |
| `setDeploymentLocationName(studyId, locationID, locationName)` | `deployments:set-location-name` | studyId, locationID, locationName | `{ success: boolean }`                                                                                                                                                                                                                                                                                                                                                                                   |

**Note on `getDeploymentLocations` vs `getAllDeployments`:** `getDeploymentLocations` dedupes by `(latitude, longitude)` and returns one row per physical camera-trap location — used by the Explore tab to compute map bounds, where repeats are irrelevant. `getAllDeployments` returns every deployment row (no dedup) — used by both the Overview map (so its cluster count matches the "Deployments" KPI tile and the Deployments tab) and the Deployments tab's editable map (so `MarkerClusterGroup` correctly counts co-located deployments and dragging doesn't silently split a group). `getDeploymentsActivity` runs in the sequences worker thread to keep the UI responsive on large studies.

**Note on `periodCount`:** `getDeploymentsActivity` accepts an optional `periodCount` (number of time-period buckets in the per-deployment timeline). The Deployments tab measures the timeline column width and passes a bucketed value (multiples of 10) so wider screens get more circles per row. Defaults to 20 if null/0/non-numeric, and is clamped to a maximum of 100 backend-side to bound the SUM(CASE)×N SQL aggregation.

**Note on `hasTimestamps` / `totalCount`:** `getDeploymentsActivity` always returns a `hasTimestamps` boolean and always emits `totalCount` per deployment (observation count). When all deployments lack `deploymentStart`/`deploymentEnd` (e.g. LILA Biome Health, where the source COCO has no per-image datetimes), the response sets `hasTimestamps: false`, returns `startDate: null` / `endDate: null`, and emits each deployment with `periods: []`. In the timestamped branch, `totalCount` equals the sum of period counts. The renderer reads `hasTimestamps` to hide the date axis, sparkline column, and hover crosshair, while still listing every deployment with its `totalCount`.

**Note on `setDeploymentLocationName`:** This updates the `locationName` for ALL deployments with the given `locationID`. When deployments share a `locationID` (grouped deployments), renaming any one updates the entire group.

#### Deployments CSV import/export

| Method                                            | Channel                            | Parameters         | Returns                                                                       |
| ------------------------------------------------- | ---------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `getDeploymentsCsvPreview(studyId)`               | `deployments:get-csv-preview`      | studyId            | `{ data: DeploymentRow[] }` \| `{ error }`                                    |
| `exportDeploymentsCsv(studyId)`                   | `deployments:export-csv`           | studyId            | `{ success, filePath, rowCount }` \| `{ cancelled: true }` \| `{ error }`     |
| `pickDeploymentsCsvFile()`                        | `deployments:pick-csv-file`        | —                  | `{ filePath }` \| `{ cancelled: true }`                                       |
| `parseDeploymentsCsvForImport(studyId, filePath)` | `deployments:parse-csv-for-import` | studyId, filePath  | `{ data: PreviewPayload }` \| `{ error }`                                     |
| `applyDeploymentsCsvImport(studyId, applyPlan)`   | `deployments:apply-csv-import`     | studyId, applyPlan | `{ success, summary: { deploymentsUpdated, locationsNamed } }` \| `{ error }` |

There is also one preload-only helper (not an IPC channel):

| Method                     | Purpose                                                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getDroppedFilePath(file)` | Wraps `electron.webUtils.getPathForFile(file)`. Electron 32+ removed `File.path` from the renderer; this preload-exposed helper resolves a dropped `File` to an absolute path. Used by the import-picker modal's drag-and-drop handler. |

**Flow:** For export, the renderer first calls `getDeploymentsCsvPreview` to fetch the rows shown in the export-preview modal (no file dialog, no write). On user confirmation, it calls `exportDeploymentsCsv`, which re-fetches, opens the save dialog, and writes. For import, the renderer either calls `pickDeploymentsCsvFile` (system file picker) or resolves a dropped file via `getDroppedFilePath`, then hands the path to `parseDeploymentsCsvForImport` (validates against the current DB; returns a per-cell preview payload). On user confirmation, the derived `applyPlan` is passed to `applyDeploymentsCsvImport` (single SQLite transaction).

`locationsNamed` in the apply summary counts **distinct** `locationID`s renamed — a CSV that renames 28 deployments sharing one location reports `locationsNamed: 1`, not 28.

**`PreviewPayload` shape:**

```ts
{
  filePath: string
  fileName: string
  totalRows: number
  applyCount: number // rows that will actually update:
  //   normal + ≥1 'change' cell + no 'warning' cells
  rowsBlockedByWarningCount: number // normal rows with ≥1 'warning' cell (blocked from apply)
  rowSkipCount: number // total 'skipped' rows (empty/unknown deploymentID)
  rows: Array<{
    rowIndex: number // 1-based
    deploymentID: string
    rowState: 'normal' | 'skipped'
    rowWarning: string | null
    columns: {
      [column: string]: {
        state: 'unchanged' | 'change' | 'warning' | 'readonly'
        csvValue: string
        dbValue: string | number | null
        appliedValue?: any // present when state === 'change'
        warning?: string // present when state === 'warning'
      }
    }
  }>
}
```

**`applyPlan` shape:** `Array<{ deploymentID: string, fields: { latitude?, longitude?, locationName? } }>`. The applier re-validates each value defensively (out-of-range coords are silently dropped) and propagates `locationName` to every deployment sharing the resolved `locationID`, matching `setDeploymentLocationName` semantics.

**Sort order on export:** Rows are sorted by `deploymentID` using `Intl.Collator({ numeric: true })` so numeric IDs come out in human order (`1, 2, …, 10, 11`) rather than lexicographic (`1, 10, 11, 2`). Alphanumeric IDs like `CAM_001, CAM_002, CAM_010` are also handled correctly; UUID IDs receive a deterministic but arbitrary ordering (UUIDs have no human-meaningful order).

### Locations

| Method                          | Channel                  | Parameters | Returns                |
| ------------------------------- | ------------------------ | ---------- | ---------------------- |
| `getLocationsActivity(studyId)` | `locations:get-activity` | studyId    | `{ data: Activity[] }` |

### Explore Map Export

| Method                                              | Channel                  | Parameters                | Returns                                                                           |
| --------------------------------------------------- | ------------------------ | ------------------------- | --------------------------------------------------------------------------------- |
| `exportExploreMapPng({ dataUrl, defaultFilename })` | `explore:export-map-png` | base64 PNG data URL, name | `{ success: true, filePath } \| { cancelled: true } \| { success: false, error }` |

The renderer captures the Leaflet map container with `html-to-image` (`pixelRatio: 2`, `crossOrigin=""` set on the tile layers so the canvas isn't tainted) and passes a `data:image/png;base64,…` URL plus a default filename. The Density encoding's `leaflet.heat` canvas and the Hex grid SVG overlay are drawn from in-memory data (no external images), so they stay untainted and capture correctly. Main shows a save dialog (default location: Downloads) and writes the decoded buffer to disk. Triggered from the Explore tab's right-click context menu on the map.

### Sequence-Aware Species Counts

These endpoints perform sequence grouping and counting in the main thread, returning pre-computed results. This avoids transferring raw media-level data to the renderer and keeps computation off the UI thread.

| Method                                                                                                 | Channel                              | Parameters                                        | Returns                               |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------- | ------------------------------------- |
| `getSequenceAwareSpeciesDistribution(studyId)`                                                         | `sequences:get-species-distribution` | studyId                                           | `{ data: [{scientificName, count}] }` |
| `getSequenceAwareTimeseries(studyId, speciesNames)`                                                    | `sequences:get-timeseries`           | studyId, species[]                                | `{ data: {timeseries, allSpecies} }`  |
| `getSequenceAwareHeatmap(studyId, speciesNames, startDate, endDate, timeRange, includeNullTimestamps)` | `sequences:get-heatmap`              | studyId, species[], dates, timeRange, includeNull | `{ data: {species -> locations[]} }`  |
| `getSequenceAwareDailyActivity(studyId, speciesNames, startDate, endDate)`                             | `sequences:get-daily-activity`       | studyId, species[], dates                         | `{ data: [24 hourly objects] }`       |

**Parameters:**

- `speciesNames`: Array of scientific names to include in the analysis.
- `gapSeconds` is **not passed by the frontend**. The backend fetches it from the study's metadata table. When metadata has no `sequenceGap` stored, it defaults to `null` (eventID-based grouping for CamtrapDP datasets).

**Benefits:**

- Computed in main thread = better UI responsiveness
- Frontend query cache keys include `sequenceGap` for instant slider feedback (refetch triggered on change)

### Paginated Sequences (Media Gallery)

Returns pre-grouped sequences with cursor-based pagination for the media gallery. This moves sequence grouping from the client to the main process, supporting large datasets that would be too memory-intensive to group client-side.

| Method                           | Channel                   | Parameters              | Returns                                        |
| -------------------------------- | ------------------------- | ----------------------- | ---------------------------------------------- |
| `getSequences(studyId, options)` | `sequences:get-paginated` | studyId, options object | `{ data: { sequences, nextCursor, hasMore } }` |

**Options:**

```javascript
{
  gapSeconds: number | null,  // Gap threshold in seconds (null = eventID grouping)
  limit: number,              // Sequences per page (default: 20)
  cursor: string | null,      // Opaque cursor from previous response (null = first page)
  sort: 'newest' | 'oldest',  // Timestamped-phase order (default: 'newest' = time desc)
  filters: {
    species: string[],        // Species to filter by
    dateRange: { start, end }, // Date range filter
    timeRange: { ranges: [{ start, end }, ...] } | { start, end }, // Time of day filter — multi-range (preferred) or legacy single-range; empty/missing = no filter
    deploymentID?: string | string[], // one deploymentID or several (IN)
    source?: string | string[],        // one importFolder or several (IN)
    mediaTypes?: ('image' | 'video')[], // media-type filter (matches media.fileMediatype prefix); empty = all
    favorite?: boolean,                // only favorited media
    onlyNullTimestamps?: boolean       // only media without a timestamp ("No timestamp" quick view)
  }
}
```

`deploymentID` and `source` accept a single value (back-compat) or an array for
multi-select. `favorite` / `onlyNullTimestamps` back the Media tab quick views.

The `sort` option only affects the timestamped phase; null-timestamp media always
trails last.

**Response:**

```javascript
{
  data: {
    sequences: [
      {
        id: string,              // Sequence identifier
        startTime: string | null, // ISO timestamp (null for null-timestamp media)
        endTime: string | null,   // ISO timestamp
        items: MediaItem[]        // Media items in the sequence
      }
    ],
    nextCursor: string | null,   // Pass to next request (null = no more data)
    hasMore: boolean             // Whether more sequences exist
  }
}
```

**Two-Phase Pagination:**

1. **Timestamped phase**: Returns sequences grouped by timestamp proximity (or eventID)
2. **Null-timestamp phase**: After all timestamped sequences, returns media without timestamps as individual single-item sequences

The cursor is opaque to the client - just pass it back to get the next page. The server handles the phase transition automatically.

**Usage:**

```javascript
// React Query infinite scroll
const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
  queryKey: ['sequences', studyId, filters, sequenceGap],
  queryFn: ({ pageParam }) =>
    window.api.getSequences(studyId, {
      gapSeconds: sequenceGap,
      limit: 20,
      cursor: pageParam,
      filters
    }),
  getNextPageParam: (lastPage) => (lastPage.data.hasMore ? lastPage.data.nextCursor : undefined)
})
```

### Media

| Method                                           | Channel                      | Parameters                  | Returns                                   |
| ------------------------------------------------ | ---------------------------- | --------------------------- | ----------------------------------------- |
| `getMediaBboxes(studyId, mediaID)`               | `media:get-bboxes`           | studyId, mediaID            | `{ data: Bbox[] }`                        |
| `getMediaBboxesBatch(studyId, mediaIDs)`         | `media:get-bboxes-batch`     | studyId, mediaID[]          | `{ data: Map<mediaID, Bbox[]> }`          |
| `checkMediaHaveBboxes(studyId, mediaIDs)`        | `media:have-bboxes`          | studyId, mediaID[]          | `{ data: boolean }`                       |
| `studyHasAnyBboxes(studyId)`                     | `media:study-has-any-bboxes` | studyId                     | `{ data: boolean }`                       |
| `getBestMedia(studyId, options)`                 | `media:get-best`             | studyId, { limit? }         | `{ data: ScoredMedia[] }`                 |
| `setMediaTimestamp(studyId, mediaID, timestamp)` | `media:set-timestamp`        | studyId, mediaID, timestamp | `{ success: boolean }`                    |
| `setMediaFavorite(studyId, mediaID, favorite)`   | `media:set-favorite`         | studyId, mediaID, boolean   | `{ success: boolean, mediaID, favorite }` |

**Best Media (Hybrid Mode with Diversity):**
The `getBestMedia` endpoint uses a hybrid approach with diversity constraints:

1. **User favorites first**: Returns user-marked favorite media (sorted by timestamp descending)
2. **Auto-scored fills with diversity**: If fewer than `limit` favorites, fills remaining slots with diverse auto-scored captures

The auto-scoring formula prioritizes:

- **Bbox area (15%)**: Sweet spot is 10-60% of image area
- **Fully visible (20%)**: Bbox not cut off at edges
- **Padding (15%)**: Distance from bbox to nearest edge
- **Detection confidence (15%)**: Model confidence in bbox detection
- **Classification confidence (10%)**: Model confidence in species ID
- **Rarity boost (15%)**: Rare species score higher, common species penalized (based on observation count)
- **Daytime boost (10%)**: Daylight captures score higher (8am-4pm peak, 6am-6pm extended)

Diversity constraints ensure variety in results:

- **Species diversity**: Max 2 images per species
- **Deployment diversity**: Max 3 images per camera location
- **Temporal diversity**: Max 4 images per weekly time bucket
- **Event diversity**: Max 1 image per event/sequence (avoids duplicate captures from same encounter)

Returns images only (excludes videos), filtered to those with valid bbox data.

**Favorite Media:**
The `setMediaFavorite` endpoint toggles a media item's favorite status. Favorite status is:

- Stored in the `favorite` field (boolean) in the media table
- CamtrapDP compliant - exported/imported with the standard `favorite` field
- Displayed with a heart icon in the media modal and Best Captures carousel

### Sources

| Method                    | Channel            | Parameters | Returns                 |
| ------------------------- | ------------------ | ---------- | ----------------------- |
| `getSourcesData(studyId)` | `sources:get-data` | studyId    | `{ data: SourceRow[] }` |

`SourceRow` shape:

```ts
{
  importFolder: string,        // grouping key, also displayed as the source path/label
  isRemote: boolean,           // true if any media.filePath in this source starts with 'http'
  imageCount: number,
  videoCount: number,
  deploymentCount: number,
  observationCount: number,    // observations attached to this source's media
  activeRun: {                 // null when no model_run with status='running' targets this source
    runID: string,
    modelID: string,
    modelVersion: string,
    processed: number,         // count(model_outputs) for this run scoped to this source
    total: number              // imageCount + videoCount
  } | null,
  lastModelUsed: { modelID: string, modelVersion: string } | null,
  deployments: Array<{
    deploymentID: string,
    label: string,             // deployments.locationName ?? media.folderName ?? deploymentID
    imageCount: number,
    videoCount: number,
    observationCount: number,
    activeRun: { runID, processed, total } | null
  }>
}
```

A "source" is derived at query time as a distinct value of `media.importFolder`. No `sources` table exists — the grouping is computed on every call.

### Observations

| Method                                                             | Channel                              | Parameters                                                       | Returns                          |
| ------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------- | -------------------------------- |
| `updateObservationClassification(studyId, observationID, updates)` | `observations:update-classification` | studyId, observationID, { scientificName?, commonName? }         | `{ data: Observation }`          |
| `updateObservationBbox(studyId, observationID, bboxUpdates)`       | `observations:update-bbox`           | studyId, observationID, { bboxX, bboxY, bboxWidth, bboxHeight }  | `{ data: Observation }`          |
| `deleteObservation(studyId, observationID)`                        | `observations:delete`                | studyId, observationID                                           | `{ data: { deleted: boolean } }` |
| `createObservation(studyId, observationData)`                      | `observations:create`                | studyId, observation object (optional `observationID`/`eventID`) | `{ data: Observation }`          |
| `restoreObservation(studyId, observationID, fields)`               | `observations:restore`               | studyId, observationID, fields to overwrite                      | `{ data: Observation }`          |

`observations:create` accepts optional `observationID` and `eventID` in its
payload. When supplied (used by undo-of-delete), the row is inserted with those
exact UUIDs instead of fresh ones; SQLite's PK uniqueness constraint still
rejects a second insert with a live id. It also accepts optional
`observationType` / `classificationMethod` / `classifiedBy` /
`classificationTimestamp` / `classificationProbability` — when any of these are
supplied, they are written verbatim instead of being auto-stamped as a fresh
human classification. This lets undo-of-delete restore an originally
machine-classified observation in a single IPC.

`observations:restore` performs a plain `UPDATE` of the supplied fields without
auto-stamping `classificationMethod` / `classifiedBy` / `classificationTimestamp`,
so the undo path can faithfully restore the prior classification metadata
(including `'machine'` originals). It throws `Observation not found: <id>` when
zero rows match — the renderer's undo manager treats that as a poisoned entry
and drops it from the stack. Direct user edits go through the `update-bbox` /
`update-classification` handlers, never `restore`.

### Export

| Method                                     | Channel                    | Parameters                                                                | Returns                                |
| ------------------------------------------ | -------------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| `exportImageDirectories(studyId, options)` | `export:image-directories` | studyId, { selectedSpecies?, includeBlank? }                              | `{ success, exportPath, copiedCount }` |
| `exportCamtrapDP(studyId, options)`        | `export:camtrap-dp`        | studyId, { includeMedia?, selectedSpecies?, includeBlank?, sequenceGap? } | `{ success, exportPath, counts... }`   |
| `cancelExport()`                           | `export:cancel`            | -                                                                         | `boolean`                              |
| `onExportProgress(callback)`               | `export:progress`          | callback function                                                         | unsubscribe function                   |

### ML Models

| Method                                                                     | Channel                             | Parameters                     | Returns                          |
| -------------------------------------------------------------------------- | ----------------------------------- | ------------------------------ | -------------------------------- |
| `downloadMLModel({ id, version })`                                         | `model:download`                    | id, version                    | `{ success: boolean }`           |
| `deleteLocalMLModel({ id, version })`                                      | `model:delete`                      | id, version                    | `{ success: boolean }`           |
| `isMLModelDownloaded({ id, version })`                                     | `model:is-downloaded`               | id, version                    | `boolean`                        |
| `listInstalledMLModels()`                                                  | `model:list-installed`              | -                              | `ModelReference[]`               |
| `listInstalledMLModelEnvironments()`                                       | `model:list-installed-environments` | -                              | `EnvironmentReference[]`         |
| `getMLModelDownloadStatus({ modelReference, pythonEnvironmentReference })` | `model:get-download-status`         | refs                           | `{ model: Status, env: Status }` |
| `downloadPythonEnvironment({ id, version, requestingModelId })`            | `model:download-python-environment` | id, version, requestingModelId | `{ success: boolean }`           |
| `startMLModelHTTPServer({ modelReference, pythonEnvironment })`            | `model:start-http-server`           | modelRef, envRef               | `{ port, pid, shutdownApiKey }`  |
| `stopMLModelHTTPServer({ pid, port, shutdownApiKey })`                     | `model:stop-http-server`            | pid, port, shutdownApiKey      | `{ success: boolean }`           |

### Image Import with ML

| Method                                                                       | Channel                                       | Parameters                           | Returns                                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `selectImagesDirectoryOnly()`                                                | `importer:select-images-directory-only`       | -                                    | `{ path, id }`                                                         |
| `selectImagesDirectoryWithModel(directoryPath, modelReference, countryCode)` | `importer:select-images-directory-with-model` | path, modelRef, countryCode          | `{ path, id }`                                                         |
| `addFolder(studyId, directoryPath, modelReference, country)`                 | `importer:add-folder`                         | studyId, path, modelRef, countryCode | `{ success: boolean, error?: string }`                                 |
| `getStudyLatestModelOptions(studyId)`                                        | `study:get-latest-model-options`              | studyId                              | `{ modelReference: { id, version } \| null, country: string \| null }` |
| `getImportStatus(id)`                                                        | `importer:get-status`                         | study id                             | `ImportStatus`                                                         |
| `stopImport(id)`                                                             | `importer:stop`                               | study id                             | `{ success: boolean }`                                                 |
| `resumeImport(id)`                                                           | `importer:resume`                             | study id                             | `{ success: boolean }`                                                 |

**Note:** `importer:stop` now pauses instantly (no server kill). `importer:resume` resumes instantly if paused, or cold-starts from `modelRuns` if the app was restarted. These handlers are backed by the persistent job queue (`src/main/ipc/queue.js`) rather than in-memory state.

`importer:add-folder` is the canonical "Add images directory" entry point used by the Sources tab modal. The renderer chooses model + country (defaulting to the latest run when one exists) and posts here. Supersedes the older `importer:select-more-images-directory` channel. `study:get-latest-model-options` is what the modal calls on open to pre-fill / lock those choices.

### Video Transcoding

| Method                                   | Channel                       | Parameters        | Returns                                           |
| ---------------------------------------- | ----------------------------- | ----------------- | ------------------------------------------------- |
| `transcode.needsTranscoding(filePath)`   | `transcode:needs-transcoding` | filePath          | `boolean`                                         |
| `transcode.getCached(studyId, filePath)` | `transcode:get-cached`        | studyId, filePath | `string \| null` (cached path)                    |
| `transcode.start(studyId, filePath)`     | `transcode:start`             | studyId, filePath | `{ success, path? } \| { success: false, error }` |
| `transcode.cancel(filePath)`             | `transcode:cancel`            | filePath          | `boolean`                                         |
| `transcode.getCacheStats(studyId)`       | `transcode:cache-stats`       | studyId           | `{ size: number, count: number }`                 |
| `transcode.clearCache(studyId)`          | `transcode:clear-cache`       | studyId           | `{ cleared: number, freedBytes: number }`         |
| `transcode.onProgress(callback)`         | `transcode:progress`          | callback function | unsubscribe function                              |

### Video Thumbnails

| Method                                   | Channel                | Parameters        | Returns                                           |
| ---------------------------------------- | ---------------------- | ----------------- | ------------------------------------------------- |
| `thumbnail.getCached(studyId, filePath)` | `thumbnail:get-cached` | studyId, filePath | `string \| null` (cached path)                    |
| `thumbnail.extract(studyId, filePath)`   | `thumbnail:extract`    | studyId, filePath | `{ success, path? } \| { success: false, error }` |

**Notes:**

- Transcoding converts unsupported video formats (AVI, MKV, MOV, etc.) to browser-playable MP4 (H.264)
- Uses bundled FFmpeg via `ffmpeg-static` npm package
- **Per-study caching:** Transcoded files and thumbnails are cached within each study folder:
  - Transcodes: `studies/{studyId}/cache/transcodes/`
  - Thumbnails: `studies/{studyId}/cache/thumbnails/`
- When a study is deleted, its cache is automatically cleaned up
- Cache key is SHA256 hash of (filePath + mtime) to detect file changes

**Progress event:**

```javascript
// Subscribe to progress updates
const unsubscribe = window.api.transcode.onProgress(({ filePath, progress }) => {
  console.log(`Transcoding ${filePath}: ${progress}%`)
})
// Later: unsubscribe()
```

### Remote Image Caching

| Method                               | Channel                  | Parameters          | Returns                                           |
| ------------------------------------ | ------------------------ | ------------------- | ------------------------------------------------- |
| `imageCache.getCached(studyId, url)` | `image-cache:get-cached` | studyId, remote URL | `string \| null` (cached path)                    |
| `imageCache.download(studyId, url)`  | `image-cache:download`   | studyId, remote URL | `{ success, path? } \| { success: false, error }` |
| `imageCache.getCacheStats(studyId)`  | `image-cache:stats`      | studyId             | `{ size: number, count: number }`                 |
| `imageCache.clearCache(studyId)`     | `image-cache:clear`      | studyId             | `{ cleared: number, freedBytes: number }`         |

**Notes:**

- Caches remote images (from GBIF, Agouti imports) to disk for offline access
- Uses the `cached-image://` custom protocol for transparent caching
- **Cache location:** `studies/{studyId}/cache/images/`
- **Cache key:** SHA256 hash of URL (first 16 characters)
- **Auto-expiration:** Cached images are automatically deleted after 30 days
- **Lazy caching:** Images are cached on first display (not eagerly)
- **Fallback:** If download fails, original remote URL is used via redirect

**Protocol flow:**

1. Renderer requests `cached-image://cache?studyId=X&url=Y`
2. Main process checks cache → if cached, serves from disk
3. If not cached → redirects to original URL, triggers background download
4. Next request serves from cache

### Utilities

| Method            | Channel              | Parameters | Returns                |
| ----------------- | -------------------- | ---------- | ---------------------- |
| `shell:open-path` | N/A (direct ipcMain) | path       | `{ success: boolean }` |

---

## Adding New Handlers

### 1. Add handler in main process

```javascript
// src/main/ipc/myfeature.js (create new file)
import { ipcMain } from 'electron'

export function registerMyFeatureIPCHandlers() {
  ipcMain.handle('myfeature:do-something', async (_, studyId, param1, param2) => {
  try {
    const dbPath = getStudyDatabasePath(app.getPath('userData'), studyId)
    if (!dbPath || !existsSync(dbPath)) {
      return { error: 'Database not found for this study' }
    }

    const result = await myFunction(dbPath, param1, param2)
    return { data: result }
  } catch (error) {
    log.error('Error in myfeature:do-something:', error)
    return { error: error.message }
  }
})
```

### 2. Expose in preload

```javascript
// src/preload/index.js
const api = {
  // ... existing methods ...

  doSomething: async (studyId, param1, param2) => {
    return await electronAPI.ipcRenderer.invoke('myfeature:do-something', studyId, param1, param2)
  }
}
```

### 3. Call from renderer

```javascript
// src/renderer/src/*.jsx
const { data, error } = await window.api.doSomething(studyId, 'value1', 'value2')
if (error) {
  console.error(error)
  return
}
// Use data
```

---

## Error Handling Pattern

All handlers return:

```javascript
// Success
{ data: <result> }

// Error
{ error: <string message> }
```

Check for errors in renderer:

```javascript
const response = await window.api.someMethod(params)
if (response.error) {
  // Handle error
  toast.error(response.error)
  return
}
const data = response.data
```

---

## Key Files

| File                                   | Purpose                                      |
| -------------------------------------- | -------------------------------------------- |
| `src/main/index.js`                    | Minimal app entry point                      |
| `src/main/ipc/index.js`                | Registers all IPC handlers                   |
| `src/main/ipc/*.js`                    | Individual IPC handler modules               |
| `src/main/ipc/sequences.js`            | Sequence-aware counting IPC handlers         |
| `src/preload/index.js`                 | API bridge to renderer                       |
| `src/main/database/queries/`           | Database query implementations               |
| `src/main/services/export/exporter.js` | Export handler implementations               |
| `src/main/services/sequences/`         | Sequence grouping and counting logic         |
| `src/main/ipc/ml.js`                   | ML model IPC handlers                        |
| `src/main/services/ml/server.ts`       | ML server lifecycle management               |
| `src/main/services/ml/download.ts`     | ML model download/installation               |
| `src/main/services/cache/video.js`     | Video transcoding with FFmpeg                |
| `src/main/services/cache/image.js`     | Remote image caching for GBIF/Agouti imports |
| `src/main/services/preferences.js`     | User preferences (theme) JSON store          |
| `src/main/services/theme.js`           | Theme service wrapping `nativeTheme`         |
| `src/main/ipc/theme.js`                | Theme IPC handlers                           |

---

### Theme

| Channel         | Direction       | Payload                            | Returns                                                                  |
| --------------- | --------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `theme:get`     | renderer → main | (none)                             | `{ source: 'system' \| 'light' \| 'dark', resolved: 'light' \| 'dark' }` |
| `theme:set`     | renderer → main | `'system' \| 'light' \| 'dark'`    | `{ source, resolved }`                                                   |
| `theme:changed` | main → renderer | `{ source, resolved }` (broadcast) | —                                                                        |

**Renderer API:**

```javascript
window.api.themeInitial // sync, populated from preload args ({ source, resolved })
await window.api.getTheme() // → { source, resolved }
await window.api.setThemeSource('dark') // persists, broadcasts, returns new state
const off = window.api.onThemeChanged((payload) => {
  /* { source, resolved } */
})
// Later: off()
```

`theme:set` throws if `source` is not one of the three valid values.
`theme:changed` broadcasts both on user-initiated changes and on OS
preference changes when `source` is `'system'`.
