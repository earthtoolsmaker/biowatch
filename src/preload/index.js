import { contextBridge, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  selectCamtrapDPDataset: async () => {
    return await electronAPI.ipcRenderer.invoke('import:select-camtrap-dp')
  },
  selectWildlifeDataset: async () => {
    return await electronAPI.ipcRenderer.invoke('import:select-wildlife')
  },
  downloadDemoDataset: async () => {
    return await electronAPI.ipcRenderer.invoke('import:download-demo')
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
      'model:get-status',
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

  stopMLModelHTTPServer: async ({ pid }) => {
    console.log('Received process pid:', pid)
    return await electronAPI.ipcRenderer.invoke('model:stop-http-server', pid)
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
