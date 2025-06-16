import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  createUmzug,
  runMigrations,
  getMigrationStatus,
  rollbackToVersion
} from '../src/main/migrations/umzug-index.js'
import { migrateToUmzug, isMigrationNeeded } from '../src/main/migrations/umzug-compatibility.js'

// Test data path - will be unique for each test
let testUserDataPath

beforeEach(() => {
  testUserDataPath = join(tmpdir(), 'biowatch-umzug-test', Date.now().toString())
  mkdirSync(testUserDataPath, { recursive: true })
})

afterEach(() => {
  // Clean up test directory
  if (existsSync(testUserDataPath)) {
    rmSync(testUserDataPath, { recursive: true, force: true })
  }
})

describe('Umzug Migration System', () => {
  test('should create Umzug instance successfully', () => {
    const umzug = createUmzug(testUserDataPath)
    assert(umzug, 'Umzug instance should be created')
  })

  test('should detect migration needed when old structure exists', async () => {
    // Create old structure with some .db files
    writeFileSync(join(testUserDataPath, 'study1.db'), 'fake db content')
    writeFileSync(join(testUserDataPath, 'study2.db'), 'fake db content')

    const needed = await isMigrationNeeded(testUserDataPath)
    assert.equal(needed, true)
  })

  test('should not detect migration needed when no db files exist', async () => {
    // This should be a fresh install - no migrations needed
    const needed = await isMigrationNeeded(testUserDataPath)
    assert.equal(needed, false)
  })

  test('should run migrations successfully', async () => {
    // Create old structure to trigger migration
    writeFileSync(join(testUserDataPath, 'study1.db'), 'fake db content')
    
    // Create a simple logger for testing
    const logs = []
    const testLogger = {
      info: (msg, ...args) => logs.push(['info', msg, ...args]),
      warn: (msg, ...args) => logs.push(['warn', msg, ...args]),
      error: (msg, ...args) => logs.push(['error', msg, ...args])
    }

    await runMigrations(testUserDataPath, testLogger)
    
    // Check that migration was logged
    const infoLogs = logs.filter(log => log[0] === 'info')
    assert(infoLogs.length > 0, 'Should have logged migration info')
  })

  test('should get migration status correctly', async () => {
    const status = await getMigrationStatus(testUserDataPath)
    
    assert(typeof status === 'object', 'Status should be an object')
    assert('currentVersion' in status, 'Should have currentVersion')
    assert('latestVersion' in status, 'Should have latestVersion')
    assert('needsMigration' in status, 'Should have needsMigration')
    assert(Array.isArray(status.executedMigrations), 'Should have executedMigrations array')
    assert(Array.isArray(status.pendingMigrations), 'Should have pendingMigrations array')
  })

  test('should migrate from old version file to Umzug storage', async () => {
    // Create old .biowatch-version file
    const oldVersionFile = join(testUserDataPath, '.biowatch-version')
    writeFileSync(oldVersionFile, 'v1.0.15', 'utf8')

    // Run migration to Umzug
    await migrateToUmzug(testUserDataPath)

    // Check that Umzug storage file was created
    const umzugStorageFile = join(testUserDataPath, '.biowatch-migrations.json')
    assert(existsSync(umzugStorageFile), 'Umzug storage file should be created')
  })

  test('should handle rollback operation', async () => {
    // First run migrations
    writeFileSync(join(testUserDataPath, 'study1.db'), 'fake db content')
    await runMigrations(testUserDataPath)

    // Get current status
    const statusBefore = await getMigrationStatus(testUserDataPath)

    if (statusBefore.executedMigrations.length > 0) {
      // Try to rollback to a non-existent migration (this should fail)
      try {
        await rollbackToVersion(testUserDataPath, 'v1.0.14')
        assert.fail('Rollback should have failed for non-existent version')
      } catch (error) {
        assert(
          error.message.includes("Couldn't find migration") ||
            error.message.includes('does not support rollback'),
          'Should get appropriate rollback error'
        )
      }
    }
  })
})
