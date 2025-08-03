/**
 * @fileoverview This module provides utility functions for managing the ML models and their weights.
 *
 * @module models
 */

import { app, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import net from 'net'
import { join, dirname, basename } from 'path'
import { spawn } from 'child_process'
import { existsSync, readdir, promises as fsPromises } from 'fs'
import log from 'electron-log'
import kill from 'tree-kill'
import { findModel, findPythonEnvironment, platformToKey } from '../shared/mlmodels'
import { modelZoo } from '../shared/mlmodels'
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

/**
 * Lists all directories within a specified folder path.
 *
 * This asynchronous function reads the contents of the given folder path
 * and returns an array of paths that correspond to the directories found.
 *
 * @param {string} folderPath - The path of the folder to be scanned for directories.
 * @returns {Promise<string[]>} A promise that resolves to an array of strings,
 * where each string is a path to a directory within the specified folder.
 *
 * @throws {Error} Throws an error if there is an issue reading the folder or
 * if the folder does not exist.
 *
 * @example
 * listDirectories('/path/to/folder')
 *   .then(directories => {
 *     console.log('Directories found:', directories);
 *   })
 *   .catch(error => {
 *     console.error('Error listing directories:', error.message);
 *   });
 */
async function listDirectories(folderPath: string): Promise<string[]> {
  // Check if directory exists before attempting to read it
  if (!existsSync(folderPath)) {
    log.debug(`Directory does not exist: ${folderPath}`)
    return []
  }

  return new Promise((resolve, reject) => {
    readdir(folderPath, { withFileTypes: true }, (err, files) => {
      if (err) {
        log.error('Error reading directory:', err)
        reject(err)
        return
      }

      const directories = files
        .filter((file) => file.isDirectory())
        .map((dir) => join(folderPath, dir.name))

      resolve(directories)
    })
  })
}

// -------------------------------------------------------
// Util functions to define the install and download paths
// -------------------------------------------------------

function getMLModelLocalRootDir() {
  return join(app.getPath('userData'), 'biowatch-data', 'model-zoo')
}

function getMLModelLocalTarPathRoot() {
  return join(getMLModelLocalRootDir(), 'archives')
}

function getMLModelLocalTarPath({ id, version }) {
  return join(getMLModelLocalTarPathRoot(), id, `${version}.tar.gz`)
}

function getMLModelLocalInstallPath({ id, version }) {
  return join(getMLModelLocalRootDir(), id, version)
}

/**
 * Lists all installed machine learning models in the local model zoo directory.
 *
 * This asynchronous function retrieves all directories from the local model zoo directory,
 * filtering out the archives directory and returning an array of references to the installed
 * models. Each reference contains the model's unique identifier (id) and its version.
 *
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of objects representing
 * the installed models, where each object contains:
 *   - {string} id - The unique identifier of the ML model.
 *   - {string} version - The version of the ML model.
 *
 * @throws {Error} Throws an error if there is an issue reading the directories.
 *
 * @example
 * listMLModelInstalled()
 *   .then(installedModels => {
 *     console.log('Installed models:', installedModels);
 *   })
 *   .catch(error => {
 *     console.error('Error listing installed models:', error.message);
 *   });
 */
async function listInstalledMLModels() {
  const rootDir = getMLModelLocalRootDir()
  
  // Check if the root directory exists
  if (!existsSync(rootDir)) {
    log.debug(`ML Model root directory does not exist: ${rootDir}`)
    return []
  }

  const installedPaths = await listDirectories(rootDir)
  // Remove the archives
  const filteredPaths = installedPaths.filter((x: string) => x !== getMLModelLocalTarPathRoot())
  const folderPaths = await Promise.all(
    filteredPaths.map((folderPath: string) => listDirectories(folderPath))
  )
  const references = folderPaths.flat().map((folderPath: string) => ({
    version: basename(folderPath),
    id: basename(dirname(folderPath))
  }))
  return references
}

function getMLModelLocalDownloadManifest() {
  return join(getMLModelLocalRootDir(), 'manifest.yaml')
}

function getMLModelEnvironmentRootDir() {
  return join(app.getPath('userData'), 'biowatch-data', 'python-environments', 'conda')
}

function getMLEnvironmentDownloadManifest() {
  return join(getMLModelEnvironmentRootDir(), 'manifest.yaml')
}

function getMLModelEnvironmentLocalInstallPath({ version, id }) {
  return join(getMLModelEnvironmentRootDir(), `${id}`, `${version}`)
}

/**
 * Lists all installed machine learning model environments in the local environment directory.
 *
 * This asynchronous function retrieves all directories from the local environment directory,
 * filtering out the archives directory and returning an array of references to the installed
 * environments. Each reference contains the environment's unique identifier (id) and its version.
 *
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of objects representing
 * the installed environments, where each object contains:
 *   - {string} id - The unique identifier of the environment.
 *   - {string} version - The version of the environment.
 *
 * @throws {Error} Throws an error if there is an issue reading the directories.
 *
 * @example
 * listInstalledMLModelEnvironments()
 *   .then(installedEnvironments => {
 *     console.log('Installed environments:', installedEnvironments);
 *   })
 *   .catch(error => {
 *     console.error('Error listing installed environments:', error.message);
 *   });
 */
async function listInstalledMLModelEnvironments() {
  const rootDir = getMLModelEnvironmentRootDir()
  
  // Check if the root directory exists
  if (!existsSync(rootDir)) {
    log.debug(`ML Model environment root directory does not exist: ${rootDir}`)
    return []
  }

  const installedPaths = await listDirectories(rootDir)
  // Remove the archives
  const filteredPaths = installedPaths.filter(
    (x: string) => x !== getMLModelEnvironmentLocalTarPathRoot()
  )
  const folderPaths = await Promise.all(
    filteredPaths.map((folderPath: string) => listDirectories(folderPath))
  )
  const references = folderPaths.flat().map((folderPath: string) => ({
    version: basename(folderPath),
    id: basename(dirname(folderPath))
  }))
  return references
}

function getMLModelEnvironmentLocalTarPathRoot() {
  return join(getMLModelEnvironmentRootDir(), 'archives')
}

function getMLModelEnvironmentLocalTarPath({ id, version }) {
  return join(getMLModelEnvironmentLocalTarPathRoot(), id, version)
}

/**
 * Retrieves a list of stale installed machine learning models.
 *
 * This asynchronous function checks the installed models in the local model zoo
 * against the available models in the model repository. It identifies and returns
 * the models that are no longer available or have been deprecated.
 *
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of objects
 * representing the stale installed models, where each object contains:
 *   - {string} id - The unique identifier of the ML model.
 *   - {string} version - The version of the ML model.
 *
 * @throws {Error} Throws an error if there is an issue retrieving the installed models.
 *
 * @example
 * listStaleInstalledModels()
 *   .then(staleModels => {
 *     console.log('Stale models found:', staleModels);
 *   })
 *   .catch(error => {
 *     console.error('Error listing stale models:', error.message);
 *   });
 */
async function listStaleInstalledModels() {
  const installedReferences = await listInstalledMLModels()
  const availableReferences = modelZoo.map((e) => e.reference)

  const staleReferences = installedReferences.filter(
    (installed) =>
      !availableReferences.some(
        (available) => available.id === installed.id && available.version === installed.version
      )
  )

  return staleReferences
}

/**
 * Lists all stale installed machine learning model environments in the local environment directory.
 *
 * This asynchronous function checks the installed environments in the local environment directory
 * against the available environments in the model repository. It identifies and returns
 * the environments that are no longer available or have been deprecated.
 *
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of objects
 * representing the stale installed environments, where each object contains:
 *   - {string} id - The unique identifier of the environment.
 *   - {string} version - The version of the environment.
 *
 * @throws {Error} Throws an error if there is an issue retrieving the installed environments.
 *
 * @example
 * listStaleInstalledMLModelEnvironments()
 *   .then(staleEnvironments => {
 *     console.log('Stale environments found:', staleEnvironments);
 *   })
 *   .catch(error => {
 *     console.error('Error listing stale environments:', error.message);
 *   });
 */
async function listStaleInstalledMLModelEnvironments() {
  const installedReferences = await listInstalledMLModelEnvironments()
  const availableReferences = modelZoo.map((e) => e.pythonEnvironment)

  const staleReferences = installedReferences.filter(
    (installed) =>
      !availableReferences.some(
        (available) => available.id === installed.id && available.version === installed.version
      )
  )

  return staleReferences
}

/**
 * Garbage collects stale machine learning models from the local model zoo directory.
 *
 * This asynchronous function identifies stale models that are no longer available
 * in the model zoo and removes their corresponding directories from the local file
 * system. It logs the number of models found for removal and performs the cleanup
 * operation, ensuring that only valid models are retained in the local installation.
 *
 * @returns {Promise<void>} A promise that resolves when the garbage collection
 * process is completed.
 *
 * @throws {Error} Throws an error if there is an issue during the removal of directories.
 */
async function garbageCollectMLModels() {
  const staleReferences = await listStaleInstalledModels()
  const dirs = staleReferences.map((reference) => getMLModelLocalInstallPath({ ...reference }))
  if (dirs.length > 0) {
    log.info(`[GC] Found ${dirs.length} models to remove: ${dirs}`)
  } else {
    log.info('[GC] no ML Model to garbage collect')
  }

  // Remove directories
  await Promise.all(
    dirs.map(async (dir) => {
      if (existsSync(dir)) {
        log.info('[GC] Removing directory:', dir)
        await fsPromises.rm(dir, { recursive: true, force: true })
      }
    })
  )
}

/**
 * Garbage collects stale machine learning model environments from the local environment directory.
 *
 * This asynchronous function identifies stale environments that are no longer available
 * in the model zoo and removes their corresponding directories from the local file system.
 * It logs the number of environments found for removal and performs the cleanup operation,
 * ensuring that only valid environments are retained.
 *
 * @returns {Promise<void>} A promise that resolves when the garbage collection
 * process is completed.
 *
 * @throws {Error} Throws an error if there is an issue during the removal of directories.
 */
async function garbageCollectMLModelEnvironments() {
  const staleReferences = await listStaleInstalledMLModelEnvironments()
  const dirs = staleReferences.map((reference) =>
    getMLModelEnvironmentLocalInstallPath({ ...reference })
  )
  if (dirs.length > 0) {
    log.info(`[GC] Found ${dirs.length} environments to remove: ${dirs}`)
  } else {
    log.info('[GC] no environment to garbage collect')
  }
  // Remove directories
  await Promise.all(
    dirs.map(async (dir) => {
      if (existsSync(dir)) {
        log.info('[GC] Removing directory:', dir)
        await fsPromises.rm(dir, { recursive: true, force: true })
      }
    })
  )
}

/**
 * Initiates the garbage collection process for machine learning models and their environments.
 *
 * This asynchronous function identifies and removes stale machine learning models
 * and their associated Python environments from the local filesystem. It logs the
 * progress of the garbage collection, including the number of models and environments
 * found for removal, and handles any errors that may occur during the process.
 *
 * @returns {Promise<void>} A promise that resolves when the garbage collection process
 * is completed successfully, or rejects if an error occurs.
 *
 * @throws {Error} Throws an error if there is an issue during the garbage collection
 * process, including failures to remove directories or access the filesystem.
 *
 * @example
 * garbageCollect()
 *   .then(() => {
 *     console.log('Garbage collection completed successfully.');
 *   })
 *   .catch(error => {
 *     console.error('Error during garbage collection:', error.message);
 *   });
 */
export async function garbageCollect() {
  log.info('[GC] Starting garbage collection of Models and Environments')
  try {
    await garbageCollectMLModels()
    await garbageCollectMLModelEnvironments()
    log.info('[GC] completed successfully ✅')
  } catch (error) {
    log.error('[GC] Error during garbage collection:', error.message)
    throw new Error(`Garbage collection failed: ${error.message}`)
  }
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
    
    log.info('[CLEAR ALL] Starting clear all operation')
    log.info('[CLEAR ALL] Model directory path:', localMLModelRootDir)
    log.info('[CLEAR ALL] Environment directory path:', localMLModelEnvironmentRootDir)
    
    // Check if directories exist before attempting to remove
    const modelDirExists = existsSync(localMLModelRootDir)
    const envDirExists = existsSync(localMLModelEnvironmentRootDir)
    
    log.info('[CLEAR ALL] Model directory exists:', modelDirExists)
    log.info('[CLEAR ALL] Environment directory exists:', envDirExists)
    
    if (modelDirExists) {
      log.info('[CLEAR ALL] Attempting to remove model directory:', localMLModelRootDir)
      await fsPromises.rm(localMLModelRootDir, { recursive: true, force: true })
      log.info('[CLEAR ALL] Model directory removal completed')
      
      // Verify removal
      const modelDirStillExists = existsSync(localMLModelRootDir)
      log.info('[CLEAR ALL] Model directory still exists after removal:', modelDirStillExists)
    } else {
      log.info('[CLEAR ALL] Model directory does not exist, skipping removal')
    }
    
    if (envDirExists) {
      log.info('[CLEAR ALL] Attempting to remove environment directory:', localMLModelEnvironmentRootDir)
      await fsPromises.rm(localMLModelEnvironmentRootDir, { recursive: true, force: true })
      log.info('[CLEAR ALL] Environment directory removal completed')
      
      // Verify removal
      const envDirStillExists = existsSync(localMLModelEnvironmentRootDir)
      log.info('[CLEAR ALL] Environment directory still exists after removal:', envDirStillExists)
    } else {
      log.info('[CLEAR ALL] Environment directory does not exist, skipping removal')
    }
    
    log.info('[CLEAR ALL] Clear all operation completed successfully')
    return {
      success: true,
      message: 'All Local ML models and environments cleared'
    }
  } catch (error) {
    log.error('[CLEAR ALL] Error during clear all operation:', error)
    log.error('[CLEAR ALL] Error stack:', error.stack)
    return { 
      success: false, 
      message: `Failed to clear all local ML models: ${error.message}` 
    }
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

  const onProgressDownload = ({ percent, isRetry, attemptNumber }) => {
    const progress = (percent * installationStateProgress[InstallationState.Download]) / 100
    if (progress > previousDownloadProgress + flushProgressDownloadIncrementThreshold) {
      // Add retry information to the manifest when retrying
      const retryInfo = isRetry ? { isRetry, attemptNumber } : {}
      
      writeToManifest({
        manifestFilepath,
        id,
        version,
        state: InstallationState.Download,
        progress: progress,
        opts: { ...manifestOpts, ...retryInfo }
      })
      previousDownloadProgress = progress
      
      // Log retry progress
      if (isRetry) {
        log.info(`[RETRY ${attemptNumber}] Python environment download progress: ${progress.toFixed(1)}%`)
      }
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
      log.info(`[DOWNLOAD] Starting Python environment download from ${downloadURL}`)
      log.info(`[DOWNLOAD] Download will use retry logic with up to ${5} attempts`)
      
      writeToManifest({
        manifestFilepath,
        id,
        version,
        progress: 0,
        state: InstallationState.Download,
        opts: manifestOpts
      })
      
      // Use the robust download function with retry logic
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
  try {
    const manifestFilepathMLModel = getMLModelLocalDownloadManifest()
    const manifestFilepathPythonEnvironment = getMLEnvironmentDownloadManifest()
    
    // Validate input parameters
    if (!modelReference || !modelReference.id || !modelReference.version) {
      log.error('Invalid modelReference provided to getMLModelDownloadStatus')
      return { model: {}, pythonEnvironment: {} }
    }
    
    if (!pythonEnvironmentReference || !pythonEnvironmentReference.id || !pythonEnvironmentReference.version) {
      log.error('Invalid pythonEnvironmentReference provided to getMLModelDownloadStatus')
      return { model: {}, pythonEnvironment: {} }
    }
    
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
  } catch (error) {
    log.error('Error getting ML model download status:', error.message)
    return { model: {}, pythonEnvironment: {} }
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

  // IPC handler to list all installed ML models
  ipcMain.handle('model:list-installed', () => listInstalledMLModels())

  // IPC handler to list all installed ML model environments
  ipcMain.handle('model:list-installed-environments', () => listInstalledMLModelEnvironments())

  // IPC handler to check the ML model download status
  ipcMain.handle('model:get-download-status', (_, modelReference, pythonEnvironmentReference) =>
    getMLModelDownloadStatus({ modelReference, pythonEnvironmentReference })
  )

  // IPC handler to delete the ml model
  ipcMain.handle('model:delete', (_, id, version) => deleteLocalMLModel({ id, version }))

  ipcMain.handle('model:clear-all', async (_) => {
    log.info('[CLEAR ALL] IPC: Received clear all request')
    const result = await clearAllLocalMLModels()
    log.info('[CLEAR ALL] IPC: Clear all operation result:', result)
    return result
  })

  ipcMain.handle('model:download', async (_, id, version) => {
    return await downloadMLModel({ id, version })
  })
  ipcMain.handle('model:download-python-environment', async (_, id, version) => {
    return await downloadPythonEnvironment({ id, version })
  })
  ipcMain.handle('model:stop-http-server', async (_, pid, port) => {
    return await stopMLModelHTTPServer({ pid, port })
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
 * Waits for the specified server to become healthy by polling its health endpoint.
 *
 * This function spawns a Python process for the server and continuously checks
 * its health status by making GET requests to the provided health endpoint.
 * If the server becomes healthy within the maximum number of retries,
 * the function resolves with the spawned process.
 * If the server fails to start within the expected time,
 * it terminates the process and throws an error.
 *
 * @async
 * @param {Object} options - The configuration options for health checking.
 * @param {string} options.pythonInterpreter - The path to the Python interpreter.
 * @param {string} options.scriptPath - The path to the server script to be executed.
 * @param {Array<string>} options.scriptArgs - The arguments to be passed to the server script.
 * @param {string} options.healthEndpoint - The URL of the health check endpoint.
 * @param {number} options.retryInterval - The interval between health check attempts in milliseconds.
 * @param {number} options.maxRetries - The maximum number of retries for health checking.
 *
 * @returns {Promise<ChildProcess>} A promise that resolves to the spawned Python process if the server starts successfully.
 *
 * @throws {Error} Throws an error if the server fails to start within the expected time.
 */
async function startAndWaitTillServerHealty({
  pythonInterpreter,
  scriptPath,
  scriptArgs,
  healthEndpoint,
  retryInterval = 1000,
  maxRetries = 30
}) {
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
  for (let i = 0; i < maxRetries; i++) {
    try {
      const healthCheck = await fetch(healthEndpoint, {
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
  return await startAndWaitTillServerHealty({
    pythonInterpreter,
    scriptPath,
    scriptArgs,
    healthEndpoint: `http://localhost:${port}/health`
  })
}

/**
 * Starts the DeepFaune HTTP server using a specified Python environment and configuration.
 *
 * This function initializes a Python process that runs the DeepFaune server script.
 * It sets up the server with the provided parameters and checks its health status
 * by polling the server endpoint until it is ready or the maximum number of retries is reached.
 *
 * @async
 * @param {Object} options - The configuration options for starting the server.
 * @param {number} options.port - The port on which the server will listen.
 * @param {string} options.classifierWeightsFilepath - The file path to the classifier weights to be used by the server.
 * @param {string} options.detectorWeightsFilepath - The file path to the detector weights to be used by the server.
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
 * const server = await startDeepFauneHTTPServer({
 *   port: 8080,
 *   classifierWeightsFilepath: '/path/to/classifier/weights',
 *   detectorWeightsFilepath: '/path/to/detector/weights',
 *   timeout: 5000,
 *   pythonEnvironment: {
 *     reference: {
 *       id: 'my-python-env'
 *     }
 *   }
 * });
 */
async function startDeepFauneHTTPServer({
  port,
  classifierWeightsFilepath,
  detectorWeightsFilepath,
  timeout,
  pythonEnvironment
}) {
  log.info('StartDeepFauneNetHTTPServer success!')
  log.info(pythonEnvironment)
  const localInstalRootDirPythonEnvironment = join(
    getMLModelEnvironmentLocalInstallPath({
      ...pythonEnvironment.reference
    }),
    pythonEnvironment.reference.id
  )
  log.info('Local Python Environment root dir is', localInstalRootDirPythonEnvironment)
  const scriptPath = is.dev
    ? join(__dirname, '../../python-environments/common/run_deepfaune_server.py')
    : join(process.resourcesPath, 'python-environments', 'common', 'run_deepfaune_server.py')
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
    '--filepath-classifier-weights',
    classifierWeightsFilepath,
    '--filepath-detector-weights',
    detectorWeightsFilepath,
    '--timeout',
    timeout
  ]
  log.info('Script args: ', scriptArgs)
  log.info('Formatted script args: ', [scriptPath, ...scriptArgs])
  return await startAndWaitTillServerHealty({
    pythonInterpreter,
    scriptPath,
    scriptArgs,
    healthEndpoint: `http://localhost:${port}/health`
  })
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
async function stopMLModelHTTPServer({ pid, port }) {
  try {
    log.info(`Stopping ML Model HTTP Server running on port ${port} with pid ${pid}`)
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
    case 'deepfaune': {
      const port = is.dev ? 8001 : await findFreePort()
      const localInstallPath = getMLModelLocalInstallPath({ ...modelReference })
      log.info(`Local ML Model install path ${localInstallPath}`)
      const classifierWeightsFilepath = join(
        localInstallPath,
        'deepfaune-vit_large_patch14_dinov2.lvd142m.v3.pt'
      )
      const detectorWeightsFilepath = join(localInstallPath, 'MDV6-yolov10x.pt')
      const pythonProcess = await startDeepFauneHTTPServer({
        port,
        classifierWeightsFilepath: classifierWeightsFilepath,
        detectorWeightsFilepath: detectorWeightsFilepath,
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
  garbageCollect,
  registerMLModelManagementIPCHandlers,
  startMLModelHTTPServer,
  stopMLModelHTTPServer
}
