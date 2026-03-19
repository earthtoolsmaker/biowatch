import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

import { importCamTrapDatasetWithPath } from '../../../src/main/services/import/parsers/camtrapDP.js'

let testBiowatchDataPath
let testCamTrapDataPath

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    const log = electronLog.default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // electron-log not available in test environment
  }

  testBiowatchDataPath = join(tmpdir(), 'biowatch-event-expansion-test', Date.now().toString())
  mkdirSync(testBiowatchDataPath, { recursive: true })

  testCamTrapDataPath = join(process.cwd(), 'test', 'data', 'camtrap-event-expansion')
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

function queryDatabase(dbPath, query) {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.prepare(query).all()
  } finally {
    db.close()
  }
}

function countRecords(dbPath, tableName) {
  const results = queryDatabase(dbPath, `SELECT COUNT(*) as count FROM ${tableName}`)
  return results[0].count
}

describe('CamTrapDP Event-Based Observation Expansion', () => {
  test('should expand event-based observations to individual media', async () => {
    const studyId = 'test-event-expansion'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

    // obs-event1 has eventStart/eventEnd covering media001, media002, media003 (deploy001)
    // obs-event2 has eventStart/eventEnd covering media004, media005 (deploy002)
    // obs-direct1 already has mediaID (media006) — should be unchanged
    // obs-orphan1 has no deploymentID and no mediaID — should be preserved
    // Total expected: 3 (from event1) + 2 (from event2) + 1 (direct) + 1 (orphan) = 7
    const obsCount = countRecords(dbPath, 'observations')
    assert.equal(obsCount, 7, 'Should have 7 observations after expansion')
  })

  test('should create correct media links for expanded observations', async () => {
    const studyId = 'test-event-media-links'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

    // All expanded observations should have non-NULL mediaID
    const nullMediaObs = queryDatabase(
      dbPath,
      'SELECT * FROM observations WHERE mediaID IS NULL AND deploymentID IS NOT NULL'
    )
    assert.equal(
      nullMediaObs.length,
      0,
      'No event-based observations with deploymentID should remain unexpanded'
    )

    // Check Red Deer observations were expanded to 3 media
    const redDeerObs = queryDatabase(
      dbPath,
      "SELECT * FROM observations WHERE scientificName = 'Cervus elaphus' ORDER BY mediaID"
    )
    assert.equal(redDeerObs.length, 3, 'Red Deer event should expand to 3 observations')

    const redDeerMediaIDs = redDeerObs.map((o) => o.mediaID).sort()
    assert.deepEqual(redDeerMediaIDs, ['media001', 'media002', 'media003'])

    // All Red Deer observations should inherit the original properties
    for (const obs of redDeerObs) {
      assert.equal(obs.commonName, 'Red Deer')
      assert.equal(obs.classificationProbability, 0.95)
      assert.equal(obs.count, 2)
      assert.equal(obs.deploymentID, 'deploy001')
      assert.equal(obs.eventID, 'event001')
    }
  })

  test('should expand Red Fox observations to correct media', async () => {
    const studyId = 'test-event-fox'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

    const foxObs = queryDatabase(
      dbPath,
      "SELECT * FROM observations WHERE scientificName = 'Vulpes vulpes' ORDER BY mediaID"
    )
    assert.equal(foxObs.length, 2, 'Red Fox event should expand to 2 observations')

    const foxMediaIDs = foxObs.map((o) => o.mediaID).sort()
    assert.deepEqual(foxMediaIDs, ['media004', 'media005'])

    for (const obs of foxObs) {
      assert.equal(obs.deploymentID, 'deploy002')
      assert.equal(obs.eventID, 'event002')
    }
  })

  test('should preserve observations that already have mediaID', async () => {
    const studyId = 'test-event-preserve-direct'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

    const directObs = queryDatabase(dbPath, "SELECT * FROM observations WHERE mediaID = 'media006'")
    assert.equal(directObs.length, 1, 'Direct observation should be preserved')
    assert.equal(directObs[0].observationID, 'obs-direct1')
    assert.equal(directObs[0].scientificName, 'Sus scrofa')
  })

  test('should preserve orphan observations with NULL deploymentID', async () => {
    const studyId = 'test-event-preserve-orphan'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

    const orphanObs = queryDatabase(
      dbPath,
      "SELECT * FROM observations WHERE observationID = 'obs-orphan1'"
    )
    assert.equal(orphanObs.length, 1, 'Orphan observation should be preserved')
    assert.equal(orphanObs[0].mediaID, null)
    assert.equal(orphanObs[0].deploymentID, null)
    assert.equal(orphanObs[0].commonName, 'Empty')
  })

  test('should delete original event-based observations after expansion', async () => {
    const studyId = 'test-event-cleanup'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

    // The original obs-event1 and obs-event2 should be deleted
    const origEvent1 = queryDatabase(
      dbPath,
      "SELECT * FROM observations WHERE observationID = 'obs-event1'"
    )
    assert.equal(origEvent1.length, 0, 'Original event observation obs-event1 should be deleted')

    const origEvent2 = queryDatabase(
      dbPath,
      "SELECT * FROM observations WHERE observationID = 'obs-event2'"
    )
    assert.equal(origEvent2.length, 0, 'Original event observation obs-event2 should be deleted')
  })

  test('should generate unique observationIDs for expanded observations', async () => {
    const studyId = 'test-event-unique-ids'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

    const allObs = queryDatabase(dbPath, 'SELECT observationID FROM observations')
    const ids = allObs.map((o) => o.observationID)
    const uniqueIds = new Set(ids)
    assert.equal(ids.length, uniqueIds.size, 'All observation IDs should be unique')
  })

  test('should maintain referential integrity after expansion', async () => {
    const studyId = 'test-event-integrity'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')

    // All observations with non-NULL mediaID should reference existing media
    const orphanedObs = queryDatabase(
      dbPath,
      `SELECT o.* FROM observations o
       LEFT JOIN media m ON o.mediaID = m.mediaID
       WHERE o.mediaID IS NOT NULL AND m.mediaID IS NULL`
    )
    assert.equal(
      orphanedObs.length,
      0,
      'All observations with mediaID should reference existing media'
    )
  })
})
