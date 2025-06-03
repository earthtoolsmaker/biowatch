import { contextBridge, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  getPort: async () => {
    return await electronAPI.ipcRenderer.invoke('get-port')
  },
  selectImage: async () => {
    console.log('electronAPI', electronAPI)
    return await electronAPI.ipcRenderer.invoke('select-image')
  },
  selectDataset: async () => {
    return await electronAPI.ipcRenderer.invoke('select-dataset')
  },
  checkModelStatus: async () => {
    return await electronAPI.ipcRenderer.invoke('check-model-status')
  },
  downloadModel: async () => {
    return await electronAPI.ipcRenderer.invoke('download-model')
  },
  downloadDemoDataset: async () => {
    return await electronAPI.ipcRenderer.invoke('download-demo-dataset')
  },
  getSpeciesDistribution: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('get-species-distribution', studyId)
  },
  getDeployments: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('get-deployments', studyId)
  },
  importDroppedDataset: async (path) => {
    return await electronAPI.ipcRenderer.invoke(
      'import-dropped-dataset',
      webUtils.getPathForFile(path)
    )
  },
  showStudyContextMenu: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('show-study-context-menu', studyId)
  },
  deleteStudyDatabase: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('delete-study-database', studyId)
  },
  getDeploymentsActivity: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('get-deployments-activity', studyId)
  },
  getTopSpeciesTimeseries: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('get-top-species-timeseries', studyId)
  },
  getSpeciesTimeseries: async (studyId, species) => {
    return await electronAPI.ipcRenderer.invoke('get-species-timeseries', studyId, species)
  },
  getSpeciesHeatmapData: async (studyId, species, startDate, endDate, startTime, endTime) => {
    return await electronAPI.ipcRenderer.invoke(
      'get-species-heatmap-data',
      studyId,
      species,
      startDate,
      endDate,
      startTime,
      endTime
    )
  },
  getLocationsActivity: async (studyId) => {
    return await electronAPI.ipcRenderer.invoke('get-locations-activity', studyId)
  },
  getLatestMedia: async (studyId, limit = 10) => {
    return await electronAPI.ipcRenderer.invoke('get-latest-media', studyId, limit)
  },
  getMedia: async (studyId, options = {}) => {
    return await electronAPI.ipcRenderer.invoke('get-media', studyId, options)
  },
  getSpeciesDailyActivity: async (studyId, species, startDate, endDate) => {
    return await electronAPI.ipcRenderer.invoke(
      'get-species-daily-activity',
      studyId,
      species,
      startDate,
      endDate
    )
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
