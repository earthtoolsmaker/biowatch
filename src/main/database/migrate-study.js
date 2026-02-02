/**
 * Core study database migration logic
 *
 * This module contains the pure migration logic without Electron dependencies,
 * making it testable in a Node.js environment.
 */

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import log from '../services/logger.js'

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
