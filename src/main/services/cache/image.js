/**
 * Remote image caching module for storing remote images locally.
 *
 * Caches images from remote URLs (GBIF, Agouti, etc.) to disk for offline access
 * and improved performance. Follows the same patterns as transcoder.js.
 */

import { createHash } from 'crypto'
import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync, mkdirSync, statSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join, basename, extname } from 'path'

import { downloadFileWithRetry } from '../download.ts'
import { cleanExpiredImageCacheImpl } from './cleanup.js'

// Track in-progress downloads to prevent duplicates
const inProgressDownloads = new Map()

// Image extensions we cache
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])

/**
 * Get the cache directory for a specific study.
 * @param {string} studyId - The study ID
 * @returns {string} Path to the study's cache directory
 */
function getStudyCacheDir(studyId) {
  return join(app.getPath('userData'), 'biowatch-data', 'studies', studyId, 'cache')
}

/**
 * Get the image cache directory for a specific study.
 * @param {string} studyId - The study ID
 * @returns {string} Path to the study's image cache directory
 */
export function getImageCacheDir(studyId) {
  return join(getStudyCacheDir(studyId), 'images')
}

/**
 * Ensure the image cache directory exists for a study.
 * @param {string} studyId - The study ID
 */
function ensureImageCacheDir(studyId) {
  const imageCacheDir = getImageCacheDir(studyId)
  if (!existsSync(imageCacheDir)) {
    mkdirSync(imageCacheDir, { recursive: true })
    log.info(`[ImageCache] Created image cache directory: ${imageCacheDir}`)
  }
}

/**
 * Generate a unique cache key from a URL.
 * @param {string} url - The remote URL
 * @returns {string} SHA256 hash (first 16 chars) to use as cache key
 */
export function getCacheKeyFromUrl(url) {
  return createHash('sha256').update(url).digest('hex').substring(0, 16)
}

/**
 * Extract filename and extension from a URL.
 * @param {string} url - The remote URL
 * @returns {{ filename: string, ext: string }} Filename and extension
 */
function getFilenameFromUrl(url) {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    const fullFilename = basename(pathname)
    const ext = extname(fullFilename).toLowerCase()
    const filename = basename(fullFilename, ext)
    return { filename: filename || 'image', ext: ext || '.jpg' }
  } catch {
    return { filename: 'image', ext: '.jpg' }
  }
}

/**
 * Get the cache path for an image.
 * @param {string} studyId - The study ID
 * @param {string} url - The remote URL
 * @returns {string} Path to the cached file
 */
export function getCachedImagePath(studyId, url) {
  const cacheKey = getCacheKeyFromUrl(url)
  const { filename, ext } = getFilenameFromUrl(url)
  return join(getImageCacheDir(studyId), `${cacheKey}_${filename}${ext}`)
}

/**
 * Check if a cached image exists.
 * @param {string} studyId - The study ID
 * @param {string} url - The remote URL
 * @returns {string|null} Path to cached file if exists, null otherwise
 */
export function getCachedImage(studyId, url) {
  const cachedPath = getCachedImagePath(studyId, url)
  return existsSync(cachedPath) ? cachedPath : null
}

/**
 * Check if a download is already in progress for a URL.
 * @param {string} url - The remote URL
 * @returns {boolean} True if download is in progress
 */
export function isDownloadInProgress(url) {
  return inProgressDownloads.has(url)
}

/**
 * Download and cache an image from a remote URL.
 * @param {string} studyId - The study ID
 * @param {string} url - The remote URL
 * @returns {Promise<string>} Path to the cached file
 */
