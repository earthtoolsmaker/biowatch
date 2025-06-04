/**
 * @fileoverview This module provides utility functions for managing the ML models and their weights.
 *
 * This file includes functions for downloading, extracting, deleting model weights.
 *
 * @module ml_model_management
 */

import yaml from 'js-yaml'
import { app, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { extract } from 'tar'
import { net as electronNet } from 'electron'
import net from 'net'
import { join, dirname } from 'path'
import { spawn } from 'child_process'
import {
  createReadStream,
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  createWriteStream,
  promises as fsPromises,
  writeFileSync
} from 'fs'
import log from 'electron-log'
import path from 'path'
import kill from 'tree-kill'
import { findModel, findPythonEnvironment, platformToKey } from '../shared/mlmodels'

/**
 * Extracts a .tar.gz archive to a specified directory.
 *
 * This function checks if the extraction directory already exists and contains files.
 * If the directory exists and is not empty, the extraction is skipped. If the directory
 * does not exist, it will be created. The extraction is performed using the native `tar`
 * command, which works on macOS, Linux, and modern Windows systems.
 *
 * @async
 * @param {string} tarPath - The path to the .tar.gz archive to be extracted.
 * @param {string} extractPath - The path to the directory where the files will be extracted.
 * @param {function} onProgress - A callback function that is called with progress updates.
 * @returns {Promise<string>} A promise that resolves to the destination path if the download is successful.
 * @throws {Error} Throws an error if the extraction process fails or if the `tar` command encounters an issue.
 *
 * @example
 * extractTarGz('./path/to/archive.tar.gz', './path/to/extract', (progress) => {
 *   console.log(`Download progress: ${progress.extracted}%`);
 * })
)
 *   .then((path) => {
 *     console.log(`Files extracted to: ${path}`);
 *   })
 *   .catch((error) => {
 *     console.error('Extraction failed:', error);
 *   });
 */
async function extractTarGz(tarPath, extractPath, onProgress) {
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

  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    let processedEntries = 0
    const tarStream = createReadStream(tarPath)
      .pipe(extract({ cwd: extractPath }))
      .on('finish', () => {
        const duration = (Date.now() - startTime) / 1000
        log.info(`Extraction complete to ${extractPath}. Took ${duration} seconds.`)
        resolve(extractPath)
      })
      .on('error', (err) => {
        log.error(`Error during extraction:`, err)
        reject(err)
      })
      .on('entry', (_entry) => {
        processedEntries++
        onProgress({ extracted: processedEntries })
      })
  })
}

/**
 * Downloads a file from a specified URL to a designated destination path.
 *
 * This function ensures that the destination directory exists before downloading the file.
 * It uses Electron's net module to fetch the file and streams the response to the specified
 * destination. If the download fails, an error is thrown with the appropriate status.
 * A progress callback can be provided to track the download progress.
 *
 * @async
 * @param {string} url - The URL of the file to be downloaded.
 * @param {string} destination - The path where the downloaded file will be saved.
 * @param {function} onProgress - A callback function that is called with progress updates.
 * @returns {Promise<string>} A promise that resolves to the destination path if the download is successful.
 * @throws {Error} Throws an error if the download fails or if the destination directory cannot be created.
 *
 * @example
 * downloadFile('https://example.com/file.zip', './downloads/file.zip', (progress) => {
 *   console.log(`Download progress: ${progress.percent}%`);
 * })
 *   .then((path) => {
 *     console.log(`File downloaded to: ${path}`);
 *   })
 *   .catch((error) => {
 *     console.error('Download failed:', error);
 *   });
 **/
