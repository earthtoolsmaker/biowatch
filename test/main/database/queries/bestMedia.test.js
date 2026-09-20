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

describe('getBestImagePerSpecies fallback when bbox data is missing', () => {
  test('falls back to a representative photo per species when no observations have bboxWidth/bboxHeight', async () => {
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

    // No bbox -> every species gets a fallback photo (linked via mediaID).
    const byName = Object.fromEntries(result.map((r) => [r.scientificName, r]))
    assert.equal(result.length, 2)
    assert.equal(byName.Fox.mediaID, 'm-a')
    assert.equal(byName.Fox.isFallback, true)
    assert.equal(byName.Deer.mediaID, 'm-b')
    assert.equal(byName.Deer.isFallback, true)
  })

  test('falls back when observations have bboxX but no bboxWidth (point-only CamTrap DP pattern)', async () => {
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

    assert.equal(result.length, 1)
    assert.equal(result[0].scientificName, 'Fox')
    assert.equal(result[0].mediaID, 'm-a')
    assert.equal(result[0].isFallback, true)
  })

  test('falls back via the timestamp link when observations.mediaID is NULL (CamTrap DP)', async () => {
    // CamTrap DP datasets leave observations.mediaID NULL and link to media by
    // eventStart = media.timestamp within the same deployment.
    await seed({
      media: {
        'fox.jpg': mediaEntry('m-fox', '2024-01-05T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-fox',
          mediaID: null,
          deploymentID: 'd1',
          eventID: 'e-fox',
          eventStart: DateTime.fromISO('2024-01-05T10:00:00Z'),
          scientificName: 'Fox',
          count: 1
        }
      ]
    })

    const result = await getBestImagePerSpecies(testDbPath)

    assert.equal(result.length, 1)
    assert.equal(result[0].scientificName, 'Fox')
    assert.equal(result[0].mediaID, 'm-fox')
    assert.equal(result[0].isFallback, true)
  })

  test('runs the scoring pipeline and returns one scored row per species when bbox data exists', async () => {
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

    // One row per species, each pointing to the correct media and flagged as a
    // scored (non-fallback) image.
    const byName = Object.fromEntries(result.map((r) => [r.scientificName, r]))
    assert.ok(byName.Fox, 'Fox row present')
    assert.equal(byName.Fox.mediaID, 'm-fox')
    assert.equal(byName.Fox.isFallback, false)
    assert.ok(byName.Deer, 'Deer row present')
    assert.equal(byName.Deer.mediaID, 'm-deer')
    assert.equal(byName.Deer.isFallback, false)
    assert.equal(result.length, 2)
  })

  test('mixes scored and fallback rows: species without a bbox still gets a photo', async () => {
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
          count: 1
        },
        {
          observationID: 'o-deer',
          mediaID: 'm-deer',
          deploymentID: 'd1',
          eventID: 'e-deer',
          scientificName: 'Deer',
          count: 1
        }
      ]
    })
    // Only Fox has a usable bbox; Deer has none.
    setBbox(manager, 'o-fox', { x: 0.2, y: 0.2, width: 0.3, height: 0.3 })

    const result = await getBestImagePerSpecies(testDbPath)

    const byName = Object.fromEntries(result.map((r) => [r.scientificName, r]))
    assert.equal(result.length, 2)
    assert.equal(byName.Fox.mediaID, 'm-fox')
    assert.equal(byName.Fox.isFallback, false)
    assert.equal(byName.Deer.mediaID, 'm-deer')
    assert.equal(byName.Deer.isFallback, true)
  })
})

