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
  testStudyId = `test-pag-sort-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-pag-sort-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

async function seedDays(n) {
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
  const mediaMap = {}
  for (let i = 1; i <= n; i++) {
    const day = String(i).padStart(2, '0')
    mediaMap[`m${i}.jpg`] = {
      mediaID: `m${i}`,
      deploymentID: 'd1',
      timestamp: DateTime.fromISO(`2024-06-${day}T10:00:00Z`),
      filePath: `/m${i}.jpg`,
      fileName: `m${i}.jpg`
    }
  }
  await insertMedia(manager, mediaMap)
}

describe('getPaginatedSequences — sort', () => {
  test('newest (default): most recent sequence first', async () => {
    await seedDays(3)
    const res = await getPaginatedSequences(testDbPath, { gapSeconds: 1, limit: 20, sort: 'newest' })
    const firstIDs = res.sequences.map((s) => s.items[0].mediaID)
    assert.deepEqual(firstIDs, ['m3', 'm2', 'm1'])
  })

  test('oldest: earliest sequence first', async () => {
    await seedDays(3)
    const res = await getPaginatedSequences(testDbPath, { gapSeconds: 1, limit: 20, sort: 'oldest' })
    const firstIDs = res.sequences.map((s) => s.items[0].mediaID)
    assert.deepEqual(firstIDs, ['m1', 'm2', 'm3'])
  })

  test('oldest: paginates forward correctly across pages (cursor direction)', async () => {
    await seedDays(5)
    const collected = []
    let cursor = null
    // Page through 2 at a time; each media is its own sequence (gap=1s).
    for (let i = 0; i < 10; i++) {
      const res = await getPaginatedSequences(testDbPath, {
        gapSeconds: 1,
        limit: 2,
        sort: 'oldest',
        cursor
      })
      collected.push(...res.sequences.map((s) => s.items[0].mediaID))
      if (!res.hasMore) break
      cursor = res.nextCursor
    }
    assert.deepEqual(collected, ['m1', 'm2', 'm3', 'm4', 'm5'])
  })

  test('newest: paginates forward correctly across pages (regression)', async () => {
    await seedDays(5)
    const collected = []
    let cursor = null
    for (let i = 0; i < 10; i++) {
      const res = await getPaginatedSequences(testDbPath, {
        gapSeconds: 1,
        limit: 2,
        sort: 'newest',
        cursor
      })
      collected.push(...res.sequences.map((s) => s.items[0].mediaID))
      if (!res.hasMore) break
      cursor = res.nextCursor
    }
    assert.deepEqual(collected, ['m5', 'm4', 'm3', 'm2', 'm1'])
  })
})
