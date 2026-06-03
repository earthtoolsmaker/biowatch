import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  markMediaReviewed,
  getSequenceReviewStatus,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations,
  getMediaBboxes
} from '../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-markrev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-markrev-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

async function seedMachineObs() {
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
    }
  })
  await insertObservations(manager, [
    {
      observationID: 'o1',
      mediaID: 'm1',
      deploymentID: 'd1',
      scientificName: 'Panthera pardus',
      observationType: 'animal',
      classificationMethod: 'machine'
    }
  ])
}

describe('markMediaReviewed', () => {
  test('flips machine observations to human without changing species', async () => {
    await seedMachineObs()

    const res = await markMediaReviewed(testDbPath, ['m1'])
    assert.equal(res.updated, 1)

    const status = await getSequenceReviewStatus(testDbPath, ['m1'])
    assert.equal(status.get('m1'), true)

    // Species is unchanged; method is now human
    const obs = await getMediaBboxes(testDbPath, 'm1', true)
    assert.equal(obs[0].scientificName, 'Panthera pardus')
    assert.equal(obs[0].classificationMethod, 'human')
  })

  test('empty mediaIDs is a no-op', async () => {
    await seedMachineObs()
    const res = await markMediaReviewed(testDbPath, [])
    assert.equal(res.updated, 0)
  })
})
