/**
 * Path utilities for study data management
 */

import { join } from 'path'

// Lazily cached app reference for Electron context
let _app = null

function getApp() {
  if (_app) return _app
  try {
    _app = require('electron').app
  } catch {
    _app = { getPath: () => '/tmp' }
  }
  return _app
}

/**
 * Get the biowatch data directory path
 * Uses Electron's app.getPath('userData') in production, '/tmp' in tests
 * @returns {string} Path to biowatch-data directory
 */
export function getBiowatchDataPath() {
  return join(getApp().getPath('userData'), 'biowatch-data')
}

/**
 * Get the path to a study's database file
 * @param {string} userDataPath - The user data directory path
 * @param {string} studyId - The study ID
 * @returns {string} Path to the study database file
 */
export function getStudyDatabasePath(userDataPath, studyId) {
  return join(getStudyPath(userDataPath, studyId), 'study.db')
}

/**
 * Get the path to a study's directory
 * @param {string} userDataPath - The user data directory path
 * @param {string} studyId - The study ID
 * @returns {string} Path to the study directory
 */
export function getStudyPath(userDataPath, studyId) {
  return join(userDataPath, 'biowatch-data', 'studies', studyId)
}
