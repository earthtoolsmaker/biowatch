/**
 * Video transcoding module for converting unsupported formats to browser-playable MP4.
 *
 * Uses ffmpeg-static to bundle FFmpeg binaries with the app.
 * Transcodes videos on-demand when user clicks to play an unsupported format (AVI, MKV, etc.)
 * Caches transcoded files for instant replay.
 */

import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { app, ipcMain } from 'electron'
import log from 'electron-log'
import { existsSync, mkdirSync, statSync, readdirSync, unlinkSync, rmSync } from 'fs'
import { join, basename, extname } from 'path'
import ffmpegPath from 'ffmpeg-static'

// Browser-compatible video formats (don't need transcoding)
const BROWSER_COMPATIBLE_FORMATS = new Set(['.mp4', '.webm', '.ogg', '.ogv'])

// Formats that need transcoding
const TRANSCODE_FORMATS = new Set(['.avi', '.mkv', '.mov', '.m4v', '.wmv', '.flv', '.3gp'])

/**
 * Get the cache directory for a specific study.
 * @param {string} studyId - The study ID
 * @returns {string} Path to the study's cache directory
 */
function getStudyCacheDir(studyId) {
  return join(app.getPath('userData'), 'biowatch-data', 'studies', studyId, 'cache')
}

/**
 * Get the transcode cache directory for a specific study.
 * @param {string} studyId - The study ID
 * @returns {string} Path to the study's transcode cache directory
 */
function getTranscodeCacheDir(studyId) {
  return join(getStudyCacheDir(studyId), 'transcodes')
}

/**
 * Get the thumbnail cache directory for a specific study.
 * @param {string} studyId - The study ID
 * @returns {string} Path to the study's thumbnail cache directory
 */
function getThumbnailCacheDir(studyId) {
  return join(getStudyCacheDir(studyId), 'thumbnails')
}

// Active transcoding jobs (for progress tracking and cancellation)
const activeJobs = new Map()

/**
 * Check if a video format needs transcoding.
 * @param {string} filePath - Path to the video file
 * @returns {boolean} True if the format needs transcoding
 */
export function needsTranscoding(filePath) {
  const ext = extname(filePath).toLowerCase()
  return TRANSCODE_FORMATS.has(ext)
}

/**
 * Check if a video format is browser-compatible.
 * @param {string} filePath - Path to the video file
 * @returns {boolean} True if the format can be played directly
 */
export function isBrowserCompatible(filePath) {
  const ext = extname(filePath).toLowerCase()
  return BROWSER_COMPATIBLE_FORMATS.has(ext)
}

/**
 * Generate a unique cache key for a video file based on path and mtime.
 * @param {string} filePath - Absolute path to the video file
 * @returns {string} SHA256 hash to use as cache key
 */
function getCacheKey(filePath) {
  const stats = statSync(filePath)
  const data = `${filePath}:${stats.mtime.getTime()}`
  return createHash('sha256').update(data).digest('hex').substring(0, 16)
}

/**
 * Get the cache path for a transcoded video.
 * @param {string} studyId - The study ID
 * @param {string} filePath - Original video file path
 * @returns {string} Path to the cached transcoded file
 */
export function getTranscodedPath(studyId, filePath) {
  const cacheKey = getCacheKey(filePath)
  const originalName = basename(filePath, extname(filePath))
  return join(getTranscodeCacheDir(studyId), `${cacheKey}_${originalName}.mp4`)
}

/**
 * Check if a transcoded version exists in cache.
 * @param {string} studyId - The study ID
 * @param {string} filePath - Original video file path
 * @returns {string|null} Path to cached file if exists, null otherwise
 */
export function getCachedTranscode(studyId, filePath) {
  const transcodedPath = getTranscodedPath(studyId, filePath)
  return existsSync(transcodedPath) ? transcodedPath : null
}

/**
 * Ensure the transcode cache directory exists for a study.
 * @param {string} studyId - The study ID
 */
function ensureCacheDir(studyId) {
  const transcodeCacheDir = getTranscodeCacheDir(studyId)
  if (!existsSync(transcodeCacheDir)) {
    mkdirSync(transcodeCacheDir, { recursive: true })
    log.info(`[Transcoder] Created transcode cache directory: ${transcodeCacheDir}`)
  }
}

