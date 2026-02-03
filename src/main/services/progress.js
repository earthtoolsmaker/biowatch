/**
 * Progress broadcaster utilities for sending import progress to renderer windows
 */

import { BrowserWindow } from 'electron'

/**
 * Send GBIF import progress to all renderer windows
 * @param {Object} progressData - Progress data to send
 */
export function sendGbifImportProgress(progressData) {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('gbif-import:progress', progressData)
    }
  })
}

/**
 * Send Demo import progress to all renderer windows
 * @param {Object} progressData - Progress data to send
 */
export function sendDemoImportProgress(progressData) {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('demo-import:progress', progressData)
    }
  })
}

/**
 * Send LILA import progress to all renderer windows
 * @param {Object} progressData - Progress data to send
 */
export function sendLilaImportProgress(progressData) {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('lila-import:progress', progressData)
    }
  })
}

/**
 * Send CamtrapDP import progress to all renderer windows
 * @param {Object} progressData - Progress data to send
 */
export function sendCamtrapDPImportProgress(progressData) {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('camtrap-dp-import:progress', progressData)
    }
  })
}
