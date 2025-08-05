import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import sqlite3 from 'sqlite3'

// Import the function we want to test
import { importWildlifeDatasetWithPath } from '../src/main/wildlife.js'

// Test data paths
let testBiowatchDataPath
let testWildlifeDataPath

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
  testBiowatchDataPath = join(tmpdir(), 'biowatch-wildlife-test', Date.now().toString())
  mkdirSync(testBiowatchDataPath, { recursive: true })

  // Use the test wildlife dataset from the test directory
  testWildlifeDataPath = join(process.cwd(), 'test', 'data', 'wildlife')
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
 * @returns {Promise<Array>} - Query results
 */
function queryDatabase(dbPath, query) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err)
        return
      }

      db.all(query, (err, rows) => {
        if (err) {
          reject(err)
        } else {
          resolve(rows)
        }
        db.close()
      })
    })
  })
}

/**
 * Helper function to count records in a table
 * @param {string} dbPath - Path to the database
 * @param {string} tableName - Name of the table
 * @returns {Promise<number>} - Number of records
 */
async function countRecords(dbPath, tableName) {
  const results = await queryDatabase(dbPath, `SELECT COUNT(*) as count FROM ${tableName}`)
  return results[0].count
}

/**
 * Helper function to get all records from a table
 * @param {string} dbPath - Path to the database
 * @param {string} tableName - Name of the table
 * @returns {Promise<Array>} - All records
 */
async function getAllRecords(dbPath, tableName) {
  return await queryDatabase(dbPath, `SELECT * FROM ${tableName}`)
}

