/**
 * Utility to get the correct path to Tesseract traineddata files
 * Handles both development and production environments
 */

import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'

/**
 * Get the langPath for tesseract.js worker initialization
 * In development, uses the local resources/tessdata directory
 * In production, uses the bundled extraResources tessdata directory
 *
 * @returns {string} File URL to tessdata directory (e.g., file:///path/to/tessdata)
 */
export function getTessdataLangPath() {
  if (is.dev) {
    // Development: use local bundled file from project root
    const localPath = join(process.cwd(), 'resources', 'tessdata')
    return pathToFileURL(localPath).href
  }

  // Production: use extraResources path
  const tessdataDir = join(process.resourcesPath, 'tessdata')
  return pathToFileURL(tessdataDir).href
}
