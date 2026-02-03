# IPC API Reference

Inter-process communication handlers between renderer and main process.

## Overview

Biowatch uses Electron's IPC for communication:

```
Renderer Process          Preload Script          Main Process
     │                         │                       │
     │  window.api.getMedia()  │                       │
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
const { data, error } = await window.api.getMedia(studyId, { limit: 100 })
```

## Handler Reference

### Studies

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `getStudies()` | `studies:list` | - | `Study[]` |
| `updateStudy(id, update)` | `studies:update` | studyId, update object | `Study` |
| `deleteStudyDatabase(studyId)` | `study:delete-database` | studyId | `{ success: boolean }` |
| `checkStudyHasEventIDs(studyId)` | `study:has-event-ids` | studyId | `{ data: boolean }` |
| `getSequenceGap(studyId)` | `study:get-sequence-gap` | studyId | `{ data: number \| null }` |
| `setSequenceGap(studyId, sequenceGap)` | `study:set-sequence-gap` | studyId, sequenceGap (0-600) | `{ data: number }` |

### Data Import

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `selectCamtrapDPDataset()` | `import:select-camtrap-dp` | - | `{ path, data, id }` |
| `selectWildlifeDataset()` | `import:select-wildlife` | - | `{ path, data, id }` |
| `selectDeepfauneDataset()` | `import:select-deepfaune` | - | `{ path, data, id }` |
| `downloadDemoDataset()` | `import:download-demo` | - | `{ path, data, id }` |
| `importGbifDataset(datasetKey)` | `import:gbif-dataset` | GBIF dataset key | `{ path, data, id }` |

### Species & Distribution

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `getSpeciesDistribution(studyId)` | `species:get-distribution` | studyId | `{ data: Distribution[] }` |
| `getDistinctSpecies(studyId)` | `species:get-distinct` | studyId | `{ data: string[] }` |

### Deployments

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `getDeployments(studyId)` | `deployments:get` | studyId | `{ data: Deployment[] }` |
| `getDeploymentsActivity(studyId)` | `deployments:get-activity` | studyId | `{ data: Activity[] }` |
| `setDeploymentLatitude(studyId, deploymentID, latitude)` | `deployments:set-latitude` | studyId, deploymentID, latitude | `{ success: boolean }` |
| `setDeploymentLongitude(studyId, deploymentID, longitude)` | `deployments:set-longitude` | studyId, deploymentID, longitude | `{ success: boolean }` |
| `setDeploymentLocationName(studyId, locationID, locationName)` | `deployments:set-location-name` | studyId, locationID, locationName | `{ success: boolean }` |

**Note on `setDeploymentLocationName`:** This updates the `locationName` for ALL deployments with the given `locationID`. When deployments share a `locationID` (grouped deployments), renaming any one updates the entire group.

### Locations

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `getLocationsActivity(studyId)` | `locations:get-activity` | studyId | `{ data: Activity[] }` |

### Sequence-Aware Species Counts

These endpoints perform sequence grouping and counting in the main thread, returning pre-computed results. This avoids transferring raw media-level data to the renderer and keeps computation off the UI thread.

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `getSequenceAwareSpeciesDistribution(studyId, gapSeconds)` | `sequences:get-species-distribution` | studyId, gapSeconds | `{ data: [{scientificName, count}] }` |
| `getSequenceAwareTimeseries(studyId, speciesNames, gapSeconds)` | `sequences:get-timeseries` | studyId, species[], gapSeconds | `{ data: {timeseries, allSpecies} }` |
| `getSequenceAwareHeatmap(studyId, speciesNames, startDate, endDate, startHour, endHour, includeNullTimestamps, gapSeconds)` | `sequences:get-heatmap` | studyId, species[], dates, hours, includeNull, gapSeconds | `{ data: {species -> locations[]} }` |
| `getSequenceAwareDailyActivity(studyId, speciesNames, startDate, endDate, gapSeconds)` | `sequences:get-daily-activity` | studyId, species[], dates, gapSeconds | `{ data: [24 hourly objects] }` |

**Parameters:**
- `gapSeconds`: Sequence gap threshold in seconds. Use `0` for eventID-based grouping (CamtrapDP datasets with imported events).
- `speciesNames`: Array of scientific names to include in the analysis.

