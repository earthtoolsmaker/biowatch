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
  testStudyId = `test-multifilter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-multifilter-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath))
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

async function seed() {
  const manager = await createImageDirectoryDatabase(testDbPath)
  const dep = (id) => ({
    deploymentID: id,
    locationID: `loc-${id}`,
    locationName: `Site ${id}`,
    deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
    deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
    latitude: 1,
    longitude: 1,
    cameraID: `cam-${id}`
  })
  await insertDeployments(manager, { d1: dep('d1'), d2: dep('d2'), d3: dep('d3') })
  const m = (id, dID, src) => ({
    mediaID: id,
    deploymentID: dID,
    timestamp: DateTime.fromISO(`2024-06-0${id.slice(1)}T10:00:00Z`),
    filePath: `/${id}.jpg`,
    fileName: `${id}.jpg`,
    importFolder: src
  })
  await insertMedia(manager, {
    'm1.jpg': m('m1', 'd1', 's1'),
    'm2.jpg': m('m2', 'd2', 's1'),
    'm3.jpg': m('m3', 'd3', 's2')
  })
}

function ids(result) {
  return result.media.map((x) => x.mediaID).sort()
}

describe('getMediaForSequencePagination — multi-value deployment/source', () => {
  const base = { cursor: null, batchSize: 100, species: [], dateRange: {}, timeRange: {} }

  test('deploymentID array returns media from all listed deployments', async () => {
    await seed()
    const res = await getMediaForSequencePagination(testDbPath, {
      ...base,
      deploymentID: ['d1', 'd2']
    })
    assert.deepEqual(ids(res), ['m1', 'm2'])
  })

  test('deploymentID string still works (back-compat)', async () => {
    await seed()
    const res = await getMediaForSequencePagination(testDbPath, { ...base, deploymentID: 'd1' })
    assert.deepEqual(ids(res), ['m1'])
  })

  test('source array filters by importFolder', async () => {
    await seed()
    const res = await getMediaForSequencePagination(testDbPath, { ...base, source: ['s2'] })
    assert.deepEqual(ids(res), ['m3'])
  })

  test('empty array means no filter', async () => {
    await seed()
    const res = await getMediaForSequencePagination(testDbPath, { ...base, deploymentID: [] })
    assert.deepEqual(ids(res), ['m1', 'm2', 'm3'])
  })
})
