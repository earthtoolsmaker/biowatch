/**
 * Study database migrations service
 *
 * Runs Drizzle migrations for all study databases at app startup.
 * Successful databases become available before normal connections are opened.
 * Failures stay discoverable but are blocked from normal study queries.
 */

import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import log from './logger.js'
import { getStudiesPath } from './study.js'
import { getValidatedMigrationsPath } from '../database/migrations-utils.js'
import { migrateStudyDatabase } from '../database/migrate-study.js'
import { closeStudyDatabase } from '../database/manager.js'
import {
  databaseFailure,
  getStudyDatabaseStatus,
  setStudyDatabaseStatus
} from '../database/study-readiness.js'

const retries = new Map()

/** Retry only this unavailable study, keeping normal access blocked throughout. */
export async function retryStudyDatabaseMigration(studyId) {
  if (retries.has(studyId)) return retries.get(studyId)
  const study = enumerateStudyDatabases().find((entry) => entry.studyId === studyId)
  if (!study) throw new Error('Study database not found.')
  const previous = getStudyDatabaseStatus(study.dbPath)
  if (
    previous.status === 'ready' ||
    previous.status === 'newer' ||
    previous.status === 'incompatible'
  ) {
    return previous
  }
  setStudyDatabaseStatus(study.dbPath, {
    ...previous,
    status: 'updating',
    message: 'This study’s database is being updated.'
  })
  const retry = (async () => {
    try {
      await closeStudyDatabase(studyId)
      const result = await migrateStudyDatabase(
        studyId,
        study.dbPath,
        getValidatedMigrationsPath(undefined, log)
      )
      return result.database
    } catch (error) {
      const database = databaseFailure(error, previous)
      setStudyDatabaseStatus(study.dbPath, database)
      return database
    }
  })()
  retries.set(studyId, retry)
  try {
    return await retry
  } finally {
    retries.delete(studyId)
  }
}

// Re-export for convenience
export { migrateStudyDatabase }

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
    log.error('[StudyMigrations] No valid migrations path found, blocking affected studies')
    for (const { dbPath } of databases) {
      setStudyDatabaseStatus(dbPath, databaseFailure(new Error('No valid migrations path found')))
    }
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
