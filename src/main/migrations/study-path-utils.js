import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'fs'
import { join } from 'path'

/**
 * Utility functions for working with study database paths across migration versions
 */

/**
 * Get the database path for a study, checking both old and new locations
 * @param {string} userDataPath - Path to app userData directory
 * @param {string} studyId - The study identifier
 * @returns {string|null} Path to the database file, or null if not found
 */
export function getStudyDatabasePath(userDataPath, studyId) {
  // Try new structure first
  const newPath = join(userDataPath, 'biowatch-data', 'studies', studyId, 'study.db')
  if (existsSync(newPath)) {
    return newPath
  }

  // Fall back to old structure
  const oldPath = join(userDataPath, `${studyId}.db`)
  if (existsSync(oldPath)) {
    return oldPath
  }

  return null
}

/**
 * Get the directory path for a study (where additional files can be stored)
 * @param {string} userDataPath - Path to app userData directory
 * @param {string} studyId - The study identifier
 * @returns {string} Path to the study directory (creates if needed in new structure)
 */
export function getStudyDirectoryPath(userDataPath, studyId) {
  // Always use new structure for directory path
  const studyDir = join(userDataPath, 'biowatch-data', 'studies', studyId)

  // Create directory if it doesn't exist
  if (!existsSync(studyDir)) {
    mkdirSync(studyDir, { recursive: true })
  }

  return studyDir
}

/**
 * Get the path where a new database should be created
 * @param {string} userDataPath - Path to app userData directory
 * @param {string} studyId - The study identifier
 * @returns {string} Path for new database file
 */
export function getNewStudyDatabasePath(userDataPath, studyId) {
  const studyDir = getStudyDirectoryPath(userDataPath, studyId)
  return join(studyDir, 'study.db')
}

/**
 * Check if a study exists (in either old or new structure)
 * @param {string} userDataPath - Path to app userData directory
 * @param {string} studyId - The study identifier
 * @returns {boolean} True if study database exists
 */
export function studyExists(userDataPath, studyId) {
  return getStudyDatabasePath(userDataPath, studyId) !== null
}

/**
 * List all available studies from both old and new structures
 * @param {string} userDataPath - Path to app userData directory
 * @returns {Array<string>} Array of study IDs
 */
export function listAllStudies(userDataPath) {
  const studies = new Set()

  try {
    // Check new structure
    const newStudiesPath = join(userDataPath, 'biowatch-data', 'studies')
    if (existsSync(newStudiesPath)) {
      const dirs = readdirSync(newStudiesPath)
      for (const dir of dirs) {
        const studyDbPath = join(newStudiesPath, dir, 'study.db')
        if (existsSync(studyDbPath)) {
          studies.add(dir)
        }
      }
    }

    // Check old structure (flat .db files in userData root)
    const files = readdirSync(userDataPath)
    for (const file of files) {
      if (file.endsWith('.db') && !file.startsWith('.')) {
        const studyId = file.replace('.db', '')
        studies.add(studyId)
      }
    }
  } catch (error) {
    // Directory might not exist or not readable
    console.warn('Error listing studies:', error.message)
  }

  return Array.from(studies).sort()
}

/**
 * Delete a study completely (removes database and any additional files)
 * @param {string} userDataPath - Path to app userData directory
 * @param {string} studyId - The study identifier
 * @returns {boolean} True if study was found and deleted
 */
export function deleteStudy(userDataPath, studyId) {
  let deleted = false

  // Try new structure first
  const newStudyDir = join(userDataPath, 'biowatch-data', 'studies', studyId)
  if (existsSync(newStudyDir)) {
    try {
      // Remove all files in the study directory
      const files = readdirSync(newStudyDir)
      for (const file of files) {
        unlinkSync(join(newStudyDir, file))
      }
      // Remove the directory itself (should be empty now)
      rmSync(newStudyDir, { recursive: true })
      deleted = true
    } catch (error) {
      console.warn(`Error deleting new structure study ${studyId}:`, error.message)
    }
  }

  // Try old structure
  const oldPath = join(userDataPath, `${studyId}.db`)
  if (existsSync(oldPath)) {
    try {
      unlinkSync(oldPath)
      deleted = true
    } catch (error) {
      console.warn(`Error deleting old structure study ${studyId}:`, error.message)
    }
  }

  return deleted
}

/**
 * Check if the filesystem has been migrated to the new structure
 * @param {string} userDataPath - Path to app userData directory
 * @returns {boolean} True if migration appears complete
 */
export function isFileSystemMigrated(userDataPath) {
  const newStructurePath = join(userDataPath, 'biowatch-data', 'studies')
  const hasNewStructure = existsSync(newStructurePath)

  // Check for old .db files in root
  try {
    const files = readdirSync(userDataPath)
    const hasOldDbFiles = files.some((file) => file.endsWith('.db') && !file.startsWith('.'))

    // Check for old model-zoo and python-environments directories
    const hasOldModelZoo = existsSync(join(userDataPath, 'model-zoo'))
    const hasOldPythonEnv = existsSync(join(userDataPath, 'python-environments'))

    // Migration is complete if we have new structure and no old files/directories
    return hasNewStructure && !hasOldDbFiles && !hasOldModelZoo && !hasOldPythonEnv
  } catch {
    return false
  }
}
