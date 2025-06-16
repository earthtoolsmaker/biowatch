import './migrations.js' // This registers all migrations
import {
  runMigrations,
  isMigrationNeeded,
  getMigrationStatus,
  rollbackToVersion
} from './index.js'
import {
  getStudyDatabasePath,
  getNewStudyDatabasePath,
  listAllStudies
} from './study-path-utils.js'

/**
 * Example usage of the migration system
 * This would typically be called early in your app startup
 */

async function exampleUsage() {
  // In a real Electron app, you would get this from app.getPath('userData')
  const userDataPath = '/path/to/your/app/userData'

  try {
    // Check if migration is needed
    const needsMigration = await isMigrationNeeded(userDataPath)

    if (needsMigration) {
      console.log('Migration needed, running migrations...')

      // Get status before migration
      const statusBefore = await getMigrationStatus(userDataPath)
      console.log('Status before migration:', statusBefore)

      // Run migrations
      await runMigrations(userDataPath)

      // Get status after migration
      const statusAfter = await getMigrationStatus(userDataPath)
      console.log('Status after migration:', statusAfter)

      console.log('Migrations completed successfully!')
    } else {
      console.log('No migration needed')
    }

    // Example of using path utilities
    const studyId = 'example-study-123'

    // Get current database path (checks both old and new structure)
    const currentPath = getStudyDatabasePath(userDataPath, studyId)
    console.log(`Current database path for ${studyId}:`, currentPath)

    // Get new database path (always uses new structure)
    const newPath = getNewStudyDatabasePath(userDataPath, studyId)
    console.log(`New database path for ${studyId}:`, newPath)

    // List all studies
    const allStudies = listAllStudies(userDataPath)
    console.log('All studies:', allStudies)

  } catch (error) {
    console.error('Migration failed:', error)
  }
}

// Example rollback usage
async function exampleRollback() {
  const userDataPath = '/path/to/your/app/userData'

  try {
    // Rollback to a previous version
    await rollbackToVersion(userDataPath, 'v1.0.0')
    console.log('Rollback completed successfully!')
  } catch (error) {
    console.error('Rollback failed:', error)
  }
}

// Integration example for Electron main process
export async function initializeMigrationsInElectron(app) {
  const userDataPath = app.getPath('userData')

  try {
    const needsMigration = await isMigrationNeeded(userDataPath)

    if (needsMigration) {
      console.log('Running migrations...')
      await runMigrations(userDataPath)
    }

    return true
  } catch (error) {
    console.error('Migration initialization failed:', error)
    throw error
  }
}

export { exampleUsage, exampleRollback }

    // This will work with both old and new structures
    const existingDbPath = getStudyDatabasePath(studyId)
    if (existingDbPath) {
      console.log(`Found existing study at: ${existingDbPath}`)
    } else {
      console.log('Study not found')
    }

    // This will always use the new structure for new databases
    const newDbPath = getNewStudyDatabasePath(studyId)
    console.log(`New database would be created at: ${newDbPath}`)
  } catch (error) {
    console.error('Migration failed:', error)
    throw error
  }
}

// Example of app startup integration
export async function initializeApp() {
  // Run migrations before app starts
  const needsMigration = await isMigrationNeeded()

  if (needsMigration) {
    // You might want to show a loading dialog here
    console.log('Updating database structure...')
    await runMigrations()
    console.log('Database update complete')
  }

  // Continue with normal app initialization
  console.log('App ready to start')
}

// You can also use individual functions
export function getDatabasePathForStudy(studyId) {
  // This automatically handles both old and new structures
  return getStudyDatabasePath(studyId)
}

// For creating new studies, always use the new structure
export function createNewStudy(studyId) {
  const dbPath = getNewStudyDatabasePath(studyId)
  // Create your database at this path
  return dbPath
}

// Example usage (uncomment to test)
// exampleUsage().catch(console.error)
