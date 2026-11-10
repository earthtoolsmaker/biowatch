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
import { registerCameraTimeFunctions } from '../services/cameraTime.js'
import {
  databaseFailure,
  databaseNotReadyError,
  getMigrationManifest,
  inspectDatabaseVersion,
  setStudyDatabaseStatus
} from './study-readiness.js'

/** Migrate and verify an existing connection, without hiding SQL failures. */
export function migrateStudyConnection(sqlite, migrationsPath) {
  let status
  try {
    const manifest = getMigrationManifest(migrationsPath)
    status = { currentVersion: null, expectedVersion: manifest.entries.at(-1).tag }
    status = inspectDatabaseVersion(sqlite, manifest.path)
    if (status.status === 'newer' || status.status === 'incompatible') {
      throw databaseNotReadyError(status)
    }
    registerCameraTimeFunctions(sqlite)
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('journal_mode = WAL')
    migrate(drizzle(sqlite), { migrationsFolder: manifest.path })
    status = inspectDatabaseVersion(sqlite, manifest.path)
    if (status.status !== 'ready') throw databaseNotReadyError(status)
    return status
  } catch (error) {
    throw databaseNotReadyError(databaseFailure(error, status))
  }
}

/**
 * Run Drizzle migrations on a single study database
 * Opens a temporary read-write connection, runs migrations, then closes it.
 *
 * @param {string} studyId - The study identifier
 * @param {string} dbPath - Path to the study database file
 * @param {string} migrationsPath - Path to the migrations folder
 * @returns {Promise<{success: boolean, database: Object, error?: Error}>} Migration result
 */
export async function migrateStudyDatabase(studyId, dbPath, migrationsPath) {
  let sqlite = null
  let previous

  try {
    previous = { expectedVersion: getMigrationManifest(migrationsPath).entries.at(-1).tag }
    // Open a temporary read-write connection for migrations
    sqlite = new Database(dbPath, { fileMustExist: true })
    const database = migrateStudyConnection(sqlite, migrationsPath)
    setStudyDatabaseStatus(dbPath, database)

    log.info(`[StudyMigrations] Successfully migrated study ${studyId}`)
    return { success: true, database }
  } catch (error) {
    const database = databaseFailure(error, previous)
    setStudyDatabaseStatus(dbPath, database)
    log.error(`[StudyMigrations] Failed to migrate study ${studyId}:`, error)
    return { success: false, error, database }
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
