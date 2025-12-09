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

### Locations

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `getLocationsActivity(studyId)` | `locations:get-activity` | studyId | `{ data: Activity[] }` |

### Activity Analysis

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `getSpeciesTimeseries(studyId, species)` | `activity:get-timeseries` | studyId, species | `{ data: TimeseriesPoint[] }` |
| `getSpeciesDailyActivity(studyId, species, startDate, endDate)` | `activity:get-daily` | studyId, species, startDate?, endDate? | `{ data: DailyActivity[] }` |
| `getSpeciesHeatmapData(studyId, species, startDate, endDate, startTime, endTime)` | `activity:get-heatmap-data` | studyId, species, filters... | `{ data: HeatmapData }` |

### Media

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `getMedia(studyId, options)` | `media:get` | studyId, { limit?, offset?, filters? } | `{ data: Media[] }` |
| `getMediaBboxes(studyId, mediaID)` | `media:get-bboxes` | studyId, mediaID | `{ data: Bbox[] }` |
| `getMediaBboxesBatch(studyId, mediaIDs)` | `media:get-bboxes-batch` | studyId, mediaID[] | `{ data: Map<mediaID, Bbox[]> }` |
| `checkMediaHaveBboxes(studyId, mediaIDs)` | `media:have-bboxes` | studyId, mediaID[] | `{ data: boolean }` |
| `setMediaTimestamp(studyId, mediaID, timestamp)` | `media:set-timestamp` | studyId, mediaID, timestamp | `{ success: boolean }` |

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

### Utilities

| Method | Channel | Parameters | Returns |
|--------|---------|------------|---------|
| `shell:open-path` | N/A (direct ipcMain) | path | `{ success: boolean }` |

---

## Adding New Handlers

### 1. Add handler in main process

```javascript
// src/main/index.js
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
| `src/main/index.js` | IPC handler definitions |
| `src/preload/index.js` | API bridge to renderer |
| `src/main/queries.js` | Database query implementations |
| `src/main/export.js` | Export handler implementations |
| `src/main/models.ts` | ML model handler implementations |
