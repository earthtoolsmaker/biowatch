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
} from '../src/main/migrations/index.js'

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

  test('should move study to new location', async () => {
    // Create old structure to trigger migration
    const oldDbPath = join(testUserDataPath, 'study1.db')
    const testContent = 'fake db content with specific data'
    writeFileSync(oldDbPath, testContent)

    // Create a simple logger for testing
    const logs = []
    const testLogger = {
      info: (msg, ...args) => logs.push(['info', msg, ...args]),
      warn: (msg, ...args) => logs.push(['warn', msg, ...args]),
      error: (msg, ...args) => logs.push(['error', msg, ...args])
    }

    await runMigrations(testUserDataPath, testLogger)

    // Verify the study database has been moved to the correct location
    const newDbPath = join(testUserDataPath, 'biowatch-data', 'studies', 'study1', 'study.db')
    assert(existsSync(newDbPath), 'Study database should exist in new location')

    // Verify the old database file no longer exists
    assert(!existsSync(oldDbPath), 'Old study database should no longer exist')

    // Verify the biowatch-data directory structure was created
    const biowatchDataPath = join(testUserDataPath, 'biowatch-data')
    const studiesPath = join(biowatchDataPath, 'studies')
    assert(existsSync(biowatchDataPath), 'biowatch-data directory should exist')
    assert(existsSync(studiesPath), 'studies directory should exist')

    // Verify the file content is preserved
    const { readFileSync } = await import('fs')
    const newContent = readFileSync(newDbPath, 'utf8')
    assert.strictEqual(newContent, testContent, 'File content should be preserved during migration')
  })

  test('should move model-zoo and python-environments to correct location', async () => {
    // Create old structure with model-zoo and python-environments
    const oldModelZooPath = join(testUserDataPath, 'model-zoo')
    const oldPythonEnvPath = join(testUserDataPath, 'python-environments')

    mkdirSync(oldModelZooPath, { recursive: true })
    mkdirSync(oldPythonEnvPath, { recursive: true })

    // Add some test files to verify content is preserved
    writeFileSync(join(oldModelZooPath, 'test-model.json'), '{"model": "test"}')
    writeFileSync(join(oldPythonEnvPath, 'env-config.txt'), 'python environment config')

    // Create a simple logger for testing
    const logs = []
    const testLogger = {
      info: (msg, ...args) => logs.push(['info', msg, ...args]),
      warn: (msg, ...args) => logs.push(['warn', msg, ...args]),
      error: (msg, ...args) => logs.push(['error', msg, ...args])
    }

    await runMigrations(testUserDataPath, testLogger)

    // Verify directories were moved to correct locations
    const newModelZooPath = join(testUserDataPath, 'biowatch-data', 'model-zoo')
    const newPythonEnvPath = join(testUserDataPath, 'biowatch-data', 'python-environments')

    assert(existsSync(newModelZooPath), 'model-zoo should exist in new location')
    assert(existsSync(newPythonEnvPath), 'python-environments should exist in new location')

    // Verify old directories no longer exist
    assert(!existsSync(oldModelZooPath), 'Old model-zoo directory should no longer exist')
    assert(
      !existsSync(oldPythonEnvPath),
      'Old python-environments directory should no longer exist'
    )

    // Verify content is preserved
    const { readFileSync } = await import('fs')
    const modelContent = readFileSync(join(newModelZooPath, 'test-model.json'), 'utf8')
    const envContent = readFileSync(join(newPythonEnvPath, 'env-config.txt'), 'utf8')

    assert.strictEqual(modelContent, '{"model": "test"}', 'model-zoo content should be preserved')
    assert.strictEqual(
      envContent,
      'python environment config',
      'python-environments content should be preserved'
    )
  })

  test('should get migration status correctly', async () => {
    const status = await getMigrationStatus(testUserDataPath)

    console.log('Migration Status:', status)

    assert(typeof status === 'object', 'Status should be an object')
    assert('currentVersion' in status, 'Should have currentVersion')
    assert('latestVersion' in status, 'Should have latestVersion')
    assert('needsMigration' in status, 'Should have needsMigration')
    assert(Array.isArray(status.executedMigrations), 'Should have executedMigrations array')
    assert(Array.isArray(status.pendingMigrations), 'Should have pendingMigrations array')
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
