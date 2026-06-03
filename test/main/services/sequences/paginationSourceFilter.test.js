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
  testStudyId = `test-pag-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-pag-source-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
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
  await insertMedia(manager, {
    'a.jpg': {
      mediaID: 'a',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'),
      filePath: '/a.jpg',
      fileName: 'a.jpg',
      importFolder: 'src1'
    },
    'b.jpg': {
      mediaID: 'b',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'),
      filePath: '/b.jpg',
      fileName: 'b.jpg',
      importFolder: 'src2'
    }
  })
}

describe('getPaginatedSequences — source filter', () => {
  test('source filter narrows to that source only', async () => {
    await seed()
    const result = await getPaginatedSequences(testDbPath, {
      gapSeconds: 60,
      limit: 20,
      filters: { source: 'src1' }
    })
    const ids = result.sequences.flatMap((s) => s.items.map((i) => i.mediaID)).sort()
    assert.deepEqual(ids, ['a'])
  })
})
