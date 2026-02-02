import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

import { getMigrationsPath } from '../../../src/main/database/migrations-utils.js'
import { migrateStudyDatabase } from '../../../src/main/database/migrate-study.js'

let testRootPath
let testStudiesPath

beforeEach(async () => {
  // Silence electron-log in tests
  try {
    const electronLog = await import('electron-log')
    const log = electronLog.default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // electron-log not available in test environment
  }

  testRootPath = join(tmpdir(), 'biowatch-study-migrations-test', Date.now().toString())
  testStudiesPath = join(testRootPath, 'biowatch-data', 'studies')
  mkdirSync(testStudiesPath, { recursive: true })
})

afterEach(async () => {
  if (existsSync(testRootPath)) {
    rmSync(testRootPath, { recursive: true, force: true })
  }
})

describe('Study database migrations at startup', () => {
  test('migrateStudyDatabase should run migrations on empty database', async () => {
    const studyId = 'test-migration-study'
    const studyPath = join(testStudiesPath, studyId)
    mkdirSync(studyPath, { recursive: true })

    const dbPath = join(studyPath, 'study.db')

    // Create an empty database file
    const sqlite = new Database(dbPath)
    sqlite.close()

    // Get the migrations path
    const migrationsPath = getMigrationsPath('development')

    // Run migrations
    const result = await migrateStudyDatabase(studyId, dbPath, migrationsPath)

    assert.equal(result.success, true, 'Migration should succeed')

    // Verify migrations created the expected tables
    const dbAfter = new Database(dbPath, { readonly: true })

    // Check that metadata table exists (created by migrations)
    const metadataTable = dbAfter
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'")
      .all()

    assert.equal(metadataTable.length, 1, 'metadata table should exist after migrations')

    // Check that __drizzle_migrations table exists (migration tracking)
    const drizzleTable = dbAfter
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
      .all()

    assert.equal(drizzleTable.length, 1, '__drizzle_migrations table should exist')

    dbAfter.close()
  })

  test('migrateStudyDatabase should be idempotent', async () => {
    const studyId = 'test-idempotent-study'
    const studyPath = join(testStudiesPath, studyId)
    mkdirSync(studyPath, { recursive: true })

    const dbPath = join(studyPath, 'study.db')

    // Create an empty database file
    const sqlite = new Database(dbPath)
    sqlite.close()

    const migrationsPath = getMigrationsPath('development')

    // Run migrations twice
    const result1 = await migrateStudyDatabase(studyId, dbPath, migrationsPath)
    const result2 = await migrateStudyDatabase(studyId, dbPath, migrationsPath)

    assert.equal(result1.success, true, 'First migration should succeed')
    assert.equal(result2.success, true, 'Second migration should also succeed (idempotent)')

    // Verify the database is still valid
    const dbAfter = new Database(dbPath, { readonly: true })
    const tables = dbAfter.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()

    assert(tables.length > 0, 'Database should have tables')
    dbAfter.close()
  })

  test('migrateStudyDatabase should handle already existing tables gracefully', async () => {
    const studyId = 'test-existing-tables'
    const studyPath = join(testStudiesPath, studyId)
    mkdirSync(studyPath, { recursive: true })

    const dbPath = join(studyPath, 'study.db')

    // Create database with an existing table that might conflict
    const sqlite = new Database(dbPath)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at INTEGER
      )
    `)
    sqlite.close()

    const migrationsPath = getMigrationsPath('development')

    // Should not throw even with existing migration table
    const result = await migrateStudyDatabase(studyId, dbPath, migrationsPath)

    assert.equal(result.success, true, 'Migration should succeed with existing tables')
  })

  test('should run migrations before readonly connection works', async () => {
    const studyId = `test-readonly-${Date.now()}`
    const studyPath = join(testStudiesPath, studyId)
    mkdirSync(studyPath, { recursive: true })

    const dbPath = join(studyPath, 'study.db')

    // Create an empty database file (simulates pre-migration state)
    const sqlite = new Database(dbPath)
    sqlite.close()

    const migrationsPath = getMigrationsPath('development')

    // Run migrations (simulating what happens at startup)
    const result = await migrateStudyDatabase(studyId, dbPath, migrationsPath)
    assert.equal(result.success, true, 'Migration should succeed')

    // Now open as readonly - this should work because migrations already ran
    const readonlyDb = new Database(dbPath, { readonly: true })

    // Query should work without errors
    const metadata = readonlyDb.prepare('SELECT * FROM metadata').all()

    assert(Array.isArray(metadata), 'Should be able to query metadata table')
    assert.equal(metadata.length, 0, 'Metadata should be empty initially')

    readonlyDb.close()
  })
})
