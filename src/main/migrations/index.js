import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'

// Migration registry
const migrations = new Map()

/**
 * Register a migration
 * @param {string} version - Version identifier (e.g., 'v0.0.15')
 * @param {Object} migration - Migration object with up, down functions and description
 */
export function registerMigration(version, migration) {
  migrations.set(version, migration)
}

/**
 * Get the current migration version from the app data directory
 * @param {string} userDataPath - Path to app userData directory
 * @returns {Promise<string|null>} Current version or null if not set
 */
async function getCurrentVersion(userDataPath) {
  const versionFile = join(userDataPath, '.biowatch-version')

  try {
    const version = readFileSync(versionFile, 'utf8').trim()
    return version
  } catch {
    // File doesn't exist or can't be read - assume fresh install
    return null
  }
}

/**
 * Set the current migration version
 * @param {string} userDataPath - Path to app userData directory
 * @param {string} version - Version to set
 */
async function setCurrentVersion(userDataPath, version) {
  const versionFile = join(userDataPath, '.biowatch-version')
  writeFileSync(versionFile, version, 'utf8')
}

/**
 * Check if migration is needed by comparing versions
 * @param {string} userDataPath - Path to app userData directory
 * @returns {Promise<boolean>} True if migration is needed
 */
export async function isMigrationNeeded(userDataPath) {
  const currentVersion = await getCurrentVersion(userDataPath)

  // If no version file exists, check if old structure exists
  if (!currentVersion) {
    // Look for any .db files in the root of userData
    try {
      const files = readdirSync(userDataPath)
      const dbFiles = files.filter((file) => file.endsWith('.db'))
      return dbFiles.length > 0
    } catch {
      return false
    }
  }

  // Compare with latest migration version
  const latestVersion = getLatestMigrationVersion()
  return currentVersion !== latestVersion
}

/**
 * Get the latest migration version available
 * @returns {string} Latest version
 */
function getLatestMigrationVersion() {
  const versions = Array.from(migrations.keys())
  // Sort versions to get the latest (assuming semantic versioning)
  return versions.sort().pop() || 'v1.0.0'
}

/**
 * Run all pending migrations
 * @param {string} userDataPath - Path to app userData directory
 * @param {Object} [logger] - Optional logger object with info/error methods
 * @returns {Promise<void>}
 */
export async function runMigrations(userDataPath, logger = console) {
  const currentVersion = await getCurrentVersion(userDataPath)

  logger.info(`Starting migrations from version: ${currentVersion || 'none'}`)

  try {
    // If no current version, run all migrations
    if (!currentVersion) {
      for (const [version, migration] of migrations.entries()) {
        logger.info(`Running migration ${version}: ${migration.description}`)
        await migration.up(userDataPath)
        await setCurrentVersion(userDataPath, version)
        logger.info(`Completed migration ${version}`)
      }
    } else {
      // Run only migrations newer than current version
      const versions = Array.from(migrations.keys()).sort()
      const currentIndex = versions.indexOf(currentVersion)
      const pendingVersions = versions.slice(currentIndex + 1)

      for (const version of pendingVersions) {
        const migration = migrations.get(version)
        logger.info(`Running migration ${version}: ${migration.description}`)
        await migration.up(userDataPath)
        await setCurrentVersion(userDataPath, version)
        logger.info(`Completed migration ${version}`)
      }
    }

    logger.info('All migrations completed successfully')
  } catch (error) {
    logger.error('Migration failed:', error)
    throw error
  }
}

/**
 * Rollback to a specific version
 * @param {string} userDataPath - Path to app userData directory
 * @param {string} targetVersion - Version to rollback to
 * @param {Object} [logger] - Optional logger object with info/error methods
 * @returns {Promise<void>}
 */
export async function rollbackToVersion(userDataPath, targetVersion, logger = console) {
  const currentVersion = await getCurrentVersion(userDataPath)

  if (!currentVersion) {
    throw new Error('No current version found, cannot rollback')
  }

  logger.info(`Rolling back from ${currentVersion} to ${targetVersion}`)

  try {
    const versions = Array.from(migrations.keys()).sort().reverse()
    const currentIndex = versions.indexOf(currentVersion)
    const targetIndex = versions.indexOf(targetVersion)

    if (targetIndex === -1) {
      throw new Error(`Target version ${targetVersion} not found`)
    }

    if (currentIndex === -1) {
      throw new Error(`Current version ${currentVersion} not found`)
    }

    // Run down migrations in reverse order
    for (let i = currentIndex; i > targetIndex; i--) {
      const version = versions[i]
      const migration = migrations.get(version)

      if (!migration.down) {
        throw new Error(`Migration ${version} does not support rollback`)
      }

      logger.info(`Rolling back migration ${version}`)
      await migration.down(userDataPath)
    }

    await setCurrentVersion(userDataPath, targetVersion)
    logger.info(`Rollback to ${targetVersion} completed successfully`)
  } catch (error) {
    logger.error('Rollback failed:', error)
    throw error
  }
}

/**
 * Get migration status information
 * @param {string} userDataPath - Path to app userData directory
 * @returns {Promise<Object>} Migration status
 */
export async function getMigrationStatus(userDataPath) {
  const currentVersion = await getCurrentVersion(userDataPath)
  const latestVersion = getLatestMigrationVersion()
  const needsMigration = await isMigrationNeeded(userDataPath)

  return {
    currentVersion,
    latestVersion,
    needsMigration,
    availableMigrations: Array.from(migrations.keys()).sort()
  }
}
