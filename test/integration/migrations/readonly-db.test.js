import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { getReadonlyDrizzleDb, getMetadata } from '../../../src/main/database/index.js'

// Test data path - will be unique for each test
let testDbPath
let studyId

beforeEach(() => {
  studyId = `test-study-${Date.now()}`
  const testDir = join(tmpdir(), 'biowatch-readonly-test', studyId)
  mkdirSync(testDir, { recursive: true })
  testDbPath = join(testDir, 'study.db')
})

afterEach(() => {
  // Clean up test directory
  const testDir = join(tmpdir(), 'biowatch-readonly-test')
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

describe('Readonly Database with Outdated Schema', () => {
  test('should handle missing columns when reading metadata from old schema in readonly mode', async () => {
    // Create a database with an old schema (before migration 0005 that adds metadata table)
    // and missing the 'favorite' column (added in migration 0011)
    const Database = (await import('better-sqlite3')).default
    const db = new Database(testDbPath)

    // Create deployments table from initial migration (0000_initial.sql)
    db.exec(`
      CREATE TABLE deployments (
        deploymentID TEXT PRIMARY KEY NOT NULL,
        locationID TEXT,
        locationName TEXT,
        deploymentStart TEXT,
        deploymentEnd TEXT,
        latitude REAL,
        longitude REAL
      )
    `)

    // Create media table from initial migration WITHOUT favorite field (simulating old schema)
    db.exec(`
      CREATE TABLE media (
        mediaID TEXT PRIMARY KEY NOT NULL,
        deploymentID TEXT,
        timestamp TEXT,
        filePath TEXT,
        fileName TEXT,
        FOREIGN KEY (deploymentID) REFERENCES deployments(deploymentID) ON UPDATE no action ON DELETE no action
      )
    `)

    // Create observations table from initial migration
    db.exec(`
      CREATE TABLE observations (
        observationID TEXT PRIMARY KEY NOT NULL,
        mediaID TEXT,
        deploymentID TEXT,
        eventID TEXT,
        eventStart TEXT,
        eventEnd TEXT,
        scientificName TEXT,
        observationType TEXT,
        commonName TEXT,
        confidence REAL,
        count INTEGER,
        prediction TEXT,
        lifeStage TEXT,
        age TEXT,
        sex TEXT,
        behavior TEXT,
        FOREIGN KEY (mediaID) REFERENCES media(mediaID) ON UPDATE no action ON DELETE no action,
        FOREIGN KEY (deploymentID) REFERENCES deployments(deploymentID) ON UPDATE no action ON DELETE no action
      )
    `)

    // Create metadata table (from migration 0005) with data
    db.exec(`
      CREATE TABLE metadata (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT,
        title TEXT,
        description TEXT,
        created TEXT NOT NULL,
        importerName TEXT NOT NULL,
        contributors TEXT,
        updatedAt TEXT,
        startDate TEXT,
        endDate TEXT
      )
    `)

    // Insert test metadata
    db.prepare(`
      INSERT INTO metadata (id, name, title, description, created, importerName, startDate, endDate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      studyId,
      'Old Schema Study',
      'Test Study with Old Schema',
      'This database has an old schema missing recent columns',
      '2025-01-01T00:00:00.000Z',
      'local/images',
      '2025-01-01',
      '2025-12-31'
    )

    db.close()

    // Now open the database in readonly mode and try to access metadata
    // This should work despite the missing 'favorite' column in media table
    const drizzleDb = await getReadonlyDrizzleDb(studyId, testDbPath)
    const metadata = await getMetadata(drizzleDb)

    // Assertions - this is what SHOULD happen (but may fail with current implementation)
    assert(metadata, 'Metadata should be retrieved successfully')
    assert.strictEqual(metadata.id, studyId, 'Metadata ID should match')
    assert.strictEqual(metadata.name, 'Old Schema Study', 'Metadata name should match')
    assert.strictEqual(
      metadata.title,
      'Test Study with Old Schema',
      'Metadata title should match'
    )
    assert.strictEqual(
      metadata.description,
      'This database has an old schema missing recent columns',
      'Metadata description should match'
    )
  })

  test('should fail when drizzle queries media table with missing favorite column in readonly mode', async () => {
    // Create a database with media table missing the 'favorite' column
    const Database = (await import('better-sqlite3')).default
    const db = new Database(testDbPath)

    // Create media table from initial migration WITHOUT favorite field
    db.exec(`
      CREATE TABLE media (
        mediaID TEXT PRIMARY KEY NOT NULL,
        deploymentID TEXT,
        timestamp TEXT,
        filePath TEXT,
        fileName TEXT
      )
    `)

    // Create metadata table
    db.exec(`
      CREATE TABLE metadata (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT,
        title TEXT,
        description TEXT,
        created TEXT NOT NULL,
        importerName TEXT NOT NULL,
        contributors TEXT,
        updatedAt TEXT,
        startDate TEXT,
        endDate TEXT
      )
    `)

    // Insert test data
    db.prepare(`
      INSERT INTO media (mediaID, timestamp, filePath, fileName)
      VALUES (?, ?, ?, ?)
    `).run('media-001', '2025-01-15T10:00:00.000Z', '/test/path/image.jpg', 'image.jpg')

    db.close()

    // Open readonly database
    const drizzleDb = await getReadonlyDrizzleDb(studyId, testDbPath)

    // Try to query media table - this will likely fail because Drizzle expects 'favorite' column
    // which doesn't exist in this old schema
    try {
      const { media } = await import('../../../src/main/database/index.js')
      const results = await drizzleDb.select().from(media).limit(1)

      // If we get here, check if the results handle missing columns gracefully
      assert(results, 'Query should not crash on missing columns')

      // The bug is that the query might fail or return unexpected results
      // This assertion documents what SHOULD happen
      console.log('Query results:', results)
    } catch (error) {
      // This is the expected failure demonstrating the bug
      console.error('Query failed with error:', error.message)

      // Document the bug: readonly databases don't run migrations, so they can't
      // access columns that were added in later migrations
      assert(
        error.message.includes('no such column') || error.message.includes('favorite'),
        `Expected error about missing column, got: ${error.message}`
      )

      // This assertion will fail, demonstrating the bug exists
      assert.fail(
        'EXPECTED FAILURE: Query should succeed but fails due to missing column in readonly database without migrations'
      )
    }
  })

  test('should demonstrate the listStudies use case with outdated schema', async () => {
    // This test simulates the real-world scenario described in the bug report:
    // 1. A study database exists with an old schema
    // 2. listStudies() opens it in readonly mode via getReadonlyDrizzleDb()
    // 3. getMetadata() is called which may fail on outdated schema

    const Database = (await import('better-sqlite3')).default
    const db = new Database(testDbPath)

    // Create complete old schema (all tables from 0000_initial.sql + metadata from 0005)
    // but WITHOUT the 'favorite' column from migration 0011
    db.exec(`
      CREATE TABLE deployments (
        deploymentID TEXT PRIMARY KEY NOT NULL,
        locationID TEXT,
        locationName TEXT,
        deploymentStart TEXT,
        deploymentEnd TEXT,
        latitude REAL,
        longitude REAL
      );

      CREATE TABLE media (
        mediaID TEXT PRIMARY KEY NOT NULL,
        deploymentID TEXT,
        timestamp TEXT,
        filePath TEXT,
        fileName TEXT,
        importFolder TEXT,
        folderName TEXT,
        fileMediatype TEXT DEFAULT 'image/jpeg',
        exifData TEXT,
        FOREIGN KEY (deploymentID) REFERENCES deployments(deploymentID)
      );

      CREATE TABLE observations (
        observationID TEXT PRIMARY KEY NOT NULL,
        mediaID TEXT,
        deploymentID TEXT,
        eventID TEXT,
        eventStart TEXT,
        eventEnd TEXT,
        scientificName TEXT,
        observationType TEXT,
        commonName TEXT,
        classificationProbability REAL,
        count INTEGER,
        lifeStage TEXT,
        age TEXT,
        sex TEXT,
        behavior TEXT,
        bboxX REAL,
        bboxY REAL,
        bboxWidth REAL,
        bboxHeight REAL,
        detectionConfidence REAL,
        modelOutputID TEXT,
        classificationMethod TEXT,
        classifiedBy TEXT,
        classificationTimestamp TEXT,
        FOREIGN KEY (mediaID) REFERENCES media(mediaID),
        FOREIGN KEY (deploymentID) REFERENCES deployments(deploymentID)
      );

      CREATE TABLE metadata (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT,
        title TEXT,
        description TEXT,
        created TEXT NOT NULL,
        importerName TEXT NOT NULL,
        contributors TEXT,
        updatedAt TEXT,
        startDate TEXT,
        endDate TEXT
      );

      CREATE TABLE model_runs (
        id TEXT PRIMARY KEY NOT NULL,
        modelID TEXT NOT NULL,
        modelVersion TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        importPath TEXT,
        options TEXT
      );

      CREATE TABLE model_outputs (
        id TEXT PRIMARY KEY NOT NULL,
        mediaID TEXT NOT NULL,
        runID TEXT NOT NULL,
        rawOutput TEXT,
        FOREIGN KEY (mediaID) REFERENCES media(mediaID) ON DELETE CASCADE,
        FOREIGN KEY (runID) REFERENCES model_runs(id) ON DELETE CASCADE,
        UNIQUE(mediaID, runID)
      );
    `)

    // Insert metadata
    db.prepare(`
      INSERT INTO metadata (id, name, title, created, importerName)
      VALUES (?, ?, ?, ?, ?)
    `).run(studyId, 'Production Study', 'Real World Study', '2024-06-01T00:00:00.000Z', 'camtrap/datapackage')

    db.close()

    // Simulate listStudies() behavior: open in readonly mode and call getMetadata()
    const drizzleDb = await getReadonlyDrizzleDb(studyId, testDbPath)
    const metadata = await getMetadata(drizzleDb)

    // This should succeed - getMetadata() only reads from metadata table
    assert(metadata, 'Metadata should be retrievable in readonly mode')
    assert.strictEqual(metadata.id, studyId)
    assert.strictEqual(metadata.name, 'Production Study')

    // But if any code tries to query media table with SELECT * or includes 'favorite' field,
    // it will fail. Let's demonstrate this:
    const { media } = await import('../../../src/main/database/index.js')

    try {
      // This query will fail because Drizzle's schema expects 'favorite' column
      const mediaResults = await drizzleDb.select().from(media).limit(1)

      // If we reach here without error, the test passes (bug is fixed or doesn't occur)
      console.log('Media query succeeded:', mediaResults)
    } catch (error) {
      // This error demonstrates the bug
      console.error('Media query failed on readonly database:', error.message)

      assert(
        error.message.includes('no such column') || error.message.includes('favorite'),
        `Expected error about missing 'favorite' column, got: ${error.message}`
      )

      // Fail the test to demonstrate the bug
      assert.fail(
        'BUG DEMONSTRATED: Cannot query media table in readonly mode when schema is outdated. ' +
          'The database is missing the "favorite" column added in migration 0011, ' +
          'but migrations are skipped for readonly connections.'
      )
    }
  })
})
