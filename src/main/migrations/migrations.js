import { registerMigration } from './index.js'
import { fileSystemRestructureMigration } from './v1.0.15-filesystem-restructure.js'

/**
 * Register all available migrations
 * This file should be imported early in the app lifecycle
 */

// Register the file system restructure migration
registerMigration(fileSystemRestructureMigration.version, fileSystemRestructureMigration)

// Future migrations can be registered here
// registerMigration('v1.0.16', someOtherMigration)

export { runMigrations, isMigrationNeeded, getMigrationStatus, rollbackToVersion } from './index.js'

export {
  getStudyDatabasePath,
  getStudyDirectoryPath,
  getNewStudyDatabasePath,
  studyExists,
  listAllStudies,
  deleteStudy
} from './study-path-utils.js'