/**
 * Ensure the thumbnail cache directory exists for a study.
 * @param {string} studyId - The study ID
 */
function ensureThumbnailCacheDir(studyId) {
  const thumbnailCacheDir = getThumbnailCacheDir(studyId)
  if (!existsSync(thumbnailCacheDir)) {
    mkdirSync(thumbnailCacheDir, { recursive: true })
    log.info(`[Transcoder] Created thumbnail cache directory: ${thumbnailCacheDir}`)
  }
}

/**
 * Get the cache path for a video thumbnail.
 * @param {string} studyId - The study ID
 * @param {string} filePath - Original video file path
 * @returns {string} Path to the cached thumbnail file
 */
export function getThumbnailPath(studyId, filePath) {
  const cacheKey = getCacheKey(filePath)
  const originalName = basename(filePath, extname(filePath))
  return join(getThumbnailCacheDir(studyId), `${cacheKey}_${originalName}.jpg`)
}

/**
 * Check if a cached thumbnail exists for a video.
 * @param {string} studyId - The study ID
 * @param {string} filePath - Original video file path
 * @returns {string|null} Path to cached thumbnail if exists, null otherwise
 */
export function getCachedThumbnail(studyId, filePath) {
  const thumbnailPath = getThumbnailPath(studyId, filePath)
  return existsSync(thumbnailPath) ? thumbnailPath : null
}

/**
 * Extract a thumbnail from a video using FFmpeg.
 * Extracts the first frame (or frame at 1 second for longer videos).
 * @param {string} studyId - The study ID
 * @param {string} inputPath - Path to video file
 * @returns {Promise<string>} Path to extracted thumbnail
 */
export async function extractThumbnail(studyId, inputPath) {
  ensureThumbnailCacheDir(studyId)

  const outputPath = getThumbnailPath(studyId, inputPath)

  // Check if already cached
  if (existsSync(outputPath)) {
    log.info(`[Transcoder] Using cached thumbnail: ${outputPath}`)
    return outputPath
  }

  log.info(`[Transcoder] Extracting thumbnail: ${inputPath} -> ${outputPath}`)

  return new Promise((resolve, reject) => {
    // Extract first frame using FFmpeg
    // -ss 0.5 seeks to 0.5s to skip any black frames at start
    // -frames:v 1 extracts only one frame
    // -q:v 2 sets JPEG quality (2-31, lower is better)
    const ffmpeg = spawn(ffmpegPath, [
      '-i',
      inputPath,
      '-ss',
      '0.5', // Seek to 0.5s to skip potential black frames
      '-frames:v',
      '1', // Extract only one frame
      '-q:v',
      '2', // High quality JPEG
      '-y', // Overwrite output
      outputPath
    ])

    let stderrBuffer = ''

    ffmpeg.stderr.on('data', (data) => {
      stderrBuffer += data.toString()
    })

    ffmpeg.on('close', (code) => {
      if (code === 0 && existsSync(outputPath)) {
        log.info(`[Transcoder] Thumbnail extracted: ${outputPath}`)
        resolve(outputPath)
      } else {
        log.error(`[Transcoder] FFmpeg thumbnail extraction failed with code ${code}`)
        log.error(`[Transcoder] FFmpeg stderr: ${stderrBuffer}`)
        // Clean up partial file
        if (existsSync(outputPath)) {
          try {
            unlinkSync(outputPath)
          } catch {
            // Ignore cleanup errors
          }
        }
        reject(new Error(`FFmpeg exited with code ${code}`))
      }
    })

    ffmpeg.on('error', (err) => {
      log.error(`[Transcoder] FFmpeg error: ${err.message}`)
      reject(err)
    })
  })
}

/**
 * Parse FFmpeg progress output to extract percentage.
 * FFmpeg outputs progress to stderr in format like: "time=00:01:23.45"
 * @param {string} data - FFmpeg stderr output
 * @param {number} duration - Total video duration in seconds
 * @returns {number|null} Progress percentage (0-100) or null if not parseable
 */
function parseProgress(data, duration) {
  // Match time=HH:MM:SS.ms format
  const timeMatch = data.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/)
  if (!timeMatch) return null

  const hours = parseInt(timeMatch[1], 10)
  const minutes = parseInt(timeMatch[2], 10)
  const seconds = parseFloat(timeMatch[3])
  const currentTime = hours * 3600 + minutes * 60 + seconds

  if (duration > 0) {
    return Math.min(100, Math.round((currentTime / duration) * 100))
  }
  return null
}

