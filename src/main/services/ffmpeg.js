/**
 * Shared FFmpeg binary path resolution.
 *
 * Provides a single helper to locate the bundled FFmpeg binary from
 * ffmpeg-static, handling the app.asar → app.asar.unpacked rewrite
 * required in packaged Electron apps.
 *
 * Intentionally free of Electron imports so the module can be loaded
 * in plain Node.js (e.g. tests) without crashing.
 *
 * @module ffmpeg
 */

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
  // ffmpeg-static uses __dirname to resolve the binary path; inside an asar
  // archive this yields a path containing "app.asar" which must be rewritten
  // to "app.asar.unpacked" where electron-builder places the real binary.
  return ffmpegPath.includes('app.asar')
    ? ffmpegPath.replace('app.asar', 'app.asar.unpacked')
    : ffmpegPath
}
