/**
 * Path utilities for study data management
 */

import { join } from 'path'

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
