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
} from '../../../src/main/migrations/index.js'

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

  test('should migrate study.json to database metadata', async () => {
    // Create new structure with study.json
    const studyId = 'test-study-123'
    const studyPath = join(testUserDataPath, 'biowatch-data', 'studies', studyId)
    mkdirSync(studyPath, { recursive: true })

    // Create a study.json with simple format
    const studyJson = {
      id: studyId,
      name: 'Test Study',
      importerName: 'local/speciesnet',
      createdAt: '2025-01-15T10:00:00.000Z',
      data: {
        name: 'Test Study',
        title: 'My Test Study',
        description: 'A test study for migration',
        contributors: [
          {
            title: 'John Doe',
            email: 'john@example.com',
            role: 'principalInvestigator'
          }
        ],
        temporal: {
          start: '2025-01-01',
          end: '2025-12-31'
        }
      }
    }

    const studyJsonPath = join(studyPath, 'study.json')
    writeFileSync(studyJsonPath, JSON.stringify(studyJson, null, 2))

    // Create a minimal database file
    const dbPath = join(studyPath, 'study.db')
    const Database = (await import('better-sqlite3')).default
    const db = new Database(dbPath)

    // Create metadata table
    db.exec(`
      CREATE TABLE metadata (
        id TEXT PRIMARY KEY,
        name TEXT,
        title TEXT,
        description TEXT,
        created TEXT NOT NULL,
        importerName TEXT NOT NULL,
        contributors TEXT,
        updatedAt TEXT,
        startDate TEXT,
        endDate TEXT,
        sequenceGap INTEGER
      )
    `)
    db.close()

    // Run migrations
    const logs = []
    const testLogger = {
      info: (msg, ...args) => logs.push(['info', msg, ...args]),
      warn: (msg, ...args) => logs.push(['warn', msg, ...args]),
      error: (msg, ...args) => logs.push(['error', msg, ...args])
    }

    await runMigrations(testUserDataPath, testLogger)

    // Verify study.json was deleted
    assert(!existsSync(studyJsonPath), 'study.json should be deleted after migration')

    // Verify metadata was inserted into database
    const dbAfter = new Database(dbPath)
    const metadata = dbAfter.prepare('SELECT * FROM metadata WHERE id = ?').get(studyId)
    dbAfter.close()

    assert(metadata, 'Metadata should exist in database')
    assert.strictEqual(metadata.id, studyId, 'ID should match')
    assert.strictEqual(metadata.name, 'Test Study', 'Name should match')
    assert.strictEqual(metadata.title, 'My Test Study', 'Title should match')
    assert.strictEqual(
      metadata.description,
      'A test study for migration',
      'Description should match'
    )
    assert.strictEqual(metadata.startDate, '2025-01-01', 'Start date should match')
    assert.strictEqual(metadata.endDate, '2025-12-31', 'End date should match')

    const contributors = JSON.parse(metadata.contributors)
    assert.strictEqual(
      contributors[0].email,
      'john@example.com',
      'Contributors should be preserved'
    )
  })

  test('should skip migration if study.json does not exist', async () => {
    // Create new structure without study.json
    const studyId = 'test-study-456'
    const studyPath = join(testUserDataPath, 'biowatch-data', 'studies', studyId)
    mkdirSync(studyPath, { recursive: true })

    // Create database with existing metadata
    const dbPath = join(studyPath, 'study.db')
    const Database = (await import('better-sqlite3')).default
    const db = new Database(dbPath)

    db.exec(`
      CREATE TABLE metadata (
        id TEXT PRIMARY KEY,
        name TEXT,
        title TEXT,
        description TEXT,
        created TEXT NOT NULL,
        importerName TEXT NOT NULL,
        contributors TEXT,
        updatedAt TEXT,
        startDate TEXT,
        endDate TEXT,
        sequenceGap INTEGER
      )
    `)

    db.prepare(
      `
      INSERT INTO metadata (id, name, created, importerName)
      VALUES (?, ?, ?, ?)
    `
    ).run(studyId, 'Already Migrated Study', '2025-01-01T00:00:00.000Z', 'local/images')

    db.close()

    // Run migrations
    const logs = []
    const testLogger = {
      info: (msg, ...args) => logs.push(['info', msg, ...args]),
      warn: (msg, ...args) => logs.push(['warn', msg, ...args]),
      error: (msg, ...args) => logs.push(['error', msg, ...args])
    }

    await runMigrations(testUserDataPath, testLogger)

    // Verify metadata remains unchanged
    const dbAfter = new Database(dbPath)
    const metadata = dbAfter.prepare('SELECT * FROM metadata WHERE id = ?').get(studyId)
    dbAfter.close()

    assert(metadata, 'Metadata should still exist')
    assert.strictEqual(metadata.name, 'Already Migrated Study', 'Metadata should be unchanged')
  })

  test('should migrate multiple studies with study.json files', async () => {
    const Database = (await import('better-sqlite3')).default

    // Create multiple studies with study.json files
    const studies = [
      {
        id: 'study-1',
        name: 'First Study',
        importerName: 'local/speciesnet',
        createdAt: '2025-01-10T10:00:00.000Z'
      },
      {
        id: 'study-2',
        name: 'Second Study',
        importerName: 'camtrap/datapackage',
        createdAt: '2025-01-11T10:00:00.000Z'
      },
      {
        id: 'study-3',
        name: 'Third Study',
        importerName: 'wildlife/folder',
        createdAt: '2025-01-12T10:00:00.000Z'
      }
    ]

    // Create each study with study.json and database
    for (const study of studies) {
      const studyPath = join(testUserDataPath, 'biowatch-data', 'studies', study.id)
      mkdirSync(studyPath, { recursive: true })

      // Create study.json
      const studyJson = {
        id: study.id,
        name: study.name,
        importerName: study.importerName,
        createdAt: study.createdAt,
        data: {
          name: study.name
        }
      }

      writeFileSync(join(studyPath, 'study.json'), JSON.stringify(studyJson, null, 2))

      // Create database
      const dbPath = join(studyPath, 'study.db')
      const db = new Database(dbPath)

      db.exec(`
        CREATE TABLE metadata (
          id TEXT PRIMARY KEY,
          name TEXT,
          title TEXT,
          description TEXT,
          created TEXT NOT NULL,
          importerName TEXT NOT NULL,
          contributors TEXT,
          updatedAt TEXT,
          startDate TEXT,
          endDate TEXT,
          sequenceGap INTEGER
        )
      `)
      db.close()
    }

    // Run migrations
    await runMigrations(testUserDataPath)

    // Verify all studies were migrated
    for (const study of studies) {
      const studyPath = join(testUserDataPath, 'biowatch-data', 'studies', study.id)
      const studyJsonPath = join(studyPath, 'study.json')
      const dbPath = join(studyPath, 'study.db')

      // Verify study.json was deleted
      assert(!existsSync(studyJsonPath), `study.json should be deleted for ${study.id}`)

      // Verify metadata was inserted
      const db = new Database(dbPath)
      const metadata = db.prepare('SELECT * FROM metadata WHERE id = ?').get(study.id)
      db.close()

      assert(metadata, `Metadata should exist for ${study.id}`)
      assert.strictEqual(metadata.name, study.name, `Name should match for ${study.id}`)
      assert.strictEqual(
        metadata.importerName,
        study.importerName,
        `ImporterName should match for ${study.id}`
      )
    }
  })
})
