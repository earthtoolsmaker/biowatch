/**
 * OCR Service for extracting timestamps from camera trap images
 * Uses tesseract.js for OCR and sharp for image preprocessing
 */

import { createWorker } from 'tesseract.js'
import sharp from 'sharp'
import { ipcMain, app } from 'electron'
import { join } from 'path'
import { unlink } from 'fs/promises'
import log from 'electron-log'
import crypto from 'crypto'
import os from 'os'
import { DateTime } from 'luxon'
import { parseDateFromText, normalizeOCRText } from './date-parser.js'
import { getDrizzleDb, ocrOutputs, media, observations } from './db/index.js'
import { eq, isNull } from 'drizzle-orm'
import { downloadAndCacheImage } from './image-cache.js'
import { extractFirstFrame, getLocalVideoPath, getVideoDuration } from './transcoder.js'
import { getTessdataLangPath } from './tessdata-path.js'

/**
 * Get the database path for a study
 * @param {string} studyId - Study identifier
 * @returns {string} Path to the study database
 */
function getStudyDbPath(studyId) {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, 'biowatch-data', 'studies', studyId, 'study.db')
}

/**
 * Check if a path is a remote URL
 * @param {string} filePath - File path or URL
 * @returns {boolean} True if remote URL
 */
function isRemoteUrl(filePath) {
  return filePath.startsWith('http://') || filePath.startsWith('https://')
}

/**
 * Get local path for an image, downloading if remote
 * @param {string} studyId - Study identifier
 * @param {string} imagePath - Local path or remote URL
 * @returns {Promise<{localPath: string, isTemporary: boolean}>}
 */
async function getLocalImagePath(studyId, imagePath) {
  if (!isRemoteUrl(imagePath)) {
    return { localPath: imagePath, isTemporary: false }
  }

  // Download remote image to cache (temporary for OCR)
  log.info(`[OCR] Downloading remote image: ${imagePath}`)
  const localPath = await downloadAndCacheImage(studyId, imagePath)
  return { localPath, isTemporary: true }
}

// Tesseract.js version for tracking
const TESSERACT_VERSION = '5.1.1'
const MODEL_ID = 'tesseract'

// Region extraction percentage (top/bottom of image)
// Reduced from 0.15 to 0.07 - timestamps are in a small band, less data = faster OCR
const REGION_PERCENTAGE = 0.07

// Max width for OCR processing (downscale larger images for speed)
const MAX_OCR_WIDTH = 1280

// Character whitelist for timestamp OCR
const CHAR_WHITELIST = '0123456789/:.- ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Get the number of OCR workers based on CPU cores
 * Uses CPU cores - 2 to leave headroom for other processes
 * @returns {number} Number of workers (minimum 2)
 */
function getWorkerCount() {
  return Math.max(2, os.cpus().length - 2)
}

// Active OCR operation (for cancellation)
let activeAbortController = null
// Current OCR status (for restoring state when navigating back)
let currentOCRStudyId = null
let currentOCRProgress = null

/**
 * Extract a region from an image (top or bottom)
 * Downscales large images first for faster OCR processing
 * @param {string} imagePath - Path to image file
 * @param {'top'|'bottom'} region - Which region to extract
 * @returns {Promise<Buffer>} Processed image buffer
 */
async function extractRegion(imagePath, region) {
  let image = sharp(imagePath)
  const metadata = await image.metadata()

  // Downscale if image is wider than MAX_OCR_WIDTH for faster processing
  let width = metadata.width
  let height = metadata.height
  if (width > MAX_OCR_WIDTH) {
    const scale = MAX_OCR_WIDTH / width
    width = MAX_OCR_WIDTH
    height = Math.round(metadata.height * scale)
    image = image.resize(width)
  }

  const regionHeight = Math.round(height * REGION_PERCENTAGE)

  const extractOptions =
    region === 'top'
      ? { left: 0, top: 0, width, height: regionHeight }
      : {
          left: 0,
          top: height - regionHeight,
          width,
          height: regionHeight
        }

  // Extract region and preprocess for better OCR
  return await image.extract(extractOptions).grayscale().normalize().toBuffer()
}

