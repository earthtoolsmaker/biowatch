/**
 * Tests for the favorites CTE rewrite in getBestMedia and the bbox
 * short-circuit in getBestImagePerSpecies.
 *
 * insertMedia/insertObservations don't expose favorite or bbox columns, so
 * we seed those via raw SQL on the underlying better-sqlite3 handle.
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
  getBestMedia,
  getBestImagePerSpecies
} from '../../../../src/main/database/index.js'

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

  testStudyId = `test-best-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-best-media-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

function deployment(id) {
  return {
    deploymentID: id,
    locationID: `loc-${id}`,
    locationName: `Site ${id}`,
    deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
    deploymentEnd: DateTime.fromISO('2024-01-31T00:00:00Z'),
    latitude: 0,
    longitude: 0
  }
}

function mediaEntry(id, ts) {
  return {
    mediaID: id,
    deploymentID: 'd1',
    timestamp: DateTime.fromISO(ts),
    filePath: `p/${id}.jpg`,
    fileName: `${id}.jpg`,
    importFolder: 'p',
    folderName: 'f'
  }
}

async function seed({ deployments = { d1: deployment('d1') }, media, observations }) {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, deployments)
  await insertMedia(manager, media)
  await insertObservations(manager, observations)
  return manager
}

/** Raw-SQL helper to mark specific mediaIDs as favorite = 1. */
function markFavorites(manager, mediaIDs) {
  const sqlite = manager.getSqlite()
  const stmt = sqlite.prepare('UPDATE media SET favorite = 1 WHERE mediaID = ?')
  for (const id of mediaIDs) stmt.run(id)
}

/** Raw-SQL helper to populate bbox geometry on an observation. */
function setBbox(manager, observationID, { x, y, width, height, detectionConfidence = 0.9 }) {
  const sqlite = manager.getSqlite()
  sqlite
    .prepare(
      `UPDATE observations
         SET bboxX = ?, bboxY = ?, bboxWidth = ?, bboxHeight = ?, detectionConfidence = ?
       WHERE observationID = ?`
    )
    .run(x, y, width, height, detectionConfidence, observationID)
}

