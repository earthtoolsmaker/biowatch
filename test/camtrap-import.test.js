import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
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
  testBiowatchDataPath = join(tmpdir(), 'biowatch-camtrap-test', Date.now().toString())
  mkdirSync(testBiowatchDataPath, { recursive: true })

  // Use the test CamTrapDP dataset from the test directory
  testCamTrapDataPath = join(process.cwd(), 'test', 'data', 'camtrap')
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

/**
 * Helper function to get all records from a table
 * @param {string} dbPath - Path to the database
 * @param {string} tableName - Name of the table
 * @returns {Array} - All records
 */
function getAllRecords(dbPath, tableName) {
  return queryDatabase(dbPath, `SELECT * FROM ${tableName}`)
}

describe('CamTrapDP Import Tests', () => {
  describe('CamTrapDP Dataset Import', () => {
    test('should import CamTrapDP dataset and create correct database structure', async () => {
      const studyId = 'test-camtrap-study'

      // Run the import
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      // Check that database was created
      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
      assert(existsSync(dbPath), 'Database should be created')

      // Verify database tables exist (Drizzle also creates __drizzle_migrations table)
      const tables = queryDatabase(dbPath, "SELECT name FROM sqlite_master WHERE type='table'")
      const tableNames = tables.map((t) => t.name).sort()
      const expectedTables = ['__drizzle_migrations', 'deployments', 'media', 'observations']
      assert.deepEqual(
        tableNames,
        expectedTables,
        'Should create all required tables including Drizzle migration tracking'
      )
    })

    test('should import deployments correctly', async () => {
      const studyId = 'test-camtrap-deployments'
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Count deployments - should be 3 from the test data
      const deploymentCount = countRecords(dbPath, 'deployments')
      assert.equal(deploymentCount, 3, 'Should create 3 deployments')

      // Verify deployment details
      const deployments = getAllRecords(dbPath, 'deployments')
      const deployment1 = deployments.find((d) => d.deploymentID === 'deploy001')

      assert(deployment1, 'Should find deployment deploy001')
      assert.equal(deployment1.locationName, 'Forest Site A', 'Should have correct location name')
      assert.equal(deployment1.latitude, 46.7712, 'Should have correct latitude')
      assert.equal(deployment1.longitude, 6.6413, 'Should have correct longitude')
      assert(deployment1.deploymentStart, 'Should have deployment start date')
      assert(deployment1.deploymentEnd, 'Should have deployment end date')

      // Verify date format (should be ISO format)
      assert(deployment1.deploymentStart.includes('2023-03-15'), 'Start date should be correct')
      assert(deployment1.deploymentEnd.includes('2023-06-15'), 'End date should be correct')
    })

    test('should import media records correctly', async () => {
      const studyId = 'test-camtrap-media'
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Count media records - should be 10 from the test data
      const mediaCount = countRecords(dbPath, 'media')
      assert.equal(mediaCount, 10, 'Should create 10 media records')

      // Verify media record structure
      const mediaRecords = queryDatabase(dbPath, 'SELECT * FROM media LIMIT 5')

      for (const media of mediaRecords) {
        assert(media.mediaID, 'Media should have an ID')
        assert(media.deploymentID, 'Media should be linked to a deployment')
        assert(media.timestamp, 'Media should have a timestamp')
        assert(media.filePath, 'Media should have a file path')
        assert(media.fileName, 'Media should have a file name')
      }

      // Check specific media record
      const specificMedia = queryDatabase(dbPath, "SELECT * FROM media WHERE mediaID = 'media001'")
      assert.equal(specificMedia.length, 1, 'Should find the specific media record')
      assert.equal(specificMedia[0].fileName, 'IMG001.JPG', 'Should have correct filename')
      assert.equal(
        specificMedia[0].deploymentID,
        'deploy001',
        'Should be linked to correct deployment'
      )
    })

    test('should import observations correctly', async () => {
      const studyId = 'test-camtrap-observations'
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Count observations - should be 10 from the test data
      const observationCount = countRecords(dbPath, 'observations')
      assert.equal(observationCount, 10, 'Should create 10 observation records')

      // Verify observation record structure
      const observations = queryDatabase(dbPath, 'SELECT * FROM observations LIMIT 5')

      for (const obs of observations) {
        assert(obs.observationID, 'Observation should have an ID')
        assert(obs.mediaID, 'Observation should be linked to media')
        assert(obs.deploymentID, 'Observation should be linked to deployment')
        assert(obs.eventStart, 'Observation should have event start time')
        assert(obs.eventEnd, 'Observation should have event end time')
      }

      // Check for empty observations
      const emptyObs = queryDatabase(
        dbPath,
        "SELECT * FROM observations WHERE commonName = 'Empty'"
      )
      assert(emptyObs.length > 0, 'Should have empty observations')

      // Check for species observations
      const speciesObs = queryDatabase(
        dbPath,
        "SELECT * FROM observations WHERE scientificName = 'Cervus elaphus'"
      )
      assert(speciesObs.length > 0, 'Should have Red Deer observations')

      // Verify Red Deer observation details
      const redDeerObs = speciesObs[0]
      assert.equal(redDeerObs.commonName, 'Red Deer', 'Should have correct common name')
      assert.equal(
        redDeerObs.scientificName,
        'Cervus elaphus',
        'Should have correct scientific name'
      )
      assert.equal(redDeerObs.count, 2, 'Should have correct count')
      assert.equal(redDeerObs.confidence, 0.95, 'Should have correct confidence')
    })

    test('should handle scientific name and empty observations correctly', async () => {
      const studyId = 'test-camtrap-taxonomy'
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Check various taxonomic scenarios
      const observations = queryDatabase(
        dbPath,
        'SELECT DISTINCT scientificName, commonName FROM observations WHERE scientificName IS NOT NULL'
      )

      // Should have proper scientific names
      const scientificNames = observations.map((obs) => obs.scientificName)
      assert(scientificNames.includes('Cervus elaphus'), 'Should have Cervus elaphus')
      assert(scientificNames.includes('Vulpes vulpes'), 'Should have Vulpes vulpes')
      assert(scientificNames.includes('Sus scrofa'), 'Should have Sus scrofa')

      // Should handle empty entries - they should have commonName = 'Empty' but scientificName = null
      const emptyObs = queryDatabase(
        dbPath,
        "SELECT * FROM observations WHERE commonName = 'Empty' AND scientificName IS NULL"
      )
      assert(
        emptyObs.length > 0,
        'Should properly handle empty observations with null scientificName'
      )
    })

    test('should validate ID relationships between tables', async () => {
      const studyId = 'test-camtrap-relationships'
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // All media records should have valid deploymentID
      const mediaWithoutDeployment = queryDatabase(
        dbPath,
        `SELECT m.* FROM media m 
         LEFT JOIN deployments d ON m.deploymentID = d.deploymentID 
         WHERE d.deploymentID IS NULL`
      )
      assert.equal(mediaWithoutDeployment.length, 0, 'All media should be linked to deployments')

      // All observations should have valid mediaID
      const obsWithoutMedia = queryDatabase(
        dbPath,
        `SELECT o.* FROM observations o 
         LEFT JOIN media m ON o.mediaID = m.mediaID 
         WHERE m.mediaID IS NULL`
      )
      assert.equal(obsWithoutMedia.length, 0, 'All observations should be linked to media')
    })

    test('should handle file path transformation correctly', async () => {
      const studyId = 'test-camtrap-paths'
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Check that file paths are transformed correctly
      const mediaWithPaths = queryDatabase(
        dbPath,
        'SELECT filePath, fileName FROM media WHERE filePath IS NOT NULL LIMIT 3'
      )

      for (const media of mediaWithPaths) {
        // File paths should be transformed to absolute paths
        assert(media.filePath.includes('images/'), 'FilePath should contain relative path')
        assert(media.fileName.endsWith('.JPG'), 'FileName should have correct extension')
      }
    })

    test('should handle timestamps correctly', async () => {
      const studyId = 'test-camtrap-timestamps'
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Check that timestamps are in ISO format
      const mediaWithTimestamp = queryDatabase(
        dbPath,
        'SELECT timestamp FROM media WHERE timestamp IS NOT NULL LIMIT 5'
      )

      for (const media of mediaWithTimestamp) {
        // ISO format should contain 'T' and 'Z' or timezone info
        assert(media.timestamp.includes('T'), 'Timestamp should be in ISO format')
        assert(media.timestamp.includes('Z'), 'Timestamp should include timezone info')
      }

      // Check specific timestamp conversion
      const specificRecord = queryDatabase(
        dbPath,
        "SELECT timestamp FROM media WHERE mediaID = 'media001'"
      )
      assert.equal(specificRecord.length, 1, 'Should find the specific record')
      assert(specificRecord[0].timestamp.includes('2023-03-20'), 'Should have correct date')
      assert(specificRecord[0].timestamp.includes('14:30:15'), 'Should have correct time')
    })

    test('study.json should be created with valid CamTrapDP metadata', async () => {
      const studyId = 'test-camtrap-study-json'

      // Import the test dataset
      const result = await importCamTrapDatasetWithPath(
        testCamTrapDataPath,
        testBiowatchDataPath,
        studyId
      )

      // Check that study.json was created
      const studyJsonPath = join(testBiowatchDataPath, 'studies', studyId, 'study.json')
      assert(existsSync(studyJsonPath), 'study.json should be created')

      // Read and parse the study.json file
      const studyJsonContent = readFileSync(studyJsonPath, 'utf8')
      const studyData = JSON.parse(studyJsonContent)

      // Verify the structure and content
      assert(studyData.name, 'study.json should contain a name property')
      assert.equal(typeof studyData.name, 'string', 'name should be a string')
      assert(studyData.name.length > 0, 'name should not be empty')
      assert.equal(
        studyData.importerName,
        'camtrap/datapackage',
        'should have correct importer name'
      )

      // Should extract name from datapackage.json
      assert.equal(studyData.name, 'test-camtrap-dataset', 'name should match datapackage name')

      // Verify datapackage metadata is preserved
      assert(studyData.data, 'Should contain datapackage data')
      assert.equal(
        studyData.data.title,
        'Test CamTrap Dataset',
        'Should preserve datapackage title'
      )
      assert(studyData.data.resources, 'Should preserve resource definitions')

      // Should match the returned data
      assert.deepEqual(result.data, studyData, 'returned data should match study.json content')
    })

    test('should handle missing datapackage.json gracefully', async () => {
      const studyId = 'test-camtrap-no-datapackage'

      // Create a temporary directory without datapackage.json
      const tempDir = join(testBiowatchDataPath, 'no-datapackage')
      mkdirSync(tempDir, { recursive: true })

      // Should return error when datapackage.json is missing
      const result = await importCamTrapDatasetWithPath(tempDir, testBiowatchDataPath, studyId)

      assert(result.error, 'Should return an error')
      assert(
        result.error.includes('datapackage.json not found'),
        'Should indicate missing datapackage.json'
      )
    })
  })
})
