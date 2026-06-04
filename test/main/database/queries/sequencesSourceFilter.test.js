import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getMediaForSequencePagination,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-sourcefilter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-sourcefilter-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath))
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

async function seed() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  await insertDeployments(manager, {
    d1: {
      deploymentID: 'd1',
      locationID: 'loc1',
      locationName: 'Site A',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 1,
      longitude: 1,
      cameraID: 'cam1'
    }
  })
  // two sources, distinguished by importFolder
  await insertMedia(manager, {
    'a.jpg': {
      mediaID: 'a',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'),
      filePath: '/a.jpg',
      fileName: 'a.jpg',
      importFolder: 'ndutu_2024'
    },
    'b.jpg': {
      mediaID: 'b',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'),
      filePath: '/b.jpg',
      fileName: 'b.jpg',
      importFolder: 'serengeti_2023'
    },
    'c-null.jpg': {
      mediaID: 'c',
      deploymentID: 'd1',
      timestamp: null,
      filePath: '/c.jpg',
      fileName: 'c.jpg',
      importFolder: 'ndutu_2024'
    }
  })
}

describe('getMediaForSequencePagination — source filter', () => {
  test('no source: returns media from all sources (timestamped phase)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: null,
      batchSize: 100,
      species: [],
      dateRange: {},
      timeRange: {}
    })
    assert.deepEqual(result.media.map((m) => m.mediaID).sort(), ['a', 'b'])
  })

  test('with source: only matching source (timestamped phase)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: null,
      batchSize: 100,
      species: [],
      dateRange: {},
      timeRange: {},
      source: 'ndutu_2024'
    })
    assert.deepEqual(result.media.map((m) => m.mediaID).sort(), ['a'])
  })

  test('with source: only matching source (null phase)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: { phase: 'null', offset: 0 },
      batchSize: 100,
      species: [],
      dateRange: {},
      timeRange: {},
      source: 'ndutu_2024'
    })
    assert.deepEqual(result.media.map((m) => m.mediaID).sort(), ['c'])
  })

  test('non-existent source: empty, no error', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      cursor: null,
      batchSize: 100,
      species: [],
      dateRange: {},
      timeRange: {},
      source: 'nope'
    })
    assert.deepEqual(result.media, [])
  })
})