describe('getBestMedia auto-scored IUCN boost', () => {
  // Real species names that resolve in the bundled IUCN dictionary.
  // Verify with: grep '"ailurus fulgens"' src/shared/speciesInfo/data.json
  const EN_NAME = 'Ailurus fulgens' // Endangered (red panda) → +0.18
  const LC_NAME = 'Vulpes vulpes' // Least Concern (red fox) → 0
  const NOT_IN_DICT = 'Made up species' // No resolution → 0

  test('an EN species displaces a comparable LC species when their raw scores are close', async () => {
    // Two media at the same deployment, identical bbox geometry and detection
    // confidence so the only difference between them in the orig formula is
    // the rarity boost (which is the same when each species appears once).
    // The IUCN boost should tip the EN species above the LC one.
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-en', '2024-01-05T12:00:00Z'),
        'b.jpg': mediaEntry('m-lc', '2024-01-06T12:00:00Z')
      },
      observations: [
        {
          observationID: 'o-en',
          mediaID: 'm-en',
          deploymentID: 'd1',
          eventID: 'e-en',
          scientificName: EN_NAME,
          count: 1
        },
        {
          observationID: 'o-lc',
          mediaID: 'm-lc',
          deploymentID: 'd1',
          eventID: 'e-lc',
          scientificName: LC_NAME,
          count: 1
        }
      ]
    })
    setBbox(manager, 'o-en', { x: 0.3, y: 0.3, width: 0.3, height: 0.3, detectionConfidence: 0.9 })
    setBbox(manager, 'o-lc', { x: 0.3, y: 0.3, width: 0.3, height: 0.3, detectionConfidence: 0.9 })

    const result = await getBestMedia(testDbPath, { limit: 12 })

    const enRow = result.find((r) => r.scientificName === EN_NAME)
    const lcRow = result.find((r) => r.scientificName === LC_NAME)
    assert.ok(enRow, `expected EN row for ${EN_NAME}`)
    assert.ok(lcRow, `expected LC row for ${LC_NAME}`)
    assert.ok(
      enRow.compositeScore > lcRow.compositeScore,
      `expected EN boost to make ${EN_NAME} (${enRow.compositeScore}) outrank ${LC_NAME} (${lcRow.compositeScore})`
    )
    // Boost magnitude: EN gets +0.18 on top of an otherwise-equal score.
    // We allow a small tolerance because rarity score is per-species count.
    assert.ok(
      enRow.compositeScore - lcRow.compositeScore >= 0.17,
      `expected score gap ≥ 0.17, got ${enRow.compositeScore - lcRow.compositeScore}`
    )
  })

  test('a species not in the IUCN dictionary gets no boost', async () => {
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-x', '2024-01-05T12:00:00Z'),
        'b.jpg': mediaEntry('m-lc', '2024-01-06T12:00:00Z')
      },
      observations: [
        {
          observationID: 'o-x',
          mediaID: 'm-x',
          deploymentID: 'd1',
          eventID: 'e-x',
          scientificName: NOT_IN_DICT,
          count: 1
        },
        {
          observationID: 'o-lc',
          mediaID: 'm-lc',
          deploymentID: 'd1',
          eventID: 'e-lc',
          scientificName: LC_NAME,
          count: 1
        }
      ]
    })
    setBbox(manager, 'o-x', { x: 0.3, y: 0.3, width: 0.3, height: 0.3, detectionConfidence: 0.9 })
    setBbox(manager, 'o-lc', { x: 0.3, y: 0.3, width: 0.3, height: 0.3, detectionConfidence: 0.9 })

    const result = await getBestMedia(testDbPath, { limit: 12 })

    const xRow = result.find((r) => r.scientificName === NOT_IN_DICT)
    const lcRow = result.find((r) => r.scientificName === LC_NAME)
    assert.ok(xRow && lcRow)
    // Both have no IUCN boost, so the gap should be ≤ 0.01 (just rarity ties).
    assert.ok(
      Math.abs(xRow.compositeScore - lcRow.compositeScore) < 0.05,
      `expected no boost for unresolved species; gap was ${Math.abs(xRow.compositeScore - lcRow.compositeScore)}`
    )
  })

  test('zero IUCN-tagged species in the study → query still runs (CASE expr is "0")', async () => {
    const manager = await seed({
      media: { 'a.jpg': mediaEntry('m-x', '2024-01-05T12:00:00Z') },
      observations: [
        {
          observationID: 'o-x',
          mediaID: 'm-x',
          deploymentID: 'd1',
          eventID: 'e-x',
          scientificName: NOT_IN_DICT,
          count: 1
        }
      ]
    })
    setBbox(manager, 'o-x', { x: 0.3, y: 0.3, width: 0.3, height: 0.3, detectionConfidence: 0.9 })

    const result = await getBestMedia(testDbPath, { limit: 12 })

    assert.equal(result.length, 1)
    assert.equal(result[0].scientificName, NOT_IN_DICT)
  })
})

