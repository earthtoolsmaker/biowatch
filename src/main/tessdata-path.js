/**
 * Utility to get the correct path to Tesseract traineddata files
 * Handles both development and production environments
 */

import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log'

/**
 * Get the langPath for tesseract.js worker initialization
 * In development, uses the local resources/tessdata directory
 * In production, uses the bundled extraResources tessdata directory
 *
 * @returns {string} File URL to tessdata directory (e.g., file:///path/to/tessdata)
 */
export function getTessdataLangPath() {
  let tessdataDir
  let langPath

  if (is.dev) {
    // Development: use local bundled file from project root
    tessdataDir = join(process.cwd(), 'resources', 'tessdata')
  } else {
    // Production: use extraResources path
    tessdataDir = join(process.resourcesPath, 'tessdata')
  }

  langPath = pathToFileURL(tessdataDir).href

  log.info(`[Tessdata] is.dev=${is.dev}, tessdataDir=${tessdataDir}, langPath=${langPath}`)

  return langPath
}