/**
 * Run OCR on a single region
 * @param {Object} worker - Tesseract worker
 * @param {Buffer} imageBuffer - Image buffer to process
 * @returns {Promise<Object>} OCR result with text and confidence
 */
async function ocrRegion(worker, imageBuffer) {
  const {
    data: { text, confidence }
  } = await worker.recognize(imageBuffer)

  return {
    text: normalizeOCRText(text),
    confidence: confidence / 100 // Normalize to 0-1
  }
}

/**
 * Extract timestamp from a single image
 * Tries both top and bottom regions, returns best result
 * @param {string} imagePath - Path to image file
 * @param {Object} worker - Tesseract worker (optional, creates one if not provided)
 * @returns {Promise<Object>} OCR result
 */
export async function extractTimestampFromImage(imagePath, worker = null) {
  const shouldCleanupWorker = !worker
  const fileName = imagePath.split('/').pop()

  log.info(`[OCR] Starting extraction for: ${fileName}`)

  if (!worker) {
    worker = await createWorker('eng', 1, {
      langPath: getTessdataLangPath()
    })
    await worker.setParameters({
      tessedit_char_whitelist: CHAR_WHITELIST
    })
  }

  try {
    // Extract both regions
    const [topBuffer, bottomBuffer] = await Promise.all([
      extractRegion(imagePath, 'top'),
      extractRegion(imagePath, 'bottom')
    ])

    // OCR both regions
    const [topResult, bottomResult] = await Promise.all([
      ocrRegion(worker, topBuffer),
      ocrRegion(worker, bottomBuffer)
    ])

    // Log raw OCR results
    log.info(`[OCR] ${fileName} - TOP region:`)
    log.info(`[OCR]   Raw text: "${topResult.text.replace(/\n/g, '\\n')}"`)
    log.info(`[OCR]   Confidence: ${(topResult.confidence * 100).toFixed(1)}%`)

    log.info(`[OCR] ${fileName} - BOTTOM region:`)
    log.info(`[OCR]   Raw text: "${bottomResult.text.replace(/\n/g, '\\n')}"`)
    log.info(`[OCR]   Confidence: ${(bottomResult.confidence * 100).toFixed(1)}%`)

    // Parse dates from both regions
    const topParsed = parseDateFromText(topResult.text)
    const bottomParsed = parseDateFromText(bottomResult.text)

    // Log parsing results
    if (topParsed) {
      log.info(
        `[OCR] ${fileName} - TOP parsed: ${topParsed.isoString} (format: ${topParsed.format}, match: "${topParsed.rawMatch}")`
      )
    } else {
      log.info(`[OCR] ${fileName} - TOP: no date pattern found`)
    }

    if (bottomParsed) {
      log.info(
        `[OCR] ${fileName} - BOTTOM parsed: ${bottomParsed.isoString} (format: ${bottomParsed.format}, match: "${bottomParsed.rawMatch}")`
      )
    } else {
      log.info(`[OCR] ${fileName} - BOTTOM: no date pattern found`)
    }

    // Determine which region has the better result
    let selectedRegion = null
    let parsedDate = null

    if (topParsed && bottomParsed) {
      // Both have dates, pick the one with higher combined confidence
      const topScore = topResult.confidence * topParsed.confidence
      const bottomScore = bottomResult.confidence * bottomParsed.confidence
      log.info(
        `[OCR] ${fileName} - Both regions have dates. Top score: ${topScore.toFixed(3)}, Bottom score: ${bottomScore.toFixed(3)}`
      )
      if (topScore >= bottomScore) {
        selectedRegion = 'top'
        parsedDate = topParsed
      } else {
        selectedRegion = 'bottom'
        parsedDate = bottomParsed
      }
    } else if (topParsed) {
      selectedRegion = 'top'
      parsedDate = topParsed
    } else if (bottomParsed) {
      selectedRegion = 'bottom'
      parsedDate = bottomParsed
    }

    if (selectedRegion) {
      log.info(`[OCR] ${fileName} - Selected: ${selectedRegion} region -> ${parsedDate.isoString}`)
    } else {
      log.warn(`[OCR] ${fileName} - No timestamp found in either region`)
    }

    return {
      topRegion: {
        text: topResult.text,
        confidence: topResult.confidence,
        parsedDate: topParsed
          ? {
              isoString: topParsed.isoString,
              format: topParsed.format,
              rawMatch: topParsed.rawMatch
            }
          : null
      },
      bottomRegion: {
        text: bottomResult.text,
        confidence: bottomResult.confidence,
        parsedDate: bottomParsed
          ? {
              isoString: bottomParsed.isoString,
              format: bottomParsed.format,
              rawMatch: bottomParsed.rawMatch
            }
          : null
      },
      selectedRegion,
      parsedDate: parsedDate?.isoString || null,
      dateFormat: parsedDate?.format || null
    }
  } finally {
    if (shouldCleanupWorker) {
      await worker.terminate()
    }
  }
}

