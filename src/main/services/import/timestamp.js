/**
 * Video timestamp extraction module.
 *
 * Provides a layered fallback chain for extracting timestamps from video files:
 *   1. FFmpeg container metadata (creation_time)
 *   2. Filename pattern parsing (common camera trap naming conventions)
 *   3. File modification time (last resort)
 *
 * Each result is validated against known-bad sentinel values
 * (QuickTime epoch 1904, Unix epoch 1970, future dates).
 */

import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

import log from '../logger.js'

/**
 * Check whether a Date represents a known-bad or implausible timestamp.
 * Rejects QuickTime epoch (1904), Unix epoch (1970), pre-2000, and future dates.
 * @param {Date} date
 * @returns {boolean} true if the timestamp is valid
 */
export function isValidTimestamp(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return false

  const year = date.getFullYear()
  const currentYear = new Date().getFullYear()

  // QuickTime epoch (1904-01-01) and Unix epoch (1970-01-01)
  if (year <= 1970) return false

  // Camera traps didn't exist before ~2000
  if (year < 2000) return false

  // Reject future dates (allow 1 year margin for clock drift)
  if (year > currentYear + 1) return false

  return true
}

/**
 * Parse ffmpeg stderr output to extract creation_time metadata.
 * FFmpeg prints lines like:
 *   creation_time   : 2024-03-15T14:30:22.000000Z
 * @param {string} stderr - FFmpeg stderr output
 * @returns {Date|null}
 */
export function parseFFmpegCreationTime(stderr) {
  // Match creation_time in ffmpeg banner output, preserving any trailing Z
  const match = stderr.match(/creation_time\s*:\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})\S*/)
  if (!match) return null

  // Ensure the timestamp is parsed as UTC — FFmpeg creation_time is always UTC
  let isoString = match[1]
  if (!isoString.endsWith('Z')) isoString += 'Z'

  const date = new Date(isoString)
  return isNaN(date.getTime()) ? null : date
}

/**
 * Lazily resolve the FFmpeg binary path once.
 * Avoids top-level Electron imports (which break tests) and repeated
 * resolution during batch imports. The promise is cached after first call.
 * @returns {() => Promise<string>}
 */
const resolveFFmpegPath = (() => {
  let cached
  return () => {
    if (!cached) cached = import('../ffmpeg.js').then((m) => m.getFFmpegBinaryPath())
    return cached
  }
})()

/**
 * Extract timestamp from video container metadata using FFmpeg.
 * Spawns `ffmpeg -i <file>` to read the container header (no decoding) and
 * parses `creation_time` from stderr. Includes a 10 s timeout to handle
 * corrupt files or stalled mounts.
 * @param {string} filePath - Absolute path to video file
 * @returns {Promise<{timestamp: Date|null, source: string}>}
 */
export async function extractTimestampFromFFmpeg(filePath) {
  let ffmpegBinary
  try {
    ffmpegBinary = await resolveFFmpegPath()
  } catch {
    log.warn('[Timestamp] FFmpeg binary not available, skipping container metadata extraction')
    return { timestamp: null, source: 'ffmpeg' }
  }

  return new Promise((resolve) => {
    let stderr = ''
    let settled = false

    const settle = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    // Only read the container header — no output means FFmpeg prints metadata
    // to stderr and exits immediately instead of decoding the entire stream.
    const proc = spawn(ffmpegBinary, ['-i', filePath], {
      stdio: ['ignore', 'ignore', 'pipe']
    })

    // Kill FFmpeg if it hangs (e.g. corrupt file, stalled network mount)
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      log.warn(`[Timestamp] FFmpeg timed out for ${filePath}`)
      settle({ timestamp: null, source: 'ffmpeg' })
    }, 10_000)

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', () => {
      const date = parseFFmpegCreationTime(stderr)
      if (date && isValidTimestamp(date)) {
        settle({ timestamp: date, source: 'ffmpeg' })
      } else {
        settle({ timestamp: null, source: 'ffmpeg' })
      }
    })

    proc.on('error', (err) => {
      log.warn(`[Timestamp] FFmpeg failed for ${filePath}: ${err.message}`)
      settle({ timestamp: null, source: 'ffmpeg' })
    })
  })
}

/**
 * Filename patterns commonly used by camera trap manufacturers.
 * Each entry: [regex, hasTime] where hasTime indicates if time components are captured.
 *
 * Patterns are tried in order; the first match wins.
 * Named groups: y=year, M=month, d=day, h=hour, m=minute, s=second
 */