async function downloadFile(url, destination, onProgress) {
  log.info(`Downloading ${url} to ${destination}...`)

  try {
    const dir = path.dirname(destination)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const response = await electronNet.fetch(url)
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`)
    }

    const totalBytes = Number(response.headers.get('Content-Length'))
    const writer = createWriteStream(destination)
    const reader = response.body.getReader()

    let downloadedBytes = 0

    // Custom function to read the stream
    const readStream = async () => {
      const { done, value } = await reader.read()

      if (done) {
        log.info(`Download complete: ${destination}`)
        writer.end() // Close the write stream
        return destination
      }

      // Write the chunk to the file
      writer.write(value)
      downloadedBytes += value.length

      // Update progress
      const progress = (downloadedBytes / totalBytes) * 100
      onProgress({ totalBytes, downloadedBytes, percent: progress })
      if (onProgress) {
        onProgress({ totalBytes, downloadedBytes, percent: progress })
      }

      // Read the next chunk
      return readStream()
    }

    await readStream() // Start reading the stream

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

const getMLModelLocalDownloadManifest = () => join(getMLModelLocalRootDir(), 'manifest.yaml')

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

async function downloadPythonEnvironment({ id, version }) {
  const installationStateProgress = {
    [InstallationState.Failure]: 0,
    // The Download stage indicates that the model is currently being downloaded.
    // Once this stage is complete, it contributes 70% to the overall progress.
    [InstallationState.Download]: 70,
    // The Extract stage indicates that the model has been downloaded and is now being extracted.
    // Upon completion, this stage contributes 98% to the overall progress.
    [InstallationState.Extract]: 98,
    // The Clean stage signifies that the installation process is cleaning up temporary files.
    // Once this stage is finished, it marks 100% completion of the installation.
    [InstallationState.Clean]: 100,
    // The Success state indicates that the installation has completed successfully.
    [InstallationState.Success]: 100
  }
  const env = findPythonEnvironment({ id, version })
  log.info(`env: ${env}`)
  const platformKey = platformToKey(process.platform)
  log.info('downloadPythonEnvironment: platformKey is ', platformKey)
  const { downloadURL } = env['platform'][platformKey]
  log.info('downloadPythonEnvironment: download URL is ', downloadURL)
  const extractPath = getMLModelEnvironmentLocalInstallPath({ id, version })
  log.info('extractPath: ', extractPath)
  const localTarPath = getMLModelEnvironmentLocalTarPath({ id, version })
  log.info('localTarPath: ', localTarPath)
  const manifestFilepath = getMLEnvironmentDownloadManifest()

  const manifest = yamlRead(manifestFilepath)
  log.info('manifest filepath: ', manifestFilepath)
  log.info('manifest content: ', manifest)
  const manifestOpts = { archivePath: localTarPath, installPath: extractPath }

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

  try {
    if (existsSync(extractPath)) {
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
      await extractTarGz(localTarPath, extractPath, (progress) =>
        log.info(`Number of extracted files ${JSON.stringify(progress)}`)
      )
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
    }
    return {
      success: true,
      message: 'Python Environment downloaded and extracted successfully'
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
 * Reads the contents of a YAML file and parses it into a JavaScript object.
 *
 * This function checks if the specified YAML file exists. If it does, it reads the file's contents,
 * parses the YAML data, and returns it as a JavaScript object. If the file does not exist,
 * the function returns an empty structure with a default property `downloads` set to an empty array.
 *
 * @param {string} yamlFile - The path to the YAML file to be read.
 * @returns {Object} The parsed contents of the YAML file, or an empty structure if the file does not exist.
 *
 * @example
 * const config = yamlRead('./config.yaml');
 * console.log(config.downloads);
 */
function yamlRead(yamlFile) {
  if (existsSync(yamlFile)) {
    const fileContents = readFileSync(yamlFile, 'utf8')
    return yaml.load(fileContents) || {}
  } else {
    return {} // Return an empty structure if the file doesn't exist
  }
}

enum InstallationState {
  /** Indicates a successful installation. */
  Success = 'success',
  /** Indicates a failed installation. */
  Failure = 'failure',
  /** Indicates that the artifact is currently being downloaded. */
  Download = 'download',
  /** Indicates that the artifact is being cleaned up after installation. */
  Clean = 'clean',
  /** Indicates that the artifact is currently being extracted from its archive. */
  Extract = 'extract'
}

/**
 * Writes a JavaScript object to a YAML file.
 *
 * This function converts the provided data object into a YAML string format
 * and writes it to the specified file path. If the file already exists,
 * it will be overwritten. The function uses the `js-yaml` library to perform
 * the conversion from the JavaScript object to YAML format.
 *
 * @param {Object} data - The JavaScript object to be converted and written to the YAML file.
 * @param {string} yamlFile - The path to the file where the YAML data will be written.
 *
 * @example
 * const data = {
 *   name: "example",
 *   version: "1.0.0",
 *   contributors: ["Alice", "Bob"]
 * };
 * yamlWrite(data, './config.yaml');
 */
function yamlWrite(data, yamlFile) {
  const yamlStr = yaml.dump(data)
  writeFileSync(yamlFile, yamlStr, 'utf8')
}

/**
 * Writes the specified ML model information to the manifest file.
 *
 * This function updates the manifest file with the current state and options
 * for a given model identified by its ID and version. If the model already exists
 * in the manifest, it will be updated; otherwise, it will be added.
 *
 * @param {Object} params - The parameters for writing to the manifest.
 * @param {string} params.manifestFilepath - The path to the manifest file.
 * @param {string} params.id - The identifier of the artifact
 * @param {string} params.version - The version of the artifact
 * @param {string} params.state - The current state of the download and install (e.g., success, failure).
 * @param {Object} params.opts - Additional options related to the ML model.
 */
function writeToManifest({ manifestFilepath, progress, id, version, state, opts }) {
  const manifest = yamlRead(manifestFilepath)
  log.info('manifest content: ', JSON.stringify(manifest))
  const yamlData = {
    ...manifest,
    [id]: {
      ...manifest[id],
      [version]: { state: state, progress: progress, opts: opts }
    }
  }
  log.info('New manifest data: ', JSON.stringify(yamlData))
  yamlWrite(yamlData, manifestFilepath)
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
  const { downloadURL } = findModel({ id, version })
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
    [InstallationState.Download]: 70,
    // The Extract stage indicates that the model has been downloaded and is now being extracted.
    // Upon completion, this stage contributes 98% to the overall progress.
    [InstallationState.Extract]: 98,
    // The Clean stage signifies that the installation process is cleaning up temporary files.
    // Once this stage is finished, it marks 100% completion of the installation.
    [InstallationState.Clean]: 100,
    // The Success state indicates that the installation has completed successfully.
    [InstallationState.Success]: 100
  }

  const manifest = yamlRead(manifestFilepath)
  log.info('manifest filepath: ', manifestFilepath)
  log.info('manifest content: ', manifest)
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
  try {
    if (existsSync(localInstallPath)) {
      log.info(`Model already installed in ${localInstallPath}, skipping.`)
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
      await extractTarGz(localTarPath, extractPath, (progress) =>
        log.info(`Number of extracted files ${JSON.stringify(progress)}`)
      )
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

const getMLModelEnvironmentRootDir = () =>
  join(app.getPath('userData'), 'python-environments', 'conda')

const getMLEnvironmentDownloadManifest = () => join(getMLModelEnvironmentRootDir(), 'manifest.yaml')

function getMLModelEnvironmentLocalInstallPath({ version, id }) {
  return join(getMLModelEnvironmentRootDir(), `${id}`, `${version}`)
}

function getMLModelEnvironmentLocalTarPath({ id, version }) {
  return join(getMLModelEnvironmentRootDir(), 'archives', id, version)
}

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

  ipcMain.handle('ml-model-management:v0:download-ml-model', async (_, id, version) => {
    return await downloadMLModel({ id, version })
  })
  ipcMain.handle('ml-model-management:v0:download-python-environment', async (_, id, version) => {
    return await downloadPythonEnvironment({ id, version })
  })
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
  // TODO: Make sure the build steps include the python script as a resource in the electron buil
  // use app.getResource to target the python script
  const scriptPath = is.dev
    ? join(__dirname, '../../python-environments/common/run_speciesnet_server.py')
    : join(process.resourcesPath, 'python-environments', 'common', 'run_speciesnet_server.py')
  const pythonInterpreter = is.dev
    ? join(__dirname, '../../python-environments/common/.venv/bin/python')
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
    default:
      log.warn(
        `startMLModelHTTPServer: Not implemented for ${modelReference.id} version ${modelReference.version}`
      )
  }
}

export default {
  startMLModelHTTPServer,
  stopMLModelHTTPServer
}
