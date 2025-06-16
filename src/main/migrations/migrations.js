// Import both old and new migration systems for compatibility
import { registerMigration } from './index.js'
import { fileSystemRestructureMigration } from './v1.0.15-filesystem-restructure.js'

// New Umzug-based system
import {
  runMigrations as runUmzugMigrations,
  isMigrationNeeded as isUmzugMigrationNeeded,
  getMigrationStatus as getUmzugMigrationStatus,
  rollbackToVersion as rollbackUmzugToVersion
} from './umzug-index.js'
import { migrateToUmzug } from './umzug-compatibility.js'

/**
 * Register all available migrations (legacy system)
 * This file should be imported early in the app lifecycle
 */

// Register the file system restructure migration (legacy)
registerMigration(fileSystemRestructureMigration.version, fileSystemRestructureMigration)

// Future migrations can be registered here
// registerMigration('v1.0.16', someOtherMigration)

/**
 * Wrapper functions that use the new Umzug system
 * These maintain the same API for backward compatibility
 */

/**
 * Check if migration is needed using Umzug
 * @param {string} userDataPath - Path to app userData directory
 * @returns {Promise<boolean>} True if migration is needed
 */
export async function isMigrationNeeded(userDataPath) {
  await migrateToUmzug(userDataPath)
  return await isUmzugMigrationNeeded(userDataPath)
}

/**
 * Run all pending migrations using Umzug
 * @param {string} userDataPath - Path to app userData directory
 * @param {Object} [logger] - Optional logger object with info/error methods
 * @returns {Promise<void>}
 */
export async function runMigrations(userDataPath, logger = console) {
  await migrateToUmzug(userDataPath)
  return await runUmzugMigrations(userDataPath, logger)
}

/**
 * Get migration status using Umzug
 * @param {string} userDataPath - Path to app userData directory
 * @returns {Promise<Object>} Migration status
 */
export async function getMigrationStatus(userDataPath) {
  await migrateToUmzug(userDataPath)
  return await getUmzugMigrationStatus(userDataPath)
}

/**
 * Rollback to a specific version using Umzug
 * @param {string} userDataPath - Path to app userData directory
 * @param {string} targetVersion - Version to rollback to
 * @param {Object} [logger] - Optional logger object with info/error methods
 * @returns {Promise<void>}
 */
export async function rollbackToVersion(userDataPath, targetVersion, logger = console) {
  await migrateToUmzug(userDataPath)
  return await rollbackUmzugToVersion(userDataPath, targetVersion, logger)
}

// Legacy exports for backward compatibility
export { registerMigration }

export {
  getStudyDatabasePath,
  getStudyDirectoryPath,
  getNewStudyDatabasePath,
  studyExists,
  listAllStudies,
  deleteStudy
} from './study-path-utils.js'
