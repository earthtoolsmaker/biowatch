import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import { DateTime } from 'luxon'

// Import database functions and schema
import {
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../src/main/queries.js'
import { getDrizzleDb } from '../src/main/db/index.js'
import { deployments, media, observations } from '../src/main/db/schema.js'
import { eq, count, sql } from 'drizzle-orm'

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

  testStudyId = `test-schema-${Date.now()}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-schema-test', testStudyId)
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
 * Helper function to get raw database connection
 * @param {string} dbPath - Path to the database
 * @returns {Database} - SQLite database connection
 */
function getRawDatabase(dbPath) {
  return new Database(dbPath)
}

/**
 * Helper function to query table schema information
 * @param {Database} db - Database connection
 * @param {string} tableName - Name of the table
 * @returns {Array} - Table schema information
 */
function getTableSchema(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all()
}

/**
 * Helper function to get foreign key information
 * @param {Database} db - Database connection
 * @param {string} tableName - Name of the table
 * @returns {Array} - Foreign key information
 */
function getForeignKeys(db, tableName) {
  return db.prepare(`PRAGMA foreign_key_list(${tableName})`).all()
}

/**
 * Helper function to create comprehensive test data
 * @param {string} dbPath - Path to the database
 * @returns {Promise<Object>} - Test data references
 */
async function createComprehensiveTestData(dbPath) {
  const manager = await createImageDirectoryDatabase(dbPath)

  // Create test deployments with edge cases
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
      locationName: 'Site with Special Chars: "Test" & <Symbols>',
      deploymentStart: DateTime.fromISO('2023-04-01T09:00:00Z'),
      deploymentEnd: DateTime.fromISO('2023-07-01T19:00:00Z'),
      latitude: -23.5505, // Negative latitude
      longitude: -46.6333 // Negative longitude
    },
    deploy003: {
      deploymentID: 'deploy003',
      locationID: 'loc003',
      locationName: 'Edge Case Site',
      deploymentStart: DateTime.fromISO('2023-03-20T08:00:00Z'),
      deploymentEnd: DateTime.fromISO('2023-06-20T20:00:00Z'),
      latitude: 0.0, // Zero latitude
      longitude: 180.0 // Maximum longitude
    }
  }

  await insertDeployments(manager, testDeployments)

  // Create test media with various edge cases
  const testMedia = {
    'media001.jpg': {
      mediaID: 'media001',
      deploymentID: 'deploy001',
      timestamp: DateTime.fromISO('2023-03-20T14:30:15.123Z'), // With milliseconds
      filePath: 'images/media001.jpg',
      fileName: 'media001.jpg'
    },
    'media002.jpg': {
      mediaID: 'media002',
      deploymentID: 'deploy001',
      timestamp: DateTime.fromISO('2023-03-25T23:59:59.999Z'), // Edge timestamp
      filePath: 'images/subdir/media002.jpg',
      fileName: 'media with spaces.jpg'
    },
    'media003.jpg': {
      mediaID: 'media003',
      deploymentID: 'deploy002',
      timestamp: DateTime.fromISO('2023-04-05T00:00:00.000Z'), // Midnight
      filePath: 'images/unicode-émojis-🦌.jpg',
      fileName: 'unicode-émojis-🦌.jpg'
    }
  }

  await insertMedia(manager, testMedia)

  // Create test observations with comprehensive edge cases
  const testObservations = [
    {
      observationID: 'obs001',
      mediaID: 'media001',
      deploymentID: 'deploy001',
      eventID: 'event001',
      eventStart: DateTime.fromISO('2023-03-20T14:30:15.123Z'),
      eventEnd: DateTime.fromISO('2023-03-20T14:30:45.456Z'),
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
      eventStart: DateTime.fromISO('2023-03-25T23:59:59.999Z'),
      eventEnd: DateTime.fromISO('2023-03-26T00:00:29.999Z'),
      scientificName: 'Species with "quotes" & special chars',
      commonName: 'Test Species',
      confidence: 0.01, // Very low confidence
      count: 100, // Large count
      prediction: 'test_species'
    },
    {
      observationID: 'obs003',
      mediaID: 'media003',
      deploymentID: 'deploy002',
      eventID: 'event003',
      eventStart: DateTime.fromISO('2023-04-05T00:00:00.000Z'),
      eventEnd: DateTime.fromISO('2023-04-05T00:00:00.001Z'), // Very short event
      scientificName: null, // Null scientific name
      commonName: 'Empty',
      confidence: null, // Null confidence
      count: 0, // Zero count
      prediction: 'empty'
    }
  ]

  await insertObservations(manager, testObservations)

  return { manager, deployments: testDeployments, media: testMedia, observations: testObservations }
}

describe('Database Schema and Integrity Tests', () => {
  describe('Schema Structure', () => {
    test('should create all required tables', async () => {
      await createImageDirectoryDatabase(testDbPath)

      const db = getRawDatabase(testDbPath)

      // Check that all tables exist
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      const tableNames = tables.map((t) => t.name).sort()

      // Expected tables (including Drizzle migration tracking)
      const expectedTables = ['__drizzle_migrations', 'deployments', 'media', 'model_outputs', 'model_runs', 'observations'].sort()

      assert.deepEqual(tableNames, expectedTables, 'Should create all required tables')

      db.close()
    })

    test('should have correct deployments table schema', async () => {
      await createImageDirectoryDatabase(testDbPath)

      const db = getRawDatabase(testDbPath)
      const schema = getTableSchema(db, 'deployments')

      // Expected columns
      const expectedColumns = [
        { name: 'deploymentID', type: 'TEXT', pk: 1 },
        { name: 'locationID', type: 'TEXT', pk: 0 },
        { name: 'locationName', type: 'TEXT', pk: 0 },
        { name: 'deploymentStart', type: 'TEXT', pk: 0 },
        { name: 'deploymentEnd', type: 'TEXT', pk: 0 },
        { name: 'latitude', type: 'REAL', pk: 0 },
        { name: 'longitude', type: 'REAL', pk: 0 }
      ]

      expectedColumns.forEach((expectedCol) => {
        const actualCol = schema.find((col) => col.name === expectedCol.name)
        assert(actualCol, `Column ${expectedCol.name} should exist`)
        assert.equal(
          actualCol.type,
          expectedCol.type,
          `Column ${expectedCol.name} should have correct type`
        )
        assert.equal(
          actualCol.pk,
          expectedCol.pk,
          `Column ${expectedCol.name} should have correct primary key setting`
        )
      })

      db.close()
    })

    test('should have correct media table schema', async () => {
      await createImageDirectoryDatabase(testDbPath)

      const db = getRawDatabase(testDbPath)
      const schema = getTableSchema(db, 'media')

      const expectedColumns = [
        { name: 'mediaID', type: 'TEXT', pk: 1 },
        { name: 'deploymentID', type: 'TEXT', pk: 0 },
        { name: 'timestamp', type: 'TEXT', pk: 0 },
        { name: 'filePath', type: 'TEXT', pk: 0 },
        { name: 'fileName', type: 'TEXT', pk: 0 }
      ]

      expectedColumns.forEach((expectedCol) => {
        const actualCol = schema.find((col) => col.name === expectedCol.name)
        assert(actualCol, `Column ${expectedCol.name} should exist`)
        assert.equal(
          actualCol.type,
          expectedCol.type,
          `Column ${expectedCol.name} should have correct type`
        )
      })

      db.close()
    })

    test('should have correct observations table schema', async () => {
      await createImageDirectoryDatabase(testDbPath)

      const db = getRawDatabase(testDbPath)
      const schema = getTableSchema(db, 'observations')

      const expectedColumns = [
        { name: 'observationID', type: 'TEXT', pk: 1 },
        { name: 'mediaID', type: 'TEXT', pk: 0 },
        { name: 'deploymentID', type: 'TEXT', pk: 0 },
        { name: 'eventID', type: 'TEXT', pk: 0 },
        { name: 'eventStart', type: 'TEXT', pk: 0 },
        { name: 'eventEnd', type: 'TEXT', pk: 0 },
        { name: 'scientificName', type: 'TEXT', pk: 0 },
        { name: 'observationType', type: 'TEXT', pk: 0 },
        { name: 'commonName', type: 'TEXT', pk: 0 },
        { name: 'confidence', type: 'REAL', pk: 0 },
        { name: 'count', type: 'INTEGER', pk: 0 },
        { name: 'lifeStage', type: 'TEXT', pk: 0 },
        { name: 'age', type: 'TEXT', pk: 0 },
        { name: 'sex', type: 'TEXT', pk: 0 },
        { name: 'behavior', type: 'TEXT', pk: 0 },
        { name: 'bboxX', type: 'REAL', pk: 0 },
        { name: 'bboxY', type: 'REAL', pk: 0 },
        { name: 'bboxWidth', type: 'REAL', pk: 0 },
        { name: 'bboxHeight', type: 'REAL', pk: 0 },
        { name: 'modelOutputID', type: 'TEXT', pk: 0 },
        { name: 'classificationMethod', type: 'TEXT', pk: 0 },
        { name: 'classifiedBy', type: 'TEXT', pk: 0 },
        { name: 'classificationTimestamp', type: 'TEXT', pk: 0 }
      ]

      expectedColumns.forEach((expectedCol) => {
        const actualCol = schema.find((col) => col.name === expectedCol.name)
        assert(actualCol, `Column ${expectedCol.name} should exist`)
        assert.equal(
          actualCol.type,
          expectedCol.type,
          `Column ${expectedCol.name} should have correct type`
        )
      })

      db.close()
    })
  })

  describe('Foreign Key Constraints', () => {
    test('should have correct foreign key relationships', async () => {
      await createImageDirectoryDatabase(testDbPath)

      const db = getRawDatabase(testDbPath)

      // Check media table foreign keys
      const mediaForeignKeys = getForeignKeys(db, 'media')
      const mediaToDeploymentFK = mediaForeignKeys.find((fk) => fk.table === 'deployments')

      assert(mediaToDeploymentFK, 'Media should have foreign key to deployments')
      assert.equal(mediaToDeploymentFK.from, 'deploymentID', 'FK should be on deploymentID')
      assert.equal(mediaToDeploymentFK.to, 'deploymentID', 'FK should reference deploymentID')

      // Check observations table foreign keys
      const observationsForeignKeys = getForeignKeys(db, 'observations')
      const obsToMediaFK = observationsForeignKeys.find((fk) => fk.table === 'media')
      const obsToDeploymentFK = observationsForeignKeys.find((fk) => fk.table === 'deployments')

      assert(obsToMediaFK, 'Observations should have foreign key to media')
      assert.equal(obsToMediaFK.from, 'mediaID', 'FK should be on mediaID')
      assert.equal(obsToMediaFK.to, 'mediaID', 'FK should reference mediaID')

      assert(obsToDeploymentFK, 'Observations should have foreign key to deployments')
      assert.equal(obsToDeploymentFK.from, 'deploymentID', 'FK should be on deploymentID')
      assert.equal(obsToDeploymentFK.to, 'deploymentID', 'FK should reference deploymentID')

      db.close()
    })

    test('should enforce foreign key constraints', async () => {
      const { manager } = await createComprehensiveTestData(testDbPath)
      const db = manager.getDb()

      // Try to insert media with non-existent deployment
      try {
        await db.insert(media).values({
          mediaID: 'invalid-media',
          deploymentID: 'non-existent-deployment',
          timestamp: DateTime.now().toISO(),
          filePath: 'test.jpg',
          fileName: 'test.jpg'
        })
        assert.fail('Should throw error for invalid deployment reference')
      } catch (error) {
        assert(
          error.message.includes('FOREIGN KEY constraint failed'),
          'Should fail with foreign key constraint error'
        )
      }

      // Try to insert observation with non-existent media
      try {
        await db.insert(observations).values({
          observationID: 'invalid-obs',
          mediaID: 'non-existent-media',
          deploymentID: 'deploy001',
          eventID: 'event999',
          eventStart: DateTime.now().toISO(),
          scientificName: 'Test species'
        })
        assert.fail('Should throw error for invalid media reference')
      } catch (error) {
        assert(
          error.message.includes('FOREIGN KEY constraint failed'),
          'Should fail with foreign key constraint error'
        )
      }
    })
  })

  describe('Data Type Validation', () => {
    test('should handle various coordinate formats', async () => {
      const manager = await createImageDirectoryDatabase(testDbPath)

      const edgeCaseDeployments = {
        edge001: {
          deploymentID: 'edge001',
          locationID: 'edge_loc001',
          locationName: 'Edge Case Coordinates',
          deploymentStart: DateTime.fromISO('2023-01-01T00:00:00Z'),
          deploymentEnd: DateTime.fromISO('2023-12-31T23:59:59Z'),
          latitude: 90.0, // North pole
          longitude: -180.0 // International date line
        },
        edge002: {
          deploymentID: 'edge002',
          locationID: 'edge_loc002',
          locationName: 'South Pole',
          deploymentStart: DateTime.fromISO('2023-01-01T00:00:00Z'),
          deploymentEnd: DateTime.fromISO('2023-12-31T23:59:59Z'),
          latitude: -90.0, // South pole
          longitude: 180.0 // International date line
        }
      }

      await insertDeployments(manager, edgeCaseDeployments)

      const db = manager.getDb()
      const results = await db.select().from(deployments).where()

      assert.equal(results.length, 2, 'Should insert edge case coordinates')

      const northPole = results.find((d) => d.deploymentID === 'edge001')
      const southPole = results.find((d) => d.deploymentID === 'edge002')

      assert.equal(northPole.latitude, 90.0, 'Should handle maximum latitude')
      assert.equal(northPole.longitude, -180.0, 'Should handle minimum longitude')
      assert.equal(southPole.latitude, -90.0, 'Should handle minimum latitude')
      assert.equal(southPole.longitude, 180.0, 'Should handle maximum longitude')
    })

    test('should handle edge cases in confidence values', async () => {
      const { manager } = await createComprehensiveTestData(testDbPath)

      const edgeCaseObservations = [
        {
          observationID: 'conf001',
          mediaID: 'media002',
          deploymentID: 'deploy001',
          eventID: 'conf_event001',
          eventStart: DateTime.now(),
          eventEnd: DateTime.now().plus({ seconds: 10 }),
          scientificName: 'Perfect Confidence',
          commonName: 'Perfect Species',
          confidence: 1.0, // Maximum confidence
          count: 1,
          prediction: 'perfect_species'
        },
        {
          observationID: 'conf002',
          mediaID: 'media003',
          deploymentID: 'deploy002',
          eventID: 'conf_event002',
          eventStart: DateTime.now().plus({ minutes: 1 }),
          eventEnd: DateTime.now().plus({ minutes: 1, seconds: 10 }),
          scientificName: 'Zero Confidence',
          commonName: 'Zero Species',
          confidence: 0.0, // Minimum confidence
          count: 1,
          prediction: 'zero_species'
        }
      ]

      await insertObservations(manager, edgeCaseObservations)

      const db = manager.getDb()
      const results = await db
        .select()
        .from(observations)
        .where(sql`${observations.observationID} IN ('conf001', 'conf002')`)

      assert.equal(results.length, 2, 'Should insert edge case confidence values')

      const perfectConf = results.find((o) => o.observationID === 'conf001')
      const zeroConf = results.find((o) => o.observationID === 'conf002')

      assert.equal(perfectConf.confidence, 1.0, 'Should handle maximum confidence')
      assert.equal(zeroConf.confidence, 0.0, 'Should handle minimum confidence')
    })

    test('should handle timestamp precision and edge cases', async () => {
      const manager = await createImageDirectoryDatabase(testDbPath)

      const edgeCaseMedia = {
        'timestamp001.jpg': {
          mediaID: 'timestamp001',
          deploymentID: 'deploy001',
          timestamp: DateTime.fromISO('1970-01-01T00:00:00.000Z'), // Unix epoch
          filePath: 'images/epoch.jpg',
          fileName: 'epoch.jpg'
        },
        'timestamp002.jpg': {
          mediaID: 'timestamp002',
          deploymentID: 'deploy001',
          timestamp: DateTime.fromISO('2038-01-19T03:14:07.999Z'), // Near 32-bit limit
          filePath: 'images/future.jpg',
          fileName: 'future.jpg'
        }
      }

      // First need a deployment
      await insertDeployments(manager, {
        deploy001: {
          deploymentID: 'deploy001',
          locationID: 'loc001',
          locationName: 'Test Location',
          deploymentStart: DateTime.fromISO('1970-01-01T00:00:00Z'),
          deploymentEnd: DateTime.fromISO('2038-01-19T03:14:07Z'),
          latitude: 0.0,
          longitude: 0.0
        }
      })

      await insertMedia(manager, edgeCaseMedia)

      const db = manager.getDb()
      const results = await db.select().from(media).where()

      assert.equal(results.length, 2, 'Should insert edge case timestamps')

      const epochMedia = results.find((m) => m.mediaID === 'timestamp001')
      const futureMedia = results.find((m) => m.mediaID === 'timestamp002')

      assert(epochMedia.timestamp.includes('1970-01-01'), 'Should handle Unix epoch')
      assert(futureMedia.timestamp.includes('2038-01-19'), 'Should handle future timestamps')
    })
  })

  describe('Data Integrity', () => {
    test('should maintain referential integrity on deletion', async () => {
      const { manager } = await createComprehensiveTestData(testDbPath)
      const db = manager.getDb()

      // Try to delete a deployment that has media references
      // This should fail due to foreign key constraints (if enabled)
      try {
        await db.delete(deployments).where(eq(deployments.deploymentID, 'deploy001'))

        // If deletion succeeded, verify that orphaned records don't exist
        const orphanedMedia = await db
          .select()
          .from(media)
          .where(eq(media.deploymentID, 'deploy001'))
        const orphanedObs = await db
          .select()
          .from(observations)
          .where(eq(observations.deploymentID, 'deploy001'))

        // Depending on FK enforcement, either deletion should fail or orphans should be cleaned up
        if (orphanedMedia.length > 0 || orphanedObs.length > 0) {
          assert.fail('Should not have orphaned records after deployment deletion')
        }
      } catch (error) {
        // Foreign key constraint should prevent deletion
        assert(
          error.message.includes('FOREIGN KEY constraint failed'),
          'Should prevent deletion due to foreign key constraint'
        )
      }
    })

    test('should handle null values appropriately', async () => {
      const { manager } = await createComprehensiveTestData(testDbPath)

      // Verify that null values are handled correctly
      const db = manager.getDb()
      const nullObservation = await db
        .select()
        .from(observations)
        .where(eq(observations.observationID, 'obs003'))
        .get()

      assert(nullObservation, 'Should find observation with null values')
      assert.equal(nullObservation.scientificName, null, 'Scientific name should be null')
      assert.equal(nullObservation.confidence, null, 'Confidence should be null')
      assert.equal(nullObservation.count, 0, 'Count should be zero')
    })

    test('should handle large datasets without corruption', async () => {
      const manager = await createImageDirectoryDatabase(testDbPath)

      // Create a deployment first
      await insertDeployments(manager, {
        'bulk-deploy': {
          deploymentID: 'bulk-deploy',
          locationID: 'bulk-location',
          locationName: 'Bulk Test Location',
          deploymentStart: DateTime.fromISO('2023-01-01T00:00:00Z'),
          deploymentEnd: DateTime.fromISO('2023-12-31T23:59:59Z'),
          latitude: 45.0,
          longitude: 7.0
        }
      })

      // Create large dataset
      const bulkMedia = {}
      const bulkObservations = []

      const batchSize = 100 // Reduced for testing

      for (let i = 0; i < batchSize; i++) {
        const mediaId = `bulk-media-${i.toString().padStart(5, '0')}`
        const timestamp = DateTime.fromISO('2023-01-01T00:00:00Z').plus({ minutes: i })

        bulkMedia[`${mediaId}.jpg`] = {
          mediaID: mediaId,
          deploymentID: 'bulk-deploy',
          timestamp: timestamp,
          filePath: `images/bulk/${mediaId}.jpg`,
          fileName: `${mediaId}.jpg`
        }

        bulkObservations.push({
          observationID: `bulk-obs-${i.toString().padStart(5, '0')}`,
          mediaID: mediaId,
          deploymentID: 'bulk-deploy',
          eventID: `bulk-event-${i.toString().padStart(5, '0')}`,
          eventStart: timestamp,
          eventEnd: timestamp.plus({ seconds: 30 }),
          scientificName: i % 2 === 0 ? 'Cervus elaphus' : null,
          commonName: i % 2 === 0 ? 'Red Deer' : 'Empty',
          confidence: i % 2 === 0 ? Math.random() : null,
          count: i % 2 === 0 ? Math.floor(Math.random() * 5) + 1 : 0,
          prediction: i % 2 === 0 ? 'cervus_elaphus' : 'empty'
        })
      }

      await insertMedia(manager, bulkMedia)
      await insertObservations(manager, bulkObservations)

      // Verify data integrity
      const db = manager.getDb()
      const mediaCount = await db.select({ count: count() }).from(media).where()
      const obsCount = await db.select({ count: count() }).from(observations).where()

      assert.equal(
        mediaCount[0].count,
        batchSize,
        `Should have inserted ${batchSize} media records`
      )
      assert.equal(
        obsCount[0].count,
        batchSize,
        `Should have inserted ${batchSize} observation records`
      )

      // Verify no data corruption
      const randomSample = await db
        .select()
        .from(observations)
        .limit(10)
        .orderBy(sql`RANDOM()`)

      randomSample.forEach((obs) => {
        assert(obs.observationID, 'Observation should have valid ID')
        assert(obs.mediaID, 'Observation should have valid media ID')
        assert(obs.deploymentID, 'Observation should have valid deployment ID')
        assert(obs.eventStart, 'Observation should have valid event start')
      })
    })
  })

  describe('Performance and Indexing', () => {
    test('should perform well with complex queries', async () => {
      const { manager } = await createComprehensiveTestData(testDbPath)

      // Test a complex query performance
      const startTime = Date.now()

      const db = manager.getDb()
      const complexQuery = await db
        .select({
          deploymentID: deployments.deploymentID,
          locationName: deployments.locationName,
          mediaCount: count(media.mediaID),
          speciesCount: count(observations.scientificName)
        })
        .from(deployments)
        .leftJoin(media, eq(deployments.deploymentID, media.deploymentID))
        .leftJoin(observations, eq(media.mediaID, observations.mediaID))
        .groupBy(deployments.deploymentID, deployments.locationName)

      const endTime = Date.now()
      const queryTime = endTime - startTime

      assert(complexQuery.length > 0, 'Complex query should return results')
      assert(queryTime < 1000, 'Complex query should complete within 1 second') // Adjust threshold as needed

      // Verify query results make sense
      complexQuery.forEach((result) => {
        assert(result.deploymentID, 'Result should have deployment ID')
        assert(result.locationName, 'Result should have location name')
        assert(typeof result.mediaCount === 'number', 'Media count should be numeric')
        assert(typeof result.speciesCount === 'number', 'Species count should be numeric')
      })
    })

    test('should handle concurrent access patterns', async () => {
      const { manager } = await createComprehensiveTestData(testDbPath)
      const db = manager.getDb()

      // Simulate concurrent read operations
      const concurrentQueries = [
        db.select().from(deployments),
        db.select().from(media),
        db.select().from(observations),
        db.select({ count: count() }).from(deployments),
        db.select({ count: count() }).from(media),
        db.select({ count: count() }).from(observations)
      ]

      const results = await Promise.all(concurrentQueries)

      // All queries should succeed
      assert.equal(results.length, 6, 'All concurrent queries should complete')

      // Verify results are consistent
      assert(results[0].length > 0, 'Deployments query should return results')
      assert(results[1].length > 0, 'Media query should return results')
      assert(results[2].length > 0, 'Observations query should return results')
      assert(results[3][0].count > 0, 'Deployments count should be positive')
      assert(results[4][0].count > 0, 'Media count should be positive')
      assert(results[5][0].count > 0, 'Observations count should be positive')
    })
  })

  describe('Migration and Schema Evolution', () => {
    test('should have proper migration tracking', async () => {
      await createImageDirectoryDatabase(testDbPath)

      const db = getRawDatabase(testDbPath)

      // Check that Drizzle migration table exists and has records
      const migrationTable = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'"
        )
        .get()
      assert(migrationTable, 'Migration tracking table should exist')

      const migrations = db.prepare('SELECT * FROM __drizzle_migrations').all()
      assert(migrations.length > 0, 'Should have migration records')

      migrations.forEach((migration) => {
        assert(migration.hash, 'Migration should have hash')
        assert(migration.created_at, 'Migration should have created timestamp')
      })

      db.close()
    })

    test('should handle database recreation idempotently', async () => {
      // Create database first time
      await createImageDirectoryDatabase(testDbPath)

      const db1 = getRawDatabase(testDbPath)
      const initialTables = db1.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      db1.close()

      // Create database again (should be idempotent)
      await createImageDirectoryDatabase(testDbPath)

      const db2 = getRawDatabase(testDbPath)
      const recreatedTables = db2.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      db2.close()

      assert.deepEqual(initialTables, recreatedTables, 'Database recreation should be idempotent')
    })
  })
})
