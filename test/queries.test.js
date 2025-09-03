import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import { DateTime } from 'luxon'

// Import the query functions we want to test
import {
  getSpeciesDistribution,
  getLocationsActivity,
  getSpeciesTimeseries,
  getSpeciesHeatmapData,
  getMedia,
  getSpeciesDailyActivity,
  getDeployments,
  getDeploymentsActivity,
  getFilesData,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../src/main/queries.js'

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
      confidence: 0.95,
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
      confidence: 0.87,
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
      confidence: 0.92,
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
      confidence: null,
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
      confidence: 0.78,
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

  describe('getSpeciesTimeseries', () => {
    test('should return timeseries data for all species', async () => {
      await createTestData(testDbPath)

      const result = await getSpeciesTimeseries(testDbPath)

      assert(result.allSpecies, 'Should have allSpecies array')
      assert(result.timeseries, 'Should have timeseries array')
      assert(Array.isArray(result.allSpecies), 'allSpecies should be an array')
      assert(Array.isArray(result.timeseries), 'timeseries should be an array')

      // Should have 3 species
      assert.equal(result.allSpecies.length, 3, 'Should have 3 species')

      // Species should be sorted by count descending
      assert(
        result.allSpecies[0].count >= result.allSpecies[1].count,
        'Species should be sorted by count descending'
      )

      // Timeseries should have data points
      assert(result.timeseries.length > 0, 'Should have timeseries data points')

      // Each timeseries point should have date and species data
      result.timeseries.forEach((point) => {
        assert(point.date, 'Timeseries point should have date')
      })
    })

    test('should filter by specific species', async () => {
      await createTestData(testDbPath)

      const result = await getSpeciesTimeseries(testDbPath, ['Cervus elaphus'])

      assert.equal(result.allSpecies.length, 1, 'Should return only filtered species')
      assert.equal(
        result.allSpecies[0].scientificName,
        'Cervus elaphus',
        'Should return correct filtered species'
      )
    })
  })

  describe('getSpeciesHeatmapData', () => {
    test('should return heatmap data for specified species', async () => {
      await createTestData(testDbPath)

      const species = ['Cervus elaphus', 'Vulpes vulpes']
      const startDate = '2023-03-01T00:00:00Z'
      const endDate = '2023-05-01T00:00:00Z'

      const result = await getSpeciesHeatmapData(testDbPath, species, startDate, endDate)

      assert(typeof result === 'object', 'Should return an object')
      assert(result['Cervus elaphus'], 'Should have data for Cervus elaphus')
      assert(result['Vulpes vulpes'], 'Should have data for Vulpes vulpes')

      // Check data structure for each species
      species.forEach((speciesName) => {
        if (result[speciesName] && result[speciesName].length > 0) {
          result[speciesName].forEach((point) => {
            assert(typeof point.lat === 'number', 'Should have numeric latitude')
            assert(typeof point.lng === 'number', 'Should have numeric longitude')
            assert(typeof point.count === 'number', 'Should have numeric count')
            assert(point.locationName, 'Should have location name')
          })
        }
      })
    })

    test('should handle time range filtering', async () => {
      await createTestData(testDbPath)

      const species = ['Sus scrofa'] // Only observed at 22:00
      const startDate = '2023-03-01T00:00:00Z'
      const endDate = '2023-05-01T00:00:00Z'
      const startHour = 21 // 9 PM
      const endHour = 23 // 11 PM

      const result = await getSpeciesHeatmapData(
        testDbPath,
        species,
        startDate,
        endDate,
        startHour,
        endHour
      )

      assert(result['Sus scrofa'], 'Should include Sus scrofa within time range')
      assert(result['Sus scrofa'].length > 0, 'Should have data points for Sus scrofa')
    })
  })

  describe('getMedia', () => {
    test('should return media with pagination', async () => {
      await createTestData(testDbPath)

      const result = await getMedia(testDbPath, { limit: 3, offset: 0 })

      assert(Array.isArray(result), 'Should return an array')
      assert(result.length <= 3, 'Should respect limit parameter')

      result.forEach((media) => {
        assert(media.mediaID, 'Media should have ID')
        assert(media.filePath, 'Media should have file path')
        assert(media.fileName, 'Media should have file name')
        assert(media.timestamp, 'Media should have timestamp')
        assert(media.scientificName, 'Media should have associated species')
      })
    })

    test('should filter by species', async () => {
      await createTestData(testDbPath)

      const result = await getMedia(testDbPath, {
        species: ['Cervus elaphus'],
        limit: 10
      })

      result.forEach((media) => {
        assert.equal(
          media.scientificName,
          'Cervus elaphus',
          'All returned media should be for specified species'
        )
      })
    })

    test('should filter by date range', async () => {
      await createTestData(testDbPath)

      const result = await getMedia(testDbPath, {
        dateRange: {
          start: '2023-03-15T00:00:00Z',
          end: '2023-03-30T23:59:59Z'
        },
        limit: 10
      })

      result.forEach((media) => {
        const mediaDate = new Date(media.timestamp)
        const startDate = new Date('2023-03-15T00:00:00Z')
        const endDate = new Date('2023-03-30T23:59:59Z')

        assert(
          mediaDate >= startDate && mediaDate <= endDate,
          'Media timestamp should be within specified date range'
        )
      })
    })
  })

  describe('getSpeciesDailyActivity', () => {
    test('should return hourly activity patterns', async () => {
      await createTestData(testDbPath)

      const species = ['Cervus elaphus', 'Vulpes vulpes']
      const startDate = '2023-03-01T00:00:00Z'
      const endDate = '2023-05-01T00:00:00Z'

      const result = await getSpeciesDailyActivity(testDbPath, species, startDate, endDate)

      assert(Array.isArray(result), 'Should return an array')
      assert.equal(result.length, 24, 'Should return 24 hours of data')

      result.forEach((hourData, hour) => {
        assert.equal(hourData.hour, hour, 'Should have correct hour')
        species.forEach((speciesName) => {
          assert(
            typeof hourData[speciesName] === 'number',
            `Should have numeric count for ${speciesName}`
          )
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
})