/**
 * Process a batch of media files for OCR timestamp extraction
 * Uses parallel Tesseract workers for improved performance
 * @param {string} studyId - Study identifier
 * @param {string} dbPath - Database path
 * @param {string[]} mediaIDs - Array of media IDs to process (empty = all with null timestamps)
 * @param {Function} onProgress - Progress callback
 * @param {AbortSignal} signal - Abort signal for cancellation
 * @returns {Promise<Object>} Processing results
 */
export async function extractTimestampBatch(
  studyId,
  dbPath,
  mediaIDs = [],
  onProgress = () => {},
  signal = null
) {
  const db = await getDrizzleDb(studyId, dbPath)

  // Get media to process
  let mediaRecords
  if (mediaIDs.length > 0) {
    mediaRecords = await db.select().from(media).where(eq(media.mediaID, mediaIDs[0])) // TODO: Handle multiple IDs properly
  } else {
    // Get all media with null timestamps (images only)
    mediaRecords = await db.select().from(media).where(isNull(media.timestamp)).all()
  }

  // Filter to images and videos (OCR-capable media)
  mediaRecords = mediaRecords.filter((m) => {
    if (!m.fileMediatype) return false
    return m.fileMediatype.startsWith('image/') || m.fileMediatype.startsWith('video/')
  })

  const total = mediaRecords.length
  let processed = 0
  let extracted = 0
  const errors = []
  const extractedResults = []

  // Track all cached images for batch-level cleanup (defense in depth)
  const cachedImagePaths = new Set()

  onProgress({
    stage: 'initializing',
    current: 0,
    total
  })

  // Create worker pool based on CPU cores
  const workerCount = Math.min(getWorkerCount(), total)
  const workers = await Promise.all(
    Array(workerCount)
      .fill(null)
      .map(async () => {
        const worker = await createWorker('eng', 1, {
          langPath: getTessdataLangPath()
        })
        await worker.setParameters({ tessedit_char_whitelist: CHAR_WHITELIST })
        return worker
      })
  )

  log.info(`[OCR] Created ${workerCount} Tesseract workers for parallel processing`)

  // Shared index for work distribution
  let currentIndex = 0

  try {
    // Worker tasks (following export.js pattern)
    const workerTasks = workers.map(async (worker, workerIdx) => {
      while (currentIndex < total) {
        if (signal?.aborted) break

        const index = currentIndex++
        const mediaRecord = mediaRecords[index]

        // Primary check: use fileMediatype if available
        let isVideo = mediaRecord.fileMediatype?.startsWith('video/')

        // Fallback: detect video by file extension if fileMediatype might be wrong
        // This handles cases where videos were imported with incorrect MIME types
        if (!isVideo && mediaRecord.filePath) {
          const ext = mediaRecord.filePath.toLowerCase().split('.').pop()
          const videoExtensions = [
            'avi',
            'mp4',
            'mkv',
            'mov',
            'm4v',
            'wmv',
            'flv',
            '3gp',
            'webm',
            'ogv'
          ]
          isVideo = videoExtensions.includes(ext)
        }

        let localPath = null
        let isTemporary = false
        let frameCleanup = null
        let videoDuration = null // Track video duration for eventEnd calculation

        try {
          if (isVideo) {
            // Get local video path (downloads remote videos, caches result)
            const localVideoPath = await getLocalVideoPath(studyId, mediaRecord.filePath)

            // Get video duration for eventEnd calculation
            videoDuration = await getVideoDuration(localVideoPath)

            // Extract first frame for OCR (uses cached local path)
            const frameResult = await extractFirstFrame(studyId, mediaRecord.filePath)
            localPath = frameResult.framePath
            frameCleanup = frameResult.cleanup
            isTemporary = true
          } else {
            // Download image if remote
            const pathInfo = await getLocalImagePath(studyId, mediaRecord.filePath)
            localPath = pathInfo.localPath
            isTemporary = pathInfo.isTemporary
          }

          // Track cached images for batch-level cleanup
          if (isTemporary && localPath && !frameCleanup) {
            cachedImagePaths.add(localPath)
          }

          // Run OCR
          const result = await extractTimestampFromImage(localPath, worker)

          // Store OCR output
          await db.insert(ocrOutputs).values({
            id: crypto.randomUUID(),
            mediaID: mediaRecord.mediaID,
            modelID: MODEL_ID,
            modelVersion: TESSERACT_VERSION,
            createdAt: new Date().toISOString(),
            rawOutput: result
          })

          // Update media timestamp if found
          if (result.parsedDate && !mediaRecord.timestamp) {
            await db
              .update(media)
              .set({ timestamp: result.parsedDate })
              .where(eq(media.mediaID, mediaRecord.mediaID))

            // For videos: also calculate and set eventEnd
            if (isVideo) {
              // Priority: extracted duration > exifData > default to eventStart
              const duration = videoDuration || mediaRecord.exifData?.duration
              let eventEnd = result.parsedDate // Default if no duration
              if (duration) {
                const startDate = DateTime.fromISO(result.parsedDate)
                eventEnd = startDate.plus({ seconds: duration }).toISO()
              }

              // Update linked observations with both eventStart AND eventEnd
              await db
                .update(observations)
                .set({
                  eventStart: result.parsedDate,
                  eventEnd: eventEnd
                })
                .where(eq(observations.mediaID, mediaRecord.mediaID))
            } else {
              // For images: only update eventStart (existing behavior)
              await db
                .update(observations)
                .set({ eventStart: result.parsedDate })
                .where(eq(observations.mediaID, mediaRecord.mediaID))
            }

            // Track the extracted result for frontend
            extractedResults.push({
              mediaID: mediaRecord.mediaID,
              timestamp: result.parsedDate
            })

            extracted++
          }
        } catch (err) {
          log.error(`[OCR] Worker ${workerIdx} failed on ${mediaRecord.filePath}:`, err)
          errors.push({ mediaID: mediaRecord.mediaID, error: err.message })
        } finally {
          // Cleanup temp file immediately after processing
          if (frameCleanup) {
            // Video frame cleanup via callback
            await frameCleanup()
          } else if (isTemporary && localPath) {
            // Image cleanup
            await unlink(localPath).catch(() => {})
            cachedImagePaths.delete(localPath) // Mark as cleaned
          }
        }

        processed++
        onProgress({
          stage: 'processing',
          current: processed,
          total,
          currentMediaID: mediaRecord.mediaID
        })
      }
    })

    await Promise.all(workerTasks)

    // Only send 'complete' if not cancelled
    if (!signal?.aborted) {
      onProgress({
        stage: 'complete',
        current: processed,
        total
      })
    }

    return {
      success: true,
      processed,
      extracted,
      errors,
      results: extractedResults
    }
  } finally {
    // Terminate all workers
    await Promise.all(workers.map((w) => w.terminate()))
    log.info(`[OCR] Terminated ${workers.length} workers`)

    // Final cleanup: delete any cached images that weren't cleaned up
    // (e.g., due to cancellation, crashes, or edge cases)
    if (cachedImagePaths.size > 0) {
      log.info(`[OCR] Final cleanup: removing ${cachedImagePaths.size} remaining cached images`)
      await Promise.all(
        Array.from(cachedImagePaths).map((path) =>
          unlink(path).catch((err) => {
            log.warn(`[OCR] Failed to cleanup cached image ${path}: ${err.message}`)
          })
        )
      )
      cachedImagePaths.clear()
    }
  }
}

