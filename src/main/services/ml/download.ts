/**
 * @fileoverview Download and installation management for ML models and Python environments.
 *
 * @module ml/download
 */

import { existsSync, promises as fsPromises } from 'fs'
import { dirname, basename } from 'path'
import log from 'electron-log'

import {
  findModel,
  findPythonEnvironment,
  platformToKey,
  modelZoo,
  pythonEnvironments
} from '../../../shared/mlmodels'
import {
  extractTarGz,
  InstallationState,
  downloadFile,
  writeToManifest,
  removeManifestEntry,
  getDownloadStatus,
  isDownloadSuccess
} from '../download.js'
import {
  listDirectories,
  getMLModelLocalRootDir,
  getMLModelLocalTarPathRoot,
  getMLModelLocalTarPath,
  getMLModelLocalInstallPath,
  getMLModelLocalDownloadManifest,
  getMLModelEnvironmentRootDir,
  getMLEnvironmentDownloadManifest,
  getMLModelEnvironmentLocalInstallPath,
  getMLModelEnvironmentLocalTarPathRoot,
  getMLModelEnvironmentLocalTarPath,
  parseReferenceFromPath
} from './paths.js'

// ============================================================================
// Model & Environment Listing
// ============================================================================

/**
 * Lists all installed machine learning models in the local model zoo directory.
 *
 * @returns {Promise<Array<{id: string, version: string}>>} Array of installed model references.
 */
export async function listInstalledMLModels(): Promise<Array<{ id: string; version: string }>> {
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
  const references = folderPaths
    .flat()
    .map((folderPath: string) => parseReferenceFromPath(folderPath))
  return references
}

/**
 * Lists all installed machine learning model environments in the local environment directory.
 *
 * @returns {Promise<Array<{id: string, version: string}>>} Array of installed environment references.
 */
export async function listInstalledMLModelEnvironments(): Promise<
  Array<{ id: string; version: string }>
> {
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
  const references = folderPaths
    .flat()
    .map((folderPath: string) => parseReferenceFromPath(folderPath))
  return references
}

// ============================================================================
// Stale Detection
// ============================================================================

/**
 * Retrieves a list of stale installed machine learning models.
 *
 * @returns {Promise<Array<{id: string, version: string}>>} Array of stale model references.
 */