export async function downloadAndCacheImage(studyId, url) {
  // Check if already in progress
  if (inProgressDownloads.has(url)) {
    log.info(`[ImageCache] Download already in progress for: ${url}`)
    return inProgressDownloads.get(url)
  }

  ensureImageCacheDir(studyId)
  const destPath = getCachedImagePath(studyId, url)

  // Check if already cached
  if (existsSync(destPath)) {
    log.info(`[ImageCache] Using cached image: ${destPath}`)
    return destPath
  }

  log.info(`[ImageCache] Downloading image: ${url} -> ${destPath}`)

  // Create a promise for the download and track it
  // Using empty callback since we don't need progress updates for background image caching
  const downloadPromise = downloadFileWithRetry(url, destPath, () => {})
    .then(() => {
      log.info(`[ImageCache] Image cached: ${destPath}`)
      return destPath
    })
    .catch((error) => {
      log.error(`[ImageCache] Failed to cache image: ${error.message}`)
      throw error
    })
    .finally(() => {
      inProgressDownloads.delete(url)
    })

  inProgressDownloads.set(url, downloadPromise)
  return downloadPromise
}

/**
 * Save image buffer directly to cache.
 * Used by protocol handler to cache fetched images.
 * @param {string} studyId - The study ID
 * @param {string} url - The remote URL (used for cache key)
 * @param {Buffer} buffer - The image data
 * @returns {Promise<string>} Path to the cached file
 */
export async function saveImageToCache(studyId, url, buffer) {
  ensureImageCacheDir(studyId)
  const destPath = getCachedImagePath(studyId, url)
  writeFileSync(destPath, buffer)
  log.info(`[ImageCache] Saved to cache: ${destPath}`)
  return destPath
}

/**
 * Get MIME type from file extension.
 * @param {string} filePath - Path to the file
 * @returns {string} MIME type
 */
export function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase()
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

/**
 * Get cache statistics for a study.
 * @param {string} studyId - The study ID
 * @returns {{ size: number, count: number }} Cache size in bytes and file count
 */
export function getImageCacheStats(studyId) {
  const imageCacheDir = getImageCacheDir(studyId)

  let totalSize = 0
  let count = 0

  try {
    if (existsSync(imageCacheDir)) {
      const files = readdirSync(imageCacheDir)
      for (const file of files) {
        const ext = extname(file).toLowerCase()
        if (IMAGE_EXTENSIONS.has(ext)) {
          const filePath = join(imageCacheDir, file)
          const stats = statSync(filePath)
          totalSize += stats.size
          count++
        }
      }
    }
  } catch (e) {
    log.error(`[ImageCache] Error getting cache stats: ${e.message}`)
  }

  return { size: totalSize, count }
}

/**
 * Clear the image cache for a study.
 * @param {string} studyId - The study ID
 * @returns {{ cleared: number, freedBytes: number }} Number of files cleared and bytes freed
 */
export function clearImageCache(studyId) {
  const imageCacheDir = getImageCacheDir(studyId)
  const stats = getImageCacheStats(studyId)

  try {
    if (existsSync(imageCacheDir)) {
      rmSync(imageCacheDir, { recursive: true, force: true })
      mkdirSync(imageCacheDir, { recursive: true })
    }
  } catch (e) {
    log.error(`[ImageCache] Error clearing cache: ${e.message}`)
  }

  return { cleared: stats.count, freedBytes: stats.size }
}

/**
 * Clean expired image cache files across all studies.
 * Runs asynchronously in background without blocking app startup.
 * Deletes image files older than 30 days.
 */
export async function cleanExpiredImageCache() {
  const studiesPath = join(app.getPath('userData'), 'biowatch-data', 'studies')
  return cleanExpiredImageCacheImpl(studiesPath, undefined, { log })
}

/**
 * Register IPC handlers for image cache operations.
 */
export function registerImageCacheIPCHandlers() {
  // Check if a cached version exists
  ipcMain.handle('image-cache:get-cached', (event, studyId, url) => {
    return getCachedImage(studyId, url)
  })

  // Manually trigger caching of an image
  ipcMain.handle('image-cache:download', async (event, studyId, url) => {
    try {
      const cachedPath = await downloadAndCacheImage(studyId, url)
      return { success: true, path: cachedPath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // Get cache statistics for a study
  ipcMain.handle('image-cache:stats', (event, studyId) => {
    return getImageCacheStats(studyId)
  })

  // Clear the cache for a study
  ipcMain.handle('image-cache:clear', (event, studyId) => {
    return clearImageCache(studyId)
  })

  log.info('[ImageCache] IPC handlers registered')
}
