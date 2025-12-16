import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, writeFileSync, copyFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

// Import the function we want to test
import { importCamTrapDatasetWithPath } from '../src/main/import/camtrap.js'

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
      const expectedTables = [
        '__drizzle_migrations',
        'deployments',
        'media',
        'metadata',
        'model_outputs',
        'model_runs',
        'observations',
        'ocr_outputs'
      ]
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
      assert.equal(
        redDeerObs.classificationProbability,
        0.95,
        'Should have correct classificationProbability'
      )
    })

    test('should import bounding boxes correctly including zero values', async () => {
      const studyId = 'test-camtrap-bboxes'
      await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

      // Test obs001: normal bbox values (0.1, 0.2, 0.3, 0.4)
      const obs001 = queryDatabase(
        dbPath,
        "SELECT bboxX, bboxY, bboxWidth, bboxHeight FROM observations WHERE observationID = 'obs001'"
      )
      assert.equal(obs001.length, 1, 'Should find obs001')
      assert.equal(obs001[0].bboxX, 0.1, 'obs001: bboxX should be 0.1')
      assert.equal(obs001[0].bboxY, 0.2, 'obs001: bboxY should be 0.2')
      assert.equal(obs001[0].bboxWidth, 0.3, 'obs001: bboxWidth should be 0.3')
      assert.equal(obs001[0].bboxHeight, 0.4, 'obs001: bboxHeight should be 0.4')

      // Test obs002: bboxX=0 (edge case - should NOT be null)
      const obs002 = queryDatabase(
        dbPath,
        "SELECT bboxX, bboxY, bboxWidth, bboxHeight FROM observations WHERE observationID = 'obs002'"
      )
      assert.equal(obs002.length, 1, 'Should find obs002')
      assert.equal(obs002[0].bboxX, 0, 'obs002: bboxX=0 should be preserved as 0, not null')
      assert.equal(obs002[0].bboxY, 0.5, 'obs002: bboxY should be 0.5')
      assert.equal(obs002[0].bboxWidth, 0.25, 'obs002: bboxWidth should be 0.25')
      assert.equal(obs002[0].bboxHeight, 0.35, 'obs002: bboxHeight should be 0.35')

      // Test obs004: bboxY=0 (edge case - should NOT be null)
      const obs004 = queryDatabase(
        dbPath,
        "SELECT bboxX, bboxY, bboxWidth, bboxHeight FROM observations WHERE observationID = 'obs004'"
      )
      assert.equal(obs004.length, 1, 'Should find obs004')
      assert.equal(obs004[0].bboxX, 0.15, 'obs004: bboxX should be 0.15')
      assert.equal(obs004[0].bboxY, 0, 'obs004: bboxY=0 should be preserved as 0, not null')
      assert.equal(obs004[0].bboxWidth, 0.2, 'obs004: bboxWidth should be 0.2')
      assert.equal(obs004[0].bboxHeight, 0.3, 'obs004: bboxHeight should be 0.3')

      // Test obs006: both bboxX=0 AND bboxY=0 (double edge case)
      const obs006 = queryDatabase(
        dbPath,
        "SELECT bboxX, bboxY, bboxWidth, bboxHeight FROM observations WHERE observationID = 'obs006'"
      )
      assert.equal(obs006.length, 1, 'Should find obs006')
      assert.equal(obs006[0].bboxX, 0, 'obs006: bboxX=0 should be preserved as 0, not null')
      assert.equal(obs006[0].bboxY, 0, 'obs006: bboxY=0 should be preserved as 0, not null')
      assert.equal(obs006[0].bboxWidth, 0.5, 'obs006: bboxWidth should be 0.5')
      assert.equal(obs006[0].bboxHeight, 0.6, 'obs006: bboxHeight should be 0.6')

      // Test obs003: empty observation (no bbox values - should all be null)
      const obs003 = queryDatabase(
        dbPath,
        "SELECT bboxX, bboxY, bboxWidth, bboxHeight FROM observations WHERE observationID = 'obs003'"
      )
      assert.equal(obs003.length, 1, 'Should find obs003')
      assert.equal(obs003[0].bboxX, null, 'obs003: bboxX should be null for empty observation')
      assert.equal(obs003[0].bboxY, null, 'obs003: bboxY should be null for empty observation')
      assert.equal(
        obs003[0].bboxWidth,
        null,
        'obs003: bboxWidth should be null for empty observation'
      )
      assert.equal(
        obs003[0].bboxHeight,
        null,
        'obs003: bboxHeight should be null for empty observation'
      )

      // Verify count of observations with valid bboxes (where bboxX IS NOT NULL)
      const bboxCount = queryDatabase(
        dbPath,
        'SELECT COUNT(*) as count FROM observations WHERE bboxX IS NOT NULL'
      )
      assert.equal(bboxCount[0].count, 8, 'Should have 8 observations with bounding boxes')

      // Verify count of observations without bboxes
      const noBboxCount = queryDatabase(
        dbPath,
        'SELECT COUNT(*) as count FROM observations WHERE bboxX IS NULL'
      )
      assert.equal(
        noBboxCount[0].count,
        2,
        'Should have 2 observations without bounding boxes (Empty observations)'
      )
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
        assert(media.filePath.includes('images'), 'FilePath should contain relative path segment')
        assert(media.fileName.endsWith('.JPG'), 'FileName should have correct extension')
        // The path should be absolute (starts with / on Unix or drive letter on Windows)
        const isAbsolute = media.filePath.startsWith('/') || /^[A-Z]:/i.test(media.filePath)
        assert(isAbsolute, 'FilePath should be transformed to an absolute path')
      }
    })

    test('should resolve relative paths to camtrap directory when media exists there', async () => {
      // Create a temporary camtrap directory with media subfolder
      const tempCamtrapDir = join(testBiowatchDataPath, 'camtrap-with-media')
      const mediaDir = join(tempCamtrapDir, 'media')
      mkdirSync(mediaDir, { recursive: true })

      // Copy datapackage.json and deployments.csv only (no observations.csv to avoid FK issues)
      copyFileSync(
        join(testCamTrapDataPath, 'datapackage.json'),
        join(tempCamtrapDir, 'datapackage.json')
      )
      copyFileSync(
        join(testCamTrapDataPath, 'deployments.csv'),
        join(tempCamtrapDir, 'deployments.csv')
      )

      // Create a media.csv with paths pointing to media/ subfolder (like our export does)
      const mediaCsv = `mediaID,deploymentID,filePath,fileName,timestamp
media001,deploy001,media/test-image.jpg,test-image.jpg,2023-03-20T14:30:15Z`
      writeFileSync(join(tempCamtrapDir, 'media.csv'), mediaCsv)

      // Create the actual media file in the media subfolder
      writeFileSync(join(mediaDir, 'test-image.jpg'), 'fake image content')

      const studyId = 'test-camtrap-media-subfolder'
      await importCamTrapDatasetWithPath(tempCamtrapDir, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
      const mediaRecords = queryDatabase(
        dbPath,
        "SELECT filePath FROM media WHERE mediaID = 'media001'"
      )

      assert.equal(mediaRecords.length, 1, 'Should find the media record')
      // Should resolve to the camtrap directory (where file exists), not parent
      assert(
        mediaRecords[0].filePath.includes(join('camtrap-with-media', 'media')),
        'FilePath should resolve relative to camtrap directory when file exists there'
      )
      assert(
        existsSync(mediaRecords[0].filePath),
        'Resolved file path should point to existing file'
      )
    })

    test('should fall back to parent directory when media does not exist in camtrap directory', async () => {
      // Create a temporary camtrap directory WITHOUT media subfolder
      const tempCamtrapDir = join(testBiowatchDataPath, 'camtrap-without-media')
      mkdirSync(tempCamtrapDir, { recursive: true })

      // Create media in the PARENT directory (sibling to camtrap dir)
      const siblingMediaDir = join(testBiowatchDataPath, 'sibling-media')
      mkdirSync(siblingMediaDir, { recursive: true })
      writeFileSync(join(siblingMediaDir, 'sibling-image.jpg'), 'fake image content')

      // Copy datapackage.json and deployments.csv only (no observations.csv to avoid FK issues)
      copyFileSync(
        join(testCamTrapDataPath, 'datapackage.json'),
        join(tempCamtrapDir, 'datapackage.json')
      )
      copyFileSync(
        join(testCamTrapDataPath, 'deployments.csv'),
        join(tempCamtrapDir, 'deployments.csv')
      )

      // Create a media.csv with paths pointing to sibling directory
      const mediaCsv = `mediaID,deploymentID,filePath,fileName,timestamp
media001,deploy001,sibling-media/sibling-image.jpg,sibling-image.jpg,2023-03-20T14:30:15Z`
      writeFileSync(join(tempCamtrapDir, 'media.csv'), mediaCsv)

      const studyId = 'test-camtrap-sibling-media'
      await importCamTrapDatasetWithPath(tempCamtrapDir, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
      const mediaRecords = queryDatabase(
        dbPath,
        "SELECT filePath FROM media WHERE mediaID = 'media001'"
      )

      assert.equal(mediaRecords.length, 1, 'Should find the media record')
      // Should fall back to parent directory (backward compatibility)
      assert(
        mediaRecords[0].filePath.includes('sibling-media'),
        'FilePath should fall back to parent directory when file does not exist in camtrap dir'
      )
    })

    test('should handle cross-platform path separators correctly', async () => {
      // Create a temporary camtrap directory with nested media structure
      const tempCamtrapDir = join(testBiowatchDataPath, 'camtrap-cross-platform')
      const nestedMediaDir = join(tempCamtrapDir, 'media', 'subfolder')
      mkdirSync(nestedMediaDir, { recursive: true })

      // Copy datapackage.json and deployments.csv only (no observations.csv to avoid FK issues)
      copyFileSync(
        join(testCamTrapDataPath, 'datapackage.json'),
        join(tempCamtrapDir, 'datapackage.json')
      )
      copyFileSync(
        join(testCamTrapDataPath, 'deployments.csv'),
        join(tempCamtrapDir, 'deployments.csv')
      )

      // Create the actual media file
      writeFileSync(join(nestedMediaDir, 'nested-image.jpg'), 'fake image content')

      // Create a media.csv with forward slashes (standard Camtrap DP format)
      const mediaCsv = `mediaID,deploymentID,filePath,fileName,timestamp
media001,deploy001,media/subfolder/nested-image.jpg,nested-image.jpg,2023-03-20T14:30:15Z`
      writeFileSync(join(tempCamtrapDir, 'media.csv'), mediaCsv)

      const studyId = 'test-camtrap-cross-platform'
      await importCamTrapDatasetWithPath(tempCamtrapDir, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
      const mediaRecords = queryDatabase(
        dbPath,
        "SELECT filePath FROM media WHERE mediaID = 'media001'"
      )

      assert.equal(mediaRecords.length, 1, 'Should find the media record')
      // The resolved path should exist regardless of OS
      assert(
        existsSync(mediaRecords[0].filePath),
        'Resolved file path should point to existing file'
      )
      // Path should be properly formatted for the current OS
      assert(
        mediaRecords[0].filePath.includes('nested-image.jpg'),
        'FilePath should contain the filename'
      )
    })

    test('should preserve absolute paths unchanged', async () => {
      // Create a temporary camtrap directory
      const tempCamtrapDir = join(testBiowatchDataPath, 'camtrap-absolute')
      mkdirSync(tempCamtrapDir, { recursive: true })

      // Copy datapackage.json and deployments.csv only (no observations.csv to avoid FK issues)
      copyFileSync(
        join(testCamTrapDataPath, 'datapackage.json'),
        join(tempCamtrapDir, 'datapackage.json')
      )
      copyFileSync(
        join(testCamTrapDataPath, 'deployments.csv'),
        join(tempCamtrapDir, 'deployments.csv')
      )

      // Create a media.csv with absolute path
      const absolutePath = join(testBiowatchDataPath, 'absolute-media', 'absolute-image.jpg')
      const mediaCsv = `mediaID,deploymentID,filePath,fileName,timestamp
media001,deploy001,${absolutePath},absolute-image.jpg,2023-03-20T14:30:15Z`
      writeFileSync(join(tempCamtrapDir, 'media.csv'), mediaCsv)

      const studyId = 'test-camtrap-absolute-path'
      await importCamTrapDatasetWithPath(tempCamtrapDir, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
      const mediaRecords = queryDatabase(
        dbPath,
        "SELECT filePath FROM media WHERE mediaID = 'media001'"
      )

      assert.equal(mediaRecords.length, 1, 'Should find the media record')
      // Absolute paths should be preserved unchanged
      assert.equal(
        mediaRecords[0].filePath,
        absolutePath,
        'Absolute path should be preserved unchanged'
      )
    })

    test('should preserve URLs unchanged', async () => {
      // Create a temporary camtrap directory
      const tempCamtrapDir = join(testBiowatchDataPath, 'camtrap-url')
      mkdirSync(tempCamtrapDir, { recursive: true })

      // Copy datapackage.json and deployments.csv only (no observations.csv to avoid FK issues)
      copyFileSync(
        join(testCamTrapDataPath, 'datapackage.json'),
        join(tempCamtrapDir, 'datapackage.json')
      )
      copyFileSync(
        join(testCamTrapDataPath, 'deployments.csv'),
        join(tempCamtrapDir, 'deployments.csv')
      )

      // Create a media.csv with URL
      const mediaUrl = 'https://example.com/media/image.jpg'
      const mediaCsv = `mediaID,deploymentID,filePath,fileName,timestamp
media001,deploy001,${mediaUrl},image.jpg,2023-03-20T14:30:15Z`
      writeFileSync(join(tempCamtrapDir, 'media.csv'), mediaCsv)

      const studyId = 'test-camtrap-url-path'
      await importCamTrapDatasetWithPath(tempCamtrapDir, testBiowatchDataPath, studyId)

      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
      const mediaRecords = queryDatabase(
        dbPath,
        "SELECT filePath FROM media WHERE mediaID = 'media001'"
      )

      assert.equal(mediaRecords.length, 1, 'Should find the media record')
      // URLs should be preserved unchanged
      assert.equal(mediaRecords[0].filePath, mediaUrl, 'URL should be preserved unchanged')
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

    test('metadata should be stored in database with valid CamTrapDP info', async () => {
      const studyId = 'test-camtrap-metadata'

      // Import the test dataset
      const result = await importCamTrapDatasetWithPath(
        testCamTrapDataPath,
        testBiowatchDataPath,
        studyId
      )

      // Check that metadata was stored in database
      const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
      assert(existsSync(dbPath), 'Database should be created')

      // Query the metadata table
      const metadataRecords = queryDatabase(dbPath, 'SELECT * FROM metadata')
      assert.equal(metadataRecords.length, 1, 'Should have one metadata record')

      const metadata = metadataRecords[0]

      // Verify the structure and content
      assert(metadata.name, 'metadata should contain a name property')
      assert.equal(typeof metadata.name, 'string', 'name should be a string')
      assert(metadata.name.length > 0, 'name should not be empty')
      assert.equal(
        metadata.importerName,
        'camtrap/datapackage',
        'should have correct importer name'
      )
      assert(metadata.created, 'metadata should contain a created property')
      assert.equal(typeof metadata.created, 'string', 'created should be a string')
      assert(!isNaN(Date.parse(metadata.created)), 'created should be a valid ISO date string')

      // Should extract name from datapackage.json
      assert.equal(metadata.name, 'test-camtrap-dataset', 'name should match datapackage name')

      // Verify datapackage metadata is preserved
      assert.equal(metadata.title, 'Test CamTrap Dataset', 'Should preserve datapackage title')

      // Verify returned data matches
      assert(result.data, 'Should return data')
      assert.equal(result.data.name, metadata.name, 'returned name should match metadata')
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
