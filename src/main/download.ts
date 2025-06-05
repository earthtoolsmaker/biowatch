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
  writeFileSync
} from 'fs'
import log from 'electron-log'
import path from 'path'

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
export async function downloadFile(url, destination, onProgress) {
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
    const responseBody = response.body
    if (responseBody) {
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
    }
    return destination
  } catch (error) {
    log.error(`Download failed: ${error.message}`)
    throw error
  }
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
  const manifest = yamlRead(manifestFilepath)
  log.debug('manifest content: ', JSON.stringify(manifest))
  const yamlData = {
    ...manifest,
    [id]: {
      ...manifest[id],
      [version]: { state: state, progress: progress, opts: opts }
    }
  }
  log.debug('New manifest data: ', JSON.stringify(yamlData))
  yamlWrite(yamlData, manifestFilepath)
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
  const manifest = yamlRead(manifestFilepath)
  if (Object.keys(manifest).length === 0) {
    return false
  }
  if (manifest[id] && manifest[id][version]) {
    return manifest[id][version]['state'] === 'success'
  }
  return false
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
  const manifest = yamlRead(manifestFilepath)
  if (Object.keys(manifest).length === 0) {
    log.info('empty manifest file')
    return {}
  }
  return manifest[id][version] || {}
}