**Benefits:**
- Computed in main thread = better UI responsiveness
- Query cache key includes `gapSeconds` for instant slider feedback

### Paginated Sequences (Media Gallery)

Returns pre-grouped sequences with cursor-based pagination for the media gallery. This moves sequence grouping from the client to the main process, supporting large datasets that would be too memory-intensive to group client-side.

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `getSequences(studyId, options)` | `sequences:get-paginated` | studyId, options object | `{ data: { sequences, nextCursor, hasMore } }` |

**Options:**
```javascript
{
  gapSeconds: number | null,  // Gap threshold in seconds (null = eventID grouping)
  limit: number,              // Sequences per page (default: 20)
  cursor: string | null,      // Opaque cursor from previous response (null = first page)
  filters: {
    species: string[],        // Species to filter by
    dateRange: { start, end }, // Date range filter
    timeRange: { start, end }  // Time of day range (hours 0-23)
  }
}
```

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
  queryFn: ({ pageParam }) => window.api.getSequences(studyId, {
    gapSeconds: sequenceGap,
    limit: 20,
    cursor: pageParam,
    filters
  }),
  getNextPageParam: (lastPage) => lastPage.data.hasMore ? lastPage.data.nextCursor : undefined
})
```

### Media

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `getMedia(studyId, options)` | `media:get` | studyId, { limit?, offset?, filters? } | `{ data: Media[] }` |
| `getMediaBboxes(studyId, mediaID)` | `media:get-bboxes` | studyId, mediaID | `{ data: Bbox[] }` |
| `getMediaBboxesBatch(studyId, mediaIDs)` | `media:get-bboxes-batch` | studyId, mediaID[] | `{ data: Map<mediaID, Bbox[]> }` |
| `checkMediaHaveBboxes(studyId, mediaIDs)` | `media:have-bboxes` | studyId, mediaID[] | `{ data: boolean }` |
| `getBestMedia(studyId, options)` | `media:get-best` | studyId, { limit? } | `{ data: ScoredMedia[] }` |
| `setMediaTimestamp(studyId, mediaID, timestamp)` | `media:set-timestamp` | studyId, mediaID, timestamp | `{ success: boolean }` |
| `setMediaFavorite(studyId, mediaID, favorite)` | `media:set-favorite` | studyId, mediaID, boolean | `{ success: boolean, mediaID, favorite }` |

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

### Files

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `getFilesData(studyId)` | `files:get-data` | studyId | `{ data: FileStats }` |

### Observations

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `updateObservationClassification(studyId, observationID, updates)` | `observations:update-classification` | studyId, observationID, { scientificName?, commonName? } | `{ data: Observation }` |
| `updateObservationBbox(studyId, observationID, bboxUpdates)` | `observations:update-bbox` | studyId, observationID, { bboxX, bboxY, bboxWidth, bboxHeight } | `{ data: Observation }` |
| `deleteObservation(studyId, observationID)` | `observations:delete` | studyId, observationID | `{ data: { deleted: boolean } }` |
| `createObservation(studyId, observationData)` | `observations:create` | studyId, observation object | `{ data: Observation }` |

### Export

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `exportImageDirectories(studyId, options)` | `export:image-directories` | studyId, { selectedSpecies?, includeBlank? } | `{ success, exportPath, copiedCount }` |
| `exportCamtrapDP(studyId, options)` | `export:camtrap-dp` | studyId, { includeMedia?, selectedSpecies?, includeBlank?, sequenceGap? } | `{ success, exportPath, counts... }` |
| `cancelExport()` | `export:cancel` | - | `boolean` |
| `onExportProgress(callback)` | `export:progress` | callback function | unsubscribe function |

### ML Models

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `downloadMLModel({ id, version })` | `model:download` | id, version | `{ success: boolean }` |
| `deleteLocalMLModel({ id, version })` | `model:delete` | id, version | `{ success: boolean }` |
| `isMLModelDownloaded({ id, version })` | `model:is-downloaded` | id, version | `boolean` |
| `listInstalledMLModels()` | `model:list-installed` | - | `ModelReference[]` |
| `listInstalledMLModelEnvironments()` | `model:list-installed-environments` | - | `EnvironmentReference[]` |
| `getMLModelDownloadStatus({ modelReference, pythonEnvironmentReference })` | `model:get-download-status` | refs | `{ model: Status, env: Status }` |
| `downloadPythonEnvironment({ id, version, requestingModelId })` | `model:download-python-environment` | id, version, requestingModelId | `{ success: boolean }` |
| `startMLModelHTTPServer({ modelReference, pythonEnvironment })` | `model:start-http-server` | modelRef, envRef | `{ port, pid, shutdownApiKey }` |
| `stopMLModelHTTPServer({ pid, port, shutdownApiKey })` | `model:stop-http-server` | pid, port, shutdownApiKey | `{ success: boolean }` |

### Image Import with ML

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `selectImagesDirectoryOnly()` | `importer:select-images-directory-only` | - | `{ path, id }` |
| `selectImagesDirectoryWithModel(directoryPath, modelReference, countryCode)` | `importer:select-images-directory-with-model` | path, modelRef, countryCode | `{ path, id }` |
| `getImportStatus(id)` | `importer:get-status` | import id | `ImportStatus` |
| `stopImport(id)` | `importer:stop` | import id | `{ success: boolean }` |
| `resumeImport(id)` | `importer:resume` | import id | `{ success: boolean }` |
| `selectMoreImagesDirectory(id)` | `importer:select-more-images-directory` | study id | `{ success: boolean }` |

### Video Transcoding

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `transcode.needsTranscoding(filePath)` | `transcode:needs-transcoding` | filePath | `boolean` |
| `transcode.getCached(studyId, filePath)` | `transcode:get-cached` | studyId, filePath | `string \| null` (cached path) |
| `transcode.start(studyId, filePath)` | `transcode:start` | studyId, filePath | `{ success, path? } \| { success: false, error }` |
| `transcode.cancel(filePath)` | `transcode:cancel` | filePath | `boolean` |
| `transcode.getCacheStats(studyId)` | `transcode:cache-stats` | studyId | `{ size: number, count: number }` |
| `transcode.clearCache(studyId)` | `transcode:clear-cache` | studyId | `{ cleared: number, freedBytes: number }` |
| `transcode.onProgress(callback)` | `transcode:progress` | callback function | unsubscribe function |

### Video Thumbnails

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `thumbnail.getCached(studyId, filePath)` | `thumbnail:get-cached` | studyId, filePath | `string \| null` (cached path) |
| `thumbnail.extract(studyId, filePath)` | `thumbnail:extract` | studyId, filePath | `{ success, path? } \| { success: false, error }` |

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

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `imageCache.getCached(studyId, url)` | `image-cache:get-cached` | studyId, remote URL | `string \| null` (cached path) |
| `imageCache.download(studyId, url)` | `image-cache:download` | studyId, remote URL | `{ success, path? } \| { success: false, error }` |
| `imageCache.getCacheStats(studyId)` | `image-cache:stats` | studyId | `{ size: number, count: number }` |
| `imageCache.clearCache(studyId)` | `image-cache:clear` | studyId | `{ cleared: number, freedBytes: number }` |

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

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `shell:open-path` | N/A (direct ipcMain) | path | `{ success: boolean }` |

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

| File | Purpose |
|------|---------|
| `src/main/index.js` | Minimal app entry point |
| `src/main/ipc/index.js` | Registers all IPC handlers |
| `src/main/ipc/*.js` | Individual IPC handler modules |
| `src/main/ipc/sequences.js` | Sequence-aware counting IPC handlers |
| `src/preload/index.js` | API bridge to renderer |
| `src/main/database/queries/` | Database query implementations |
| `src/main/services/export/exporter.js` | Export handler implementations |
| `src/main/services/sequences/` | Sequence grouping and counting logic |
| `src/main/ipc/ml.js` | ML model IPC handlers |
| `src/main/services/ml/server.ts` | ML server lifecycle management |
| `src/main/services/ml/download.ts` | ML model download/installation |
| `src/main/services/cache/video.js` | Video transcoding with FFmpeg |
| `src/main/services/cache/image.js` | Remote image caching for GBIF/Agouti imports |