/**
 * Get video duration using FFmpeg.
 * @param {string} filePath - Path to video file
 * @returns {Promise<number>} Duration in seconds
 */
async function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn(ffmpegPath, [
      '-i',
      filePath,
      '-hide_banner',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1'
    ])

    let output = ''
    let error = ''

    ffprobe.stdout.on('data', (data) => {
      output += data.toString()
    })

    ffprobe.stderr.on('data', (data) => {
      error += data.toString()
      // FFmpeg outputs duration info to stderr too
      const durationMatch = error.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/)
      if (durationMatch) {
        const hours = parseInt(durationMatch[1], 10)
        const minutes = parseInt(durationMatch[2], 10)
        const seconds = parseFloat(durationMatch[3])
        resolve(hours * 3600 + minutes * 60 + seconds)
      }
    })

    ffprobe.on('close', () => {
      // Try to parse output if we didn't get duration from stderr
      const duration = parseFloat(output.trim())
      if (!isNaN(duration)) {
        resolve(duration)
      } else {
        // Default to 0 if we can't determine duration
        resolve(0)
      }
    })

    ffprobe.on('error', reject)
  })
}

/**
 * Transcode a video to browser-compatible MP4 format.
 * @param {string} studyId - The study ID
 * @param {string} inputPath - Path to input video
 * @param {function} onProgress - Progress callback (percentage 0-100)
 * @param {AbortSignal} signal - Optional abort signal for cancellation
 * @returns {Promise<string>} Path to transcoded file
 */
export async function transcodeVideo(studyId, inputPath, onProgress = () => {}, signal = null) {
  ensureCacheDir(studyId)

  const outputPath = getTranscodedPath(studyId, inputPath)

  // Check if already cached
  if (existsSync(outputPath)) {
    log.info(`[Transcoder] Using cached transcoded file: ${outputPath}`)
    return outputPath
  }

  log.info(`[Transcoder] Starting transcode: ${inputPath} -> ${outputPath}`)

  // Get duration for progress calculation
  const duration = await getVideoDuration(inputPath)
  log.info(`[Transcoder] Video duration: ${duration}s`)

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-i',
      inputPath,
      '-c:v',
      'libx264', // H.264 video codec
      '-preset',
      'fast', // Good speed/quality balance
      '-crf',
      '23', // Quality level (lower = better, 23 is default)
      '-c:a',
      'aac', // AAC audio codec
      '-movflags',
      '+faststart', // Optimize for web playback
      '-y', // Overwrite output
      outputPath
    ])

    const jobId = getCacheKey(inputPath)
    activeJobs.set(jobId, { process: ffmpeg, inputPath, outputPath })

    let stderrBuffer = ''

    ffmpeg.stderr.on('data', (data) => {
      stderrBuffer += data.toString()

      // Parse progress from buffer
      const progress = parseProgress(stderrBuffer, duration)
      if (progress !== null) {
        onProgress(progress)
      }

      // Keep only last 1000 chars to avoid memory issues
      if (stderrBuffer.length > 1000) {
        stderrBuffer = stderrBuffer.substring(stderrBuffer.length - 500)
      }
    })

    ffmpeg.on('close', (code) => {
      activeJobs.delete(jobId)

      if (code === 0) {
        log.info(`[Transcoder] Transcode complete: ${outputPath}`)
        onProgress(100)
        resolve(outputPath)
      } else {
        log.error(`[Transcoder] FFmpeg exited with code ${code}`)
        // Clean up partial file
        if (existsSync(outputPath)) {
          try {
            unlinkSync(outputPath)
          } catch {
            // Ignore cleanup errors
          }
        }
        reject(new Error(`FFmpeg exited with code ${code}`))
      }
    })

    ffmpeg.on('error', (err) => {
      activeJobs.delete(jobId)
      log.error(`[Transcoder] FFmpeg error: ${err.message}`)
      reject(err)
    })

    // Handle abort signal
    if (signal) {
      signal.addEventListener('abort', () => {
        log.info(`[Transcoder] Transcode cancelled: ${inputPath}`)
        ffmpeg.kill('SIGTERM')
        // Clean up partial file
        if (existsSync(outputPath)) {
          try {
            unlinkSync(outputPath)
          } catch {
            // Ignore cleanup errors
          }
        }
        reject(new Error('Transcode cancelled'))
      })
    }
  })
}