describe('getBestMedia favorites CTE', () => {
  test('returns all favorites that have observations, capped at limit', async () => {
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-a', '2024-01-05T10:00:00Z'),
        'b.jpg': mediaEntry('m-b', '2024-01-06T10:00:00Z'),
        'c.jpg': mediaEntry('m-c', '2024-01-07T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-a',
          mediaID: 'm-a',
          deploymentID: 'd1',
          eventID: 'e-a',
          scientificName: 'Fox',
          count: 1
        },
        {
          observationID: 'o-b',
          mediaID: 'm-b',
          deploymentID: 'd1',
          eventID: 'e-b',
          scientificName: 'Deer',
          count: 1
        },
        {
          observationID: 'o-c',
          mediaID: 'm-c',
          deploymentID: 'd1',
          eventID: 'e-c',
          scientificName: 'Badger',
          count: 1
        }
      ]
    })
    markFavorites(manager, ['m-a', 'm-b', 'm-c'])

    const result = await getBestMedia(testDbPath, { limit: 12 })

    assert.equal(result.length, 3)
    // Ordered by timestamp DESC
    assert.deepEqual(
      result.map((r) => r.mediaID),
      ['m-c', 'm-b', 'm-a']
    )
    // All flagged as favorites
    for (const r of result) assert.equal(r.favorite, 1)
    // scientificName decorated from the favorite's observation
    assert.deepEqual(
      result.map((r) => r.scientificName),
      ['Badger', 'Deer', 'Fox']
    )
  })

  test('favorites without observations are excluded (do not consume limit)', async () => {
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-a', '2024-01-05T10:00:00Z'),
        'b.jpg': mediaEntry('m-b', '2024-01-06T10:00:00Z'), // no observation
        'c.jpg': mediaEntry('m-c', '2024-01-07T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-a',
          mediaID: 'm-a',
          deploymentID: 'd1',
          eventID: 'e-a',
          scientificName: 'Fox',
          count: 1
        },
        {
          observationID: 'o-c',
          mediaID: 'm-c',
          deploymentID: 'd1',
          eventID: 'e-c',
          scientificName: 'Badger',
          count: 1
        }
      ]
    })
    markFavorites(manager, ['m-a', 'm-b', 'm-c'])

    const result = await getBestMedia(testDbPath, { limit: 12 })

    // m-b has no observation so it is filtered out; the other two remain.
    assert.equal(result.length, 2)
    assert.deepEqual(result.map((r) => r.mediaID).sort(), ['m-a', 'm-c'])
  })

  test('LIMIT is applied after the observation-null filter, not before', async () => {
    // Three favorites (timestamps in DESC order: c, b, a). m-b has no obs.
    // With LIMIT 2 this should return [m-c, m-a] — the two favorites that
    // have observations — rather than [m-c, m-b] which would be wrong.
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-a', '2024-01-05T10:00:00Z'),
        'b.jpg': mediaEntry('m-b', '2024-01-06T10:00:00Z'),
        'c.jpg': mediaEntry('m-c', '2024-01-07T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-a',
          mediaID: 'm-a',
          deploymentID: 'd1',
          eventID: 'e-a',
          scientificName: 'Fox',
          count: 1
        },
        {
          observationID: 'o-c',
          mediaID: 'm-c',
          deploymentID: 'd1',
          eventID: 'e-c',
          scientificName: 'Badger',
          count: 1
        }
      ]
    })
    markFavorites(manager, ['m-a', 'm-b', 'm-c'])

    const result = await getBestMedia(testDbPath, { limit: 2 })

    assert.equal(result.length, 2)
    assert.deepEqual(
      result.map((r) => r.mediaID),
      ['m-c', 'm-a']
    )
  })

  test('picks highest-detectionConfidence observation per (media, species) via ROW_NUMBER', async () => {
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-a', '2024-01-05T10:00:00Z')
      },
      observations: [
        // Two Fox observations on the same media with different confidences.
        // The CTE's ROW_NUMBER ... ORDER BY detectionConfidence DESC picks the
        // higher-confidence one (0.9), which must be the observationID returned.
        {
          observationID: 'o-low',
          mediaID: 'm-a',
          deploymentID: 'd1',
          eventID: 'e-a',
          scientificName: 'Fox',
          count: 1,
          classificationProbability: 0.3
        },
        {
          observationID: 'o-high',
          mediaID: 'm-a',
          deploymentID: 'd1',
          eventID: 'e-a',
          scientificName: 'Fox',
          count: 1,
          classificationProbability: 0.9
        }
      ]
    })
    markFavorites(manager, ['m-a'])
    setBbox(manager, 'o-low', { x: 0.1, y: 0.1, width: 0.2, height: 0.2, detectionConfidence: 0.1 })
    setBbox(manager, 'o-high', {
      x: 0.3,
      y: 0.3,
      width: 0.4,
      height: 0.4,
      detectionConfidence: 0.9
    })

    const result = await getBestMedia(testDbPath, { limit: 12 })

    assert.equal(result.length, 1)
    assert.equal(result[0].observationID, 'o-high')
    assert.equal(result[0].detectionConfidence, 0.9)
  })
})

describe('getBestMedia short-circuit on missing bbox data', () => {
  test('no favorites + no bbox data: returns [] without running auto-scored CTE', async () => {
    await seed({
      media: {
        'a.jpg': mediaEntry('m-a', '2024-01-05T10:00:00Z'),
        'b.jpg': mediaEntry('m-b', '2024-01-06T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-a',
          mediaID: 'm-a',
          deploymentID: 'd1',
          eventID: 'e-a',
          scientificName: 'Fox',
          count: 1
        },
        {
          observationID: 'o-b',
          mediaID: 'm-b',
          deploymentID: 'd1',
          eventID: 'e-b',
          scientificName: 'Deer',
          count: 1
        }
      ]
      // No favorites marked, no bboxes populated.
    })

    const result = await getBestMedia(testDbPath, { limit: 12 })

    assert.deepEqual(result, [])
  })

  test('some favorites + no bbox data: returns only the favorites, skipping auto-scored', async () => {
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-a', '2024-01-05T10:00:00Z'),
        'b.jpg': mediaEntry('m-b', '2024-01-06T10:00:00Z'),
        'c.jpg': mediaEntry('m-c', '2024-01-07T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-a',
          mediaID: 'm-a',
          deploymentID: 'd1',
          eventID: 'e-a',
          scientificName: 'Fox',
          count: 1
        },
        {
          observationID: 'o-b',
          mediaID: 'm-b',
          deploymentID: 'd1',
          eventID: 'e-b',
          scientificName: 'Deer',
          count: 1
        },
        {
          observationID: 'o-c',
          mediaID: 'm-c',
          deploymentID: 'd1',
          eventID: 'e-c',
          scientificName: 'Badger',
          count: 1
        }
      ]
    })
    // Mark only two of three as favorites; limit is larger than favorite count.
    markFavorites(manager, ['m-a', 'm-b'])

    const result = await getBestMedia(testDbPath, { limit: 12 })

    // Must return exactly the two favorites (no auto-scored fill-in on a
    // no-bbox dataset), ordered by timestamp DESC.
    assert.equal(result.length, 2)
    assert.deepEqual(
      result.map((r) => r.mediaID),
      ['m-b', 'm-a']
    )
  })

  test('bbox data exists + 0 favorites: auto-scored path runs and returns per-species candidates', async () => {
    const manager = await seed({
      media: {
        'fox.jpg': mediaEntry('m-fox', '2024-01-05T10:00:00Z'),
        'deer.jpg': mediaEntry('m-deer', '2024-01-06T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-fox',
          mediaID: 'm-fox',
          deploymentID: 'd1',
          eventID: 'e-fox',
          scientificName: 'Fox',
          count: 1,
          classificationProbability: 0.8
        },
        {
          observationID: 'o-deer',
          mediaID: 'm-deer',
          deploymentID: 'd1',
          eventID: 'e-deer',
          scientificName: 'Deer',
          count: 1,
          classificationProbability: 0.9
        }
      ]
    })
    setBbox(manager, 'o-fox', { x: 0.2, y: 0.2, width: 0.3, height: 0.3 })
    setBbox(manager, 'o-deer', { x: 0.1, y: 0.1, width: 0.4, height: 0.4 })
    // No favorites marked; auto-scored branch must run.

    const result = await getBestMedia(testDbPath, { limit: 12 })

    // Both species' media should be selected via the scoring/diversity pipeline.
    const mediaIDs = result.map((r) => r.mediaID).sort()
    assert.deepEqual(mediaIDs, ['m-deer', 'm-fox'])
  })
})

