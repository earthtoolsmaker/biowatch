/**
 * Study database migrations service
 *
 * Runs Drizzle migrations for all study databases at app startup.
 * This ensures all databases are up-to-date before any readonly connections
 * are opened (e.g., when listing studies).
 */

import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { getStudiesPath } from './study.js'
import { getValidatedMigrationsPath } from '../database/migrations-utils.js'

/**
 * Enumerate all study databases in the studies directory
 * @returns {Array<{studyId: string, dbPath: string}>} Array of study database info
 */
export function enumerateStudyDatabases() {
  const studiesPath = getStudiesPath()

  if (!existsSync(studiesPath)) {
    log.info('[StudyMigrations] Studies directory does not exist, no databases to migrate')
    return []
  }

  const studyDirs = readdirSync(studiesPath, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)

  const databases = []

  for (const studyId of studyDirs) {
    const dbPath = join(studiesPath, studyId, 'study.db')
    if (existsSync(dbPath)) {
      databases.push({ studyId, dbPath })
    }
  }

  log.info(`[StudyMigrations] Found ${databases.length} study database(s) to check`)
  return databases
}

/**
 * Run Drizzle migrations on a single study database
 * Opens a temporary read-write connection, runs migrations, then closes it.
 *
 * @param {string} studyId - The study identifier
 * @param {string} dbPath - Path to the study database file
 * @param {string} migrationsPath - Path to the migrations folder
 * @returns {Promise<{success: boolean, error?: Error}>} Migration result
 */
export async function migrateStudyDatabase(studyId, dbPath, migrationsPath) {
  let sqlite = null

  try {
    // Open a temporary read-write connection for migrations
    sqlite = new Database(dbPath)

    // Enable WAL mode and foreign keys
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('journal_mode = WAL')

    // Create Drizzle instance without schema (just for migrations)
    const db = drizzle(sqlite)

    // Run migrations - this is idempotent (checks __drizzle_migrations table)
    await migrate(db, { migrationsFolder: migrationsPath })

    log.info(`[StudyMigrations] Successfully migrated study ${studyId}`)
    return { success: true }
  } catch (error) {
    // Handle case where tables already exist (can happen with older databases)
    if (error.message.includes('already exists') || error.message.includes('CREATE TABLE')) {
      log.info(`[StudyMigrations] Study ${studyId} tables already exist, skipping`)
      return { success: true }
    }

    log.error(`[StudyMigrations] Failed to migrate study ${studyId}:`, error)
    return { success: false, error }
  } finally {
    // Always close the temporary connection
    if (sqlite) {
      try {
        sqlite.close()
      } catch (closeError) {
        log.warn(`[StudyMigrations] Error closing database for study ${studyId}:`, closeError)
      }
    }
  }
}

/**
 * Migrate all study databases at startup
 * Runs migrations sequentially to avoid potential resource issues.
 *
 * @returns {Promise<{total: number, succeeded: number, failed: Array<{studyId: string, error: Error}>}>}
 */
export async function migrateAllStudyDatabases() {
  const databases = enumerateStudyDatabases()

  if (databases.length === 0) {
    return { total: 0, succeeded: 0, failed: [] }
  }

  // Get validated migrations path once for all databases
  const migrationsPath = getValidatedMigrationsPath(undefined, log)

  if (!migrationsPath) {
    log.error('[StudyMigrations] No valid migrations path found, skipping all study migrations')
    return {
      total: databases.length,
      succeeded: 0,
      failed: databases.map(({ studyId }) => ({
        studyId,
        error: new Error('No valid migrations path found')
      }))
    }
  }

  log.info(`[StudyMigrations] Running migrations for ${databases.length} study database(s)`)

  const failed = []
  let succeeded = 0

  // Run migrations sequentially (safer at startup, avoids resource contention)
  for (const { studyId, dbPath } of databases) {
    const result = await migrateStudyDatabase(studyId, dbPath, migrationsPath)

    if (result.success) {
      succeeded++
    } else {
      failed.push({ studyId, error: result.error })
    }
  }

  return {
    total: databases.length,
    succeeded,
    failed
  }
}
