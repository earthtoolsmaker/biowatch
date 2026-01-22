import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'

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
  getDeployments: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('deployments:get', studyId)
  },
  deleteStudyDatabase: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('study:delete-database', studyId)
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
  getLocationsActivity: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('locations:get-activity', studyId)
  },
  getDeploymentsActivity: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('deployments:get-activity', studyId)
  },
  getMedia: async (studyId, options = {}) => {
    return await electronAPI.ipcRenderer.invoke('media:get', studyId, options)
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
  checkMediaHaveBboxes: async (studyId, mediaIDs) => {
    return await electronAPI.ipcRenderer.invoke('media:have-bboxes', studyId, mediaIDs)
  },
  getBestMedia: async (studyId, options = {}) => {
    return await electronAPI.ipcRenderer.invoke('media:get-best', studyId, options)
  },
  getBestImagePerSpecies: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('species:get-best-images', studyId)
  },
  // Sequence-aware species distribution APIs (pre-computed in main thread)
  getSequenceAwareSpeciesDistribution: async (studyId, gapSeconds) => {
    return await electronAPI.ipcRenderer.invoke(
      'sequences:get-species-distribution',
      studyId,
      gapSeconds
    )
  },
  getSequenceAwareTimeseries: async (studyId, speciesNames, gapSeconds) => {
    return await electronAPI.ipcRenderer.invoke(
      'sequences:get-timeseries',
      studyId,
      speciesNames,
      gapSeconds
    )
  },
  getSequenceAwareHeatmap: async (
    studyId,
    speciesNames,
    startDate,
    endDate,
    startHour,
    endHour,
    includeNullTimestamps,
    gapSeconds
  ) => {
    return await electronAPI.ipcRenderer.invoke(
      'sequences:get-heatmap',
      studyId,
      speciesNames,
      startDate,
      endDate,
      startHour,
      endHour,
      includeNullTimestamps,
      gapSeconds
    )
  },
  getSequenceAwareDailyActivity: async (studyId, speciesNames, startDate, endDate, gapSeconds) => {
    return await electronAPI.ipcRenderer.invoke(
      'sequences:get-daily-activity',
      studyId,
      speciesNames,
      startDate,
      endDate,
      gapSeconds
    )
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
  selectMoreImagesDirectory: async (id) => {
    return await electronAPI.ipcRenderer.invoke('importer:select-more-images-directory', id)
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
  setMediaTimestamp: async (studyId, mediaID, timestamp) => {
    return await electronAPI.ipcRenderer.invoke('media:set-timestamp', studyId, mediaID, timestamp)
  },
  setMediaFavorite: async (studyId, mediaID, favorite) => {
    return await electronAPI.ipcRenderer.invoke('media:set-favorite', studyId, mediaID, favorite)
  },
  countMediaWithNullTimestamps: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('media:count-null-timestamps', studyId)
  },
  getFilesData: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('files:get-data', studyId)
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
  // LILA import progress events
  onLilaImportProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    electronAPI.ipcRenderer.on('lila-import:progress', handler)
    return () => electronAPI.ipcRenderer.removeListener('lila-import:progress', handler)
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