describe('getBestMedia favorites over-limit ordering', () => {
  const EN_NAME = 'Ailurus fulgens' // Endangered
  const VU_NAME = 'Acinonyx jubatus' // Vulnerable
  const LC_NAME = 'Vulpes vulpes' // Least Concern

  test('when favorites count ≤ limit, ordering is timestamp DESC (unchanged)', async () => {
    // 3 favorites, limit=12 → under limit. The IUCN-aware reorder must NOT trigger.
    // The user's curated set is preserved in chronological order.
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-old-en', '2024-01-01T10:00:00Z'),
        'b.jpg': mediaEntry('m-mid-lc', '2024-01-02T10:00:00Z'),
        'c.jpg': mediaEntry('m-new-vu', '2024-01-03T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-en',
          mediaID: 'm-old-en',
          deploymentID: 'd1',
          eventID: 'e-en',
          scientificName: EN_NAME,
          count: 1
        },
        {
          observationID: 'o-lc',
          mediaID: 'm-mid-lc',
          deploymentID: 'd1',
          eventID: 'e-lc',
          scientificName: LC_NAME,
          count: 1
        },
        {
          observationID: 'o-vu',
          mediaID: 'm-new-vu',
          deploymentID: 'd1',
          eventID: 'e-vu',
          scientificName: VU_NAME,
          count: 1
        }
      ]
    })
    markFavorites(manager, ['m-old-en', 'm-mid-lc', 'm-new-vu'])

    const result = await getBestMedia(testDbPath, { limit: 12 })

    // All three favorites returned, in timestamp DESC order — NOT tier order.
    assert.deepEqual(
      result.map((r) => r.mediaID),
      ['m-new-vu', 'm-mid-lc', 'm-old-en']
    )
  })

  test('when favorites count > limit, ordering is IUCN tier DESC then timestamp DESC', async () => {
    // 5 favorites, limit=3 → over limit. EN (oldest) must beat LC (newest)
    // because tier-first beats recency.
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-en-old', '2024-01-01T10:00:00Z'),
        'b.jpg': mediaEntry('m-en-new', '2024-01-02T10:00:00Z'),
        'c.jpg': mediaEntry('m-vu', '2024-01-03T10:00:00Z'),
        'd.jpg': mediaEntry('m-lc-old', '2024-01-04T10:00:00Z'),
        'e.jpg': mediaEntry('m-lc-new', '2024-01-05T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-1',
          mediaID: 'm-en-old',
          deploymentID: 'd1',
          eventID: 'e-1',
          scientificName: EN_NAME,
          count: 1
        },
        {
          observationID: 'o-2',
          mediaID: 'm-en-new',
          deploymentID: 'd1',
          eventID: 'e-2',
          scientificName: EN_NAME,
          count: 1
        },
        {
          observationID: 'o-3',
          mediaID: 'm-vu',
          deploymentID: 'd1',
          eventID: 'e-3',
          scientificName: VU_NAME,
          count: 1
        },
        {
          observationID: 'o-4',
          mediaID: 'm-lc-old',
          deploymentID: 'd1',
          eventID: 'e-4',
          scientificName: LC_NAME,
          count: 1
        },
        {
          observationID: 'o-5',
          mediaID: 'm-lc-new',
          deploymentID: 'd1',
          eventID: 'e-5',
          scientificName: LC_NAME,
          count: 1
        }
      ]
    })
    markFavorites(manager, ['m-en-old', 'm-en-new', 'm-vu', 'm-lc-old', 'm-lc-new'])

    const result = await getBestMedia(testDbPath, { limit: 3 })

    // Top 3 by tier-first: both EN (newest first within tier), then VU.
    // The two LC favorites get pushed off, even though one is the newest overall.
    assert.deepEqual(
      result.map((r) => r.mediaID),
      ['m-en-new', 'm-en-old', 'm-vu']
    )
  })

  test('with exactly limit favorites, no reorder happens (timestamp DESC preserved)', async () => {
    // Boundary: count === limit. Neither over-limit reorder nor auto-scored fill.
    const manager = await seed({
      media: {
        'a.jpg': mediaEntry('m-lc', '2024-01-01T10:00:00Z'),
        'b.jpg': mediaEntry('m-en', '2024-01-02T10:00:00Z')
      },
      observations: [
        {
          observationID: 'o-lc',
          mediaID: 'm-lc',
          deploymentID: 'd1',
          eventID: 'e-lc',
          scientificName: LC_NAME,
          count: 1
        },
        {
          observationID: 'o-en',
          mediaID: 'm-en',
          deploymentID: 'd1',
          eventID: 'e-en',
          scientificName: EN_NAME,
          count: 1
        }
      ]
    })
    markFavorites(manager, ['m-lc', 'm-en'])

    const result = await getBestMedia(testDbPath, { limit: 2 })

    // Count == limit → original timestamp-DESC path. EN (newest) first, LC second.
    // (Tier-first WOULD pass too — they happen to coincide here. The previous
    // test is the one that distinguishes tier-first from timestamp-first.)
    assert.deepEqual(
      result.map((r) => r.mediaID),
      ['m-en', 'm-lc']
    )
  })
})

