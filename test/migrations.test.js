import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  registerMigration,
  isMigrationNeeded,
  runMigrations,
  getMigrationStatus
} from '../src/main/migrations/index.js'
import { fileSystemRestructureMigration } from '../src/main/migrations/v1.0.15-filesystem-restructure.js'
import {
  getStudyDatabasePath,
  getNewStudyDatabasePath,
  studyExists,
  listAllStudies,
  deleteStudy,
  isFileSystemMigrated
} from '../src/main/migrations/study-path-utils.js'

// Test data path - will be unique for each test
let testUserDataPath

beforeEach(() => {
  testUserDataPath = join(tmpdir(), 'biowatch-test', Date.now().toString())
  mkdirSync(testUserDataPath, { recursive: true })
})

afterEach(() => {
  // Clean up test directory
  if (existsSync(testUserDataPath)) {
    rmSync(testUserDataPath, { recursive: true, force: true })
  }
})

describe('Migration System', () => {
  // Migration System Tests
  test('should detect migration needed when old structure exists', async () => {
    // Create old structure with some .db files
    writeFileSync(join(testUserDataPath, 'study1.db'), 'fake db content')
    writeFileSync(join(testUserDataPath, 'study2.db'), 'fake db content')

    const needed = await isMigrationNeeded(testUserDataPath)
    assert.equal(needed, true)
  })

  test('should not detect migration needed when no db files exist', async () => {
    const needed = await isMigrationNeeded(testUserDataPath)
    assert.equal(needed, false)
  })

  test('should register and run migrations', async () => {
    // Register test migration
    registerMigration(fileSystemRestructureMigration.version, fileSystemRestructureMigration)

    // Create old structure
    writeFileSync(join(testUserDataPath, 'test-study-1.db'), 'fake db content 1')
    writeFileSync(join(testUserDataPath, 'test-study-2.db'), 'fake db content 2')

    // Run migrations
    await runMigrations(testUserDataPath)

    // Check new structure exists
    const newPath1 = join(testUserDataPath, 'biowatch-data', 'studies', 'test-study-1', 'study.db')
    const newPath2 = join(testUserDataPath, 'biowatch-data', 'studies', 'test-study-2', 'study.db')

    assert(existsSync(newPath1), 'Study 1 should be migrated to new location')
    assert(existsSync(newPath2), 'Study 2 should be migrated to new location')

    // Check old structure is gone
    assert(!existsSync(join(testUserDataPath, 'test-study-1.db')), 'Old study 1 should be removed')
    assert(!existsSync(join(testUserDataPath, 'test-study-2.db')), 'Old study 2 should be removed')

    // Check content is preserved
    const content1 = readFileSync(newPath1, 'utf8')
    const content2 = readFileSync(newPath2, 'utf8')
    assert.equal(content1, 'fake db content 1')
    assert.equal(content2, 'fake db content 2')
  })

  test('should get migration status correctly', async () => {
    registerMigration(fileSystemRestructureMigration.version, fileSystemRestructureMigration)

    const status = await getMigrationStatus(testUserDataPath)
    assert.equal(status.currentVersion, null)
    assert.equal(status.latestVersion, fileSystemRestructureMigration.version)
    assert.equal(status.needsMigration, false) // No db files exist
    assert(status.availableMigrations.includes(fileSystemRestructureMigration.version))
  })

  test('should support rollback', async () => {
    registerMigration(fileSystemRestructureMigration.version, fileSystemRestructureMigration)

    // Create old structure and migrate
    writeFileSync(join(testUserDataPath, 'test-study.db'), 'test content')
    await runMigrations(testUserDataPath)

    // Verify migration worked
    const newPath = join(testUserDataPath, 'biowatch-data', 'studies', 'test-study', 'study.db')
    assert(existsSync(newPath), 'Should be migrated to new location')
    assert(!existsSync(join(testUserDataPath, 'test-study.db')), 'Old file should be gone')

    // Now rollback using the migration's down function directly
    await fileSystemRestructureMigration.down(testUserDataPath)

    // Verify rollback worked
    assert(existsSync(join(testUserDataPath, 'test-study.db')), 'Old file should be restored')
    assert(!existsSync(newPath), 'New file should be gone')
  })
})

