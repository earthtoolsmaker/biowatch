import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import { getPaginatedSequences } from '../../../../src/main/services/sequences/index.js'
import {
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-pag-qv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-pag-qv-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath))
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

// Seed four media:
//  m1 — timestamped, favorite, human-classified            (reviewed, fav)
//  m2 — timestamped, machine prob 0.30                       (needs-review, low-conf)
//  m3 — timestamped, human-classified                        (reviewed)
//  m4 — NULL timestamp, machine prob 0.90                    (needs-review, null-ts)
async function seed() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: {
      deploymentID: 'd1',
      locationID: 'l1',
      locationName: 'A',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 1,
      longitude: 1,
      cameraID: 'c1'
    }
  })
  await insertMedia(manager, {
    'm1.jpg': {
      mediaID: 'm1',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'),
      filePath: '/m1.jpg',
      fileName: 'm1.jpg',
      favorite: true
    },
    'm2.jpg': {
      mediaID: 'm2',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'),
      filePath: '/m2.jpg',
      fileName: 'm2.jpg'
    },
    'm3.jpg': {
      mediaID: 'm3',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-03T10:00:00Z'),
      filePath: '/m3.jpg',
      fileName: 'm3.jpg'
    },
    'm4.jpg': {
      mediaID: 'm4',
      deploymentID: 'd1',
      timestamp: null,
      filePath: '/m4.jpg',
      fileName: 'm4.jpg'
    }
  })
  await insertObservations(manager, [
    {
      observationID: 'o1',
      mediaID: 'm1',
      deploymentID: 'd1',
      scientificName: 'Panthera pardus',
      observationType: 'animal',
      classificationMethod: 'human'
    },
    {
      observationID: 'o2',
      mediaID: 'm2',
      deploymentID: 'd1',
      scientificName: 'Genetta genetta',
      observationType: 'animal',
      classificationMethod: 'machine',
      classificationProbability: 0.3
    },
    {
      observationID: 'o3',
      mediaID: 'm3',
      deploymentID: 'd1',
      scientificName: 'Panthera pardus',
      observationType: 'animal',
      classificationMethod: 'human'
    },
    {
      observationID: 'o4',
      mediaID: 'm4',
      deploymentID: 'd1',
      scientificName: 'Sus scrofa',
      observationType: 'animal',
      classificationMethod: 'machine',
      classificationProbability: 0.9
    }
  ])
}

// getPaginatedSequences returns one phase per call (timestamped, then the
// null-timestamp phase on the following page), so page through to completion.
async function collectIds(filters) {
  const ids = []
  let cursor = null
  for (let i = 0; i < 20; i++) {
    const res = await getPaginatedSequences(testDbPath, {
      gapSeconds: 1,
      limit: 50,
      cursor,
      filters
    })
    ids.push(...res.sequences.flatMap((s) => s.items.map((m) => m.mediaID)))
    if (!res.hasMore) break
    cursor = res.nextCursor
  }
  return ids.sort()
}

describe('getPaginatedSequences — quick-view filters', () => {
  test('favorite: only favorited media', async () => {
    await seed()
    assert.deepEqual(await collectIds({ favorite: true }), ['m1'])
  })

  test('onlyNullTimestamps: only null-timestamp media', async () => {
    await seed()
    assert.deepEqual(await collectIds({ onlyNullTimestamps: true }), ['m4'])
  })

  test('no quick-view filters: all media returned', async () => {
    await seed()
    assert.deepEqual(await collectIds({}), ['m1', 'm2', 'm3', 'm4'])
  })
})
