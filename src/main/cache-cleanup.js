/**
 * Cache cleanup utilities.
 * Separated from transcoder.js to allow testing without Electron dependencies.
 */

import { readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'

// Cache expiration in milliseconds (30 days)
export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Helper to yield to event loop between operations.
 * Prevents blocking the main thread during cache cleanup.
 */
function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Clean expired transcode cache files across all studies.
 * Deletes .mp4 files older than maxAgeMs.
 *
 * @param {string} studiesPath - Path to the studies directory
 * @param {number} [maxAgeMs=CACHE_MAX_AGE_MS] - Maximum age in milliseconds (default: 30 days)
 * @param {object} [options] - Options
 * @param {object} [options.log] - Logger object with info/error methods (optional)
 * @returns {Promise<{deletedCount: number, freedBytes: number}>} Cleanup results
 */
export async function cleanExpiredTranscodeCacheImpl(
  studiesPath,
  maxAgeMs = CACHE_MAX_AGE_MS,
  options = {}
) {
  const { log } = options
  const now = Date.now()
  let deletedCount = 0
  let freedBytes = 0

  try {
    // Check if studies directory exists
    try {
      await stat(studiesPath)
    } catch {
      return { deletedCount, freedBytes } // No studies directory yet
    }

    // Get all study directories
    const entries = await readdir(studiesPath, { withFileTypes: true })
    const studyDirs = entries.filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name)

    for (const studyId of studyDirs) {
      // Build transcode cache path relative to studiesPath
      const transcodeCacheDir = join(studiesPath, studyId, 'cache', 'transcodes')

      // Check if cache dir exists
      try {
        await stat(transcodeCacheDir)
      } catch {
        continue // No cache for this study
      }

      const files = await readdir(transcodeCacheDir)

      for (const file of files) {
        if (!file.endsWith('.mp4')) continue

        const filePath = join(transcodeCacheDir, file)

        try {
          const fileStat = await stat(filePath)
          const age = now - fileStat.mtime.getTime()

          if (age > maxAgeMs) {
            freedBytes += fileStat.size
            await unlink(filePath)
            deletedCount++

            // Yield to event loop after each deletion to avoid blocking
            await yieldToEventLoop()
          }
        } catch {
          // File may have been deleted or inaccessible, skip
        }
      }

      // Small yield between studies to spread I/O load
      await yieldToEventLoop()
    }

    if (deletedCount > 0 && log) {
      log.info(
        `[Transcoder] Cache cleanup: deleted ${deletedCount} expired files, freed ${(freedBytes / 1024 / 1024).toFixed(2)} MB`
      )
    }
  } catch (e) {
    if (log) {
      log.error(`[Transcoder] Error during cache cleanup: ${e.message}`)
    }
  }

  return { deletedCount, freedBytes }
}
