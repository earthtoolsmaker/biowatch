import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

// Import the query functions we want to test
import {
  getSpeciesDistribution,
  getLocationsActivity,
  getDeployments,
  getDeploymentsActivity,
  getFilesData,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations,
  getStudyIdFromPath,
  getBlankMediaCount,
  getMediaForSequencePagination
} from '../../../src/main/database/index.js'

// Test database setup
let testBiowatchDataPath
let testDbPath
let testStudyId

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

  testStudyId = `test-queries-${Date.now()}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-queries-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')

  // Create directory structure
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  // Clean up test directory
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

/**
 * Helper function to create test data in the database
 * @param {string} dbPath - Path to the database
 * @returns {Promise<Object>} - Database manager instance and test data references
 */
async function createTestData(dbPath) {
  // Create database and initialize with schema
  const manager = await createImageDirectoryDatabase(dbPath)

  // Create test deployments
  const testDeployments = {
    deploy001: {
      deploymentID: 'deploy001',
      locationID: 'loc001',
      locationName: 'Forest Site A',
      deploymentStart: DateTime.fromISO('2023-03-15T10:00:00Z'),
      deploymentEnd: DateTime.fromISO('2023-06-15T18:00:00Z'),
      latitude: 46.7712,
      longitude: 6.6413
    },
    deploy002: {
      deploymentID: 'deploy002',
      locationID: 'loc002',
      locationName: 'Meadow Site B',
      deploymentStart: DateTime.fromISO('2023-04-01T09:00:00Z'),
      deploymentEnd: DateTime.fromISO('2023-07-01T19:00:00Z'),
      latitude: 46.78,
      longitude: 6.65
    },
    deploy003: {
      deploymentID: 'deploy003',
      locationID: 'loc003',
      locationName: 'River Site C',
      deploymentStart: DateTime.fromISO('2023-03-20T08:00:00Z'),
      deploymentEnd: DateTime.fromISO('2023-06-20T20:00:00Z'),
      latitude: 46.765,
      longitude: 6.63
    }
  }

  await insertDeployments(manager, testDeployments)

  // Create test media
  const testMedia = {
    'media001.jpg': {
      mediaID: 'media001',
      deploymentID: 'deploy001',
      timestamp: DateTime.fromISO('2023-03-20T14:30:15Z'),
      filePath: 'images/folder1/media001.jpg',
      fileName: 'media001.jpg',
      importFolder: 'images',
      folderName: 'folder1'
    },
    'media002.jpg': {
      mediaID: 'media002',
      deploymentID: 'deploy001',
      timestamp: DateTime.fromISO('2023-03-25T16:45:30Z'),
      filePath: 'images/folder1/media002.jpg',
      fileName: 'media002.jpg',
      importFolder: 'images',
      folderName: 'folder1'
    },
    'media003.jpg': {
      mediaID: 'media003',
      deploymentID: 'deploy002',
      timestamp: DateTime.fromISO('2023-04-05T12:15:00Z'),
      filePath: 'images/folder2/media003.jpg',
      fileName: 'media003.jpg',
      importFolder: 'images',
      folderName: 'folder2'
    },
    'media004.jpg': {
      mediaID: 'media004',
      deploymentID: 'deploy002',
      timestamp: DateTime.fromISO('2023-04-10T08:30:45Z'),
      filePath: 'images/folder2/media004.jpg',
      fileName: 'media004.jpg',
      importFolder: 'images',
      folderName: 'folder2'
    },
    'media005.jpg': {
      mediaID: 'media005',
      deploymentID: 'deploy003',
      timestamp: DateTime.fromISO('2023-03-25T22:00:00Z'),
      filePath: 'images/folder3/media005.jpg',
      fileName: 'media005.jpg',
      importFolder: 'images',
      folderName: 'folder3'
    }
  }

  await insertMedia(manager, testMedia)

  // Create test observations with diverse species and scenarios
  const testObservations = [
    {
      observationID: 'obs001',
      mediaID: 'media001',
      deploymentID: 'deploy001',
      eventID: 'event001',
      eventStart: DateTime.fromISO('2023-03-20T14:30:15Z'),
      eventEnd: DateTime.fromISO('2023-03-20T14:30:45Z'),
      scientificName: 'Cervus elaphus',
      commonName: 'Red Deer',
      classificationProbability: 0.95,
      count: 2,
      prediction: 'cervus_elaphus'
    },
    {
      observationID: 'obs002',
      mediaID: 'media002',
      deploymentID: 'deploy001',
      eventID: 'event002',
      eventStart: DateTime.fromISO('2023-03-25T16:45:30Z'),
      eventEnd: DateTime.fromISO('2023-03-25T16:46:00Z'),
      scientificName: 'Vulpes vulpes',
      commonName: 'Red Fox',
      classificationProbability: 0.87,
      count: 1,
      prediction: 'vulpes_vulpes'
    },
    {
      observationID: 'obs003',
      mediaID: 'media003',
      deploymentID: 'deploy002',
      eventID: 'event003',
      eventStart: DateTime.fromISO('2023-04-05T12:15:00Z'),
      eventEnd: DateTime.fromISO('2023-04-05T12:15:30Z'),
      scientificName: 'Cervus elaphus',
      commonName: 'Red Deer',
      classificationProbability: 0.92,
      count: 1,
      prediction: 'cervus_elaphus'
    },
    {
      observationID: 'obs004',
      mediaID: 'media004',
      deploymentID: 'deploy002',
      eventID: 'event004',
      eventStart: DateTime.fromISO('2023-04-10T08:30:45Z'),
      eventEnd: DateTime.fromISO('2023-04-10T08:31:15Z'),
      scientificName: null, // Empty observation
      commonName: 'Empty',
      classificationProbability: null,
      count: 0,
      prediction: 'empty'
    },
    {
      observationID: 'obs005',
      mediaID: 'media005',
      deploymentID: 'deploy003',
      eventID: 'event005',
      eventStart: DateTime.fromISO('2023-03-25T22:00:00Z'),
      eventEnd: DateTime.fromISO('2023-03-25T22:00:30Z'),
      scientificName: 'Sus scrofa',
      commonName: 'Wild Boar',
      classificationProbability: 0.78,
      count: 3,
      prediction: 'sus_scrofa'
    }
  ]

  await insertObservations(manager, testObservations)

  return {
    manager,
    deployments: testDeployments,
    media: testMedia,
    observations: testObservations
  }
}

describe('Database Query Functions Tests', () => {
  describe('getSpeciesDistribution', () => {
    test('should return species distribution with correct counts', async () => {
      await createTestData(testDbPath)

      const result = await getSpeciesDistribution(testDbPath)

      // Should have 3 species (excluding empty observations)
      assert.equal(result.length, 3, 'Should return 3 species')

      // Results should be ordered by count descending
      assert(result[0].count >= result[1].count, 'Results should be ordered by count descending')

      // Check specific species counts
      const redDeer = result.find((s) => s.scientificName === 'Cervus elaphus')
      const redFox = result.find((s) => s.scientificName === 'Vulpes vulpes')
      const wildBoar = result.find((s) => s.scientificName === 'Sus scrofa')

      assert(redDeer, 'Should include Red Deer')
      assert.equal(redDeer.count, 2, 'Red Deer should have count of 2')

      assert(redFox, 'Should include Red Fox')
      assert.equal(redFox.count, 1, 'Red Fox should have count of 1')

      assert(wildBoar, 'Should include Wild Boar')
      assert.equal(wildBoar.count, 1, 'Wild Boar should have count of 1')
    })

    test('should handle empty database gracefully', async () => {
      await createImageDirectoryDatabase(testDbPath)

      const result = await getSpeciesDistribution(testDbPath)

      assert.equal(result.length, 0, 'Should return empty array for empty database')
    })

    test('should exclude null and empty scientific names', async () => {
      await createTestData(testDbPath)

      const result = await getSpeciesDistribution(testDbPath)

      // Should not include the empty observation (obs004)
      const emptyObs = result.find((s) => s.scientificName === null || s.scientificName === '')
      assert(!emptyObs, 'Should not include observations with null or empty scientific names')
    })
  })

  describe('getDeployments', () => {
    test('should return distinct deployment locations', async () => {
      await createTestData(testDbPath)

      const result = await getDeployments(testDbPath)

      assert.equal(result.length, 3, 'Should return 3 deployment locations')

      // Check that all expected locations are present
      const locationNames = result.map((d) => d.locationName).sort()
      const expectedNames = ['Forest Site A', 'Meadow Site B', 'River Site C']
      assert.deepEqual(locationNames, expectedNames, 'Should include all expected location names')

      // Verify coordinates are present
      result.forEach((deployment) => {
        assert(typeof deployment.latitude === 'number', 'Should have numeric latitude')
        assert(typeof deployment.longitude === 'number', 'Should have numeric longitude')
        assert(deployment.deploymentStart, 'Should have deployment start date')
        assert(deployment.deploymentEnd, 'Should have deployment end date')
      })
    })
  })

  describe('getLocationsActivity', () => {
    test('should return activity data with periods and counts', async () => {
      await createTestData(testDbPath)

      const result = await getLocationsActivity(testDbPath)

      assert(result.startDate, 'Should have start date')
      assert(result.endDate, 'Should have end date')
      assert(typeof result.percentile90Count === 'number', 'Should have percentile count')
      assert(Array.isArray(result.locations), 'Should have locations array')
      assert.equal(result.locations.length, 3, 'Should have 3 locations')

      // Each location should have periods with counts
      result.locations.forEach((location) => {
        assert(location.locationID, 'Location should have ID')
        assert(location.locationName, 'Location should have name')
        assert(Array.isArray(location.periods), 'Location should have periods array')

        location.periods.forEach((period) => {
          assert(period.start, 'Period should have start date')
          assert(period.end, 'Period should have end date')
          assert(typeof period.count === 'number', 'Period should have numeric count')
        })
      })
    })
  })

  describe('getDeploymentsActivity', () => {
    test('should return deployment-level activity data', async () => {
      await createTestData(testDbPath)

      const result = await getDeploymentsActivity(testDbPath)

      assert(result.startDate, 'Should have start date')
      assert(result.endDate, 'Should have end date')
      assert(typeof result.percentile90Count === 'number', 'Should have percentile count')
      assert(Array.isArray(result.deployments), 'Should have deployments array')
      assert.equal(result.deployments.length, 3, 'Should have 3 deployments')

      result.deployments.forEach((deployment) => {
        assert(deployment.deploymentID, 'Deployment should have ID')
        assert(deployment.locationName, 'Deployment should have location name')
        assert(Array.isArray(deployment.periods), 'Deployment should have periods array')

        deployment.periods.forEach((period) => {
          assert(period.start, 'Period should have start date')
          assert(period.end, 'Period should have end date')
          assert(typeof period.count === 'number', 'Period should have numeric count')
        })
      })
    })
  })

  describe('getFilesData', () => {
    test('should return directory statistics', async () => {
      await createTestData(testDbPath)

      const result = await getFilesData(testDbPath)

      assert(Array.isArray(result), 'Should return an array')
      assert.equal(result.length, 3, 'Should have 3 directories (locations)')

      result.forEach((directory) => {
        assert(directory.folderName, 'Directory should have folder name')
        assert(typeof directory.imageCount === 'number', 'Should have numeric image count')
        assert(typeof directory.processedCount === 'number', 'Should have numeric processed count')
      })

      // Verify total counts match our test data
      const totalImages = result.reduce((sum, dir) => sum + dir.imageCount, 0)
      const totalProcessed = result.reduce((sum, dir) => sum + dir.processedCount, 0)

      assert.equal(totalImages, 5, 'Should have total of 5 images')
      assert.equal(totalProcessed, 5, 'Should have total of 5 processed observations')
    })
  })

  describe('Error Handling', () => {
    test('should handle non-existent database gracefully', async () => {
      const nonExistentPath = join(testBiowatchDataPath, 'nonexistent', 'test.db')

      try {
        await getSpeciesDistribution(nonExistentPath)
        assert.fail('Should throw error for non-existent database')
      } catch (error) {
        assert(error instanceof Error, 'Should throw an Error')
        // Error could be ENOENT or other database-related errors
        assert(
          error.message.includes('ENOENT') ||
            error.message.includes('no such file') ||
            error.message.includes('database'),
          `Should indicate file/database error, got: ${error.message}`
        )
      }
    })

    test('should handle malformed database path', async () => {
      const malformedPath = '/invalid/path/structure'

      try {
        await getSpeciesDistribution(malformedPath)
        assert.fail('Should throw error for malformed path')
      } catch (error) {
        assert(error instanceof Error, 'Should throw an Error')
      }
    })
  })

  describe('getBlankMediaCount', () => {
    test('should return 0 for mediaID-based dataset with no blanks', async () => {
      // Standard test data has all media linked to observations via mediaID
      await createTestData(testDbPath)

      const result = await getBlankMediaCount(testDbPath)

      assert.equal(result, 0, 'Should return 0 when all media have observations')
    })

    test('should return correct blank count for mediaID-based dataset with blanks', async () => {
      const manager = await createImageDirectoryDatabase(testDbPath)

      // Create deployments
      await insertDeployments(manager, {
        deploy001: {
          deploymentID: 'deploy001',
          locationID: 'loc001',
          locationName: 'Forest Site A',
          deploymentStart: DateTime.fromISO('2023-03-15T10:00:00Z'),
          deploymentEnd: DateTime.fromISO('2023-06-15T18:00:00Z'),
          latitude: 46.7712,
          longitude: 6.6413
        }
      })

      // Create 5 media items
      await insertMedia(manager, {
        'media001.jpg': {
          mediaID: 'media001',
          deploymentID: 'deploy001',
          timestamp: DateTime.fromISO('2023-03-20T14:30:15Z'),
          filePath: 'images/folder1/media001.jpg',
          fileName: 'media001.jpg',
          importFolder: 'images',
          folderName: 'folder1'
        },
        'media002.jpg': {
          mediaID: 'media002',
          deploymentID: 'deploy001',
          timestamp: DateTime.fromISO('2023-03-20T14:30:30Z'),
          filePath: 'images/folder1/media002.jpg',
          fileName: 'media002.jpg',
          importFolder: 'images',
          folderName: 'folder1'
        },
        'media003.jpg': {
          mediaID: 'media003',
          deploymentID: 'deploy001',
          timestamp: DateTime.fromISO('2023-03-20T14:30:45Z'),
          filePath: 'images/folder1/media003.jpg',
          fileName: 'media003.jpg',
          importFolder: 'images',
          folderName: 'folder1'
        },
        'media004.jpg': {
          mediaID: 'media004',
          deploymentID: 'deploy001',
          timestamp: DateTime.fromISO('2023-03-20T14:31:00Z'),
          filePath: 'images/folder1/media004.jpg',
          fileName: 'media004.jpg',
          importFolder: 'images',
          folderName: 'folder1'
        },
        'media005.jpg': {
          mediaID: 'media005',
          deploymentID: 'deploy001',
          timestamp: DateTime.fromISO('2023-03-20T14:31:15Z'),
          filePath: 'images/folder1/media005.jpg',
          fileName: 'media005.jpg',
          importFolder: 'images',
          folderName: 'folder1'
        }
      })

      // Create observations only for media001, media002, media003 (leave media004, media005 as blanks)
      await insertObservations(manager, [
        {
          observationID: 'obs001',
          mediaID: 'media001', // Linked via mediaID
          deploymentID: 'deploy001',
          eventID: 'event001',
          eventStart: DateTime.fromISO('2023-03-20T14:30:15Z'),
          eventEnd: DateTime.fromISO('2023-03-20T14:30:45Z'),
          scientificName: 'Cervus elaphus',
          count: 1
        },
        {
          observationID: 'obs002',
          mediaID: 'media002', // Linked via mediaID
          deploymentID: 'deploy001',
          eventID: 'event001',
          eventStart: DateTime.fromISO('2023-03-20T14:30:15Z'),
          eventEnd: DateTime.fromISO('2023-03-20T14:30:45Z'),
          scientificName: 'Cervus elaphus',
          count: 1
        },
        {
          observationID: 'obs003',
          mediaID: 'media003', // Linked via mediaID
          deploymentID: 'deploy001',
          eventID: 'event001',
          eventStart: DateTime.fromISO('2023-03-20T14:30:15Z'),
          eventEnd: DateTime.fromISO('2023-03-20T14:30:45Z'),
          scientificName: 'Cervus elaphus',
          count: 1
        }
      ])

      const result = await getBlankMediaCount(testDbPath)

      assert.equal(result, 2, 'Should return 2 blanks (media004 and media005)')
    })

    test('should count all media as blank when observations have NULL mediaID (timestamp-based linking)', async () => {
      // Timestamp-based datasets have NULL mediaID in all observations
      // They link media to observations via eventStart/eventEnd time ranges
      // getBlankMediaCount counts media without direct mediaID links, so all are "blank"
      const manager = await createImageDirectoryDatabase(testDbPath)

      // Create deployments
      await insertDeployments(manager, {
        deploy001: {
          deploymentID: 'deploy001',
          locationID: 'loc001',
          locationName: 'Forest Site A',
          deploymentStart: DateTime.fromISO('2023-03-15T10:00:00Z'),
          deploymentEnd: DateTime.fromISO('2023-06-15T18:00:00Z'),
          latitude: 46.7712,
          longitude: 6.6413
        }
      })

      // Create 3 media items in a burst sequence
      await insertMedia(manager, {
        'media001.jpg': {
          mediaID: 'media001',
          deploymentID: 'deploy001',
          timestamp: DateTime.fromISO('2023-03-20T14:30:15Z'),
          filePath: 'images/folder1/media001.jpg',
          fileName: 'media001.jpg',
          importFolder: 'images',
          folderName: 'folder1'
        },
        'media002.jpg': {
          mediaID: 'media002',
          deploymentID: 'deploy001',
          timestamp: DateTime.fromISO('2023-03-20T14:30:20Z'),
          filePath: 'images/folder1/media002.jpg',
          fileName: 'media002.jpg',
          importFolder: 'images',
          folderName: 'folder1'
        },
        'media003.jpg': {
          mediaID: 'media003',
          deploymentID: 'deploy001',
          timestamp: DateTime.fromISO('2023-03-20T14:30:25Z'),
          filePath: 'images/folder1/media003.jpg',
          fileName: 'media003.jpg',
          importFolder: 'images',
          folderName: 'folder1'
        }
      })

      // Create observation with NULL mediaID (timestamp-based linking)
      // This observation covers the entire burst sequence via eventStart/eventEnd
      await insertObservations(manager, [
        {
          observationID: 'obs001',
          mediaID: null, // NULL = timestamp-based linking (CamTrap DP format)
          deploymentID: 'deploy001',
          eventID: 'event001',
          eventStart: DateTime.fromISO('2023-03-20T14:30:15Z'), // First media timestamp
          eventEnd: DateTime.fromISO('2023-03-20T14:30:25Z'), // Last media timestamp
          scientificName: 'Cervus elaphus',
          count: 1
        }
      ])

      const result = await getBlankMediaCount(testDbPath)

      // Returns 3 because getBlankMediaCount only checks for direct mediaID links
      // Timestamp-based linking via eventStart/eventEnd is not considered
      assert.equal(result, 3, 'Should return 3 when no media have direct mediaID links')
    })

    test('should return 0 for empty database with no media', async () => {
      await createImageDirectoryDatabase(testDbPath)

      const result = await getBlankMediaCount(testDbPath)

      assert.equal(result, 0, 'Should return 0 for empty database')
    })

    test('should correctly distinguish mixed datasets with some mediaID observations', async () => {
      // This tests a dataset that has SOME observations with mediaID (so it's not timestamp-based)
      const manager = await createImageDirectoryDatabase(testDbPath)

      await insertDeployments(manager, {
        deploy001: {
          deploymentID: 'deploy001',
          locationID: 'loc001',
          locationName: 'Forest Site A',
          deploymentStart: DateTime.fromISO('2023-03-15T10:00:00Z'),
          deploymentEnd: DateTime.fromISO('2023-06-15T18:00:00Z'),
          latitude: 46.7712,
          longitude: 6.6413
        }
      })

      await insertMedia(manager, {
        'media001.jpg': {
          mediaID: 'media001',
          deploymentID: 'deploy001',
          timestamp: DateTime.fromISO('2023-03-20T14:30:15Z'),
          filePath: 'images/folder1/media001.jpg',
          fileName: 'media001.jpg',
          importFolder: 'images',
          folderName: 'folder1'
        },
        'media002.jpg': {
          mediaID: 'media002',
          deploymentID: 'deploy001',
          timestamp: DateTime.fromISO('2023-03-20T14:30:30Z'),
          filePath: 'images/folder1/media002.jpg',
          fileName: 'media002.jpg',
          importFolder: 'images',
          folderName: 'folder1'
        }
      })

      // One observation with mediaID, one without
      await insertObservations(manager, [
        {
          observationID: 'obs001',
          mediaID: 'media001', // Has mediaID - makes this a mediaID-based dataset
          deploymentID: 'deploy001',
          eventID: 'event001',
          eventStart: DateTime.fromISO('2023-03-20T14:30:15Z'),
          eventEnd: DateTime.fromISO('2023-03-20T14:30:45Z'),
          scientificName: 'Cervus elaphus',
          count: 1
        },
        {
          observationID: 'obs002',
          mediaID: null, // This one has NULL mediaID
          deploymentID: 'deploy001',
          eventID: 'event002',
          eventStart: DateTime.fromISO('2023-03-20T15:00:00Z'),
          eventEnd: DateTime.fromISO('2023-03-20T15:00:30Z'),
          scientificName: 'Vulpes vulpes',
          count: 1
        }
      ])

      const result = await getBlankMediaCount(testDbPath)

      // Should treat as mediaID-based dataset (because at least one obs has mediaID)
      // media002 has no observation linked via mediaID, so it's blank
      assert.equal(result, 1, 'Should return 1 blank for mixed dataset')
    })
  })

  describe('getStudyIdFromPath', () => {
    test('should extract studyId from Unix-style path', () => {
      const unixPath = '/home/user/.biowatch/studies/abc123-def456/study.db'
      const result = getStudyIdFromPath(unixPath)
      assert.equal(result, 'abc123-def456', 'Should extract studyId from Unix path')
    })

    test('should extract studyId from Windows-style path', () => {
      const windowsPath =
        'C:\\Users\\user\\AppData\\Roaming\\biowatch\\studies\\abc123-def456\\study.db'
      const result = getStudyIdFromPath(windowsPath)
      assert.equal(result, 'abc123-def456', 'Should extract studyId from Windows path')
    })

    test('should handle mixed path separators', () => {
      const mixedPath = 'C:\\Users\\user/AppData/Roaming\\biowatch/studies\\abc123-def456/study.db'
      const result = getStudyIdFromPath(mixedPath)
      assert.equal(result, 'abc123-def456', 'Should extract studyId from mixed path')
    })

    test('should return unknown for path without parent directory', () => {
      const shortPath = 'study.db'
      const result = getStudyIdFromPath(shortPath)
      assert.equal(result, 'unknown', 'Should return unknown for single element path')
    })

    test('should return unknown for empty path', () => {
      const emptyPath = ''
      const result = getStudyIdFromPath(emptyPath)
      assert.equal(result, 'unknown', 'Should return unknown for empty path')
    })

    test('should handle path with trailing separator', () => {
      const trailingPath = '/home/user/.biowatch/studies/abc123-def456/'
      const result = getStudyIdFromPath(trailingPath)
      // After split, last element is empty string, so second-to-last is the studyId
      assert.equal(
        result,
        'abc123-def456',
        'Should extract studyId from path with trailing separator'
      )
    })

    test('should extract real UUID-style studyId', () => {
      const realPath = '/mnt/data/biowatch/studies/70d5bc5d-1234-5678-9abc-def012345678/study.db'
      const result = getStudyIdFromPath(realPath)
      assert.equal(result, '70d5bc5d-1234-5678-9abc-def012345678', 'Should extract UUID studyId')
    })
  })

  describe('getMediaForSequencePagination with no date filter', () => {
    test('should return all media when dateRange is empty (select all)', async () => {
      await createTestData(testDbPath)

      // Query with NO dateRange filter (empty object = select all)
      const result = await getMediaForSequencePagination(testDbPath, {
        species: ['Cervus elaphus'],
        dateRange: {} // Empty = select all, no date filtering
      })

      // Should return 2 media for Red Deer (media001 and media003)
      assert.equal(result.media.length, 2, 'Should return all media when no date filter')
    })

    test('should return media at week boundaries when dateRange is empty', async () => {
      // This test simulates the bug scenario: media timestamp is later in the day
      // than the week-start boundary that was previously used as dateRange.end
      const manager = await createImageDirectoryDatabase(testDbPath)

      await insertDeployments(manager, {
        deploy001: {
          deploymentID: 'deploy001',
          locationID: 'loc001',
          locationName: 'Test Site',
          deploymentStart: DateTime.fromISO('2023-07-01T00:00:00Z'),
          deploymentEnd: DateTime.fromISO('2023-07-31T23:59:59Z'),
          latitude: 46.77,
          longitude: 6.64
        }
      })

      // Create media with timestamp later in the day on week start (simulating the Roan bug)
      // Week start = 2023-07-15T00:00:00Z, but media timestamp is 18:26:21
      await insertMedia(manager, {
        'roan_media.jpg': {
          mediaID: 'roan_media',
          deploymentID: 'deploy001',
          timestamp: DateTime.fromISO('2023-07-15T18:26:21Z'), // Later than midnight
          filePath: 'images/folder1/roan_media.jpg',
          fileName: 'roan_media.jpg',
          importFolder: 'images',
          folderName: 'folder1'
        }
      })

      await insertObservations(manager, [
        {
          observationID: 'obs_roan',
          mediaID: 'roan_media',
          deploymentID: 'deploy001',
          eventID: 'event_roan',
          eventStart: DateTime.fromISO('2023-07-15T18:26:21Z'),
          eventEnd: DateTime.fromISO('2023-07-15T18:26:51Z'),
          scientificName: 'roan',
          commonName: 'Roan Antelope',
          classificationProbability: 0.9,
          count: 1,
          prediction: 'roan'
        }
      ])

      // Query with empty dateRange (no date filter)
      const result = await getMediaForSequencePagination(testDbPath, {
        species: ['roan'],
        dateRange: {} // Empty = select all
      })

      assert.equal(result.media.length, 1, 'Should return roan media when no date filter')
      assert.equal(result.media[0].mediaID, 'roan_media', 'Should return the correct media')
    })

    test('should still filter by dateRange when explicitly provided', async () => {
      await createTestData(testDbPath)

      // Query with explicit dateRange that excludes some media
      const result = await getMediaForSequencePagination(testDbPath, {
        species: ['Cervus elaphus'],
        dateRange: {
          start: '2023-03-19T00:00:00Z',
          end: '2023-03-21T23:59:59Z' // Only includes media001, not media003 (April)
        }
      })

      assert.equal(result.media.length, 1, 'Should filter by dateRange when provided')
      assert.equal(result.media[0].mediaID, 'media001', 'Should return only media001')
    })
  })
})