/**
 * Cancel the active OCR operation
 */
export function cancelOCR() {
  if (activeAbortController) {
    activeAbortController.abort()
    activeAbortController = null
    currentOCRStudyId = null
    currentOCRProgress = null
    return { success: true }
  }
  return { success: false, reason: 'No active OCR operation' }
}

/**
 * Get current OCR status for a specific study (for restoring state when navigating back)
 */
export function getOCRStatus(studyId) {
  const isRunning = activeAbortController !== null && currentOCRStudyId === studyId
  return {
    isRunning,
    progress: isRunning ? currentOCRProgress : null
  }
}

/**
 * Register OCR IPC handlers
 */
export function registerOCRIPCHandlers() {
  // Extract timestamps from media
  ipcMain.handle('ocr:extract-timestamps', async (event, studyId, mediaIDs) => {
    // Derive dbPath from studyId
    const dbPath = getStudyDbPath(studyId)

    // Cancel any existing operation
    if (activeAbortController) {
      activeAbortController.abort()
    }

    activeAbortController = new AbortController()
    currentOCRStudyId = studyId
    const signal = activeAbortController.signal

    const onProgress = (progress) => {
      currentOCRProgress = progress
      event.sender.send('ocr:progress', progress)
      // Clear status when complete
      if (progress.stage === 'complete') {
        currentOCRStudyId = null
        currentOCRProgress = null
      }
    }

    try {
      const result = await extractTimestampBatch(
        studyId,
        dbPath,
        mediaIDs || [],
        onProgress,
        signal
      )
      return result
    } finally {
      activeAbortController = null
    }
  })

  // Cancel OCR operation
  ipcMain.handle('ocr:cancel', async () => {
    return cancelOCR()
  })

  // Get current OCR status for a specific study (for restoring state when navigating)
  ipcMain.handle('ocr:get-status', async (_, studyId) => {
    return getOCRStatus(studyId)
  })

  // Get media timestamp statistics (images and videos - for OCR)
  // Returns fixableCount (can be OCR'd) and failedOCRCount (already tried OCR)
  ipcMain.handle('ocr:get-timestamp-stats', async (_, studyId) => {
    const dbPath = getStudyDbPath(studyId)
    const db = await getDrizzleDb(studyId, dbPath)

    // Helper to check if media is OCR-capable (image or video)
    const isOCRCapable = (m) => {
      if (!m.fileMediatype) return false
      return m.fileMediatype.startsWith('image/') || m.fileMediatype.startsWith('video/')
    }

    // Get all media
    const allMedia = await db.select().from(media).all()
    const ocrCapableMedia = allMedia.filter(isOCRCapable)
    const totalCount = ocrCapableMedia.length

    // Get media with null timestamps, joined with OCR outputs to differentiate
    // between fixable (no OCR output) and failed (has OCR output but no timestamp)
    const missingTimestampMedia = await db
      .select({
        mediaID: media.mediaID,
        fileMediatype: media.fileMediatype,
        hasOcrOutput: ocrOutputs.id
      })
      .from(media)
      .leftJoin(ocrOutputs, eq(media.mediaID, ocrOutputs.mediaID))
      .where(isNull(media.timestamp))
      .all()

    // Filter to OCR-capable media (images and videos)
    const filtered = missingTimestampMedia.filter(isOCRCapable)

    // Fixable: null timestamp AND no OCR output (can be fixed with OCR)
    const fixableCount = filtered.filter((m) => !m.hasOcrOutput).length
    // Failed: null timestamp AND has OCR output (already tried OCR)
    const failedOCRCount = filtered.filter((m) => m.hasOcrOutput).length

    return {
      nullCount: fixableCount + failedOCRCount, // total missing timestamps
      fixableCount,
      failedOCRCount,
      totalCount
    }
  })

  // Get global OCR status (for blocking across studies)
  ipcMain.handle('ocr:get-global-status', async () => {
    const isRunning = activeAbortController !== null && currentOCRStudyId !== null
    return {
      isRunning,
      runningStudyId: isRunning ? currentOCRStudyId : null
    }
  })

  log.info('[OCR] IPC handlers registered')
}