describe('File System Restructure Migration', () => {
  // File System Restructure Migration Tests
  test('should migrate databases from flat to structured layout', async () => {
    // Create old structure
    writeFileSync(join(testUserDataPath, 'study-a.db'), 'content a')
    writeFileSync(join(testUserDataPath, 'study-b.db'), 'content b')
    writeFileSync(join(testUserDataPath, 'study-c.db'), 'content c')

    // Create model-zoo directory with some files
    const modelZooPath = join(testUserDataPath, 'model-zoo')
    mkdirSync(modelZooPath, { recursive: true })
    writeFileSync(join(modelZooPath, 'manifest.yaml'), 'model zoo manifest')
    mkdirSync(join(modelZooPath, 'archives'), { recursive: true })
    writeFileSync(join(modelZooPath, 'archives', 'test.tar.gz'), 'model archive')

    // Create python-environments directory with some files
    const pythonEnvPath = join(testUserDataPath, 'python-environments')
    mkdirSync(join(pythonEnvPath, 'conda'), { recursive: true })
    writeFileSync(join(pythonEnvPath, 'conda', 'manifest.yaml'), 'python env manifest')

    // Run migration
    await fileSystemRestructureMigration.up(testUserDataPath)

    // Verify new structure for studies
    const studyAPath = join(testUserDataPath, 'biowatch-data', 'studies', 'study-a', 'study.db')
    const studyBPath = join(testUserDataPath, 'biowatch-data', 'studies', 'study-b', 'study.db')
    const studyCPath = join(testUserDataPath, 'biowatch-data', 'studies', 'study-c', 'study.db')

    assert(existsSync(studyAPath), 'Study A should exist in new location')
    assert(existsSync(studyBPath), 'Study B should exist in new location')
    assert(existsSync(studyCPath), 'Study C should exist in new location')

    // Verify content
    assert.equal(readFileSync(studyAPath, 'utf8'), 'content a')
    assert.equal(readFileSync(studyBPath, 'utf8'), 'content b')
    assert.equal(readFileSync(studyCPath, 'utf8'), 'content c')

    // Verify old files are gone
    assert(!existsSync(join(testUserDataPath, 'study-a.db')))
    assert(!existsSync(join(testUserDataPath, 'study-b.db')))
    assert(!existsSync(join(testUserDataPath, 'study-c.db')))

    // Verify model-zoo was moved
    const newModelZooPath = join(testUserDataPath, 'biowatch-data', 'model-zoo')
    assert(existsSync(newModelZooPath), 'model-zoo should exist in new location')
    assert(existsSync(join(newModelZooPath, 'manifest.yaml')), 'model-zoo manifest should exist')
    assert(
      existsSync(join(newModelZooPath, 'archives', 'test.tar.gz')),
      'model archive should exist'
    )
    assert(!existsSync(modelZooPath), 'old model-zoo should be gone')

    // Verify python-environments was moved
    const newPythonEnvPath = join(testUserDataPath, 'biowatch-data', 'python-environments')
    assert(existsSync(newPythonEnvPath), 'python-environments should exist in new location')
    assert(
      existsSync(join(newPythonEnvPath, 'conda', 'manifest.yaml')),
      'python env manifest should exist'
    )
    assert(!existsSync(pythonEnvPath), 'old python-environments should be gone')
  })

  test('should rollback from structured to flat layout', async () => {
    // First migrate to new structure
    writeFileSync(join(testUserDataPath, 'study-x.db'), 'content x')
    writeFileSync(join(testUserDataPath, 'study-y.db'), 'content y')

    // Create directories to migrate
    const modelZooPath = join(testUserDataPath, 'model-zoo')
    mkdirSync(modelZooPath, { recursive: true })
    writeFileSync(join(modelZooPath, 'test-model.txt'), 'model content')

    const pythonEnvPath = join(testUserDataPath, 'python-environments')
    mkdirSync(join(pythonEnvPath, 'conda'), { recursive: true })
    writeFileSync(join(pythonEnvPath, 'conda', 'test-env.txt'), 'env content')

    await fileSystemRestructureMigration.up(testUserDataPath)

    // Now rollback
    await fileSystemRestructureMigration.down(testUserDataPath)

    // Verify rollback for studies
    assert(
      existsSync(join(testUserDataPath, 'study-x.db')),
      'Study X should be back in old location'
    )
    assert(
      existsSync(join(testUserDataPath, 'study-y.db')),
      'Study Y should be back in old location'
    )

    // Verify content
    assert.equal(readFileSync(join(testUserDataPath, 'study-x.db'), 'utf8'), 'content x')
    assert.equal(readFileSync(join(testUserDataPath, 'study-y.db'), 'utf8'), 'content y')

    // Verify new structure is cleaned up
    const studyXPath = join(testUserDataPath, 'biowatch-data', 'studies', 'study-x', 'study.db')
    const studyYPath = join(testUserDataPath, 'biowatch-data', 'studies', 'study-y', 'study.db')
    assert(!existsSync(studyXPath), 'New structure should be cleaned up')
    assert(!existsSync(studyYPath), 'New structure should be cleaned up')

    // Verify model-zoo rollback
    assert(
      existsSync(join(testUserDataPath, 'model-zoo')),
      'model-zoo should be back in old location'
    )
    assert(
      existsSync(join(testUserDataPath, 'model-zoo', 'test-model.txt')),
      'model content should be preserved'
    )
    assert(
      !existsSync(join(testUserDataPath, 'biowatch-data', 'model-zoo')),
      'new model-zoo should be gone'
    )

    // Verify python-environments rollback
    assert(
      existsSync(join(testUserDataPath, 'python-environments')),
      'python-environments should be back in old location'
    )
    assert(
      existsSync(join(testUserDataPath, 'python-environments', 'conda', 'test-env.txt')),
      'env content should be preserved'
    )
    assert(
      !existsSync(join(testUserDataPath, 'biowatch-data', 'python-environments')),
      'new python-environments should be gone'
    )
  })

  test('should handle empty directories gracefully', async () => {
    // Run migration with no .db files or directories
    await fileSystemRestructureMigration.up(testUserDataPath)

    // Should create directories but not fail
    const biowatchDataPath = join(testUserDataPath, 'biowatch-data')
    const studiesPath = join(biowatchDataPath, 'studies')

    assert(existsSync(biowatchDataPath), 'Should create biowatch-data directory')
    assert(existsSync(studiesPath), 'Should create studies directory')
  })

  test('should handle migration when some directories exist and others do not', async () => {
    // Create only model-zoo directory
    const modelZooPath = join(testUserDataPath, 'model-zoo')
    mkdirSync(modelZooPath, { recursive: true })
    writeFileSync(join(modelZooPath, 'test.txt'), 'test content')

    // Run migration
    await fileSystemRestructureMigration.up(testUserDataPath)

    // Verify model-zoo was moved
    const newModelZooPath = join(testUserDataPath, 'biowatch-data', 'model-zoo')
    assert(existsSync(newModelZooPath), 'model-zoo should exist in new location')
    assert(existsSync(join(newModelZooPath, 'test.txt')), 'model-zoo content should exist')
    assert(!existsSync(modelZooPath), 'old model-zoo should be gone')

    // Verify python-environments was not moved (because it didn't exist)
    const newPythonEnvPath = join(testUserDataPath, 'biowatch-data', 'python-environments')
    assert(!existsSync(newPythonEnvPath), 'python-environments should not exist in new location')
  })
})

