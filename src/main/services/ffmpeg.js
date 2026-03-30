/**
 * Shared FFmpeg binary path resolution.
 *
 * Provides a single helper to locate the bundled FFmpeg binary from
 * ffmpeg-static, handling the app.asar → app.asar.unpacked rewrite
 * required in packaged Electron apps.
 *
 * @module ffmpeg
 */

import { app } from 'electron'
import ffmpegPath from 'ffmpeg-static'

/**
 * Get the resolved path to the bundled FFmpeg binary.
 * Handles the app.asar → app.asar.unpacked rewrite needed in packaged Electron apps.
 * @returns {string} Absolute path to the FFmpeg binary
 */
export function getFFmpegBinaryPath() {
  if (!ffmpegPath) {
    throw new Error('Failed to resolve path from ffmpeg-static')
  }

  // Packaged Electron apps cannot execute binaries from app.asar.
  return app.isPackaged && ffmpegPath.includes('app.asar')
    ? ffmpegPath.replace('app.asar', 'app.asar.unpacked')
    : ffmpegPath
}
