import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getLowConfidenceCount,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-lowconf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-lowconf-test', testStudyId)
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
      fileName: 'm1.jpg'
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
    }
  })
  await insertObservations(manager, [
    {
      observationID: 'o1',
      mediaID: 'm1',
      deploymentID: 'd1',
      scientificName: 'Genetta genetta',
      observationType: 'animal',
      classificationMethod: 'machine',
      classificationProbability: 0.42
    },
    {
      observationID: 'o2',
      mediaID: 'm2',
      deploymentID: 'd1',
      scientificName: 'Panthera pardus',
      observationType: 'animal',
      classificationMethod: 'machine',
      classificationProbability: 0.91
    },
    {
      // already human-reviewed → excluded even though low probability would be null
      observationID: 'o3',
      mediaID: 'm3',
      deploymentID: 'd1',
      scientificName: 'Panthera pardus',
      observationType: 'animal',
      classificationMethod: 'human',
      classificationProbability: 0.1
    }
  ])
}

describe('getLowConfidenceCount', () => {
  test('counts distinct media with a machine observation below the threshold', async () => {
    await seed()
    const count = await getLowConfidenceCount(testDbPath, 0.5)
    assert.equal(count, 1)
  })

  test('threshold is exclusive lower bound (0.42 not counted at threshold 0.42)', async () => {
    await seed()
    const count = await getLowConfidenceCount(testDbPath, 0.42)
    assert.equal(count, 0)
  })
})
