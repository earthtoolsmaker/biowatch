/**
 * Renderer console log capture
 * Captures console messages from the renderer process and writes them to a log file
 */

import { app } from 'electron'
import fs from 'fs'
import path from 'path'

let logStream = null
let logFilePath = null

/**
 * Get the renderer log file path
 * @returns {string} Path to renderer.log
 */
export function getRendererLogPath() {
  if (!logFilePath) {
    logFilePath = path.join(app.getPath('logs'), 'renderer.log')
  }
  return logFilePath
}

/**
 * Initialize the renderer log file
 * Creates or truncates the log file at app start
 */
function initLogFile() {
  const logPath = getRendererLogPath()
  const logsDir = path.dirname(logPath)

  // Ensure logs directory exists
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }

  // Create write stream in append mode
  logStream = fs.createWriteStream(logPath, { flags: 'a' })

  // Write startup marker
  const startMarker = `\n--- Renderer log started at ${new Date().toISOString()} ---\n`
  logStream.write(startMarker)
}

/**
 * Map console log level number to string
 * @param {number} level - Console message level (0=verbose, 1=info, 2=warning, 3=error)
 * @returns {string} Level string
 */
function levelToString(level) {
  switch (level) {
    case 0:
      return 'VERBOSE'
    case 1:
      return 'INFO'
    case 2:
      return 'WARN'
    case 3:
      return 'ERROR'
    default:
      return 'LOG'
  }
}

/**
 * Write a log entry to the renderer log file
 * @param {number} level - Console message level
 * @param {string} message - Log message
 * @param {number} line - Source line number
 * @param {string} sourceId - Source file URL
 */
function writeLog(level, message, line, sourceId) {
  if (!logStream) {
    initLogFile()
  }

  const timestamp = new Date().toISOString()
  const levelStr = levelToString(level)

  // Extract filename from source URL
  let source = ''
  if (sourceId) {
    try {
      const url = new URL(sourceId)
      source = url.pathname.split('/').pop() || sourceId
    } catch {
      source = sourceId.split('/').pop() || sourceId
    }
    source = `:${source}:${line}`
  }

  const logLine = `[${timestamp}] [${levelStr}]${source} ${message}\n`
  logStream.write(logLine)
}

/**
 * Setup console message capture for a BrowserWindow
 * @param {BrowserWindow} window - The browser window to capture logs from
 */
export function setupRendererLogCapture(window) {
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    writeLog(level, message, line, sourceId)
  })
}

/**
 * Close the log stream (call on app quit)
 */
export function closeRendererLog() {
  if (logStream) {
    logStream.end()
    logStream = null
  }
}
