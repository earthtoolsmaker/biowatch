/**
 * Pure functions for determining download state.
 * These are extracted from React components to enable unit testing.
 */

/**
 * Determines if the current model owns the environment download.
 * @param {string|null|undefined} envActiveModelId - The model ID that initiated env download
 * @param {string} currentModelId - This model's ID
 * @returns {boolean}
 */
export function isOwnEnvironmentDownload(envActiveModelId, currentModelId) {
  return envActiveModelId === currentModelId || envActiveModelId === null
}

/**
 * Determines if the download should be considered complete during polling.
 * @param {Object} params
 * @param {string} params.modelState - Model download state
 * @param {string} params.envState - Environment download state
 * @param {boolean} params.isOwnEnvDownload - Whether this model owns the env download
 * @returns {boolean}
 */
export function isDownloadComplete({ modelState, envState, isOwnEnvDownload }) {
  if (modelState !== 'success') return false

  // Environment is done (success or clean)
  if (envState === 'success' || envState === 'clean') return true

  // Environment not done, but we don't own it (another model is downloading)
  if (!isOwnEnvDownload) return true

  return false
}

/**
 * Determines the UI state when component mounts based on manifest status.
 * @param {Object} params
 * @param {Object} params.modelStatus - Model manifest entry
 * @param {Object} params.envStatus - Environment manifest entry
 * @param {string} params.currentModelId - This model's ID
 * @returns {{ isDownloaded: boolean, isDownloading: boolean }}
 */
export function determineInitialDownloadState({ modelStatus, envStatus, currentModelId }) {
  const modelState = modelStatus?.state
  const envState = envStatus?.state
  const envActiveModelId = envStatus?.opts?.activeDownloadModelId
  const hasModelEntry = modelStatus && Object.keys(modelStatus).length > 0
  const hasEnvEntry = envStatus && Object.keys(envStatus).length > 0

  // Case 1: Both complete
  if (modelState === 'success' && envState === 'success') {
    return { isDownloaded: true, isDownloading: false }
  }

  // Case 2: Model is actively downloading
  if (hasModelEntry && (modelState === 'download' || modelState === 'extract')) {
    return { isDownloaded: false, isDownloading: true }
  }

  // Case 3: Model done, env downloading BY THIS MODEL
  if (
    modelState === 'success' &&
    hasEnvEntry &&
    (envState === 'download' || envState === 'extract') &&
    envActiveModelId === currentModelId
  ) {
    return { isDownloaded: false, isDownloading: true }
  }

  // Case 4: Model done, env downloading by ANOTHER model
  if (
    modelState === 'success' &&
    hasEnvEntry &&
    (envState === 'download' || envState === 'extract') &&
    envActiveModelId !== currentModelId
  ) {
    return { isDownloaded: false, isDownloading: false }
  }

  // Case 5: No entries at all
  if (!hasModelEntry || !hasEnvEntry) {
    return { isDownloaded: false, isDownloading: false }
  }

  // Case 6: Fallback
  return { isDownloaded: false, isDownloading: false }
}

/**
 * Calculates progress info for UI display.
 * @param {Object} params
 * @param {Object} params.modelStatus - Model manifest entry
 * @param {Object} params.envStatus - Environment manifest entry
 * @param {string} params.currentModelId - This model's ID
 * @returns {{ downloadMessage: string, downloadProgress: number }}
 */
export function calculateProgressInfo({ modelStatus, envStatus, currentModelId }) {
  const envActiveModelId = envStatus?.opts?.activeDownloadModelId
  const isOwnEnvDownload = isOwnEnvironmentDownload(envActiveModelId, currentModelId)

  const isPythonEnvironmentDownloading =
    modelStatus?.state === 'success' && envStatus?.state !== 'success' && isOwnEnvDownload

  const progress = isPythonEnvironmentDownloading
    ? envStatus?.progress || 0
    : modelStatus?.progress || 0

  const state = isPythonEnvironmentDownloading ? envStatus?.state : modelStatus?.state
  const suffix = isPythonEnvironmentDownloading ? 'the Python Environment' : 'the AI Model'

  let message
  switch (state) {
    case 'success':
      message = `Successfully installed ${suffix}`
      break
    case 'failure':
      message = `Failed installing ${suffix}`
      break
    case 'download':
      message = `Downloading ${suffix}`
      break
    case 'extract':
      message = `Extracting ${suffix}`
      break
    case 'clean':
      message = `Cleaning up ${suffix}`
      break
    default:
      message = `Downloading ${suffix}`
  }

  return { downloadMessage: message, downloadProgress: progress }
}