/**
 * Cancel an active transcoding job.
 * @param {string} filePath - Original video file path
 * @returns {boolean} True if job was cancelled, false if no active job
 */
export function cancelTranscode(filePath) {
  const jobId = getCacheKey(filePath)
  const job = activeJobs.get(jobId)
  if (job) {
    job.process.kill('SIGTERM')
    activeJobs.delete(jobId)
    // Clean up partial file
    if (existsSync(job.outputPath)) {
      try {
        unlinkSync(job.outputPath)
      } catch {
        // Ignore cleanup errors
      }
    }
    return true
  }
  return false
}

/**
 * Get cache statistics for a study.
 * @param {string} studyId - The study ID
 * @returns {{ size: number, count: number }} Cache size in bytes and file count
 */
export function getCacheStats(studyId) {
  const transcodeCacheDir = getTranscodeCacheDir(studyId)

  let totalSize = 0
  let count = 0

  try {
    if (existsSync(transcodeCacheDir)) {
      const files = readdirSync(transcodeCacheDir)
      for (const file of files) {
        if (file.endsWith('.mp4')) {
          const filePath = join(transcodeCacheDir, file)
          const stats = statSync(filePath)
          totalSize += stats.size
          count++
        }
      }
    }
  } catch (e) {
    log.error(`[Transcoder] Error getting cache stats: ${e.message}`)
  }

  return { size: totalSize, count }
}

/**
 * Clear the transcode cache for a study.
 * @param {string} studyId - The study ID
 * @returns {{ cleared: number, freedBytes: number }} Number of files cleared and bytes freed
 */
export function clearCache(studyId) {
  const transcodeCacheDir = getTranscodeCacheDir(studyId)
  const stats = getCacheStats(studyId)

  try {
    if (existsSync(transcodeCacheDir)) {
      rmSync(transcodeCacheDir, { recursive: true, force: true })
      mkdirSync(transcodeCacheDir, { recursive: true })
    }
  } catch (e) {
    log.error(`[Transcoder] Error clearing cache: ${e.message}`)
  }

  return { cleared: stats.count, freedBytes: stats.size }
}

/**
 * Register IPC handlers for transcoding operations.
 */
export function registerTranscodeIPCHandlers() {
  // Check if transcoding is needed for a file (no studyId needed - only checks extension)
  ipcMain.handle('transcode:needs-transcoding', (event, filePath) => {
    return needsTranscoding(filePath)
  })

  // Check if a cached version exists
  ipcMain.handle('transcode:get-cached', (event, studyId, filePath) => {
    return getCachedTranscode(studyId, filePath)
  })

  // Start transcoding with progress updates
  ipcMain.handle('transcode:start', async (event, studyId, filePath) => {
    const sender = event.sender

    try {
      const transcodedPath = await transcodeVideo(studyId, filePath, (progress) => {
        // Send progress update to renderer
        if (!sender.isDestroyed()) {
          sender.send('transcode:progress', { filePath, progress })
        }
      })

      return { success: true, path: transcodedPath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // Cancel an active transcode (no studyId needed - uses filePath for job lookup)
  ipcMain.handle('transcode:cancel', (event, filePath) => {
    return cancelTranscode(filePath)
  })

  // Get cache statistics for a study
  ipcMain.handle('transcode:cache-stats', (event, studyId) => {
    return getCacheStats(studyId)
  })

  // Clear the cache for a study
  ipcMain.handle('transcode:clear-cache', (event, studyId) => {
    return clearCache(studyId)
  })

  // Get cached thumbnail for a video
  ipcMain.handle('thumbnail:get-cached', (event, studyId, filePath) => {
    return getCachedThumbnail(studyId, filePath)
  })

  // Extract thumbnail from video
  ipcMain.handle('thumbnail:extract', async (event, studyId, filePath) => {
    try {
      const thumbnailPath = await extractThumbnail(studyId, filePath)
      return { success: true, path: thumbnailPath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  log.info('[Transcoder] IPC handlers registered')
}
