import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, webUtils } from 'electron'

// Custom APIs for renderer
const api = {
  selectCamtrapDPDataset: async () => {
    return await electronAPI.ipcRenderer.invoke('import:select-camtrap-dp')
  },
  selectWildlifeDataset: async () => {
    return await electronAPI.ipcRenderer.invoke('import:select-wildlife')
  },
  selectDeepfauneDataset: async () => {
    return await electronAPI.ipcRenderer.invoke('import:select-deepfaune')
  },
  updateStudy: async (id, update) => {
    return await electronAPI.ipcRenderer.invoke('studies:update', id, update)
  },
  getStudies: async () => {
    return await electronAPI.ipcRenderer.invoke('studies:list')
  },
  downloadDemoDataset: async () => {
    return await electronAPI.ipcRenderer.invoke('import:download-demo')
  },
  importGbifDataset: async (datasetKey) => {
    return await electronAPI.ipcRenderer.invoke('import:gbif-dataset', datasetKey)
  },
  getSpeciesDistribution: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('species:get-distribution', studyId)
  },
  getBlankMediaCount: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('species:get-blank-count', studyId)
  },
  getVehicleMediaCount: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('species:get-vehicle-count', studyId)
  },
  getDeploymentLocations: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('deployments:get-locations', studyId)
  },
  getAllDeployments: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('deployments:get-all', studyId)
  },
  getDeploymentSpecies: async (studyId, deploymentID) => {
    return await electronAPI.ipcRenderer.invoke('deployments:get-species', studyId, deploymentID)
  },
  getDeploymentStats: async (studyId, deploymentID) => {
    return await electronAPI.ipcRenderer.invoke('deployments:get-stats', studyId, deploymentID)
  },
  deleteStudyDatabase: async (studyId, options) => {
    return await electronAPI.ipcRenderer.invoke('study:delete-database', studyId, options)
  },
  getStudyMetadata: async (studyId) => {
    const response = await electronAPI.ipcRenderer.invoke('study:get-metadata', studyId)
    if (response.error) throw new Error(response.error)
    return response.data
  },
  listMergedSourceIds: async (targetStudyId) => {
    const response = await electronAPI.ipcRenderer.invoke(
      'study:list-merged-source-ids',
      targetStudyId
    )
    if (response.error) throw new Error(response.error)
    return response.data
  },
  mergePreflight: async (targetStudyId, sourceStudyId) => {
    return await electronAPI.ipcRenderer.invoke(
      'study:merge-preflight',
      targetStudyId,
      sourceStudyId
    )
  },
  mergeStudy: async (targetStudyId, sourceStudyId, reviewed) => {
    return await electronAPI.ipcRenderer.invoke(
      'study:merge',
      targetStudyId,
      sourceStudyId,
      reviewed
    )
  },
  cancelMerge: async (targetStudyId) => {
    return await electronAPI.ipcRenderer.invoke('study:merge-cancel', targetStudyId)
  },
  onMergeProgress: (callback) => {
    const handler = (_e, payload) => callback(payload)
    electronAPI.ipcRenderer.on('merge:progress', handler)
    return () => electronAPI.ipcRenderer.removeListener('merge:progress', handler)
  },
  onMergeComplete: (callback) => {
    const handler = (_e, payload) => callback(payload)
    electronAPI.ipcRenderer.on('merge:complete', handler)
    return () => electronAPI.ipcRenderer.removeListener('merge:complete', handler)
  },
  checkStudyHasEventIDs: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('study:has-event-ids', studyId)
  },
  getSequenceGap: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('study:get-sequence-gap', studyId)
  },
  setSequenceGap: async (studyId, sequenceGap) => {
    return await electronAPI.ipcRenderer.invoke('study:set-sequence-gap', studyId, sequenceGap)
  },
  getStudyCacheStats: async (studyId) => {
    const response = await electronAPI.ipcRenderer.invoke('study:get-cache-stats', studyId)
    if (response.error) throw new Error(response.error)
    return response.data
  },
  clearStudyCache: async (studyId) => {
    const response = await electronAPI.ipcRenderer.invoke('study:clear-cache', studyId)
    if (response.error) throw new Error(response.error)
    return response.data
  },
  getLocationsActivity: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('locations:get-activity', studyId)
  },
  getDeploymentsActivity: async (studyId, periodCount) => {
    return await electronAPI.ipcRenderer.invoke('deployments:get-activity', studyId, periodCount)
  },
  getMediaBboxes: async (studyId, mediaID, includeWithoutBbox = false) => {
    return await electronAPI.ipcRenderer.invoke(
      'media:get-bboxes',
      studyId,
      mediaID,
      includeWithoutBbox
    )
  },
  getMediaBboxesBatch: async (studyId, mediaIDs) => {
    return await electronAPI.ipcRenderer.invoke('media:get-bboxes-batch', studyId, mediaIDs)
  },
  getVideoFrameDetections: async (studyId, mediaID) => {
    return await electronAPI.ipcRenderer.invoke(
      'media:get-video-frame-detections',
      studyId,
      mediaID
    )
  },
  checkMediaHaveBboxes: async (studyId, mediaIDs) => {
    return await electronAPI.ipcRenderer.invoke('media:have-bboxes', studyId, mediaIDs)
  },
  studyHasAnyBboxes: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('media:study-has-any-bboxes', studyId)
  },
  getBestMedia: async (studyId, options = {}) => {
    return await electronAPI.ipcRenderer.invoke('media:get-best', studyId, options)
  },
  getBestImagePerSpecies: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('species:get-best-images', studyId)
  },
  getOverviewStats: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('overview:get-stats', studyId)
  },
  // Distribution of import sources (importFolder) with media counts — drives
  // the Media tab's Source filter.
  getSourceDistribution: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('sequences:get-source-distribution', studyId)
  },
  // Sequence-aware species distribution APIs (pre-computed in main thread)
  // gapSeconds is fetched from study metadata in the backend
  getSequenceAwareSpeciesDistribution: async (studyId, gapSeconds, bbox) => {
    return await electronAPI.ipcRenderer.invoke(
      'sequences:get-species-distribution',
      studyId,
      gapSeconds,
      bbox
    )
  },
  getSequenceAwareTimeseries: async (studyId, speciesNames, gapSeconds, bbox) => {
    return await electronAPI.ipcRenderer.invoke(
      'sequences:get-timeseries',
      studyId,
      speciesNames,
      gapSeconds,
      bbox
    )
  },
  getSequenceAwareHeatmap: async (
    studyId,
    speciesNames,
    startDate,
    endDate,
    timeRange,
    includeNullTimestamps
  ) => {
    return await electronAPI.ipcRenderer.invoke(
      'sequences:get-heatmap',
      studyId,
      speciesNames,
      startDate,
      endDate,
      timeRange,
      includeNullTimestamps
    )
  },
  getSequenceAwareDailyActivity: async (
    studyId,
    speciesNames,
    startDate,
    endDate,
    gapSeconds,
    bbox
  ) => {
    return await electronAPI.ipcRenderer.invoke(
      'sequences:get-daily-activity',
      studyId,
      speciesNames,
      startDate,
      endDate,
      gapSeconds,
      bbox
    )
  },
  // Paginated sequences API for media gallery
  getSequences: async (studyId, options = {}) => {
    return await electronAPI.ipcRenderer.invoke('sequences:get-paginated', studyId, options)
  },
  // ML Model Management
  downloadMLModel: async ({ id, version }) => {
    return await electronAPI.ipcRenderer.invoke('model:download', id, version)
  },
  getMLModelDownloadStatus: async ({ modelReference, pythonEnvironmentReference }) => {
    return await electronAPI.ipcRenderer.invoke(
      'model:get-download-status',
      modelReference,
      pythonEnvironmentReference
    )
  },
  deleteLocalMLModel: async ({ id, version }) => {
    return await electronAPI.ipcRenderer.invoke('model:delete', id, version)
  },
  isMLModelDownloaded: async ({ id, version }) => {
    return await electronAPI.ipcRenderer.invoke('model:is-downloaded', id, version)
  },
  listInstalledMLModels: async () => {
    return await electronAPI.ipcRenderer.invoke('model:list-installed')
  },
  listInstalledMLModelEnvironments: async () => {
    return await electronAPI.ipcRenderer.invoke('model:list-installed-environments')
  },
  clearAllLocalMLModel: async () => {
    return await electronAPI.ipcRenderer.invoke('model:clear-all')
  },
  getGlobalModelDownloadStatus: async () => {
    return await electronAPI.ipcRenderer.invoke('model:get-global-download-status')
  },

  downloadPythonEnvironment: async ({ id, version, requestingModelId }) => {
    return await electronAPI.ipcRenderer.invoke(
      'model:download-python-environment',
      id,
      version,
      requestingModelId
    )
  },

  startMLModelHTTPServer: async ({ modelReference, pythonEnvironment }) => {
    return await electronAPI.ipcRenderer.invoke(
      'model:start-http-server',
      modelReference,
      pythonEnvironment
    )
  },

  stopMLModelHTTPServer: async ({ pid, port, shutdownApiKey }) => {
    console.log(`Received process running on port ${port} and pid ${pid}`)
    return await electronAPI.ipcRenderer.invoke('model:stop-http-server', pid, port, shutdownApiKey)
  },
  selectImagesDirectoryOnly: async () => {
    return await electronAPI.ipcRenderer.invoke('importer:select-images-directory-only')
  },
  selectImagesDirectoryWithModel: async (directoryPath, modelReference, countryCode) => {
    return await electronAPI.ipcRenderer.invoke(
      'importer:select-images-directory-with-model',
      directoryPath,
      modelReference,
      countryCode
    )
  },
  getImportStatus: async (id) => {
    return await electronAPI.ipcRenderer.invoke('importer:get-status', id)
  },
  stopImport: async (id) => {
    return await electronAPI.ipcRenderer.invoke('importer:stop', id)
  },
  resumeImport: async (id) => {
    return await electronAPI.ipcRenderer.invoke('importer:resume', id)
  },
  getStudyLatestModelOptions: async (id) => {
    return await electronAPI.ipcRenderer.invoke('study:get-latest-model-options', id)
  },
  addFolder: async (id, directoryPath, modelReference, country) => {
    return await electronAPI.ipcRenderer.invoke(
      'importer:add-folder',
      id,
      directoryPath,
      modelReference,
      country
    )
  },
  setDeploymentLatitude: async (studyId, deploymentID, latitude) => {
    return await electronAPI.ipcRenderer.invoke(
      'deployments:set-latitude',
      studyId,
      deploymentID,
      latitude
    )
  },
  setDeploymentLongitude: async (studyId, deploymentID, longitude) => {
    return await electronAPI.ipcRenderer.invoke(
      'deployments:set-longitude',
      studyId,
      deploymentID,
      longitude
    )
  },
  setDeploymentLocationName: async (studyId, locationID, locationName) => {
    return await electronAPI.ipcRenderer.invoke(
      'deployments:set-location-name',
      studyId,
      locationID,
      locationName
    )
  },
  exportDeploymentsCsv: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('deployments:export-csv', studyId)
  },
  getDeploymentsCsvPreview: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('deployments:get-csv-preview', studyId)
  },
  pickDeploymentsCsvFile: async () => {
    return await electronAPI.ipcRenderer.invoke('deployments:pick-csv-file')
  },
  // Electron 32+ removes File.path; webUtils.getPathForFile is the
  // replacement. Called from the drop handler in the import picker
  // modal to resolve a dropped File to an absolute path.
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  parseDeploymentsCsvForImport: async (studyId, filePath) => {
    return await electronAPI.ipcRenderer.invoke(
      'deployments:parse-csv-for-import',
      studyId,
      filePath
    )
  },
  applyDeploymentsCsvImport: async (studyId, applyPlan) => {
    return await electronAPI.ipcRenderer.invoke('deployments:apply-csv-import', studyId, applyPlan)
  },
  setMediaTimestamp: async (studyId, mediaID, timestamp) => {
    return await electronAPI.ipcRenderer.invoke('media:set-timestamp', studyId, mediaID, timestamp)
  },
  setMediaFavorite: async (studyId, mediaID, favorite) => {
    return await electronAPI.ipcRenderer.invoke('media:set-favorite', studyId, mediaID, favorite)
  },
  countMediaWithNullTimestamps: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('media:count-null-timestamps', studyId)
  },
  getSourcesData: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('sources:get-data', studyId)
  },
  exportImageDirectories: async (studyId, options = {}) => {
    return await electronAPI.ipcRenderer.invoke('export:image-directories', studyId, options)
  },
  exportCamtrapDP: async (studyId, options = {}) => {
    return await electronAPI.ipcRenderer.invoke('export:camtrap-dp', studyId, options)
  },
  // Export progress events
  onExportProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    electronAPI.ipcRenderer.on('export:progress', handler)
    return () => electronAPI.ipcRenderer.removeListener('export:progress', handler)
  },
  // GBIF import progress events
  onGbifImportProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    electronAPI.ipcRenderer.on('gbif-import:progress', handler)
    return () => electronAPI.ipcRenderer.removeListener('gbif-import:progress', handler)
  },
  // Demo import progress events
  onDemoImportProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    electronAPI.ipcRenderer.on('demo-import:progress', handler)
    return () => electronAPI.ipcRenderer.removeListener('demo-import:progress', handler)
  },
  // LILA dataset import
  getLilaDatasets: async () => {
    return await electronAPI.ipcRenderer.invoke('import:lila-datasets')
  },
  importLilaDataset: async (datasetId) => {
    return await electronAPI.ipcRenderer.invoke('import:lila-dataset', datasetId)
  },
  cancelGbifImport: async (datasetKey) => {
    return await electronAPI.ipcRenderer.invoke('import:cancel-gbif', datasetKey)
  },
  cancelLilaImport: async (datasetId) => {
    return await electronAPI.ipcRenderer.invoke('import:cancel-lila', datasetId)
  },
  // LILA import progress events
  onLilaImportProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    electronAPI.ipcRenderer.on('lila-import:progress', handler)
    return () => electronAPI.ipcRenderer.removeListener('lila-import:progress', handler)
  },
  // CamtrapDP import progress events
  onCamtrapDPImportProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    electronAPI.ipcRenderer.on('camtrap-dp-import:progress', handler)
    return () => electronAPI.ipcRenderer.removeListener('camtrap-dp-import:progress', handler)
  },
  cancelExport: async () => {
    return await electronAPI.ipcRenderer.invoke('export:cancel')
  },
  // Observation classification update (CamTrap DP compliant)
  updateObservationClassification: async (studyId, observationID, updates) => {
    return await electronAPI.ipcRenderer.invoke(
      'observations:update-classification',
      studyId,
      observationID,
      updates
    )
  },
  // Observation bbox update
  updateObservationBbox: async (studyId, observationID, bboxUpdates) => {
    return await electronAPI.ipcRenderer.invoke(
      'observations:update-bbox',
      studyId,
      observationID,
      bboxUpdates
    )
  },
  // Delete observation
  deleteObservation: async (studyId, observationID) => {
    return await electronAPI.ipcRenderer.invoke('observations:delete', studyId, observationID)
  },
  // Create new observation with bbox
  createObservation: async (studyId, observationData) => {
    return await electronAPI.ipcRenderer.invoke('observations:create', studyId, observationData)
  },
  // Restore observation to a prior state (used by undo, no auto-stamping)
  restoreObservation: async (studyId, observationID, fields) => {
    return await electronAPI.ipcRenderer.invoke(
      'observations:restore',
      studyId,
      observationID,
      fields
    )
  },
  // Bulk-confirm a batch of media as human-reviewed (no species change)
  bulkMarkReviewed: async (studyId, mediaIDs) => {
    return await electronAPI.ipcRenderer.invoke('observations:bulk-mark-reviewed', studyId, mediaIDs)
  },
  // Bulk-relabel a batch of media to a species (marks human)
  bulkSetSpecies: async (studyId, mediaIDs, classification) => {
    return await electronAPI.ipcRenderer.invoke(
      'observations:bulk-update-classification',
      studyId,
      mediaIDs,
      classification
    )
  },
  // Bulk-mark a batch of media as blank
  bulkMarkBlank: async (studyId, mediaIDs) => {
    return await electronAPI.ipcRenderer.invoke('observations:bulk-mark-blank', studyId, mediaIDs)
  },
  // Get distinct species for dropdown
  getDistinctSpecies: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('species:get-distinct', studyId)
  },

  // Video transcoding
  transcode: {
    // Check if a video file needs transcoding (unsupported format)
    needsTranscoding: async (filePath) => {
      return await electronAPI.ipcRenderer.invoke('transcode:needs-transcoding', filePath)
    },
    // Get cached transcoded version if it exists
    getCached: async (studyId, filePath) => {
      return await electronAPI.ipcRenderer.invoke('transcode:get-cached', studyId, filePath)
    },
    // Start transcoding a video file
    start: async (studyId, filePath) => {
      return await electronAPI.ipcRenderer.invoke('transcode:start', studyId, filePath)
    },
    // Cancel an active transcode
    cancel: async (filePath) => {
      return await electronAPI.ipcRenderer.invoke('transcode:cancel', filePath)
    },
    // Get cache statistics for a study
    getCacheStats: async (studyId) => {
      return await electronAPI.ipcRenderer.invoke('transcode:cache-stats', studyId)
    },
    // Clear the transcode cache for a study
    clearCache: async (studyId) => {
      return await electronAPI.ipcRenderer.invoke('transcode:clear-cache', studyId)
    },
    // Listen for transcode progress updates
    onProgress: (callback) => {
      const handler = (_event, data) => callback(data)
      electronAPI.ipcRenderer.on('transcode:progress', handler)
      return () => electronAPI.ipcRenderer.removeListener('transcode:progress', handler)
    }
  },

  // Video thumbnail extraction
  thumbnail: {
    // Get cached thumbnail for a video file if it exists
    getCached: async (studyId, filePath) => {
      return await electronAPI.ipcRenderer.invoke('thumbnail:get-cached', studyId, filePath)
    },
    // Extract thumbnail from video file (extracts first frame)
    extract: async (studyId, filePath) => {
      return await electronAPI.ipcRenderer.invoke('thumbnail:extract', studyId, filePath)
    }
  },

  // Diagnostics
  exportDiagnostics: async () => {
    return await electronAPI.ipcRenderer.invoke('diagnostics:export')
  },

  // Explore tab — export the rendered Leaflet map as a PNG file
  exportExploreMapPng: async ({ dataUrl, defaultFilename }) => {
    return await electronAPI.ipcRenderer.invoke('explore:export-map-png', {
      dataUrl,
      defaultFilename
    })
  },

  // Settings → Info tab
  getChangelog: async (limit = 3) => {
    return await electronAPI.ipcRenderer.invoke('info:get-changelog', limit)
  },
  getStorageUsage: async () => {
    return await electronAPI.ipcRenderer.invoke('info:get-storage-usage')
  },
  getLicenseText: async () => {
    return await electronAPI.ipcRenderer.invoke('info:get-license-text')
  },
  openPath: async (filePath) => {
    return await electronAPI.ipcRenderer.invoke('shell:open-path', filePath)
  },

  // Remote image caching (for GBIF/Agouti imported images)
  imageCache: {
    // Get cached image path if it exists
    getCached: async (studyId, url) => {
      return await electronAPI.ipcRenderer.invoke('image-cache:get-cached', studyId, url)
    },
    // Manually trigger caching of an image
    download: async (studyId, url) => {
      return await electronAPI.ipcRenderer.invoke('image-cache:download', studyId, url)
    },
    // Get cache statistics for a study
    getCacheStats: async (studyId) => {
      return await electronAPI.ipcRenderer.invoke('image-cache:stats', studyId)
    },
    // Clear the image cache for a study
    clearCache: async (studyId) => {
      return await electronAPI.ipcRenderer.invoke('image-cache:clear', studyId)
    }
  },

  // Theme
  getTheme: async () => {
    return await electronAPI.ipcRenderer.invoke('theme:get')
  },
  setThemeSource: async (source) => {
    return await electronAPI.ipcRenderer.invoke('theme:set', source)
  },
  onThemeChanged: (handler) => {
    const listener = (_event, payload) => handler(payload)
    electronAPI.ipcRenderer.on('theme:changed', listener)
    return () => {
      electronAPI.ipcRenderer.removeListener('theme:changed', listener)
    }
  }
}