const FILENAME_PATTERNS = [
  // YYYYMMDD_HHMMSS or YYYYMMDD-HHMMSS (Reconyx, Bushnell, Browning, Stealth Cam, most camera traps)
  {
    regex: /(?<!\d)(?<y>\d{4})(?<M>\d{2})(?<d>\d{2})[_-](?<h>\d{2})(?<m>\d{2})(?<s>\d{2})(?!\d)/,
    hasTime: true
  },
  // YYYY-MM-DD_HH-MM-SS or YYYY-MM-DD-HH-MM-SS (dashed variant)
  {
    regex:
      /(?<!\d)(?<y>\d{4})-(?<M>\d{2})-(?<d>\d{2})[_-](?<h>\d{2})-(?<m>\d{2})-(?<s>\d{2})(?!\d)/,
    hasTime: true
  },
  // YYYYMMDDHHmmss (fully packed, no separator — 14 consecutive digits)
  {
    regex: /(?<!\d)(?<y>\d{4})(?<M>\d{2})(?<d>\d{2})(?<h>\d{2})(?<m>\d{2})(?<s>\d{2})(?!\d)/,
    hasTime: true
  },
  // YYYYMMDD (date only, time defaults to 00:00:00)
  { regex: /(?<!\d)(?<y>\d{4})(?<M>\d{2})(?<d>\d{2})(?!\d)/, hasTime: false }
]

/**
 * Extract timestamp from a filename using common camera trap naming patterns.
 * @param {string} fileName - File name (not full path)
 * @returns {{timestamp: Date|null, source: string}}
 */
export function extractTimestampFromFilename(fileName) {
  // Strip extension for cleaner matching
  const name = path.basename(fileName, path.extname(fileName))

  for (const { regex, hasTime } of FILENAME_PATTERNS) {
    const match = name.match(regex)
    if (!match || !match.groups) continue

    const { y, M, d } = match.groups
    const h = hasTime ? match.groups.h : '00'
    const m = hasTime ? match.groups.m : '00'
    const s = hasTime ? match.groups.s : '00'

    const year = parseInt(y, 10)
    const month = parseInt(M, 10)
    const day = parseInt(d, 10)
    const hour = parseInt(h, 10)
    const minute = parseInt(m, 10)
    const second = parseInt(s, 10)

    // Basic range validation
    if (month < 1 || month > 12) continue
    if (day < 1 || day > 31) continue
    if (hour > 23 || minute > 59 || second > 59) continue

    const date = new Date(year, month - 1, day, hour, minute, second)
    if (isValidTimestamp(date)) {
      return { timestamp: date, source: 'filename' }
    }
  }

  return { timestamp: null, source: 'filename' }
}

/**
 * Extract timestamp from file modification time.
 * @param {string} filePath - Absolute path to file
 * @returns {Promise<{timestamp: Date|null, source: string}>}
 */
export async function extractTimestampFromFileMtime(filePath) {
  try {
    const stats = await fs.promises.stat(filePath)
    const date = stats.mtime
    if (isValidTimestamp(date)) {
      return { timestamp: date, source: 'file_mtime' }
    }
  } catch (err) {
    log.warn(`[Timestamp] Could not stat ${filePath}: ${err.message}`)
  }
  return { timestamp: null, source: 'file_mtime' }
}

/**
 * Resolve a video timestamp using a layered fallback chain:
 *   1. FFmpeg container metadata (creation_time)
 *   2. Filename pattern parsing
 *   3. File modification time
 *
 * @param {string} filePath - Absolute path to video file
 * @param {string} fileName - File name (for filename-based parsing)
 * @returns {Promise<{timestamp: Date|null, source: string}>}
 */
export async function resolveVideoTimestamp(filePath, fileName) {
  // 1. Try FFmpeg container metadata
  const ffmpegResult = await extractTimestampFromFFmpeg(filePath)
  if (ffmpegResult.timestamp) {
    log.info(`[Timestamp] Extracted timestamp from FFmpeg metadata for ${fileName}`)
    return ffmpegResult
  }

  // 2. Try filename pattern parsing
  const filenameResult = extractTimestampFromFilename(fileName)
  if (filenameResult.timestamp) {
    log.info(`[Timestamp] Extracted timestamp from filename for ${fileName}`)
    return filenameResult
  }

  // 3. Fall back to file modification time
  const mtimeResult = await extractTimestampFromFileMtime(filePath)
  if (mtimeResult.timestamp) {
    log.info(`[Timestamp] Using file modification time for ${fileName}`)
    return mtimeResult
  }

  log.warn(`[Timestamp] No valid timestamp found for ${fileName}`)
  return { timestamp: null, source: 'none' }
}
