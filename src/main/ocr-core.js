/**
 * Core OCR functionality for extracting timestamps from camera trap images
 * This module is completely decoupled from Electron and database - pure OCR only
 */

import { createWorker } from 'tesseract.js'
import sharp from 'sharp'
import os from 'os'
import { parseDateFromText, normalizeOCRText } from './date-parser.js'

// Tesseract.js version for tracking
export const TESSERACT_VERSION = '5.1.1'
export const MODEL_ID = 'tesseract'

// Region extraction percentage (top/bottom of image)
const REGION_PERCENTAGE = 0.07

// Max width for OCR processing (downscale larger images for speed)
const MAX_OCR_WIDTH = 1280

// Fast language data URL for speed-optimized OCR
export const FAST_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0_fast'

// Character whitelist for timestamp OCR
export const CHAR_WHITELIST = '0123456789/:.- ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Get the number of OCR workers based on CPU cores
 * @returns {number} Number of workers (minimum 2)
 */
export function getWorkerCount() {
  return Math.max(2, os.cpus().length - 2)
}

/**
 * Check if a path is a remote URL
 * @param {string} filePath - File path or URL
 * @returns {boolean} True if remote URL
 */
export function isRemoteUrl(filePath) {
  return filePath.startsWith('http://') || filePath.startsWith('https://')
}

/**
 * Extract a region from an image (top or bottom)
 * @param {string} imagePath - Path to image file
 * @param {'top'|'bottom'} region - Which region to extract
 * @returns {Promise<Buffer>} Processed image buffer
 */
export async function extractRegion(imagePath, region) {
  let image = sharp(imagePath)
  const metadata = await image.metadata()

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
      : { left: 0, top: height - regionHeight, width, height: regionHeight }

  return await image.extract(extractOptions).grayscale().normalize().toBuffer()
}

/**
 * Run OCR on a single region
 * @param {Object} worker - Tesseract worker
 * @param {Buffer} imageBuffer - Image buffer to process
 * @returns {Promise<Object>} OCR result with text and confidence
 */
export async function ocrRegion(worker, imageBuffer) {
  const {
    data: { text, confidence }
  } = await worker.recognize(imageBuffer)

  return {
    text: normalizeOCRText(text),
    confidence: confidence / 100
  }
}

/**
 * Create a Tesseract worker configured for timestamp OCR
 * @param {string} [langPath=FAST_LANG_PATH] - Path to language data (URL or file:// path)
 * @returns {Promise<Object>} Configured Tesseract worker
 */
export async function createOCRWorker(langPath = FAST_LANG_PATH) {
  const worker = await createWorker('eng', 1, {
    langPath
  })
  await worker.setParameters({
    tessedit_char_whitelist: CHAR_WHITELIST
  })
  return worker
}

/**
 * Extract timestamp from a single image
 * Tries both top and bottom regions, returns best result
 * @param {string} imagePath - Path to image file
 * @param {Object} worker - Tesseract worker (optional, creates one if not provided)
 * @param {Object} logger - Logger object with info, warn, error methods (optional)
 * @param {string} [langPath=FAST_LANG_PATH] - Path to language data (only used if worker not provided)
 * @returns {Promise<Object>} OCR result
 */
export async function extractTimestampFromImage(
  imagePath,
  worker = null,
  logger = console,
  langPath = FAST_LANG_PATH
) {
  const shouldCleanupWorker = !worker
  const fileName = imagePath.split('/').pop()

  logger.info(`[OCR] Starting extraction for: ${fileName}`)

  if (!worker) {
    worker = await createOCRWorker(langPath)
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
    logger.info(`[OCR] ${fileName} - TOP region:`)
    logger.info(`[OCR]   Raw text: "${topResult.text.replace(/\n/g, '\\n')}"`)
    logger.info(`[OCR]   Confidence: ${(topResult.confidence * 100).toFixed(1)}%`)

    logger.info(`[OCR] ${fileName} - BOTTOM region:`)
    logger.info(`[OCR]   Raw text: "${bottomResult.text.replace(/\n/g, '\\n')}"`)
    logger.info(`[OCR]   Confidence: ${(bottomResult.confidence * 100).toFixed(1)}%`)

    // Parse dates from both regions
    const topParsed = parseDateFromText(topResult.text)
    const bottomParsed = parseDateFromText(bottomResult.text)

    // Log parsing results
    if (topParsed) {
      logger.info(
        `[OCR] ${fileName} - TOP parsed: ${topParsed.isoString} (format: ${topParsed.format}, match: "${topParsed.rawMatch}")`
      )
    } else {
      logger.info(`[OCR] ${fileName} - TOP: no date pattern found`)
    }

    if (bottomParsed) {
      logger.info(
        `[OCR] ${fileName} - BOTTOM parsed: ${bottomParsed.isoString} (format: ${bottomParsed.format}, match: "${bottomParsed.rawMatch}")`
      )
    } else {
      logger.info(`[OCR] ${fileName} - BOTTOM: no date pattern found`)
    }

    // Determine which region has the better result
    let selectedRegion = null
    let parsedDate = null

    if (topParsed && bottomParsed) {
      const topScore = topResult.confidence * topParsed.confidence
      const bottomScore = bottomResult.confidence * bottomParsed.confidence
      logger.info(
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
      logger.info(
        `[OCR] ${fileName} - Selected: ${selectedRegion} region -> ${parsedDate.isoString}`
      )
    } else {
      logger.warn(`[OCR] ${fileName} - No timestamp found in either region`)
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