describe('Wildlife Import Tests', () => {
  describe('Wildlife Dataset Import', () => {
    test('should import Wildlife dataset and create correct database structure', async () => {
      const studyId = 'test-wildlife-study'

      // Run the import
      await importWildlifeDatasetWithPath(testWildlifeDataPath, testBiowatchDataPath, studyId)

      // Check that database was created
      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
      assert(existsSync(dbPath), 'Database should be created')

      // Verify database tables exist (Drizzle also creates __drizzle_migrations table)
      const tables = await queryDatabase(
        dbPath,
        "SELECT name FROM sqlite_master WHERE type='table'"
      )
      const tableNames = tables.map((t) => t.name).sort()
      const expectedTables = ['__drizzle_migrations', 'deployments', 'media', 'observations']
      assert.deepEqual(
        tableNames,
        expectedTables,
        'Should create all required tables including Drizzle migration tracking'
      )
    })

    test('should import deployments correctly', async () => {
      const studyId = 'test-wildlife-deployments'
      await importWildlifeDatasetWithPath(testWildlifeDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Count deployments - should be 1 from the test data
      const deploymentCount = await countRecords(dbPath, 'deployments')
      assert.equal(deploymentCount, 1, 'Should create 1 deployment')

      // Verify deployment details
      const deployments = await getAllRecords(dbPath, 'deployments')
      const deployment = deployments[0]

      assert.equal(
        deployment.deploymentID,
        'Río Trubia 04/04/2024',
        'Should have correct deployment ID'
      )
      assert.equal(
        deployment.locationName,
        'Río Trubia 04/04/2024',
        'Should have correct location name'
      )
      assert.equal(deployment.latitude, 43.321849, 'Should have correct latitude')
      assert.equal(deployment.longitude, -5.99154, 'Should have correct longitude')
      assert(deployment.deploymentStart, 'Should have deployment start date')
      assert(deployment.deploymentEnd, 'Should have deployment end date')

      // Verify date format (should be ISO format)
      assert(deployment.deploymentStart.includes('2024-04-04'), 'Start date should be correct')
      assert(deployment.deploymentEnd.includes('2024-05-03'), 'End date should be correct')
    })

    test('should import media records correctly', async () => {
      const studyId = 'test-wildlife-media'
      await importWildlifeDatasetWithPath(testWildlifeDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Count media records - should match the number of rows in images.csv (593 + header = 594 total, so 593 data rows)
      const mediaCount = await countRecords(dbPath, 'media')
      assert(mediaCount > 0, 'Should create media records')
      assert(mediaCount <= 593, 'Should not exceed total number of images')

      // Verify media record structure
      const mediaRecords = await queryDatabase(dbPath, 'SELECT * FROM media LIMIT 5')

      for (const media of mediaRecords) {
        assert(media.mediaID, 'Media should have an ID')
        assert(media.deploymentID, 'Media should be linked to a deployment')
        assert(media.timestamp, 'Media should have a timestamp')
        assert(media.filePath, 'Media should have a file path')
        assert(media.fileName, 'Media should have a file name')
      }

      // Check specific media record
      const specificMedia = await queryDatabase(
        dbPath,
        "SELECT * FROM media WHERE mediaID = 'e668cfa2-c2c3-476b-b132-3daf1fe0e260'"
      )
      assert.equal(specificMedia.length, 1, 'Should find the specific media record')
      assert.equal(specificMedia[0].fileName, 'IMAG0027.JPG', 'Should have correct filename')
      assert.equal(
        specificMedia[0].deploymentID,
        'Río Trubia 04/04/2024',
        'Should be linked to correct deployment'
      )
    })

    test('should import observations correctly', async () => {
      const studyId = 'test-wildlife-observations'
      await importWildlifeDatasetWithPath(testWildlifeDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Count observations - should be less than media count since some are blank
      const observationCount = await countRecords(dbPath, 'observations')
      const mediaCount = await countRecords(dbPath, 'media')

      assert(observationCount > 0, 'Should create observation records')
      assert(observationCount <= mediaCount, 'Observations should not exceed media count')

      // Verify observation record structure
      const observations = await queryDatabase(dbPath, 'SELECT * FROM observations LIMIT 5')

      for (const obs of observations) {
        assert(obs.observationID, 'Observation should have an ID')
        assert(obs.mediaID, 'Observation should be linked to media')
        assert(obs.deploymentID, 'Observation should be linked to deployment')
        assert(obs.eventStart, 'Observation should have event start time')
        assert(obs.eventEnd, 'Observation should have event end time')
      }

      // Check for blank observations
      const blankObs = await queryDatabase(
        dbPath,
        "SELECT * FROM observations WHERE commonName = 'Blank'"
      )
      assert(blankObs.length > 0, 'Should have blank observations')

      // Check for species observations
      const speciesObs = await queryDatabase(
        dbPath,
        "SELECT * FROM observations WHERE scientificName LIKE 'Vulpes vulpes'"
      )
      assert(speciesObs.length > 0, 'Should have Red Fox observations')

      // Verify Red Fox observation details
      const foxObs = speciesObs[0]
      assert.equal(foxObs.commonName, 'Red Fox', 'Should have correct common name')
      assert.equal(foxObs.scientificName, 'Vulpes vulpes', 'Should have correct scientific name')
      assert.equal(foxObs.count, 1, 'Should have correct count')
    })

    test('should handle scientific name construction correctly', async () => {
      const studyId = 'test-wildlife-taxonomy'
      await importWildlifeDatasetWithPath(testWildlifeDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Check various taxonomic scenarios
      const observations = await queryDatabase(
        dbPath,
        'SELECT DISTINCT scientificName, commonName FROM observations WHERE scientificName IS NOT NULL'
      )

      // Should have proper scientific names constructed from genus + species
      const scientificNames = observations.map((obs) => obs.scientificName)
      assert(scientificNames.includes('Vulpes vulpes'), 'Should have Vulpes vulpes')

      // Should handle blank entries - they should have commonName = 'Blank' but scientificName = null
      const blankObs = await queryDatabase(
        dbPath,
        "SELECT * FROM observations WHERE commonName = 'Blank' AND scientificName IS NULL"
      )
      assert(
        blankObs.length > 0,
        'Should properly handle blank observations with null scientificName'
      )
    })

    test('should skip records without image_id or taxonomic info', async () => {
      const studyId = 'test-wildlife-filtering'
      await importWildlifeDatasetWithPath(testWildlifeDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // All media records should have mediaID
      const mediaWithoutId = await queryDatabase(
        dbPath,
        'SELECT * FROM media WHERE mediaID IS NULL'
      )
      assert.equal(mediaWithoutId.length, 0, 'No media records should have null mediaID')

      // All observations should have mediaID
      const obsWithoutMediaId = await queryDatabase(
        dbPath,
        'SELECT * FROM observations WHERE mediaID IS NULL'
      )
      assert.equal(obsWithoutMediaId.length, 0, 'No observations should have null mediaID')
    })

    test('should handle timestamps correctly', async () => {
      const studyId = 'test-wildlife-timestamps'
      await importWildlifeDatasetWithPath(testWildlifeDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Check that timestamps are in ISO format
      const mediaWithTimestamp = await queryDatabase(
        dbPath,
        'SELECT timestamp FROM media WHERE timestamp IS NOT NULL LIMIT 5'
      )

      for (const media of mediaWithTimestamp) {
        // ISO format should contain 'T' and 'Z' or timezone info
        assert(media.timestamp.includes('T'), 'Timestamp should be in ISO format')
      }

      // Check specific timestamp conversion
      const specificRecord = await queryDatabase(
        dbPath,
        "SELECT timestamp FROM media WHERE mediaID = 'e668cfa2-c2c3-476b-b132-3daf1fe0e260'"
      )
      assert.equal(specificRecord.length, 1, 'Should find the specific record')
      assert(specificRecord[0].timestamp.includes('2024-04-09'), 'Should have correct date')
      assert(specificRecord[0].timestamp.includes('12:15:36'), 'Should have correct time')
    })

    test('study.json should be created with valid name', async () => {
      const studyId = 'test-wildlife-study-json'

      // Import the test dataset
      const result = await importWildlifeDatasetWithPath(
        testWildlifeDataPath,
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
      assert.equal(studyData.importerName, 'wildlife/folder', 'should have correct importer name')

      // Should either have project name from CSV or fallback to directory name
      assert(
        studyData.name === 'RafaBenjumea' || studyData.name === 'wildlife',
        `name should be project name from CSV or fallback to directory name, got: ${studyData.name}`
      )

      assert(Array.isArray(studyData.data.contributors), 'Contributors should be an array')
      assert.equal(studyData.data.contributors.length, 1, 'Should have one contributor')
      assert.equal(
        studyData.data.contributors[0].title,
        'Rafa Benjumea',
        'Should have correct contributor name'
      )

      // Should match the returned data
      assert.deepEqual(result.data, studyData, 'returned data should match study.json content')
    })
  })
})
