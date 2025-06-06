/**
 * @fileoverview This module provides utility functions for managing the ML models and their weights.
 *
 * @module models
 */

import { app, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import net from 'net'
import { join, dirname } from 'path'
import { spawn } from 'child_process'
import { existsSync, promises as fsPromises } from 'fs'
import log from 'electron-log'
import kill from 'tree-kill'
import { findModel, findPythonEnvironment, platformToKey } from '../shared/mlmodels'
import {
  extractTarGz,
  InstallationState,
  downloadFile,
  writeToManifest,
  removeManifestEntry,
  getDownloadStatus,
  isDownloadSuccess
} from './download'
import os from 'node:os'

// -------------------------------------------------------
// Util functions to define the install and download paths
// -------------------------------------------------------

function getMLModelLocalRootDir() {
  return join(app.getPath('userData'), 'model-zoo')
}

function getMLModelLocalTarPath({ id, version }) {
  return join(getMLModelLocalRootDir(), 'archives', id, `${version}.tar.gz`)
}

function getMLModelLocalInstallPath({ id, version }) {
  return join(getMLModelLocalRootDir(), id, version)
}

function getMLModelLocalDownloadManifest() {
  return join(getMLModelLocalRootDir(), 'manifest.yaml')
}

function getMLModelEnvironmentRootDir() {
  return join(app.getPath('userData'), 'python-environments', 'conda')
}

function getMLEnvironmentDownloadManifest() {
  return join(getMLModelEnvironmentRootDir(), 'manifest.yaml')
}

function getMLModelEnvironmentLocalInstallPath({ version, id }) {
  return join(getMLModelEnvironmentRootDir(), `${id}`, `${version}`)
}

function getMLModelEnvironmentLocalTarPath({ id, version }) {
  return join(getMLModelEnvironmentRootDir(), 'archives', id, version)
}

/**
 * Checks if a machine learning model is downloaded.
 *
 * This function verifies whether the specified ML model, identified by its unique
 * ID and version, has been downloaded and is available in the local installation path.
 *
 * @param {Object} params - The parameters for checking the model download status.
 * @param {string} params.id - The unique identifier of the ML model.
 * @param {string} params.version - The version of the ML model.
 * @returns {boolean} True if the model is downloaded, otherwise false.
 */
function isMLModelDownloaded({ id, version }) {
  const localInstallPath = getMLModelLocalInstallPath({ id, version })
  return existsSync(localInstallPath)
}

/**
 * Clears all locally stored machine learning models and their associated Python environments.
 *
 * This function removes all files and directories within the local ML model root directory
 * and the local Python environment root directory, effectively uninstalling all models.
 * It logs the process and returns a success message if the operation is completed successfully.
 *
 * @returns {Promise<Object>} A promise that resolves to an object indicating the success
 * of the operation and a corresponding message.
 * @throws {Error} Throws an error if the clearing process fails.
 */
async function clearAllLocalMLModels() {
  try {
    const localMLModelRootDir = getMLModelLocalRootDir()
    const localMLModelEnvironmentRootDir = getMLModelEnvironmentRootDir()
    log.info('clearing all models from:', localMLModelRootDir)
    await fsPromises.rm(localMLModelRootDir, { recursive: true, force: true })
    log.info('clearing all python environments from:', localMLModelEnvironmentRootDir)
    await fsPromises.rm(localMLModelEnvironmentRootDir, { recursive: true, force: true })
    return {
      success: true,
      message: 'All Local ML models are cleared'
    }
  } catch (error) {
    return { success: false, message: `Failed to clear all local ML models: ${error.message}` }
  }
}

/**
 * Deletes a locally stored machine learning model and its associated files.
 *
 * This function removes the archived model file and the installed model
 * directory from the local file system, and updates the download manifest
 * accordingly. It logs the process and returns a success message if
 * the operation is completed successfully.
 *
 * @async
 * @param {Object} params - The parameters for deleting the model.
 * @param {string} params.id - The unique identifier of the ML model to be deleted.
 * @param {string} params.version - The version of the ML model to be deleted.
 * @returns {Promise<Object>} A promise that resolves to an object indicating the success
 * of the operation and a corresponding message.
 * @throws {Error} Throws an error if the deletion process fails.
 */
async function deleteLocalMLModel({ id, version }) {
  const localTarPath = getMLModelLocalTarPath({ id, version })
  const localInstallPath = getMLModelLocalInstallPath({ id, version })
  const manifestFilepath = getMLModelLocalDownloadManifest()
  removeManifestEntry({ manifestFilepath, id, version })
  log.info('local tar path:', localTarPath)
  if (existsSync(localTarPath)) {
    log.info('delete local tar path:', localTarPath)
    await fsPromises.unlink(localTarPath)
  }
  log.info('local installed model:', localInstallPath)
  if (existsSync(localInstallPath)) {
    log.info('delete local installed model:', localInstallPath)
    fsPromises.rm(localInstallPath, { recursive: true, force: true })
  }
  return {
    success: true,
    message: 'ML model successfully deleted'
  }
}

/**
 * Downloads a Python environment for a specified machine learning model.
 *
 * This function handles the downloading and installation of the Python environment
 * associated with the specified ML model. It tracks the progress of the download
 * and extraction process, updating the manifest accordingly. If the environment is
 * already installed, it will skip the download and return a success message.
 *
 * @async
 * @param {Object} params - The parameters for downloading the Python environment.
 * @param {string} params.id - The unique identifier of the ML model.
 * @param {string} params.version - The version of the ML model.
 * @returns {Promise<Object>} A promise that resolves to an object indicating the success
 * of the operation and a corresponding message.
 * @throws {Error} Throws an error if the download or extraction process fails.
 */
async function downloadPythonEnvironment({ id, version }) {
  const installationStateProgress = {
    [InstallationState.Failure]: 0,
    // The Download stage indicates that the model is currently being downloaded.
    // Once this stage is complete, it contributes 65% to the overall progress.
    [InstallationState.Download]: 70,
    // The Extract stage indicates that the model has been downloaded and is now being extracted.
    // Upon completion, this stage contributes 91% to the overall progress.
    [InstallationState.Extract]: 98,
    // The Clean stage signifies that the installation process is cleaning up temporary files.
    // Once this stage is finished, it marks 100% completion of the installation.
    [InstallationState.Clean]: 100,
    // The Success state indicates that the installation has completed successfully.
    [InstallationState.Success]: 100
  }
  const env = findPythonEnvironment({ id, version })
  const platformKey = platformToKey(process.platform)
  log.info('downloadPythonEnvironment: platformKey is ', platformKey)
  const { downloadURL, files } = env['platform'][platformKey]
  log.info('downloadPythonEnvironment: download URL is ', downloadURL)
  const extractPath = getMLModelEnvironmentLocalInstallPath({ id, version })
  const localTarPath = getMLModelEnvironmentLocalTarPath({ id, version })
  const manifestFilepath = getMLEnvironmentDownloadManifest()
  const manifestOpts = { archivePath: localTarPath, installPath: extractPath }

  let previousDownloadProgress = 0
  const flushProgressDownloadIncrementThreshold = 1

  const onProgressDownload = ({ percent }) => {
    const progress = (percent * installationStateProgress[InstallationState.Download]) / 100
    if (progress > previousDownloadProgress + flushProgressDownloadIncrementThreshold) {
      writeToManifest({
        manifestFilepath,
        id,
        version,
        state: InstallationState.Download,
        progress: progress,
        opts: manifestOpts
      })
      previousDownloadProgress = progress
    }
  }

  const flushProgressExtractIncrementThreshold = 1.0
  let previousExtractProgress = 0

  const onProgressExtract = ({ extracted }) => {
    const progress = Math.min(
      installationStateProgress[InstallationState.Extract],
      installationStateProgress[InstallationState.Download] +
        (extracted / files) *
          (installationStateProgress[InstallationState.Extract] -
            installationStateProgress[InstallationState.Download])
    )
    if (progress > previousExtractProgress + flushProgressExtractIncrementThreshold) {
      writeToManifest({
        manifestFilepath,
        id,
        version,
        state: InstallationState.Extract,
        progress: progress,
        opts: manifestOpts
      })
      previousExtractProgress = progress
    }
  }

  try {
    if (isDownloadSuccess({ manifestFilepath, id, version })) {
      log.info(`Python environment already installed in ${extractPath}, skipping.`)
      return {
        success: true,
        message: 'Python Environment downloaded and extracted successfully'
      }
    } else {
      log.info('Downloading the environment from', downloadURL)
      writeToManifest({
        manifestFilepath,
        id,
        version,
        progress: 0,
        state: InstallationState.Download,
        opts: manifestOpts
      })
      await downloadFile(downloadURL, localTarPath, onProgressDownload)
      writeToManifest({
        manifestFilepath,
        id,
        version,
        state: InstallationState.Extract,
        progress: installationStateProgress[InstallationState.Download],
        opts: manifestOpts
      })
      log.info(`Extracting the archive ${localTarPath} to ${extractPath}`)
      await extractTarGz(localTarPath, extractPath, onProgressExtract)

      writeToManifest({
        manifestFilepath,
        id,
        version,
        state: InstallationState.Clean,
        progress: installationStateProgress[InstallationState.Extract],
        opts: manifestOpts
      })
      log.info('Cleaning the local archive: ', localTarPath)
      await fsPromises.unlink(localTarPath)
      writeToManifest({
        manifestFilepath,
        id,
        version,
        state: InstallationState.Success,
        opts: manifestOpts,
        progress: installationStateProgress[InstallationState.Success]
      })
      log.info('Done ✅')
      return {
        success: true,
        message: 'Python Environment downloaded and extracted successfully'
      }
    }
  } catch (error) {
    log.error('Failed to download the Python Environment:', error)
    writeToManifest({
      manifestFilepath,
      id,
      version,
      state: InstallationState.Failure,
      opts: manifestOpts,
      progress: installationStateProgress[InstallationState.Failure]
    })
    return {
      success: false,
      message: `Failed to download the Python Environment: ${error.message}`
    }
  }
}

/**
 * Retrieves the download status of a machine learning model and its associated Python environment.
 *
 * This function checks the current download status of the specified ML model and its corresponding
 * Python environment by referring to their respective manifests. It returns an object containing
 * the status of both downloads, which can be used for monitoring and logging purposes.
 *
 * @param {Object} params - The parameters for checking download status.
 * @param {Object} params.modelReference - The reference object containing model details.
 * @param {Object} params.pythonEnvironmentReference - The reference object containing Python environment details.
 * @returns {Object} An object containing the download status of the ML model and Python environment.
 */
function getMLModelDownloadStatus({ modelReference, pythonEnvironmentReference }) {
  const manifestFilepathMLModel = getMLModelLocalDownloadManifest()
  const manifestFilepathPythonEnvironment = getMLEnvironmentDownloadManifest()
  return {
    model: getDownloadStatus({
      manifestFilepath: manifestFilepathMLModel,
      version: modelReference.version,
      id: modelReference.id
    }),
    pythonEnvironment: getDownloadStatus({
      manifestFilepath: manifestFilepathPythonEnvironment,
      version: pythonEnvironmentReference.version,
      id: pythonEnvironmentReference.id
    })
  }
}

/**
 * Downloads a machine learning model from a specified URL and manages its installation.
 *
 * This function handles the downloading of the model archive from the provided URL,
 * extracts it to the local installation path, and updates the installation manifest
 * with the current state of the download process. If the model is already installed,
 * the function will skip the download and return a success message. It also tracks
 * the progress of the download and extraction process, updating the manifest accordingly.
 *
 * @async
 * @param {Object} params - The parameters for downloading the model.
 * @param {string} params.id - The unique identifier of the ML model to be downloaded.
 * @param {string} params.version - The version of the ML model to be downloaded.
 * @returns {Promise<Object>} A promise that resolves to an object indicating the success
 * of the operation and a corresponding message.
 * @throws {Error} Throws an error if the download or extraction process fails.
 *
 * @example
 * downloadMLModel({ id: 'model123', version: '1.0.0' })
 *   .then(result => {
 *     console.log(result.message);
 *   })
 *   .catch(error => {
 *     console.error('Error downloading model:', error.message);
 *   });
 */
async function downloadMLModel({ id, version }) {
  const { downloadURL, files } = findModel({ id, version })
  log.info('downloadMLModel: Download URL is ', downloadURL)
  const localInstallPath = getMLModelLocalInstallPath({ id, version })
  const extractPath = dirname(localInstallPath)
  const localTarPath = getMLModelLocalTarPath({ id, version })
  const manifestFilepath = getMLModelLocalDownloadManifest()

  /**
   * Progress states for the installation process of ML models.
   *
   * This object defines the various stages of the installation process,
   * allowing for tracking of the current state and progress of downloading,
   * extracting, cleaning up, and final success or failure.
   *
   * Each state is represented as a percentage indicating the completion
   * of that specific stage in the overall installation workflow.
   */
  const installationStateProgress = {
    [InstallationState.Failure]: 0,
    // The Download stage indicates that the model is currently being downloaded.
    // Once this stage is complete, it contributes 70% to the overall progress.
    [InstallationState.Download]: 92,
    // The Extract stage indicates that the model has been downloaded and is now being extracted.
    // Upon completion, this stage contributes 98% to the overall progress.
    [InstallationState.Extract]: 98,
    // The Clean stage signifies that the installation process is cleaning up temporary files.
    // Once this stage is finished, it marks 100% completion of the installation.
    [InstallationState.Clean]: 100,
    // The Success state indicates that the installation has completed successfully.
    [InstallationState.Success]: 100
  }

  const manifestOpts = { archivePath: localTarPath, installPath: localInstallPath }

  let previousProgress = 0
  const flushProgressIncrementThreshold = 1

  const onProgressDownload = ({ percent }) => {
    const progress = (percent * installationStateProgress[InstallationState.Download]) / 100
    if (progress > previousProgress + flushProgressIncrementThreshold) {
      writeToManifest({
        manifestFilepath,
        id,
        version,
        state: InstallationState.Download,
        progress: progress,
        opts: manifestOpts
      })
      previousProgress = progress
    }
  }

  const flushProgressExtractIncrementThreshold = 1.0
  let previousExtractProgress = 0

  const onProgressExtract = ({ extracted }) => {
    const progress = Math.min(
      installationStateProgress[InstallationState.Extract],
      installationStateProgress[InstallationState.Download] +
        (extracted / files) *
          (installationStateProgress[InstallationState.Extract] -
            installationStateProgress[InstallationState.Download])
    )
    if (progress > previousExtractProgress + flushProgressExtractIncrementThreshold) {
      writeToManifest({
        manifestFilepath,
        id,
        version,
        state: InstallationState.Extract,
        progress: progress,
        opts: manifestOpts
      })
      previousExtractProgress = progress
    }
  }
  try {
    if (isDownloadSuccess({ manifestFilepath, id, version })) {
      log.info(`ML Model weights already installed in ${extractPath}, skipping.`)
      return {
        success: true,
        message: 'Model downloaded and extracted successfully'
      }
    } else {
      writeToManifest({
        manifestFilepath,
        id,
        version,
        progress: 0,
        state: InstallationState.Download,
        opts: manifestOpts
      })
      log.info('Downloading the model from', downloadURL)
      await downloadFile(downloadURL, localTarPath, onProgressDownload)
      writeToManifest({
        manifestFilepath,
        id,
        version,
        state: InstallationState.Extract,
        progress: installationStateProgress[InstallationState.Download],
        opts: manifestOpts
      })
      log.info(`Extracting the archive ${localTarPath} to ${extractPath}`)
      await extractTarGz(localTarPath, extractPath, onProgressExtract)

      writeToManifest({
        manifestFilepath,
        id,
        version,
        state: InstallationState.Clean,
        progress: installationStateProgress[InstallationState.Extract],
        opts: manifestOpts
      })
      log.info('Cleaning the local archive: ', localTarPath)
      await fsPromises.unlink(localTarPath)
      writeToManifest({
        manifestFilepath,
        id,
        version,
        state: InstallationState.Success,
        opts: manifestOpts,
        progress: installationStateProgress[InstallationState.Success]
      })
      return {
        success: true,
        message: 'Model downloaded and extracted successfully'
      }
    }
  } catch (error) {
    log.error('Failed to download model:', error)
    writeToManifest({
      manifestFilepath,
      id,
      version,
      state: InstallationState.Failure,
      opts: manifestOpts,
      progress: installationStateProgress[InstallationState.Failure]
    })
    return {
      success: false,
      message: `Failed to download model: ${error.message}`
    }
  }
}

/**
 * Registers IPC handlers for managing machine learning models.
 *
 * This function sets up various IPC (Inter-Process Communication) handlers
 * to facilitate operations related to machine learning models, such as
 * checking if a model is downloaded, getting the download status,
 * deleting a model, clearing all models, and downloading a model
 * or its associated Python environment.
 */
export function registerMLModelManagementIPCHandlers() {
  // IPC handler to check whether the ML model is properly installed locally
  ipcMain.handle('model:is-downloaded', (_, id, version) => isMLModelDownloaded({ id, version }))

  // IPC handler to check the ML model download status
  ipcMain.handle('model:get-download-status', (_, modelReference, pythonEnvironmentReference) =>
    getMLModelDownloadStatus({ modelReference, pythonEnvironmentReference })
  )

  // IPC handler to delete the ml model
  ipcMain.handle('model:delete', (_, id, version) => deleteLocalMLModel({ id, version }))

  ipcMain.handle('model:clear-all', async (_) => clearAllLocalMLModels())

  ipcMain.handle('model:download', async (_, id, version) => {
    return await downloadMLModel({ id, version })
  })
  ipcMain.handle('model:download-python-environment', async (_, id, version) => {
    return await downloadPythonEnvironment({ id, version })
  })
  ipcMain.handle('model:stop-http-server', async (_, pid) => {
    return await stopMLModelHTTPServer({ pid })
  })
  ipcMain.handle('model:start-http-server', async (_, modelReference, pythonEnvironment) => {
    try {
      const { port, process } = await startMLModelHTTPServer({
        modelReference,
        pythonEnvironment
      })
      return {
        sucess: true,
        process: { pid: process.pid, port: port },
        message: 'ML Model HTTP server successfully started'
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to start the ML Model HTTP server: ${error.message}`
      }
    }
  })
}

/**
 * Finds a free port on the local machine.
 *
 * This function creates a temporary server that listens on a random port
 * (by passing 0 to the `listen` method). Once the server is successfully
 * listening, it retrieves the assigned port number, closes the server,
 * and resolves the promise with the free port number. If there is an error
 * while creating the server, the promise is rejected.
 *
 * @returns {Promise<number>} A promise that resolves to a free port number.
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    // log.info('Finding free port...')
    const server = net.createServer()
    server.listen(0, () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

/**
 * Starts the SpeciesNet HTTP server using a specified Python environment and configuration.
 *
 * This function initializes a Python process that runs the SpeciesNet server script.
 * It sets up the server with the provided parameters and checks its health status
 * by polling the server endpoint until it is ready or the maximum number of retries is reached.
 *
 * @async
 * @param {Object} options - The configuration options for starting the server.
 * @param {number} options.port - The port on which the server will listen.
 * @param {string} options.modelWeightsFilepath - The file path to the model weights to be used by the server.
 * @param {string} options.geofence - The geofence configuration for the server.
 * @param {number} options.timeout - The timeout duration for server operations.
 * @param {Object} options.pythonEnvironment - The Python environment configuration.
 * @param {Object} options.pythonEnvironment.reference - The reference object containing environment details.
 * @param {string} options.pythonEnvironment.reference.id - The identifier for the Python environment.
 *
 * @returns {Promise<ChildProcess>} A promise that resolves to the spawned Python process if the server starts successfully.
 *
 * @throws {Error} Throws an error if the server fails to start within the expected time.
 *
 * @example
 * const server = await startSpeciesNetHTTPServer({
 *   port: 8080,
 *   modelWeightsFilepath: '/path/to/model/weights',
 *   geofence: 'some-geofence',
 *   timeout: 5000,
 *   pythonEnvironment: {
 *     reference: {
 *       id: 'my-python-env'
 *     }
 *   }
 * });
 */
async function startSpeciesNetHTTPServer({
  port,
  modelWeightsFilepath,
  geofence,
  timeout,
  pythonEnvironment
}) {
  log.info('StartSpeciesNetHTTPServer success!')
  log.info(pythonEnvironment)
  const localInstalRootDirPythonEnvironment = join(
    getMLModelEnvironmentLocalInstallPath({
      ...pythonEnvironment.reference
    }),
    pythonEnvironment.reference.id
  )
  log.info('Local Python Environment root dir is', localInstalRootDirPythonEnvironment)
  const scriptPath = is.dev
    ? join(__dirname, '../../python-environments/common/run_speciesnet_server.py')
    : join(process.resourcesPath, 'python-environments', 'common', 'run_speciesnet_server.py')
  const pythonInterpreter = is.dev
    ? join(__dirname, '../../python-environments/common/.venv/bin/python')
    : os.platform() === 'win32'
      ? join(localInstalRootDirPythonEnvironment, 'python.exe')
      : join(localInstalRootDirPythonEnvironment, 'bin', 'python')
  log.info('Python Interpreter found in', pythonInterpreter)
  log.info('Script path is', scriptPath)
  const scriptArgs = [
    '--port',
    port,
    '--geofence',
    geofence,
    '--model',
    modelWeightsFilepath,
    '--timeout',
    timeout
  ]
  log.info('Script args: ', scriptArgs)
  log.info('Formatted script args: ', [scriptPath, ...scriptArgs])
  const pythonProcess = spawn(pythonInterpreter, [scriptPath, ...scriptArgs])

  log.info('Python process started:', pythonProcess.pid)

  // Set up error handlers
  pythonProcess.stderr.on('data', (err) => {
    log.error('Python error:', err.toString())
  })

  pythonProcess.on('error', (err) => {
    log.error('Python process error:', err)
  })

  // Wait for server to be ready by polling the endpoint
  const maxRetries = 30
  const retryInterval = 1000 // 1 second

  for (let i = 0; i < maxRetries; i++) {
    try {
      const healthCheck = await fetch(`http://localhost:${port}/health`, {
        method: 'GET',
        timeout: 1000
      })

      if (healthCheck.ok) {
        log.info('Server is ready')
        return pythonProcess
      }
    } catch (error) {
      // Server not ready yet, will retry
    }

    // Wait before next retry
    await new Promise((resolve) => setTimeout(resolve, retryInterval))
    log.info(`Waiting for server to start (attempt ${i + 1}/${maxRetries})`)
  }

  // If we get here, the server failed to start
  kill(pythonProcess.pid)
  throw new Error('Server failed to start in the expected time')
}

/**
 * Stops the ML Model HTTP Server.
 *
 * This function sends a termination signal to the specified Python process running the ML Model HTTP server.
 * It logs the process ID and handles any errors that may occur while attempting to stop the process.
 *
 * @async
 * @param {Object} params - The parameters for stopping the server.
 * @param {number} params.pid - The process ID of the ML Model HTTP server to be stopped.
 * @returns {Promise<Object>} A promise that resolves to an object indicating the success of the operation
 * and a corresponding message.
 * @throws {Error} Throws an error if the process cannot be stopped.
 */
async function stopMLModelHTTPServer({ pid }) {
  try {
    log.info('Stopping ML Model HTTP Server with pid', pid)
    return new Promise((resolve, reject) => {
      kill(pid, 'SIGKILL', (err) => {
        if (err) {
          log.error('Error killing Python process:', err)
          reject(err)
        } else {
          log.info('Python process killed successfully')
          resolve({ success: true, message: `Stopped ML Model within python process pid ${pid}` })
        }
      })
    })
  } catch (error) {
    return { success: false, message: `could not stop ML Model within python process pid ${pid}` }
  }
}

/**
 * Starts the ML Model HTTP Server using a specified Python environment and model reference.
 *
 * This function initializes the HTTP server for the ML model, allowing it to handle requests.
 * It finds a free port for the server to listen on, initializes the server with the provided
 * model weights, and manages the lifecycle of the server process.
 *
 * @async
 * @param {Object} options - The options for starting the server.
 * @param {Object} options.pythonEnvironment - The Python environment configuration.
 * @param {Object} options.modelReference - The reference object containing model details.
 * @returns {Promise<Object>} A promise that resolves to an object containing the port and process of the server.
 */
async function startMLModelHTTPServer({ pythonEnvironment, modelReference }) {
  log.info('Starting ML Model HTTP Server')
  log.info('Finding free port for Python server...')
  log.info('Model Reference:', modelReference, pythonEnvironment)
  switch (modelReference.id) {
    case 'speciesnet': {
      const port = is.dev ? 8000 : await findFreePort()
      const localInstallPath = getMLModelLocalInstallPath({ ...modelReference })
      log.info(`Local ML Model install path ${localInstallPath}`)
      const pythonProcess = await startSpeciesNetHTTPServer({
        port,
        modelWeightsFilepath: localInstallPath,
        geofence: true,
        timeout: 30,
        pythonEnvironment: pythonEnvironment
      })
      log.info(`pythonProcess: ${JSON.stringify(pythonProcess)}`)
      return { port: port, process: pythonProcess }
    }
    default: {
      log.warn(
        `startMLModelHTTPServer: Not implemented for ${modelReference.id} version ${modelReference.version}`
      )
      return { port: null, process: null }
    }
  }
}

export default {
  registerMLModelManagementIPCHandlers,
  startMLModelHTTPServer,
  stopMLModelHTTPServer
}