function parseThemeInitial() {
  const args = process.argv
  const find = (prefix) => {
    const arg = args.find((a) => a.startsWith(prefix))
    return arg ? arg.slice(prefix.length) : null
  }
  const source = find('--theme-initial-source=') || 'system'
  let resolved = find('--theme-initial-resolved=') === 'dark' ? 'dark' : 'light'
  // On some platforms (notably Linux/GTK), nativeTheme.shouldUseDarkColors
  // may lag behind the OS preference at window-creation time. When source
  // is 'system', cross-check via matchMedia which reads Chromium's CSS
  // engine directly and is reliable from preload.
  if (source === 'system' && typeof window !== 'undefined' && window.matchMedia) {
    try {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    } catch {
      // ignore — keep the value parsed from argv
    }
  }
  return { source, resolved }
}
api.themeInitial = parseThemeInitial()

// Apply dark class as early as possible to avoid FOUC. The preload runs
// before the page's HTML body parses, but documentElement already exists.
// Inline <script> in index.html would be blocked by the CSP script-src 'self'.
if (api.themeInitial.resolved === 'dark') {
  if (document.documentElement) {
    document.documentElement.classList.add('dark')
  } else {
    document.addEventListener(
      'DOMContentLoaded',
      () => document.documentElement.classList.add('dark'),
      { once: true }
    )
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