describe('getBestImagePerSpecies short-circuit on missing bbox data', () => {
  test('returns [] when no observations have bboxWidth/bboxHeight', async () => {
    await seed({
      media: {
        'a.jpg': mediaEntry('m-a', '2024-01-05T10:00:00Z'),
        'b.jpg': mediaEntry('m-b', '2024-01-06T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-a',
          mediaID: 'm-a',
          deploymentID: 'd1',
          eventID: 'e-a',
          scientificName: 'Fox',
          count: 1
        },
        {
          observationID: 'o-b',
          mediaID: 'm-b',
          deploymentID: 'd1',
          eventID: 'e-b',
          scientificName: 'Deer',
          count: 1
        }
      ]
    })

    const result = await getBestImagePerSpecies(testDbPath)

    assert.deepEqual(result, [])
  })

  test('returns [] when observations have bboxX but no bboxWidth (point-only CamTrap DP pattern)', async () => {
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-a', '2024-01-05T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-a',
          mediaID: 'm-a',
          deploymentID: 'd1',
          eventID: 'e-a',
          scientificName: 'Fox',
          count: 1
        }
      ]
    })
    // Populate bboxX/bboxY but leave width/height NULL (matches the CamTrap DP
    // pattern we observed on gmu8_leuven).
    manager
      .getSqlite()
      .prepare('UPDATE observations SET bboxX = 0.5, bboxY = 0.5 WHERE observationID = ?')
      .run('o-a')

    const result = await getBestImagePerSpecies(testDbPath)

    assert.deepEqual(result, [])
  })

  test('runs the scoring pipeline and returns one row per species when bbox data exists', async () => {
    const manager = await seed({
      media: {
        'fox.jpg': mediaEntry('m-fox', '2024-01-05T10:00:00Z'),
        'deer.jpg': mediaEntry('m-deer', '2024-01-06T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-fox',
          mediaID: 'm-fox',
          deploymentID: 'd1',
          eventID: 'e-fox',
          scientificName: 'Fox',
          count: 1,
          classificationProbability: 0.8
        },
        {
          observationID: 'o-deer',
          mediaID: 'm-deer',
          deploymentID: 'd1',
          eventID: 'e-deer',
          scientificName: 'Deer',
          count: 1,
          classificationProbability: 0.9
        }
      ]
    })
    setBbox(manager, 'o-fox', { x: 0.2, y: 0.2, width: 0.3, height: 0.3 })
    setBbox(manager, 'o-deer', { x: 0.1, y: 0.1, width: 0.4, height: 0.4 })

    const result = await getBestImagePerSpecies(testDbPath)

    // One row per species, each pointing to the correct media.
    const byName = Object.fromEntries(result.map((r) => [r.scientificName, r]))
    assert.ok(byName.Fox, 'Fox row present')
    assert.equal(byName.Fox.mediaID, 'm-fox')
    assert.ok(byName.Deer, 'Deer row present')
    assert.equal(byName.Deer.mediaID, 'm-deer')
    assert.equal(result.length, 2)
  })
})