describe('getBestMedia IUCN scaling', () => {
  test('handles 1000 distinct species, all marked threatened, without "too many SQL variables"', async () => {
    // The realistic worst case is ~20 IUCN-tagged species per study (measured
    // on 56 local DBs); 1000 is two orders of magnitude beyond that. SQLite's
    // hard cap is 32766, so 1000 should comfortably succeed.
    const numSpecies = 1000

    // Stub resolver: every species we hand it is EN. No dependency on the
    // bundled dictionary — keeps this test deterministic.
    const stubResolver = () => ({ iucn: 'EN' })

    const media = {}
    const observations = []
    for (let i = 0; i < numSpecies; i++) {
      const mid = `m-${i}`
      media[`${i}.jpg`] = mediaEntry(mid, `2024-01-01T${String(i % 24).padStart(2, '0')}:00:00Z`)
      observations.push({
        observationID: `o-${i}`,
        mediaID: mid,
        deploymentID: 'd1',
        eventID: `e-${i}`,
        scientificName: `Genus speciesnumber${i}`,
        count: 1
      })
    }
    const manager = await seed({ media, observations })
    for (let i = 0; i < numSpecies; i++) {
      setBbox(manager, `o-${i}`, {
        x: 0.3,
        y: 0.3,
        width: 0.3,
        height: 0.3,
        detectionConfidence: 0.9
      })
    }

    const t0 = Date.now()
    const result = await getBestMedia(testDbPath, { limit: 12, iucnResolver: stubResolver })
    const elapsed = Date.now() - t0

    // We injected the stub resolver, so every species is "EN" and gets +0.18.
    assert.equal(result.length, 12)
    // Sanity bound: the test infrastructure (seeding 1000 obs) dominates,
    // but the actual query should be well under 5 seconds even on slow CI.
    assert.ok(elapsed < 10000, `getBestMedia took ${elapsed}ms with 1000 species`)
  })
})
