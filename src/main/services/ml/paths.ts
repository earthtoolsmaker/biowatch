/**
 * @fileoverview Path utilities for ML model and environment management.
 *
 * @module ml/paths
 */

import { app } from 'electron'
import { join, dirname, basename } from 'path'
import { existsSync, readdir } from 'fs'
import log from 'electron-log'

// ============================================================================
// Directory Listing Utility
// ============================================================================

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
 */
export async function listDirectories(folderPath: string): Promise<string[]> {
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

// ============================================================================
// ML Model Path Utilities
// ============================================================================

/**
 * Gets the root directory for ML models.
 * @returns {string} The path to the ML model root directory.
 */
export function getMLModelLocalRootDir(): string {
  return join(app.getPath('userData'), 'biowatch-data', 'model-zoo')
}

/**
 * Gets the directory for ML model archives (tar files).
 * @returns {string} The path to the archives directory.
 */
export function getMLModelLocalTarPathRoot(): string {
  return join(getMLModelLocalRootDir(), 'archives')
}

/**
 * Gets the path to a specific ML model tar file.
 * @param {Object} params - The model reference.
 * @param {string} params.id - The model ID.
 * @param {string} params.version - The model version.
 * @returns {string} The path to the tar file.
 */
export function getMLModelLocalTarPath({ id, version }: { id: string; version: string }): string {
  return join(getMLModelLocalTarPathRoot(), id, `${version}.tar.gz`)
}

/**
 * Gets the installation path for a specific ML model.
 * @param {Object} params - The model reference.
 * @param {string} params.id - The model ID.
 * @param {string} params.version - The model version.
 * @returns {string} The installation path.
 */
export function getMLModelLocalInstallPath({
  id,
  version
}: {
  id: string
  version: string
}): string {
  return join(getMLModelLocalRootDir(), id, version)
}

/**
 * Gets the path to the ML model download manifest.
 * @returns {string} The path to the manifest file.
 */
export function getMLModelLocalDownloadManifest(): string {
  return join(getMLModelLocalRootDir(), 'manifest.yaml')
}

// ============================================================================
// Python Environment Path Utilities
// ============================================================================

/**
 * Gets the root directory for Python environments.
 * @returns {string} The path to the Python environment root directory.
 */
export function getMLModelEnvironmentRootDir(): string {
  return join(app.getPath('userData'), 'biowatch-data', 'python-environments', 'conda')
}

/**
 * Gets the path to the Python environment download manifest.
 * @returns {string} The path to the manifest file.
 */
export function getMLEnvironmentDownloadManifest(): string {
  return join(getMLModelEnvironmentRootDir(), 'manifest.yaml')
}

/**
 * Gets the installation path for a specific Python environment.
 * @param {Object} params - The environment reference.
 * @param {string} params.id - The environment ID.
 * @param {string} params.version - The environment version.
 * @returns {string} The installation path.
 */
export function getMLModelEnvironmentLocalInstallPath({
  id,
  version
}: {
  id: string
  version: string
}): string {
  return join(getMLModelEnvironmentRootDir(), `${id}`, `${version}`)
}

/**
 * Gets the directory for Python environment archives.
 * @returns {string} The path to the archives directory.
 */
export function getMLModelEnvironmentLocalTarPathRoot(): string {
  return join(getMLModelEnvironmentRootDir(), 'archives')
}

/**
 * Gets the path to a specific Python environment tar file.
 * @param {Object} params - The environment reference.
 * @param {string} params.id - The environment ID.
 * @param {string} params.version - The environment version.
 * @returns {string} The path to the tar file.
 */
export function getMLModelEnvironmentLocalTarPath({
  id,
  version
}: {
  id: string
  version: string
}): string {
  return join(getMLModelEnvironmentLocalTarPathRoot(), id, version)
}

// ============================================================================
// Path Parsing Utilities
// ============================================================================

/**
 * Extracts model/environment reference from a folder path.
 * @param {string} folderPath - The folder path to parse.
 * @returns {Object} An object with id and version.
 */
export function parseReferenceFromPath(folderPath: string): { id: string; version: string } {
  return {
    version: basename(folderPath),
    id: basename(dirname(folderPath))
  }
}