describe('Study Path Utilities', () => {
  // Study Path Utilities Tests
  test('should find database in old structure', async () => {
    // Create old structure
    writeFileSync(join(testUserDataPath, 'test-study.db'), 'test content')

    const path = getStudyDatabasePath(testUserDataPath, 'test-study')
    assert.equal(path, join(testUserDataPath, 'test-study.db'))
  })

  test('should find database in new structure', async () => {
    // Create new structure
    const studyDir = join(testUserDataPath, 'biowatch-data', 'studies', 'test-study')
    mkdirSync(studyDir, { recursive: true })
    writeFileSync(join(studyDir, 'study.db'), 'test content')

    const path = getStudyDatabasePath(testUserDataPath, 'test-study')
    assert.equal(path, join(studyDir, 'study.db'))
  })

  test('should prefer new structure over old', async () => {
    // Create both structures
    writeFileSync(join(testUserDataPath, 'test-study.db'), 'old content')

    const studyDir = join(testUserDataPath, 'biowatch-data', 'studies', 'test-study')
    mkdirSync(studyDir, { recursive: true })
    writeFileSync(join(studyDir, 'study.db'), 'new content')

    const path = getStudyDatabasePath(testUserDataPath, 'test-study')
    assert.equal(path, join(studyDir, 'study.db'))
  })

  test('should return null for non-existent study', async () => {
    const path = getStudyDatabasePath(testUserDataPath, 'non-existent')
    assert.equal(path, null)
  })

  test('should create and return new study path', async () => {
    const path = getNewStudyDatabasePath(testUserDataPath, 'new-study')
    const expectedPath = join(testUserDataPath, 'biowatch-data', 'studies', 'new-study', 'study.db')

    assert.equal(path, expectedPath)

    // Should create the directory
    const studyDir = join(testUserDataPath, 'biowatch-data', 'studies', 'new-study')
    assert(existsSync(studyDir), 'Should create study directory')
  })

  test('should check study existence correctly', async () => {
    // Non-existent study
    assert.equal(studyExists(testUserDataPath, 'non-existent'), false)

    // Create old structure
    writeFileSync(join(testUserDataPath, 'old-study.db'), 'content')
    assert.equal(studyExists(testUserDataPath, 'old-study'), true)

    // Create new structure
    const studyDir = join(testUserDataPath, 'biowatch-data', 'studies', 'new-study')
    mkdirSync(studyDir, { recursive: true })
    writeFileSync(join(studyDir, 'study.db'), 'content')
    assert.equal(studyExists(testUserDataPath, 'new-study'), true)
  })

  test('should list all studies from both structures', async () => {
    // Create old structure studies
    writeFileSync(join(testUserDataPath, 'study-old-1.db'), 'content')
    writeFileSync(join(testUserDataPath, 'study-old-2.db'), 'content')

    // Create new structure studies
    const studyDir1 = join(testUserDataPath, 'biowatch-data', 'studies', 'study-new-1')
    const studyDir2 = join(testUserDataPath, 'biowatch-data', 'studies', 'study-new-2')
    mkdirSync(studyDir1, { recursive: true })
    mkdirSync(studyDir2, { recursive: true })
    writeFileSync(join(studyDir1, 'study.db'), 'content')
    writeFileSync(join(studyDir2, 'study.db'), 'content')

    const studies = listAllStudies(testUserDataPath)
    assert.equal(studies.length, 4)
    assert(studies.includes('study-old-1'))
    assert(studies.includes('study-old-2'))
    assert(studies.includes('study-new-1'))
    assert(studies.includes('study-new-2'))
  })

  test('should delete study from old structure', async () => {
    writeFileSync(join(testUserDataPath, 'test-study.db'), 'content')

    const deleted = deleteStudy(testUserDataPath, 'test-study')
    assert.equal(deleted, true)
    assert(!existsSync(join(testUserDataPath, 'test-study.db')))
  })

  test('should delete study from new structure', async () => {
    const studyDir = join(testUserDataPath, 'biowatch-data', 'studies', 'test-study')
    mkdirSync(studyDir, { recursive: true })
    writeFileSync(join(studyDir, 'study.db'), 'content')
    writeFileSync(join(studyDir, 'other-file.txt'), 'other content')

    const deleted = deleteStudy(testUserDataPath, 'test-study')
    assert.equal(deleted, true)
    assert(!existsSync(studyDir))
  })

  test('should detect filesystem migration status correctly', async () => {
    // Should not be migrated initially
    assert.equal(isFileSystemMigrated(testUserDataPath), false)

    // Create old structure
    writeFileSync(join(testUserDataPath, 'study.db'), 'content')
    const modelZooPath = join(testUserDataPath, 'model-zoo')
    mkdirSync(modelZooPath, { recursive: true })
    writeFileSync(join(modelZooPath, 'test.txt'), 'test')

    // Should not be migrated with old structure
    assert.equal(isFileSystemMigrated(testUserDataPath), false)

    // Create new structure but keep old structure
    const studyDir = join(testUserDataPath, 'biowatch-data', 'studies', 'test-study')
    mkdirSync(studyDir, { recursive: true })
    writeFileSync(join(studyDir, 'study.db'), 'content')

    // Should not be migrated with both structures
    assert.equal(isFileSystemMigrated(testUserDataPath), false)

    // Remove old structure
    unlinkSync(join(testUserDataPath, 'study.db'))
    rmSync(modelZooPath, { recursive: true, force: true })

    // Should be migrated now
    assert.equal(isFileSystemMigrated(testUserDataPath), true)
  })
})
