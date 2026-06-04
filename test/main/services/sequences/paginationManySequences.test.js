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
  insertMedia
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-pag-many-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-pag-many-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath))
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

// Seed `n` media, each spaced an hour apart so every media is its own sequence
// (with a small gapSeconds). n > the pagination batch size (200) so the first
// fetched batch produces many more complete sequences than a single page's
// limit — the exact condition that used to make the cursor skip the middle.
async function seedSingletonSequences(n) {
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
  const base = DateTime.fromISO('2024-06-01T00:00:00Z')
  const mediaMap = {}
  for (let i = 1; i <= n; i++) {
    mediaMap[`m${i}.jpg`] = {
      mediaID: `m${String(i).padStart(4, '0')}`,
      deploymentID: 'd1',
      timestamp: base.plus({ hours: i }),
      filePath: `/m${i}.jpg`,
      fileName: `m${i}.jpg`
    }
  }
  await insertMedia(manager, mediaMap)
}

// Walk every page via the cursor and collect all sequences.
async function paginateAll(opts) {
  const all = []
  let cursor = null
  let guard = 0
  do {
    const res = await getPaginatedSequences(testDbPath, { ...opts, cursor })
    all.push(...res.sequences)
    cursor = res.hasMore ? res.nextCursor : null
    guard++
  } while (cursor && guard < 1000)
  return all
}

describe('getPaginatedSequences — many sequences across batches', () => {
  test('returns every sequence with no gaps when a batch holds more than `limit` complete sequences', async () => {
    const N = 250 // > batchSize (200) and >> limit
    await seedSingletonSequences(N)

    const all = await paginateAll({ gapSeconds: 1, limit: 15, sort: 'newest' })
    const ids = all.map((s) => s.items[0].mediaID)
    const unique = new Set(ids)

    assert.equal(unique.size, ids.length, 'no sequence should be returned twice')
    assert.equal(all.length, N, `should return all ${N} singleton sequences, got ${all.length}`)
  })

  test('also covers every sequence with oldest sort', async () => {
    const N = 250
    await seedSingletonSequences(N)

    const all = await paginateAll({ gapSeconds: 1, limit: 15, sort: 'oldest' })
    const ids = all.map((s) => s.items[0].mediaID)
    const unique = new Set(ids)

    assert.equal(unique.size, ids.length, 'no sequence should be returned twice')
    assert.equal(all.length, N, `should return all ${N} singleton sequences, got ${all.length}`)
  })
})
