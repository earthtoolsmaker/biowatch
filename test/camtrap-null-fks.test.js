import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

// Import the function we want to test
import { importCamTrapDatasetWithPath } from '../src/main/camtrap.js'

// Test data paths
let testBiowatchDataPath
let testCamTrapDataPath

beforeEach(async () => {
  // Disable electron-log output in tests
  try {
    const electronLog = await import('electron-log')
    const log = electronLog.default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // electron-log not available in test environment, that's fine
  }

  // Create a temporary directory for test data
  testBiowatchDataPath = join(tmpdir(), 'biowatch-camtrap-null-test', Date.now().toString())
  mkdirSync(testBiowatchDataPath, { recursive: true })

  // Use the test CamTrapDP dataset with NULL foreign keys
  testCamTrapDataPath = join(process.cwd(), 'test', 'data', 'camtrap-null-fks')
})

afterEach(() => {
  // Clean up test directory
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

/**
 * Helper function to query database and return results
 * @param {string} dbPath - Path to the database
 * @param {string} query - SQL query
 * @returns {Array} - Query results
 */
function queryDatabase(dbPath, query) {
  const db = new Database(dbPath, { readonly: true })
  try {
    const results = db.prepare(query).all()
    return results
  } finally {
    db.close()
  }
}

/**
 * Helper function to count records in a table
 * @param {string} dbPath - Path to the database
 * @param {string} tableName - Name of the table
 * @returns {number} - Number of records
 */
function countRecords(dbPath, tableName) {
  const results = queryDatabase(dbPath, `SELECT COUNT(*) as count FROM ${tableName}`)
  return results[0].count
}

describe('CamTrapDP NULL Foreign Keys Tests', () => {
  describe('NULL Foreign Key Handling', () => {
    test('should import media records with NULL deploymentID (orphaned media)', async () => {
      const studyId = 'test-camtrap-null-fks'
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Should import all 4 media records including those with NULL deploymentID
      const mediaCount = countRecords(dbPath, 'media')
      assert.equal(mediaCount, 4, 'Should import all media records including orphaned ones')

      // Check for orphaned media (NULL deploymentID)
      const orphanedMedia = queryDatabase(dbPath, 'SELECT * FROM media WHERE deploymentID IS NULL')
      assert.equal(orphanedMedia.length, 2, 'Should have 2 orphaned media records')

      // Verify orphaned media details
      const orphan1 = orphanedMedia.find((m) => m.mediaID === 'media002')
      const orphan2 = orphanedMedia.find((m) => m.mediaID === 'media004')

      assert(orphan1, 'Should find orphaned media002')
      assert(orphan2, 'Should find orphaned media004')
      assert.equal(orphan1.fileName, 'IMG002.JPG', 'Orphaned media should have correct filename')
      assert.equal(orphan2.fileName, 'IMG004.JPG', 'Orphaned media should have correct filename')
    })

    test('should import observations with NULL mediaID (standalone observations)', async () => {
      const studyId = 'test-camtrap-null-media'
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Should import all 4 observation records including those with NULL mediaID
      const observationCount = countRecords(dbPath, 'observations')
      assert.equal(observationCount, 4, 'Should import all observations including standalone ones')

      // Check for standalone observations (NULL mediaID)
      const standaloneObs = queryDatabase(
        dbPath,
        'SELECT * FROM observations WHERE mediaID IS NULL'
      )
      assert.equal(standaloneObs.length, 2, 'Should have 2 standalone observations')

      // Verify standalone observation details
      const standalone = standaloneObs[0]
      assert.equal(standalone.observationID, 'obs002', 'Should find standalone obs002')
      assert.equal(standalone.commonName, 'Wild Boar', 'Standalone obs should have correct species')
      assert.equal(
        standalone.deploymentID,
        'deploy001',
        'Standalone obs can still have deploymentID'
      )
    })

    test('should import observations with NULL deploymentID', async () => {
      const studyId = 'test-camtrap-null-deployment'
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Check for observations with NULL deploymentID
      const noDeploymentObs = queryDatabase(
        dbPath,
        'SELECT * FROM observations WHERE deploymentID IS NULL'
      )
      assert.equal(noDeploymentObs.length, 2, 'Should have 2 observations without deploymentID')

      // Verify observation without deploymentID
      const noDeployment = noDeploymentObs[0]
      assert.equal(noDeployment.observationID, 'obs003', 'Should find obs003 without deploymentID')
      assert.equal(noDeployment.mediaID, 'media003', 'Should still have mediaID')
      assert.equal(noDeployment.commonName, 'Empty', 'Should have correct species data')
    })

    test('should import observations with both NULL mediaID and deploymentID', async () => {
      const studyId = 'test-camtrap-double-null'
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Check for completely standalone observations (both NULL)
      const completelyStandalone = queryDatabase(
        dbPath,
        'SELECT * FROM observations WHERE mediaID IS NULL AND deploymentID IS NULL'
      )
      assert.equal(
        completelyStandalone.length,
        1,
        'Should have 1 completely standalone observation'
      )

      // Verify completely standalone observation
      const standalone = completelyStandalone[0]
      assert.equal(standalone.observationID, 'obs004', 'Should find completely standalone obs004')
      assert.equal(standalone.commonName, 'European Hare', 'Should have species data')
      assert.equal(standalone.classificationProbability, 0.92, 'Should have classificationProbability value')
    })

    test('should maintain referential integrity for non-NULL foreign keys', async () => {
      const studyId = 'test-camtrap-referential-integrity'
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Media with non-NULL deploymentID should reference existing deployments
      const mediaWithValidDeployment = queryDatabase(
        dbPath,
        `SELECT m.* FROM media m 
         INNER JOIN deployments d ON m.deploymentID = d.deploymentID`
      )
      assert.equal(
        mediaWithValidDeployment.length,
        2,
        'Should have 2 media with valid deployment refs'
      )

      // Observations with non-NULL mediaID should reference existing media
      const obsWithValidMedia = queryDatabase(
        dbPath,
        `SELECT o.* FROM observations o 
         INNER JOIN media m ON o.mediaID = m.mediaID`
      )
      assert.equal(obsWithValidMedia.length, 2, 'Should have 2 observations with valid media refs')

      // Observations with non-NULL deploymentID should reference existing deployments
      const obsWithValidDeployment = queryDatabase(
        dbPath,
        `SELECT o.* FROM observations o 
         INNER JOIN deployments d ON o.deploymentID = d.deploymentID`
      )
      assert.equal(
        obsWithValidDeployment.length,
        2,
        'Should have 2 observations with valid deployment refs'
      )
    })
  })
})
