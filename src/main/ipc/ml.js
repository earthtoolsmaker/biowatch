/**
 * ML Model management IPC handlers
 */

import { ipcMain } from 'electron'
import log from 'electron-log'

import {
  isMLModelDownloaded,
  listInstalledMLModels,
  listInstalledMLModelEnvironments,
  getMLModelDownloadStatus,
  getGlobalModelDownloadStatus,
  deleteLocalMLModel,
  clearAllLocalMLModels,
  downloadMLModel,
  downloadPythonEnvironment
} from '../services/ml/download.js'

import { startMLModelHTTPServer, stopMLModelHTTPServer } from '../services/ml/server.js'

/**
 * Register all ML model management IPC handlers
 */
export function registerMLIPCHandlers() {
  // IPC handler to check whether the ML model is properly installed locally
  ipcMain.handle('model:is-downloaded', (_, id, version) => isMLModelDownloaded({ id, version }))

  // IPC handler to list all installed ML models
  ipcMain.handle('model:list-installed', () => listInstalledMLModels())

  // IPC handler to list all installed ML model environments
  ipcMain.handle('model:list-installed-environments', () => listInstalledMLModelEnvironments())

  // IPC handler to check the ML model download status
  ipcMain.handle('model:get-download-status', (_, modelReference, pythonEnvironmentReference) =>
    getMLModelDownloadStatus({ modelReference, pythonEnvironmentReference })
  )

  // IPC handler to get global model download status (for spinner indicator)
  ipcMain.handle('model:get-global-download-status', () => getGlobalModelDownloadStatus())

  // IPC handler to delete the ml model
  ipcMain.handle('model:delete', (_, id, version) => deleteLocalMLModel({ id, version }))

  // IPC handler to clear all local ML models and environments
  ipcMain.handle('model:clear-all', async () => {
    log.info('[CLEAR ALL] IPC: Received clear all request')
    const result = await clearAllLocalMLModels()
    log.info('[CLEAR ALL] IPC: Clear all operation result:', result)
    return result
  })

  // IPC handler to download an ML model
  ipcMain.handle('model:download', async (_, id, version) => {
    return await downloadMLModel({ id, version })
  })

  // IPC handler to download a Python environment
  ipcMain.handle('model:download-python-environment', async (_, id, version, requestingModelId) => {
    return await downloadPythonEnvironment({ id, version, requestingModelId })
  })

  // IPC handler to stop an ML model HTTP server
  ipcMain.handle('model:stop-http-server', async (_, pid, port, shutdownApiKey) => {
    return await stopMLModelHTTPServer({ pid, port, shutdownApiKey })
  })

  // IPC handler to start an ML model HTTP server
  ipcMain.handle(
    'model:start-http-server',
    async (_, modelReference, pythonEnvironment, country = null) => {
      try {
        const { port, process, shutdownApiKey } = await startMLModelHTTPServer({
          modelReference,
          pythonEnvironment,
          country
        })
        return {
          success: true,
          process: { pid: process.pid, port: port, shutdownApiKey: shutdownApiKey },
          message: 'ML Model HTTP server successfully started'
        }
      } catch (error) {
        return {
          success: false,
          message: `Failed to start the ML Model HTTP server: ${error.message}`
        }
      }
    }
  )

  log.info('ML IPC handlers registered')
}
