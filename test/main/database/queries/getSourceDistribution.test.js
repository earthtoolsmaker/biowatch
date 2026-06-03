import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getSourceDistribution,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-srcdist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-srcdist-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

describe('getSourceDistribution', () => {
  test('returns each importFolder with its media count, descending', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1',
        locationID: 'loc1',
        locationName: 'A',
        deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
        latitude: 1,
        longitude: 1,
        cameraID: 'c1'
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
        importFolder: 'src1'
      },
      'c.jpg': {
        mediaID: 'c',
        deploymentID: 'd1',
        timestamp: DateTime.fromISO('2024-06-03T10:00:00Z'),
        filePath: '/c.jpg',
        fileName: 'c.jpg',
        importFolder: 'src2'
      }
    })
    const result = await getSourceDistribution(testDbPath)
    assert.deepEqual(result, [
      { source: 'src1', count: 2 },
      { source: 'src2', count: 1 }
    ])
  })

  test('excludes media with a null importFolder', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1',
        locationID: 'loc1',
        locationName: 'A',
        deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
        latitude: 1,
        longitude: 1,
        cameraID: 'c1'
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
      'n.jpg': {
        mediaID: 'n',
        deploymentID: 'd1',
        timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'),
        filePath: '/n.jpg',
        fileName: 'n.jpg'
        // no importFolder
      }
    })
    const result = await getSourceDistribution(testDbPath)
    assert.deepEqual(result, [{ source: 'src1', count: 1 }])
  })
})
