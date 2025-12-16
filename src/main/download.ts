/**
 * @fileoverview This module handles the downloading, extraction, and management of artifacts.
 * It provides functions to read and write YAML configuration files, download files from URLs,
 * extract .tar.gz archives, and manage the installation states of artifacts.
 *
 * @module download
 */

import yaml from 'js-yaml'
import { extract } from 'tar'
import { net as electronNet } from 'electron'
import { dirname } from 'path'
import {
  createReadStream,
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  createWriteStream,
  writeFileSync,
  statSync
} from 'fs'
import log from 'electron-log'
import path from 'path'
import unzipper from 'unzipper'

// Retry configuration for downloads
const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffFactor: 2
}

// Network errors that should trigger a retry
const RETRYABLE_ERRORS = [
  'net::ERR_CONNECTION_RESET',
  'net::ERR_NETWORK_CHANGED',
  'net::ERR_INTERNET_DISCONNECTED',
  'net::ERR_CONNECTION_TIMED_OUT',
  'net::ERR_CONNECTION_ABORTED',
  'net::ERR_NETWORK_IO_SUSPENDED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND'
]

export enum InstallationState {
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
export function yamlRead(yamlFile) {
  if (existsSync(yamlFile)) {
    const fileContents = readFileSync(yamlFile, 'utf8')
    return yaml.load(fileContents) || {}
  } else {
    return {} // Return an empty structure if the file doesn't exist
  }
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
export function yamlWrite(data, yamlFile) {
  const yamlStr = yaml.dump(data)
  mkdirSync(dirname(yamlFile), { recursive: true })
  writeFileSync(yamlFile, yamlStr, 'utf8')
}

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
 * @param {boolean} useCache - A flag indicating whether to use cached files if available. Defaults to false.
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
export async function extractTarGz(tarPath, extractPath, onProgress, useCache = false) {
  // Check if extraction directory already exists and contains files
  log.info(`Checking extraction directory at ${extractPath}`, existsSync(extractPath))
  if (useCache && existsSync(extractPath)) {
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
 * Extracts a .zip archive to a specified directory.
 *
 * This function checks if the extraction directory already exists and creates it if it does not.
 * It uses the `unzipper` library to extract the contents of the .zip file to the specified directory.
 *
 * @async
 * @param {string} zipPath - The path to the .zip archive to be extracted.
 * @param {string} extractPath - The path to the directory where the files will be extracted.
 * @returns {Promise<string>} A promise that resolves to the extract path when the extraction is complete.
 * @throws {Error} Throws an error if the extraction process fails.
 *
 * @example
 * extractZip('./path/to/archive.zip', './path/to/extract')
 *   .then(() => {
 *     console.log('Extraction complete');
 *   })
 *   .catch((error) => {
 *     console.error('Extraction failed:', error);
 *   });
 */
export async function extractZip(zipPath, extractPath) {
  log.info(`Extracting ${zipPath} to ${extractPath}`)

  // Create the extraction directory if it doesn't exist
  if (!existsSync(extractPath)) {
    mkdirSync(extractPath, { recursive: true })
  }

  return new Promise((resolve, reject) => {
    createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: extractPath }))
      .on('finish', () => {}) //finish can be emitted before extraction is complete
      .on('close', () => {
        log.info(`Extraction complete to ${extractPath}`)
        resolve(extractPath)
      })
      .on('error', (err) => {
        log.error(`Error during extraction:`, err)
        reject(err)
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
/**
 * Checks if an error is retryable based on its message or type.
 *
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error should trigger a retry
 */
function isRetryableError(error) {
  const errorMessage = error.message || error.toString()
  return RETRYABLE_ERRORS.some((retryableError) => errorMessage.includes(retryableError))
}

/**
 * Calculates the delay for the next retry attempt using exponential backoff.
 *
 * @param {number} attemptNumber - The current attempt number (0-based)
 * @returns {number} The delay in milliseconds
 */
function calculateRetryDelay(attemptNumber) {
  const delay = RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffFactor, attemptNumber)
  return Math.min(delay, RETRY_CONFIG.maxDelay)
}

/**
 * Gets the size of a partially downloaded file, or 0 if it doesn't exist.
 *
 * @param {string} filePath - Path to the file
 * @returns {number} File size in bytes
 */
function getPartialFileSize(filePath) {
  try {
    if (existsSync(filePath)) {
      return statSync(filePath).size
    }
  } catch (error) {
    log.warn(`Could not get partial file size for ${filePath}:`, error.message)
  }
  return 0
}

/**
 * Downloads a file with retry logic and resume capability.
 *
 * @param {string} url - The URL to download from
 * @param {string} destination - The local file path to save to
 * @param {function} onProgress - Progress callback function
 * @param {number} attemptNumber - Current attempt number (for internal use)
 * @returns {Promise<string>} The destination path on success
 */
export async function downloadFileWithRetry(url, destination, onProgress, attemptNumber = 0) {
  const isRetry = attemptNumber > 0

  try {
    if (isRetry) {
      log.info(`[RETRY ${attemptNumber}/${RETRY_CONFIG.maxRetries}] Retrying download: ${url}`)
    } else {
      log.info(`Downloading ${url} to ${destination}...`)
    }

    const dir = path.dirname(destination)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // Check for partial download and prepare resume
    // Only resume (append) if this is a retry AND there's a partial file
    const partialSize = getPartialFileSize(destination)
    const isResuming = partialSize > 0 && isRetry
    const headers = {}

    if (isResuming) {
      headers['Range'] = `bytes=${partialSize}-`
      log.info(`[RETRY] Resuming download from byte ${partialSize}`)
    }

    const response = await electronNet.fetch(url, { headers })

    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}: ${response.statusText}`)
    }

    const totalBytes = Number(response.headers.get('Content-Length')) || 0
    const actualTotalBytes = isResuming ? partialSize + totalBytes : totalBytes
    // Only append if actually resuming with Range header, otherwise overwrite
    const writer = createWriteStream(destination, { flags: isResuming ? 'a' : 'w' })

    if (response.body) {
      const reader = response.body.getReader()
      let downloadedBytes = isResuming ? partialSize : 0

      const readStream = async () => {
        const { done, value } = await reader.read()

        if (done) {
          log.info(`Download complete: ${destination}`)
          writer.end()
          return destination
        }

        writer.write(value)
        downloadedBytes += value.length

        const progress = actualTotalBytes > 0 ? (downloadedBytes / actualTotalBytes) * 100 : 0
        if (onProgress) {
          onProgress({
            totalBytes: actualTotalBytes,
            downloadedBytes,
            percent: progress,
            isRetry,
            attemptNumber
          })
        }

        return readStream()
      }

      await readStream()
    }

    return destination
  } catch (error) {
    log.error(`Download attempt ${attemptNumber + 1} failed: ${error.message}`)

    // Check if we should retry
    if (attemptNumber < RETRY_CONFIG.maxRetries && isRetryableError(error)) {
      const delay = calculateRetryDelay(attemptNumber)
      log.info(
        `[RETRY] Waiting ${delay}ms before retry ${attemptNumber + 1}/${RETRY_CONFIG.maxRetries}`
      )

      await new Promise((resolve) => setTimeout(resolve, delay))
      return downloadFileWithRetry(url, destination, onProgress, attemptNumber + 1)
    }

    // No more retries or non-retryable error
    if (attemptNumber >= RETRY_CONFIG.maxRetries) {
      log.error(`Download failed after ${RETRY_CONFIG.maxRetries} retries: ${error.message}`)
    } else {
      log.error(`Download failed with non-retryable error: ${error.message}`)
    }

    throw error
  }
}

export async function downloadFile(url, destination, onProgress) {
  // Use the robust retry version by default
  return downloadFileWithRetry(url, destination, onProgress)
}

/**
 * Writes the specified information to the manifest file.
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
export function writeToManifest({ manifestFilepath, progress, id, version, state, opts }) {
  try {
    const manifest = yamlRead(manifestFilepath) || {}
    log.debug('manifest content: ', JSON.stringify(manifest))

    // Ensure manifest[id] exists before accessing its properties
    const existingEntry = manifest[id] || {}

    const yamlData = {
      ...manifest,
      [id]: {
        ...existingEntry,
        [version]: { state: state, progress: progress, opts: opts }
      }
    }
    log.debug('New manifest data: ', JSON.stringify(yamlData))
    yamlWrite(yamlData, manifestFilepath)
  } catch (error) {
    log.error(`Error writing to manifest for ${id} v${version}:`, error.message)
    throw error // Re-throw to maintain existing error handling behavior
  }
}

export function removeManifestEntry({ manifestFilepath, id, version }) {
  const manifest = yamlRead(manifestFilepath)
  let manifestUpdated = manifest
  log.info('Manifest Update: ', manifestUpdated)
  if (manifestUpdated[id] && manifestUpdated[id][version]) {
    delete manifestUpdated[id][version]
  }
  yamlWrite(manifestUpdated, manifestFilepath)
}

/**
 * Checks if the download of the artifact was successful.
 *
 * This function reads the state of the specified version and id from the
 * manifest file and determines if the artifact's installation state is marked
 * as 'success'.
 *
 * @param {Object} params - The parameters for checking download success.
 * @param {string} params.manifestFilepath - The path to the manifest file.
 * @param {string} params.version - The version of the artifact
 * @param {string} params.id - The unique identifier of the artifact
 * @returns {boolean} True if the artifact was successfully downloaded, otherwise false.
 */
export function isDownloadSuccess({ manifestFilepath, version, id }) {
  try {
    const manifest = yamlRead(manifestFilepath)
    if (!manifest || Object.keys(manifest).length === 0) {
      return false
    }

    // Defensive check: ensure both manifest[id] and manifest[id][version] exist
    if (!manifest[id] || !manifest[id][version]) {
      return false
    }

    return manifest[id][version]['state'] === 'success'
  } catch (error) {
    log.error(`Error checking download success for ${id} v${version}:`, error.message)
    return false
  }
}

/**
 * Retrieves the download status of an artifact from the manifest file.
 *
 * This function reads the specified manifest file and returns the status information
 * for a particular artifact identified by its ID and version. If the artifact is not found
 * in the manifest, it returns an empty object.
 *
 * @param {Object} params - The parameters for retrieving the download status.
 * @param {string} params.manifestFilepath - The path to the manifest file.
 * @param {string} params.version - The version of the model.
 * @param {string} params.id - The unique identifier of the model.
 * @returns {Object} An object containing the download status information for the artifact.
 */
export function getDownloadStatus({ manifestFilepath, version, id }) {
  try {
    const manifest = yamlRead(manifestFilepath)
    if (!manifest || Object.keys(manifest).length === 0) {
      log.info('empty manifest file')
      return {}
    }

    // Defensive check: ensure manifest[id] exists before accessing manifest[id][version]
    if (!manifest[id]) {
      log.debug(`No manifest entry found for id: ${id}`)
      return {}
    }

    // Use optional chaining equivalent for better safety
    return manifest[id][version] || {}
  } catch (error) {
    log.error(`Error reading download status for ${id} v${version}:`, error.message)
    return {}
  }
}
