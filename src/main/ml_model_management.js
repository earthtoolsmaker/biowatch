/**
 * @fileoverview This module provides utility functions for managing the ML models and their weights.
 *
 * This file includes functions for downloading, extracting, deleting model weights.
 *
 * @module ml_model_management
 */

import { app, ipcMain } from 'electron'
import { net as electronNet } from 'electron'
import { join, dirname } from 'path'
import { spawn } from 'child_process'
import { readdirSync, existsSync, mkdirSync, createWriteStream, promises as fsPromises } from 'fs'
import log from 'electron-log'
import path from 'path'
import { pipeline } from 'stream/promises'

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

async function isMLModelDownloaded({ id, version }) {
  localInstallPath = getMLModelLocalInstallPath({ id, version })
  return existsSync(localInstallPath)
}

async function clearAllLocalMLModels() {
  try {
    const localRootDir = getMLModelLocalRootDir()
    console.log('clearing all models from:', localRootDir)
    await fsPromises.rm(localRootDir, { recursive: true, force: true })
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
  console.log('local tar path:', localTarPath)
  if (existsSync(localTarPath)) {
    console.log('delete local tar path:', localTarPath)
    await fsPromises.unlink(localTarPath)
  }
  console.log('foo')
  console.log('local installed model:', localInstallPath)
  if (existsSync(localInstallPath)) {
    console.log('delete local installed model:', localInstallPath)
    fsPromises.rm(localInstallPath, { recursive: true, force: true })
  }
  return {
    success: true,
    message: 'ML model successfully deleted'
  }
}

async function downloadMLModel({ id, version, downloadURL }) {
  try {
    const extractPath = dirname(getMLModelLocalInstallPath({ id, version }))
    const localTarPath = getMLModelLocalTarPath({ id, version })
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
  } catch (error) {
    log.error('Failed to download model:', error)
    return {
      success: false,
      message: `Failed to download model: ${error.message}`
    }
  }
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

  ipcMain.handle('ml-model-management:v0:clear-all-local-ml-models', (_) => clearAllLocalMLModels())

  // Add IPC handler to get server port
  ipcMain.handle(
    'ml-model-management:v0:download-ml-model',
    async (_, id, version, downloadURL, format) => {
      return await downloadMLModel({ id, version, downloadURL, format })
    }
  )
}
