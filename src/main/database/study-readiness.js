/**
 * Database-version checks shared by startup, normal connections and workers.
 * No Electron dependency: inspecting an unavailable study must not open an ORM
 * connection or attempt a migration.
 */
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { getValidatedMigrationsPath } from './migrations-utils.js'
import log from '../services/logger.js'

const manifests = new Map()
const blockedDatabases = new Map()

export function getMigrationManifest(migrationsPath) {
  const path = migrationsPath || getValidatedMigrationsPath(undefined, log)
  if (!path) throw new Error('This Biowatch installation is missing its database migrations.')
  if (!manifests.has(path)) {
    const { entries } = JSON.parse(readFileSync(join(path, 'meta', '_journal.json'), 'utf8'))
    const migrations = readMigrationFiles({ migrationsFolder: path })
    if (!entries.length || migrations.length !== entries.length) {
      throw new Error('This Biowatch installation has an invalid database migration journal.')
    }
    manifests.set(path, {
      path,
      entries: entries.map((entry, index) => ({ ...entry, hash: migrations[index].hash }))
    })
  }
  return manifests.get(path)
}

export function inspectDatabaseVersion(sqlite, migrationsPath) {
  const { entries } = getMigrationManifest(migrationsPath)
  const expected = entries.at(-1)
  const tracked = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get()
  const latest = tracked
    ? sqlite
        .prepare(
          'SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1'
        )
        .get()
    : null
  const current = entries.find((entry) => entry.when === Number(latest?.created_at))
  const versions = {
    currentVersion: latest ? current?.tag || String(latest.created_at) : null,
    expectedVersion: expected.tag
  }
  if (latest && Number(latest.created_at) > expected.when) {
    return {
      ...versions,
      status: 'newer',
      message: 'This study was updated by a newer version of Biowatch. Update Biowatch to open it.'
    }
  }
  if (latest && (!current || current.hash !== latest.hash)) {
    return {
      ...versions,
      status: 'incompatible',
      message: 'This study’s migration history does not match this Biowatch installation.'
    }
  }
  return {
    ...versions,
    status: current?.when === expected.when ? 'ready' : 'outdated',
    message: current?.when === expected.when ? null : 'This study needs a database update.'
  }
}

export function databaseFailure(error, previous = {}) {
  // Drizzle errors include the entire SQL query; the underlying SQLite error is
  // more useful for support and avoids copying SQL parameters into diagnostics.
  let cause = error
  while (cause.cause) cause = cause.cause
  return (
    error.databaseStatus || {
      currentVersion: previous.currentVersion ?? null,
      expectedVersion: previous.expectedVersion ?? null,
      status: 'migration-failed',
      message: cause.message || String(cause)
    }
  )
}

export function setStudyDatabaseStatus(dbPath, status) {
  const key = resolve(dbPath)
  if (status.status === 'ready') blockedDatabases.delete(key)
  else blockedDatabases.set(key, status)
}

export function databaseNotReadyError(status) {
  const error = new Error(status.message || 'This study’s database is not ready.')
  error.name = 'StudyDatabaseNotReadyError'
  error.databaseStatus = status
  return error
}

export function assertStudyNotBlocked(dbPath) {
  const blocked = blockedDatabases.get(resolve(dbPath))
  if (blocked) throw databaseNotReadyError(blocked)
}

export function getStudyDatabaseStatus(dbPath, migrationsPath) {
  const blocked = blockedDatabases.get(resolve(dbPath))
  if (blocked) return blocked
  let sqlite
  let expectedVersion = null
  try {
    expectedVersion = getMigrationManifest(migrationsPath).entries.at(-1).tag
    sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
    return inspectDatabaseVersion(sqlite, migrationsPath)
  } catch (error) {
    return databaseFailure(error, { expectedVersion })
  } finally {
    sqlite?.close()
  }
}

export function assertStudyDatabaseReady(dbPath, migrationsPath) {
  const status = getStudyDatabaseStatus(dbPath, migrationsPath)
  if (status.status !== 'ready') throw databaseNotReadyError(status)
}