export async function listStaleInstalledModels(): Promise<Array<{ id: string; version: string }>> {
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
 * Lists all stale installed machine learning model environments.
 *
 * @returns {Promise<Array<{id: string, version: string}>>} Array of stale environment references.
 */
export async function listStaleInstalledMLModelEnvironments(): Promise<
  Array<{ id: string; version: string }>
> {
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

// ============================================================================
// Garbage Collection
// ============================================================================

/**
 * Garbage collects stale machine learning models from the local model zoo directory.
 *
 * @returns {Promise<void>} Resolves when garbage collection is complete.
 */
async function garbageCollectMLModels(): Promise<void> {
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
 * Garbage collects stale machine learning model environments.
 *
 * @returns {Promise<void>} Resolves when garbage collection is complete.
 */
async function garbageCollectMLModelEnvironments(): Promise<void> {
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
 * @returns {Promise<void>} Resolves when garbage collection is complete.
 * @throws {Error} Throws an error if garbage collection fails.
 */
export async function garbageCollect(): Promise<void> {
  log.info('[GC] Starting garbage collection of Models and Environments')
  try {
    await garbageCollectMLModels()
    await garbageCollectMLModelEnvironments()
    log.info('[GC] completed successfully ✅')
  } catch (error) {
    log.error('[GC] Error during garbage collection:', (error as Error).message)
    throw new Error(`Garbage collection failed: ${(error as Error).message}`)
  }
}

// ============================================================================
// Download Status
// ============================================================================

/**
 * Checks if a machine learning model is downloaded.
 *
 * @param {Object} params - The model reference.
 * @param {string} params.id - The model ID.
 * @param {string} params.version - The model version.
 * @returns {boolean} True if the model is downloaded.
 */
export function isMLModelDownloaded({ id, version }: { id: string; version: string }): boolean {
  const localInstallPath = getMLModelLocalInstallPath({ id, version })
  return existsSync(localInstallPath)
}

/**
 * Checks if a state indicates an active download.
 * @param {string | undefined} state - The download state.
 * @returns {boolean} True if the state indicates an active download.
 */
function isActiveDownloadState(state: string | undefined): boolean {
  return state === 'download' || state === 'extract' || state === 'clean'
}

interface DownloadStatusResult {
  model: Record<string, unknown>
  pythonEnvironment: Record<string, unknown>
}

/**
 * Retrieves the download status of a machine learning model and its associated Python environment.
 *
 * @param {Object} params - The parameters.
 * @param {Object} params.modelReference - The model reference.
 * @param {Object} params.pythonEnvironmentReference - The environment reference.
 * @returns {DownloadStatusResult} The download status of both model and environment.
 */
export function getMLModelDownloadStatus({
  modelReference,
  pythonEnvironmentReference
}: {
  modelReference: { id: string; version: string }
  pythonEnvironmentReference: { id: string; version: string }
}): DownloadStatusResult {
  try {
    const manifestFilepathMLModel = getMLModelLocalDownloadManifest()
    const manifestFilepathPythonEnvironment = getMLEnvironmentDownloadManifest()

    // Validate input parameters
    if (!modelReference || !modelReference.id || !modelReference.version) {
      log.error('Invalid modelReference provided to getMLModelDownloadStatus')
      return { model: {}, pythonEnvironment: {} }
    }

    if (
      !pythonEnvironmentReference ||
      !pythonEnvironmentReference.id ||
      !pythonEnvironmentReference.version
    ) {
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
    log.error('Error getting ML model download status:', (error as Error).message)
    return { model: {}, pythonEnvironment: {} }
  }
}

interface GlobalDownloadStatus {
  isDownloading: boolean
  modelId: string | null
}

/**
 * Gets the global model download status to determine if any model is currently downloading.
 * @returns {GlobalDownloadStatus} An object with isDownloading boolean and modelId string.
 */
export function getGlobalModelDownloadStatus(): GlobalDownloadStatus {
  try {
    const modelManifestPath = getMLModelLocalDownloadManifest()
    const envManifestPath = getMLEnvironmentDownloadManifest()

    // Check all models in modelZoo for active downloads
    for (const model of modelZoo) {
      const status = getDownloadStatus({
        manifestFilepath: modelManifestPath,
        id: model.reference.id,
        version: model.reference.version
      })
      if (isActiveDownloadState(status?.state)) {
        return { isDownloading: true, modelId: model.reference.id }
      }
    }

    // Check environment downloads
    for (const env of pythonEnvironments) {
      const status = getDownloadStatus({
        manifestFilepath: envManifestPath,
        id: env.reference.id,
        version: env.reference.version
      })
      if (isActiveDownloadState(status?.state)) {
        return { isDownloading: true, modelId: status?.opts?.activeDownloadModelId || null }
      }
    }

    return { isDownloading: false, modelId: null }
  } catch (error) {
    log.error('Error getting global model download status:', (error as Error).message)
    return { isDownloading: false, modelId: null }
  }
}

// ============================================================================
// Model Management (Delete, Clear)
// ============================================================================

interface OperationResult {
  success: boolean
  message: string
}

/**
 * Clears all locally stored machine learning models and their associated Python environments.
 *
 * @returns {Promise<OperationResult>} The result of the operation.
 */
export async function clearAllLocalMLModels(): Promise<OperationResult> {
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
      log.info(
        '[CLEAR ALL] Attempting to remove environment directory:',
        localMLModelEnvironmentRootDir
      )
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
    log.error('[CLEAR ALL] Error stack:', (error as Error).stack)
    return {
      success: false,
      message: `Failed to clear all local ML models: ${(error as Error).message}`
    }
  }
}

/**
 * Deletes a locally stored machine learning model and its associated files.
 *
 * @param {Object} params - The model reference.
 * @param {string} params.id - The model ID.
 * @param {string} params.version - The model version.
 * @returns {Promise<OperationResult>} The result of the operation.
 */
export async function deleteLocalMLModel({
  id,
  version
}: {
  id: string
  version: string
}): Promise<OperationResult> {
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
    await fsPromises.rm(localInstallPath, { recursive: true, force: true })
  }
  return {
    success: true,
    message: 'ML model successfully deleted'
  }
}

// ============================================================================
// Download Functions
// ============================================================================

/**
 * Downloads a Python environment for a specified machine learning model.
 *
 * @param {Object} params - The parameters.
 * @param {string} params.id - The environment ID.
 * @param {string} params.version - The environment version.
 * @param {string} [params.requestingModelId] - The model requesting this environment.
 * @returns {Promise<OperationResult>} The result of the operation.
 */
export async function downloadPythonEnvironment({
  id,
  version,
  requestingModelId = null
}: {
  id: string
  version: string
  requestingModelId?: string | null
}): Promise<OperationResult> {
  const installationStateProgress = {
    [InstallationState.Failure]: 0,
    [InstallationState.Download]: 70,
    [InstallationState.Extract]: 98,
    [InstallationState.Clean]: 100,
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
  const manifestOpts = {
    archivePath: localTarPath,
    installPath: extractPath,
    activeDownloadModelId: requestingModelId
  }

  let previousDownloadProgress = 0
  const flushProgressDownloadIncrementThreshold = 1

  const onProgressDownload = ({
    percent,
    isRetry,
    attemptNumber
  }: {
    percent: number
    isRetry?: boolean
    attemptNumber?: number
  }) => {
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
        log.info(
          `[RETRY ${attemptNumber}] Python environment download progress: ${progress.toFixed(1)}%`
        )
      }
    }
  }

  const flushProgressExtractIncrementThreshold = 1.0
  let previousExtractProgress = 0

  const onProgressExtract = ({ extracted }: { extracted: number }) => {
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
      // Clear activeDownloadModelId on success
      writeToManifest({
        manifestFilepath,
        id,
        version,
        state: InstallationState.Success,
        opts: { ...manifestOpts, activeDownloadModelId: null },
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
    // Clear activeDownloadModelId on failure
    writeToManifest({
      manifestFilepath,
      id,
      version,
      state: InstallationState.Failure,
      opts: { ...manifestOpts, activeDownloadModelId: null },
      progress: installationStateProgress[InstallationState.Failure]
    })
    return {
      success: false,
      message: `Failed to download the Python Environment: ${(error as Error).message}`
    }
  }
}

/**
 * Downloads a machine learning model from a specified URL and manages its installation.
 *
 * @param {Object} params - The model reference.
 * @param {string} params.id - The model ID.
 * @param {string} params.version - The model version.
 * @returns {Promise<OperationResult>} The result of the operation.
 */
export async function downloadMLModel({
  id,
  version
}: {
  id: string
  version: string
}): Promise<OperationResult> {
  const { downloadURL, files } = findModel({ id, version })
  log.info('downloadMLModel: Download URL is ', downloadURL)
  const localInstallPath = getMLModelLocalInstallPath({ id, version })
  const extractPath = dirname(localInstallPath)
  const localTarPath = getMLModelLocalTarPath({ id, version })
  const manifestFilepath = getMLModelLocalDownloadManifest()

  const installationStateProgress = {
    [InstallationState.Failure]: 0,
    [InstallationState.Download]: 92,
    [InstallationState.Extract]: 98,
    [InstallationState.Clean]: 100,
    [InstallationState.Success]: 100
  }

  const manifestOpts = { archivePath: localTarPath, installPath: localInstallPath }

  let previousProgress = 0
  const flushProgressIncrementThreshold = 1

  const onProgressDownload = ({ percent }: { percent: number }) => {
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

  const onProgressExtract = ({ extracted }: { extracted: number }) => {
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
      message: `Failed to download model: ${(error as Error).message}`
    }
  }
}
