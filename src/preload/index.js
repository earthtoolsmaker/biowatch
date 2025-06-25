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
  updateStudy: async (id, update) => {
    return await electronAPI.ipcRenderer.invoke('studies:update', id, update)
  },
  getStudies: async () => {
    return await electronAPI.ipcRenderer.invoke('studies:list')
  },
  migratefromLocalStorage: async (studies) => {
    return await electronAPI.ipcRenderer.invoke('studies:fromLocalStorage', studies)
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
  getDeployments: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('deployments:get', studyId)
  },
  showStudyContextMenu: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('study:show-context-menu', studyId)
  },
  deleteStudyDatabase: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('study:delete-database', studyId)
  },
  getSpeciesTimeseries: async (studyId, species) => {
    return await electronAPI.ipcRenderer.invoke('activity:get-timeseries', studyId, species)
  },
  getSpeciesHeatmapData: async (studyId, species, startDate, endDate, startTime, endTime) => {
    return await electronAPI.ipcRenderer.invoke(
      'activity:get-heatmap-data',
      studyId,
      species,
      startDate,
      endDate,
      startTime,
      endTime
    )
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
  getSpeciesDailyActivity: async (studyId, species, startDate, endDate) => {
    return await electronAPI.ipcRenderer.invoke(
      'activity:get-daily',
      studyId,
      species,
      startDate,
      endDate
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
  clearAllLocalMLModel: async () => {
    return await electronAPI.ipcRenderer.invoke('model:clear-all')
  },

  downloadPythonEnvironment: async ({ id, version, downloadURL }) => {
    return await electronAPI.ipcRenderer.invoke(
      'model:download-python-environment',
      id,
      version,
      downloadURL
    )
  },

  startMLModelHTTPServer: async ({ modelReference, pythonEnvironment }) => {
    return await electronAPI.ipcRenderer.invoke(
      'model:start-http-server',
      modelReference,
      pythonEnvironment
    )
  },

  stopMLModelHTTPServer: async ({ pid, port }) => {
    console.log(`Received process running on port ${port} and pid ${pid}`)
    return await electronAPI.ipcRenderer.invoke('model:stop-http-server', pid, port)
  },
  selectImagesDirectory: async () => {
    return await electronAPI.ipcRenderer.invoke('importer:select-images-directory')
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
