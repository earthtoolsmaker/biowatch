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
import { BLANK_SENTINEL } from '../../../../src/shared/constants.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-pag-blank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-pag-blank-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath))
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

const m = (id, iso) => ({
  mediaID: id,
  deploymentID: 'd1',
  timestamp: DateTime.fromISO(iso),
  filePath: `/${id}.jpg`,
  fileName: `${id}.jpg`
})

// One deployment with two bursts:
//  - a MIXED burst (2 animal frames + 3 empty frames, all within 60s) → ONE
//    detection sequence in the unified grouping.
//  - a fully-EMPTY burst (3 empty frames, 10 min later) → ONE blank sequence.
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
    'a1.jpg': m('a1', '2024-06-01T10:00:00Z'), // animal
    'a2.jpg': m('a2', '2024-06-01T10:00:01Z'), // animal
    'e1.jpg': m('e1', '2024-06-01T10:00:02Z'), // empty (inside the animal burst)
    'e2.jpg': m('e2', '2024-06-01T10:00:03Z'),
    'e3.jpg': m('e3', '2024-06-01T10:00:04Z'),
    'b1.jpg': m('b1', '2024-06-01T10:10:00Z'), // empty burst
    'b2.jpg': m('b2', '2024-06-01T10:10:01Z'),
    'b3.jpg': m('b3', '2024-06-01T10:10:02Z')
  })
  await insertObservations(manager, [
    {
      observationID: 'o1',
      mediaID: 'a1',
      deploymentID: 'd1',
      scientificName: 'Capreolus capreolus',
      observationType: 'animal'
    },
    {
      observationID: 'o2',
      mediaID: 'a2',
      deploymentID: 'd1',
      scientificName: 'Capreolus capreolus',
      observationType: 'animal'
    }
  ])
}

describe('getPaginatedSequences — Blank filter is sequence-aware', () => {
  test('unfiltered: 2 sequences (one detection, one blank)', async () => {
    await seed()
    const res = await getPaginatedSequences(testDbPath, {
      gapSeconds: 60,
      limit: 20,
      sort: 'newest'
    })
    assert.equal(res.sequences.length, 2)
  })

  test('Blank filter returns only the fully-empty sequence (mixed-burst empties are NOT blank)', async () => {
    await seed()
    const res = await getPaginatedSequences(testDbPath, {
      gapSeconds: 60,
      limit: 20,
      sort: 'newest',
      filters: { species: [BLANK_SENTINEL] }
    })
    // Exactly ONE blank sequence — the empty burst. The 3 empty frames living
    // inside the animal burst must NOT form their own blank sequence.
    assert.equal(res.sequences.length, 1, 'should be 1 blank sequence, not 2')
    const ids = res.sequences[0].items.map((i) => i.mediaID).sort()
    assert.deepEqual(ids, ['b1', 'b2', 'b3'])
  })

  test('Detections filter (hideBlank) returns only the sequence with a detection', async () => {
    await seed()
    const res = await getPaginatedSequences(testDbPath, {
      gapSeconds: 60,
      limit: 20,
      sort: 'newest',
      filters: { hideBlank: true }
    })
    // The mirror of Blank: exactly ONE sequence — the mixed burst (it contains
    // the animal); the fully-empty burst is dropped.
    assert.equal(res.sequences.length, 1, 'should be 1 detection sequence, not 2')
    const ids = res.sequences[0].items.map((i) => i.mediaID).sort()
    assert.deepEqual(ids, ['a1', 'a2', 'e1', 'e2', 'e3'])
  })
})
