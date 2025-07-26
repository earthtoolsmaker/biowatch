import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import sqlite3 from 'sqlite3'

// Import the function we want to test
import { importDeepfauneDatasetWithPath } from '../src/main/deepfaune.js'

// Test data paths
let testUserDataPath
let testCsvPath

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

  testUserDataPath = join(tmpdir(), 'biowatch-import-test', Date.now().toString())
  mkdirSync(testUserDataPath, { recursive: true })

  // Use the test CSV file directly from the test directory
  testCsvPath = join(process.cwd(), 'test', 'data', 'deepfaune-test.csv')
})

afterEach(() => {
  // Clean up test directory
  if (existsSync(testUserDataPath)) {
    rmSync(testUserDataPath, { recursive: true, force: true })
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
  const results = await queryDatabase(dbPath, `SELECT * FROM ${tableName}`)
  console.log(`Results for table ${tableName}:`, results)
  return results.length
}

describe('Import Methods Tests', () => {
  describe('Deepfaune CSV Import', () => {
    test('should import Deepfaune CSV and create correct number of records', async () => {
      const studyId = 'test-deepfaune-study'

      // Run the import using the new function with global logger
      const result = await importDeepfauneDatasetWithPath(testCsvPath, testUserDataPath, studyId)

      // Verify the result structure
      assert(result.data, 'Import result should contain data')
      assert.equal(result.data.importerName, 'deepfaune/csv', 'Should use correct importer name')
      assert.equal(result.data.name, 'deepfaune-test', 'Should extract name from CSV filename')

      // Check that study.json was created
      const studyJsonPath = join(testUserDataPath, 'studies', studyId, 'study.json')
      assert(existsSync(studyJsonPath), 'study.json should be created')

      // Check that database was created
      const dbPath = join(testUserDataPath, 'studies', studyId, 'study.db')
      assert(existsSync(dbPath), 'Database should be created')

      // Count deployments - should be 2 (cam1/sd1 and cam2)
      const deploymentCount = await countRecords(dbPath, 'deployments')
      assert.equal(deploymentCount, 2, 'Should create 2 deployments')

      // Count media records - should be 34 (41 total - 7 with "NA" dates)
      const mediaCount = await countRecords(dbPath, 'media')
      assert.equal(mediaCount, 34, 'Should create 34 media records (excluding NA dates)')

      // Count observations - should be 34 (all records with valid dates have predictions)
      const observationCount = await countRecords(dbPath, 'observations')
      assert.equal(observationCount, 34, 'Should create 34 observation records')

      // Verify deployment details
      const deployments = await queryDatabase(
        dbPath,
        'SELECT * FROM deployments ORDER BY locationName'
      )
      assert.equal(deployments.length, 2, 'Should have 2 deployments')

      // Check deployment names
      const deploymentNames = deployments.map((d) => d.locationName).sort()
      assert.deepEqual(deploymentNames, ['cam2', 'sd1'], 'Should have correct deployment names')

      // Verify each deployment has correct media count
      const cam1MediaCount = await countRecords(
        dbPath,
        `media WHERE deploymentID = '${deployments.find((d) => d.locationName === 'sd1').deploymentID}'`
      )
      const cam2MediaCount = await countRecords(
        dbPath,
        `media WHERE deploymentID = '${deployments.find((d) => d.locationName === 'cam2').deploymentID}'`
      )

      assert.equal(cam1MediaCount, 14, 'cam1/sd1 should have 14 media records')
      assert.equal(cam2MediaCount, 20, 'cam2 should have 20 media records')
    })

    test('should handle deployment date ranges correctly', async () => {
      const studyId = 'test-deepfaune-dates'

      await importDeepfauneDatasetWithPath(testCsvPath, testUserDataPath, studyId)

      const dbPath = join(testUserDataPath, 'studies', studyId, 'study.db')
      const deployments = await queryDatabase(dbPath, 'SELECT * FROM deployments')

      console.log('Deployments:', deployments)

      // Each deployment should have start and end dates
      for (const deployment of deployments) {
        assert(
          deployment.deploymentStart,
          `Deployment ${deployment.locationName} should have start date`
        )
        assert(
          deployment.deploymentEnd,
          `Deployment ${deployment.locationName} should have end date`
        )

        // Start date should be <= end date
        assert(
          deployment.deploymentStart <= deployment.deploymentEnd,
          `Deployment ${deployment.locationName} start should be <= end`
        )

        // Verify deployment start matches the earliest media date for this deployment
        const mediaForDeployment = await queryDatabase(
          dbPath,
          `SELECT MIN(timestamp) as earliestDate, MAX(timestamp) as latestDate
           FROM media WHERE deploymentID = '${deployment.deploymentID}'`
        )

        if (mediaForDeployment[0].earliestDate) {
          assert.equal(
            deployment.deploymentStart,
            mediaForDeployment[0].earliestDate,
            `Deployment ${deployment.locationName} start should match earliest media date`
          )
          assert.equal(
            deployment.deploymentEnd,
            mediaForDeployment[0].latestDate,
            `Deployment ${deployment.locationName} end should match latest media date`
          )
        }
      }
    })

    test('should have correct species', async () => {
      const studyId = 'test-deepfaune-predictions'

      await importDeepfauneDatasetWithPath(testCsvPath, testUserDataPath, studyId)

      const dbPath = join(testUserDataPath, 'studies', studyId, 'study.db')

      // Check for specific predictions from the test data
      const birdObservations = await queryDatabase(
        dbPath,
        `SELECT * FROM observations WHERE prediction = 'bird'`
      )
      assert(birdObservations.length === 2, 'Should have exactly 2 bird observations')
    })
  })

  // Placeholder tests for other import methods - to be implemented when ready
  describe('Other Import Methods', () => {
    test('should be able to test other importers when implemented', () => {
      // This is a placeholder for testing camtrap and wildlife imports
      // When you're ready to test those, you can create similar test functions
      // that don't depend on electron, similar to how we modified the deepfaune import
      assert(true, 'Placeholder test for future import method tests')
    })
  })
})
