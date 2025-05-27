/**
 * @fileoverview This module provides utility functions for managing the ML models and their weights.
 *
 * This file includes functions for downloading, extracting, deleting model weights.
 *
 * @module ml_model_management
 */

import { app, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { net as electronNet } from 'electron'
import net from 'net'
import { join, dirname } from 'path'
import { spawn } from 'child_process'
import { readdirSync, existsSync, mkdirSync, createWriteStream, promises as fsPromises } from 'fs'
import log from 'electron-log'
import path from 'path'
import { pipeline } from 'stream/promises'
import kill from 'tree-kill'

/**
 * Extracts a .tar.gz archive to a specified directory.
 *
 * This function checks if the extraction directory already exists and contains files.
 * If the directory exists and is not empty, the extraction is skipped. If the directory
 * does not exist, it will be created. The extraction is performed using the native `tar`
 * command, which works on macOS, Linux, and modern Windows systems.
 *
 * @async
 * @param {string} tarPath - The path to the .tar.gz file to be extracted.
 * @param {string} extractPath - The directory where the contents of the archive will be extracted.
 * @returns {Promise<string>} A promise that resolves to the extraction path if successful.
 * @throws {Error} Throws an error if the extraction process fails or if the `tar` command encounters an issue.
 *
 * @example
 * extractTarGz('./path/to/archive.tar.gz', './path/to/extract')
 *   .then((path) => {
 *     console.log(`Files extracted to: ${path}`);
 *   })
 *   .catch((error) => {
 *     console.error('Extraction failed:', error);
 *   });
 */
async function extractTarGz(tarPath, extractPath) {
  // Check if extraction directory already exists and contains files
  log.info(`Checking extraction directory at ${extractPath}`, existsSync(extractPath))
  if (existsSync(extractPath)) {
    try {
      const files = readdirSync(extractPath)
      if (files.length > 0) {
        log.info(
          `Extraction directory already exists with content at ${extractPath}, skipping extraction`
        )
        return extractPath
      }
    } catch (error) {
      log.warn(`Error checking extraction directory: ${error}`)
    }
  }

  log.info(`Extracting ${tarPath} to ${extractPath}`)

  if (!existsSync(extractPath)) {
    mkdirSync(extractPath, { recursive: true })
  }

  return new Promise((resolve, reject) => {
    const startTime = Date.now()

    // Use native tar command - works on macOS, Linux, and modern Windows
    const tarProcess = spawn('tar', ['-xzf', tarPath, '-C', extractPath])

    tarProcess.stdout.on('data', (data) => {
      log.info(`tar output: ${data}`)
    })

    tarProcess.stderr.on('data', (data) => {
      // Not necessarily an error, tar outputs progress to stderr
      log.info(`tar progress: ${data}`)
    })

    tarProcess.on('error', (err) => {
      log.error(`Error executing tar command:`, err)
      reject(err)
    })

    tarProcess.on('close', (code) => {
      const duration = (Date.now() - startTime) / 1000
      if (code === 0) {
        log.info(`Extraction complete to ${extractPath}. Took ${duration} seconds.`)
        resolve(extractPath)
      } else {
        const err = new Error(`tar process exited with code ${code}`)
        log.error(err)
        reject(err)
      }
    })
  })
}

/**
 * Downloads a file from a specified URL to a designated destination path.
 *
 * This function ensures that the destination directory exists before downloading the file.
 * It uses Electron's net module to fetch the file and streams the response to the specified
 * destination. If the download fails, an error is thrown with the appropriate status.
 *
 * @async
 * @param {string} url - The URL of the file to be downloaded.
 * @param {string} destination - The path where the downloaded file will be saved.
 * @returns {Promise<string>} A promise that resolves to the destination path if the download is successful.
 * @throws {Error} Throws an error if the download fails or if the destination directory cannot be created.
 *
 * @example
 * downloadFile('https://example.com/file.zip', './downloads/file.zip')
 *   .then((path) => {
 *     console.log(`File downloaded to: ${path}`);
 *   })
 *   .catch((error) => {
 *     console.error('Download failed:', error);
 *   });
 */
async function downloadFile(url, destination) {
  log.info(`Downloading ${url} to ${destination}...`)

  try {
    // Ensure the directory exists
    const dir = path.dirname(destination)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // Create a write stream
    const writer = createWriteStream(destination)

    // Download the file with electron's net module
    const response = await electronNet.fetch(url)
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`)
    }

    // Pipe the response to the file
    await pipeline(response.body, writer)

    log.info(`Download complete: ${destination}`)
    return destination
  } catch (error) {
    log.error(`Download failed: ${error.message}`)
    throw error
  }
}

const getMLModelLocalRootDir = () => join(app.getPath('userData'), 'model-zoo')

const getMLModelLocalTarPath = ({ id, version }) =>
  join(getMLModelLocalRootDir(), 'archives', id, `${version}.tar.gz`)

const getMLModelLocalInstallPath = ({ id, version }) => join(getMLModelLocalRootDir(), id, version)

function isMLModelDownloaded({ id, version }) {
  const localInstallPath = getMLModelLocalInstallPath({ id, version })
  return existsSync(localInstallPath)
}

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

async function deleteLocalMLModel({ id, version }) {
  const localTarPath = getMLModelLocalTarPath({ id, version })
  const localInstallPath = getMLModelLocalInstallPath({ id, version })
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

async function downloadPythonEnvironment({ id, version, downloadURL }) {
  try {
    const extractPath = getMLModelEnvironmentLocalInstallPath({ id, version })
    const localTarPath = getMLModelEnvironmentLocalTarPath({ id, version })
    if (existsSync(extractPath)) {
      log.info(`Python environment already installed in ${extractPath}, skipping.`)
      return {
        success: true,
        message: 'Python Environment downloaded and extracted successfully'
      }
    } else {
      log.info('Downloading the environment from', downloadURL)
      await downloadFile(downloadURL, localTarPath)
      log.info(`Extracting the archive ${localTarPath} to ${extractPath}`)
      await extractTarGz(localTarPath, extractPath)
      log.info('Cleaning the local archive: ', localTarPath)
      await fsPromises.unlink(localTarPath)
    }
    return {
      success: true,
      message: 'Python Environment downloaded and extracted successfully'
    }
  } catch (error) {
    log.error('Failed to download the Python Environment:', error)
    return {
      success: false,
      message: `Failed to download the Python Environment: ${error.message}`
    }
  }
}

async function downloadMLModel({ id, version, downloadURL }) {
  try {
    const localInstallPath = getMLModelLocalInstallPath({ id, version })
    const extractPath = dirname(localInstallPath)
    const localTarPath = getMLModelLocalTarPath({ id, version })
    if (existsSync(localInstallPath)) {
      log.info(`Model already installed in ${localInstallPath}, skipping.`)
      return {
        success: true,
        message: 'Model downloaded and extracted successfully'
      }
    } else {
      log.info('Downloading the model from', downloadURL)
      await downloadFile(downloadURL, localTarPath)
      log.info(`Extracting the archive ${localTarPath} to ${extractPath}`)
      await extractTarGz(localTarPath, extractPath)
      log.info('Cleaning the local archive: ', localTarPath)
      await fsPromises.unlink(localTarPath)
      return {
        success: true,
        message: 'Model downloaded and extracted successfully'
      }
    }
  } catch (error) {
    log.error('Failed to download model:', error)
    return {
      success: false,
      message: `Failed to download model: ${error.message}`
    }
  }
}

const getMLModelEnvironmentRootDir = () =>
  join(app.getPath('userData'), 'python-environments', 'conda')

const getMLModelEnvironmentLocalInstallPath = ({ version, id }) => {
  return join(getMLModelEnvironmentRootDir(), id, version)
}

const getMLModelEnvironmentLocalTarPath = () => join(getMLModelEnvironmentRootDir(), 'archives')

export const registerMLModelManagementIPCHandlers = () => {
  // Add IPC handler to check whether the ML model is properly installed locally
  ipcMain.handle('ml-model-management:v0:is-ml-model-downloaded', (_, id, version) =>
    isMLModelDownloaded({ id, version })
  )

  // Add IPC handler to delete the ml model
  ipcMain.handle('ml-model-management:v0:delete-local-ml-model', (_, id, version) =>
    deleteLocalMLModel({ id, version })
  )

  ipcMain.handle('ml-model-management:v0:clear-all-local-ml-models', async (_) =>
    clearAllLocalMLModels()
  )

  ipcMain.handle(
    'ml-model-management:v0:download-ml-model',
    async (_, id, version, downloadURL, format) => {
      return await downloadMLModel({ id, version, downloadURL, format })
    }
  )
  ipcMain.handle(
    'ml-model-management:v0:download-python-environment',
    async (_, id, version, downloadURL) => {
      return await downloadPythonEnvironment({ id, version, downloadURL })
    }
  )
  ipcMain.handle('ml-model-management:v0:stop-ml-model-http-server', async (_, pid) => {
    return await stopMLModelHTTPServer({ pid })
  })
  ipcMain.handle(
    'ml-model-management:v0:start-ml-model-http-server',
    async (_, modelReference, pythonEnvironment) => {
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
    }
  )
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
  const scriptPath = join(__dirname, '../../python-environments/common/run_speciesnet_server.py')
  const pythonInterpreter = join(localInstalRootDirPythonEnvironment, 'bin', 'python')
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

async function stopMLModelHTTPServer({ pid }) {
  try {
    log.info('Stopping ML Model HTTP Server with pid', pid)
    kill(pid)
    return { success: true, message: `Stopped ML Model within python process pid ${pid}` }
  } catch (error) {
    return { success: false, message: `could not stop ML Model within python process pid ${pid}` }
  }
}

async function startMLModelHTTPServer({ pythonEnvironment, modelReference }) {
  log.info('Starting ML Model HTTP Server')
  log.info('Finding free port for Python server...')
  switch (modelReference.id) {
    case 'speciesnet':
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
      // return pythonProcess
      return { port: port, process: pythonProcess }
    default:
      log.warn(
        `startMLModelHTTPServer: Not implemented for ${modelReference.id} version ${modelReference.version}`
      )
  }
}
