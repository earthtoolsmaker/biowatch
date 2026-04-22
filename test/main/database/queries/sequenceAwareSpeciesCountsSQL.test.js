/**
 * Parity tests for the SQL-aggregate path vs the JS pipeline.
 *
 * For each fixture + gap value, assert that:
 *   getSequenceAwareSpeciesCountsSQL(dbPath, gap)
 *   ==
 *   calculateSequenceAwareSpeciesCounts(getSpeciesDistributionByMedia(dbPath), gap)
 *
 * The SQL path is allowed to return null for gap values it does not handle
 * (currently: any positive number), in which case we skip the comparison.
 */

import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations,
  getSpeciesDistributionByMedia,
  getSequenceAwareSpeciesCountsSQL
} from '../../../../src/main/database/index.js'
import { calculateSequenceAwareSpeciesCounts } from '../../../../src/main/services/sequences/speciesCounts.js'

let testDbPath
let testStudyId
let testBiowatchDataPath

beforeEach(async () => {
  // Silence electron-log during tests
  try {
    const electronLog = await import('electron-log')
    const log = electronLog.default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // not available, fine
  }

  testStudyId = `test-sql-agg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-sql-agg-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

/**
 * Run the old JS pipeline and the new SQL aggregate, normalize both to
 * `[{scientificName, count}]` sorted by (count desc, name asc for stability),
 * and assert equality. If SQL returns null (unsupported gap), returns early.
 */
async function assertParity(dbPath, gapSeconds, label) {
  const rawRows = await getSpeciesDistributionByMedia(dbPath)
  const jsResult = calculateSequenceAwareSpeciesCounts(rawRows, gapSeconds)

  const sqlResult = await getSequenceAwareSpeciesCountsSQL(dbPath, gapSeconds)
  if (sqlResult === null) {
    return { skipped: true, gapSeconds, label }
  }

  const norm = (arr) =>
    [...arr]
      .map((r) => ({ scientificName: r.scientificName, count: Number(r.count) }))
      .sort(
        (a, b) =>
          b.count - a.count || (a.scientificName || '').localeCompare(b.scientificName || '')
      )

  assert.deepEqual(
    norm(sqlResult),
    norm(jsResult),
    `SQL vs JS parity mismatch for gap=${gapSeconds} (${label})`
  )
  return { skipped: false, gapSeconds, label, count: sqlResult.length }
}

async function seed(dbPath, { deployments, media, observations }) {
  const manager = await createImageDirectoryDatabase(dbPath)
  await insertDeployments(manager, deployments)
  await insertMedia(manager, media)
  await insertObservations(manager, observations)
  return manager
}

describe('getSequenceAwareSpeciesCountsSQL — parity with JS pipeline', () => {
  test('basic: three species across deployments, null + 0 gap parity', async () => {
    await seed(testDbPath, {
      deployments: {
        d1: {
          deploymentID: 'd1',
          locationID: 'loc1',
          locationName: 'Site A',
          deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
          deploymentEnd: DateTime.fromISO('2024-01-31T00:00:00Z'),
          latitude: 0,
          longitude: 0
        },
        d2: {
          deploymentID: 'd2',
          locationID: 'loc2',
          locationName: 'Site B',
          deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
          deploymentEnd: DateTime.fromISO('2024-01-31T00:00:00Z'),
          latitude: 1,
          longitude: 1
        }
      },
      media: {
        'm1.jpg': {
          mediaID: 'm1',
          deploymentID: 'd1',
          timestamp: DateTime.fromISO('2024-01-05T10:00:00Z'),
          filePath: 'p/m1.jpg',
          fileName: 'm1.jpg',
          importFolder: 'p',
          folderName: 'f'
        },
        'm2.jpg': {
          mediaID: 'm2',
          deploymentID: 'd1',
          timestamp: DateTime.fromISO('2024-01-05T10:00:30Z'),
          filePath: 'p/m2.jpg',
          fileName: 'm2.jpg',
          importFolder: 'p',
          folderName: 'f'
        },
        'm3.jpg': {
          mediaID: 'm3',
          deploymentID: 'd2',
          timestamp: DateTime.fromISO('2024-01-06T10:00:00Z'),
          filePath: 'p/m3.jpg',
          fileName: 'm3.jpg',
          importFolder: 'p',
          folderName: 'f'
        }
      },
      observations: [
        // Two observations on m1 → cnt=2 for (Deer, m1)
        {
          observationID: 'o1',
          mediaID: 'm1',
          deploymentID: 'd1',
          eventID: 'e1',
          scientificName: 'Deer',
          count: 3
        },
        {
          observationID: 'o2',
          mediaID: 'm1',
          deploymentID: 'd1',
          eventID: 'e1',
          scientificName: 'Deer',
          count: 3
        },
        // m2 in same event e1
        {
          observationID: 'o3',
          mediaID: 'm2',
          deploymentID: 'd1',
          eventID: 'e1',
          scientificName: 'Deer',
          count: 5
        },
        // m3 in its own event
        {
          observationID: 'o4',
          mediaID: 'm3',
          deploymentID: 'd2',
          eventID: 'e2',
          scientificName: 'Fox',
          count: 1
        }
      ]
    })
    await assertParity(testDbPath, null, 'null-gap')
    await assertParity(testDbPath, 0, 'eventID-gap')
  })

  test('excludes blank observationType and null/empty scientificName', async () => {
    await seed(testDbPath, {
      deployments: {
        d1: {
          deploymentID: 'd1',
          locationID: 'l1',
          locationName: 'A',
          deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
          deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
          latitude: 0,
          longitude: 0
        }
      },
      media: {
        'm1.jpg': {
          mediaID: 'm1',
          deploymentID: 'd1',
          timestamp: DateTime.fromISO('2024-01-01T10:00:00Z'),
          filePath: 'x/m1.jpg',
          fileName: 'm1.jpg',
          importFolder: 'x',
          folderName: 'f'
        },
        'm2.jpg': {
          mediaID: 'm2',
          deploymentID: 'd1',
          timestamp: DateTime.fromISO('2024-01-01T10:01:00Z'),
          filePath: 'x/m2.jpg',
          fileName: 'm2.jpg',
          importFolder: 'x',
          folderName: 'f'
        }
      },
      observations: [
        // Normal species observation
        {
          observationID: 'o1',
          mediaID: 'm1',
          deploymentID: 'd1',
          eventID: 'e1',
          scientificName: 'Badger',
          count: 1
        },
        // Blank observation (should be excluded) — same schema pattern as queries.test.js
        {
          observationID: 'o2',
          mediaID: 'm2',
          deploymentID: 'd1',
          eventID: 'e1',
          scientificName: null,
          observationType: 'blank',
          count: 0
        }
      ]
    })
    await assertParity(testDbPath, null, 'null-gap')
    await assertParity(testDbPath, 0, 'eventID-gap')
  })

  test('eventID-gap: multiple media share an eventID — MAX per (species,event) then SUM', async () => {
    await seed(testDbPath, {
      deployments: {
        d1: {
          deploymentID: 'd1',
          locationID: 'l1',
          locationName: 'A',
          deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
          deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
          latitude: 0,
          longitude: 0
        }
      },
      media: {
        'm1.jpg': {
          mediaID: 'm1',
          deploymentID: 'd1',
          timestamp: DateTime.fromISO('2024-01-01T10:00:00Z'),
          filePath: 'x/m1.jpg',
          fileName: 'm1.jpg',
          importFolder: 'x',
          folderName: 'f'
        },
        'm2.jpg': {
          mediaID: 'm2',
          deploymentID: 'd1',
          timestamp: DateTime.fromISO('2024-01-01T10:00:30Z'),
          filePath: 'x/m2.jpg',
          fileName: 'm2.jpg',
          importFolder: 'x',
          folderName: 'f'
        },
        'm3.jpg': {
          mediaID: 'm3',
          deploymentID: 'd1',
          timestamp: DateTime.fromISO('2024-01-02T10:00:00Z'),
          filePath: 'x/m3.jpg',
          fileName: 'm3.jpg',
          importFolder: 'x',
          folderName: 'f'
        }
      },
      // Note: the per-(species, media) "count" used by the sequence logic is
      // COUNT(observationID) over the group, NOT observations.count. To control
      // it we insert N rows per (species, media).
      observations: [
        // e1 / m1: 2 rows for Deer → cnt=2
        ...Array.from({ length: 2 }, (_, i) => ({
          observationID: `m1-Deer-${i}`,
          mediaID: 'm1',
          deploymentID: 'd1',
          eventID: 'e1',
          scientificName: 'Deer',
          count: 1
        })),
        // e1 / m2: 5 rows for Deer → cnt=5
        ...Array.from({ length: 5 }, (_, i) => ({
          observationID: `m2-Deer-${i}`,
          mediaID: 'm2',
          deploymentID: 'd1',
          eventID: 'e1',
          scientificName: 'Deer',
          count: 1
        })),
        // e2 / m3: 3 rows for Deer → cnt=3
        ...Array.from({ length: 3 }, (_, i) => ({
          observationID: `m3-Deer-${i}`,
          mediaID: 'm3',
          deploymentID: 'd1',
          eventID: 'e2',
          scientificName: 'Deer',
          count: 1
        }))
      ]
    })
    // For gap=0: Deer total should be 5 + 3 = 8 (MAX per event, SUM).
    // For gap=null: Deer total should be 2 + 5 + 3 = 10 (each media own seq).
    const rawRows = await getSpeciesDistributionByMedia(testDbPath)
    const jsEventID = calculateSequenceAwareSpeciesCounts(rawRows, 0)
    assert.equal(jsEventID.find((r) => r.scientificName === 'Deer').count, 8)
    const jsNull = calculateSequenceAwareSpeciesCounts(rawRows, null)
    assert.equal(jsNull.find((r) => r.scientificName === 'Deer').count, 10)

    await assertParity(testDbPath, null, 'null-gap')
    await assertParity(testDbPath, 0, 'eventID-gap')
  })

  test('null-timestamp media still contribute to counts', async () => {
    await seed(testDbPath, {
      deployments: {
        d1: {
          deploymentID: 'd1',
          locationID: 'l1',
          locationName: 'A',
          deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
          deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
          latitude: 0,
          longitude: 0
        }
      },
      media: {
        'm1.jpg': {
          mediaID: 'm1',
          deploymentID: 'd1',
          timestamp: DateTime.fromISO('2024-01-01T10:00:00Z'),
          filePath: 'x/m1.jpg',
          fileName: 'm1.jpg',
          importFolder: 'x',
          folderName: 'f'
        },
        'm2.jpg': {
          mediaID: 'm2',
          deploymentID: 'd1',
          timestamp: null, // null-ts
          filePath: 'x/m2.jpg',
          fileName: 'm2.jpg',
          importFolder: 'x',
          folderName: 'f'
        }
      },
      observations: [
        {
          observationID: 'o1',
          mediaID: 'm1',
          deploymentID: 'd1',
          eventID: 'e1',
          scientificName: 'Fox',
          count: 1
        },
        // Null-ts media with same eventID as valid-ts — current JS treats this as a
        // separate per-media sequence, my SQL must match.
        {
          observationID: 'o2',
          mediaID: 'm2',
          deploymentID: 'd1',
          eventID: 'e1',
          scientificName: 'Fox',
          count: 4
        }
      ]
    })
    await assertParity(testDbPath, null, 'null-gap with null-ts')
    await assertParity(testDbPath, 0, 'eventID-gap with null-ts')
  })

  test('positive gapSeconds: SQL path returns null (JS fallback)', async () => {
    await seed(testDbPath, {
      deployments: {
        d1: {
          deploymentID: 'd1',
          locationID: 'l1',
          locationName: 'A',
          deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
          deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
          latitude: 0,
          longitude: 0
        }
      },
      media: {
        'm1.jpg': {
          mediaID: 'm1',
          deploymentID: 'd1',
          timestamp: DateTime.fromISO('2024-01-01T10:00:00Z'),
          filePath: 'x/m1.jpg',
          fileName: 'm1.jpg',
          importFolder: 'x',
          folderName: 'f'
        }
      },
      observations: [
        {
          observationID: 'o1',
          mediaID: 'm1',
          deploymentID: 'd1',
          eventID: 'e1',
          scientificName: 'Deer',
          count: 1
        }
      ]
    })
    const sql = await getSequenceAwareSpeciesCountsSQL(testDbPath, 120)
    assert.equal(sql, null, 'positive gap should return null so caller falls back to JS')
  })

  test('empty DB returns empty array (gap=null and gap=0)', async () => {
    await createImageDirectoryDatabase(testDbPath)
    const sqlNull = await getSequenceAwareSpeciesCountsSQL(testDbPath, null)
    const sqlZero = await getSequenceAwareSpeciesCountsSQL(testDbPath, 0)
    assert.deepEqual(sqlNull, [])
    assert.deepEqual(sqlZero, [])
  })

  test('media with empty-string eventID becomes its own event (COALESCE NULLIF path)', async () => {
    await seed(testDbPath, {
      deployments: {
        d1: {
          deploymentID: 'd1',
          locationID: 'l1',
          locationName: 'A',
          deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
          deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
          latitude: 0,
          longitude: 0
        }
      },
      media: {
        'm1.jpg': {
          mediaID: 'm1',
          deploymentID: 'd1',
          timestamp: DateTime.fromISO('2024-01-01T10:00:00Z'),
          filePath: 'x/m1.jpg',
          fileName: 'm1.jpg',
          importFolder: 'x',
          folderName: 'f'
        },
        'm2.jpg': {
          mediaID: 'm2',
          deploymentID: 'd1',
          timestamp: DateTime.fromISO('2024-01-01T10:00:30Z'),
          filePath: 'x/m2.jpg',
          fileName: 'm2.jpg',
          importFolder: 'x',
          folderName: 'f'
        }
      },
      observations: [
        // m1 has empty-string eventID → its own "event"
        {
          observationID: 'o1',
          mediaID: 'm1',
          deploymentID: 'd1',
          eventID: '',
          scientificName: 'Badger',
          count: 2
        },
        // m2 has null eventID → also its own "event"
        {
          observationID: 'o2',
          mediaID: 'm2',
          deploymentID: 'd1',
          eventID: null,
          scientificName: 'Badger',
          count: 3
        }
      ]
    })
    await assertParity(testDbPath, null, 'null-gap, no-eventID')
    await assertParity(testDbPath, 0, 'eventID-gap, no-eventID')
  })
})
