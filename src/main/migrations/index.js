import { Umzug, JSONStorage } from 'umzug'
import { join } from 'path'
import { fileSystemRestructureMigration } from './v1.0.15-filesystem-restructure.js'

/**
 * Create and configure Umzug instance for managing migrations
 * @param {string} userDataPath - Path to app userData directory
 * @param {Object} [logger] - Optional logger object with info/error methods
 * @returns {Umzug} Configured Umzug instance
 */
export function createUmzug(userDataPath, logger = console) {
  const umzug = new Umzug({
    migrations: [
      {
        name: fileSystemRestructureMigration.version,
        async up({ context }) {
          const { userDataPath } = context
          await fileSystemRestructureMigration.up(userDataPath)
        },
        async down({ context }) {
          const { userDataPath } = context
          if (fileSystemRestructureMigration.down) {
            await fileSystemRestructureMigration.down(userDataPath)
          } else {
            throw new Error(
              `Migration ${fileSystemRestructureMigration.version} does not support rollback`
            )
          }
        }
      }
    ],
    context: { userDataPath },
    storage: new JSONStorage({
      path: join(userDataPath, '.biowatch-migrations.json')
    }),
    logger: {
      info: (params) => logger.info(`[Migration] ${params.event}`, params.name),
      warn: (params) => logger.warn(`[Migration] ${params.event}`, params.name),
      error: (params) => logger.error(`[Migration] ${params.event}`, params.name, params.error)
    }
  })

  return umzug
}

/**
 * Check if migration is needed by comparing current state with available migrations
 * @param {string} userDataPath - Path to app userData directory
 * @returns {Promise<boolean>} True if migration is needed
 */
export async function isMigrationNeeded(userDataPath) {
  const umzug = createUmzug(userDataPath)
  const pending = await umzug.pending()
  return pending.length > 0
}

/**
 * Run all pending migrations
 * @param {string} userDataPath - Path to app userData directory
 * @param {Object} [logger] - Optional logger object with info/error methods
 * @returns {Promise<void>}
 */
export async function runMigrations(userDataPath, logger = console) {
  const umzug = createUmzug(userDataPath, logger)

  try {
    logger.info('Starting migrations...')
    const migrations = await umzug.up()

    if (migrations.length === 0) {
      logger.info('No pending migrations found')
    } else {
      logger.info(
        `Successfully executed ${migrations.length} migration(s):`,
        migrations.map((m) => m.name).join(', ')
      )
    }
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
  const umzug = createUmzug(userDataPath, logger)

  try {
    logger.info(`Rolling back to version: ${targetVersion}`)
    await umzug.down({ to: targetVersion })
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
  const umzug = createUmzug(userDataPath)

  const executed = await umzug.executed()
  const pending = await umzug.pending()

  const currentVersion = executed.length > 0 ? executed[executed.length - 1].name : null
  const latestVersion = [...executed, ...pending].pop()?.name || null

  return {
    currentVersion,
    latestVersion,
    needsMigration: pending.length > 0,
    executedMigrations: executed.map((m) => m.name),
    pendingMigrations: pending.map((m) => m.name)
  }
}

export default {
  createUmzug,
  runMigrations,
  rollbackToVersion,
  getMigrationStatus
}
