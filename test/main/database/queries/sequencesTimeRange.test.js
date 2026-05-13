/**
 * Tests for the multi-range timeRange filter in sequences queries.
 * Covers normalizeTimeRange (pure helper) and getMediaForSequencePagination /
 * hasTimestampedMedia (integration tests against an in-memory SQLite DB).
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import { normalizeTimeRange } from '../../../../src/main/database/queries/sequences.js'
import {
  getMediaForSequencePagination,
  hasTimestampedMedia,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'

describe('normalizeTimeRange', () => {
  test('returns [] for undefined/null/empty input', () => {
    assert.deepEqual(normalizeTimeRange(undefined), [])
    assert.deepEqual(normalizeTimeRange(null), [])
    assert.deepEqual(normalizeTimeRange({}), [])
  })

  test('wraps legacy {start, end} into a single-element ranges array', () => {
    assert.deepEqual(normalizeTimeRange({ start: 5, end: 8 }), [{ start: 5, end: 8 }])
  })

  test('passes through {ranges: [...]} unchanged', () => {
    const ranges = [
      { start: 5, end: 8 },
      { start: 18, end: 21 }
    ]
    assert.deepEqual(normalizeTimeRange({ ranges }), ranges)
  })

  test('prefers ranges over start/end when both present', () => {
    const ranges = [{ start: 0, end: 12 }]
    assert.deepEqual(normalizeTimeRange({ ranges, start: 100, end: 200 }), ranges)
  })

  test('returns [] when ranges is an empty array', () => {
    assert.deepEqual(normalizeTimeRange({ ranges: [] }), [])
  })
})

let testBiowatchDataPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    // not available, fine
  }
  testStudyId = `test-time-range-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-time-range-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seedHourlyMedia() {
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
  // One media per hour, 00:30 through 23:30 (24 rows)
  const mediaMap = {}
  const obsList = []
  for (let h = 0; h < 24; h++) {
    const id = `m-${String(h).padStart(2, '0')}`
    mediaMap[`${id}.jpg`] = {
      mediaID: id,
      deploymentID: 'd1',
      timestamp: DateTime.fromISO(`2024-06-01T${String(h).padStart(2, '0')}:30:00`, {
        zone: 'utc'
      }),
      filePath: `/${id}.jpg`,
      fileName: `${id}.jpg`
    }
    obsList.push({
      observationID: `obs-${id}`,
      mediaID: id,
      deploymentID: 'd1',
      eventID: `ev-${id}`,
      observationType: 'animal',
      scientificName: 'Sus scrofa'
    })
  }
  await insertMedia(manager, mediaMap)
  await insertObservations(manager, obsList)
  return manager
}

describe('getMediaForSequencePagination — timeRange filter', () => {
  test('legacy {start, end} shape continues to work', async () => {
    await seedHourlyMedia()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: { start: 8, end: 18 }
    })
    const hours = result.media
      .map((m) => new Date(m.timestamp).getUTCHours())
      .sort((a, b) => a - b)
    assert.deepEqual(hours, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
  })

  test('new {ranges: [...]} shape with a single range matches legacy', async () => {
    await seedHourlyMedia()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: { ranges: [{ start: 8, end: 18 }] }
    })
    const hours = result.media
      .map((m) => new Date(m.timestamp).getUTCHours())
      .sort((a, b) => a - b)
    assert.deepEqual(hours, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
  })

  test('multi-range shape unions the ranges (Dawn + Dusk)', async () => {
    await seedHourlyMedia()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: {
        ranges: [
          { start: 5, end: 8 },
          { start: 18, end: 21 }
        ]
      }
    })
    const hours = result.media
      .map((m) => new Date(m.timestamp).getUTCHours())
      .sort((a, b) => a - b)
    assert.deepEqual(hours, [5, 6, 7, 18, 19, 20])
  })

  test('wrap-around range still works (Night 21 → 5)', async () => {
    await seedHourlyMedia()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: { ranges: [{ start: 21, end: 5 }] }
    })
    const hours = result.media
      .map((m) => new Date(m.timestamp).getUTCHours())
      .sort((a, b) => a - b)
    assert.deepEqual(hours, [0, 1, 2, 3, 4, 21, 22, 23])
  })

  test('empty ranges means no time filter (all 24 hours match)', async () => {
    await seedHourlyMedia()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: { ranges: [] }
    })
    assert.equal(result.media.length, 24)
  })
})

describe('hasTimestampedMedia — timeRange filter', () => {
  test('returns true when ranges union covers a populated hour', async () => {
    await seedHourlyMedia()
    const result = await hasTimestampedMedia(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: {
        ranges: [
          { start: 5, end: 8 },
          { start: 18, end: 21 }
        ]
      }
    })
    assert.equal(result, true)
  })

  test('returns true when ranges array is empty (no filter)', async () => {
    await seedHourlyMedia()
    const result = await hasTimestampedMedia(testDbPath, {
      species: ['Sus scrofa'],
      timeRange: { ranges: [] }
    })
    assert.equal(result, true)
  })
})
