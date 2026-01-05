/**
 * Tesseract.js configuration for Electron
 * Handles paths for both development and production environments
 *
 * NOTE: In Node.js/Electron main process, tesseract.js uses worker_threads natively.
 * Do NOT provide workerPath or corePath - those are for browser environments only.
 * Only langPath needs to be configured for custom language data location.
 */

import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log'

/**
 * Get the langPath for tesseract.js worker initialization
 * In development, uses the local resources/tessdata directory
 * In production, uses the bundled extraResources tessdata directory
 *
 * @returns {string} Absolute filesystem path to tessdata directory
 */
export function getLangPath() {
  let langPath

  if (is.dev) {
    // Development: use local bundled file from project root
    langPath = join(process.cwd(), 'resources', 'tessdata')
  } else {
    // Production: use extraResources path
    langPath = join(process.resourcesPath, 'tessdata')
  }

  // Add trailing slash - tesseract.js concatenates: langPath + langCode + '.traineddata.gz'
  langPath = langPath + '/'

  log.info(`[Tesseract] is.dev=${is.dev}, langPath=${langPath}`)
  return langPath
}

/**
 * Get tesseract.js configuration
 * Only provides langPath - tesseract.js handles worker_threads automatically in Node.js
 *
 * @returns {Object} Object with langPath for tesseract.js createWorker
 */
export function getTesseractConfig() {
  return {
    langPath: getLangPath()
    // Do NOT set workerPath/corePath in Node.js - tesseract.js handles this automatically
  }
}
