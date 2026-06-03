import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getSequenceReviewStatus,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-revstatus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-revstatus-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

async function seedBase() {
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
    }
  })
  return manager
}

describe('getSequenceReviewStatus', () => {
  test('media with all-human observations → reviewed true; any-machine → false', async () => {
    const manager = await seedBase()
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm1',
        deploymentID: 'd1',
        scientificName: 'Panthera pardus',
        observationType: 'animal',
        classificationMethod: 'human'
      },
      {
        observationID: 'o2',
        mediaID: 'm2',
        deploymentID: 'd1',
        scientificName: 'Panthera pardus',
        observationType: 'animal',
        classificationMethod: 'machine'
      }
    ])
    const status = await getSequenceReviewStatus(testDbPath, ['m1', 'm2'])
    assert.equal(status.get('m1'), true)
    assert.equal(status.get('m2'), false)
  })

  test('media with mixed human+machine observations → reviewed false', async () => {
    const manager = await seedBase()
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm1',
        deploymentID: 'd1',
        scientificName: 'Panthera pardus',
        observationType: 'animal',
        classificationMethod: 'human'
      },
      {
        observationID: 'o2',
        mediaID: 'm1',
        deploymentID: 'd1',
        scientificName: 'Genetta genetta',
        observationType: 'animal',
        classificationMethod: 'machine'
      }
    ])
    const status = await getSequenceReviewStatus(testDbPath, ['m1'])
    assert.equal(status.get('m1'), false)
  })

  test('media with no observations → reviewed false', async () => {
    await seedBase()
    const status = await getSequenceReviewStatus(testDbPath, ['m1'])
    assert.equal(status.get('m1'), false)
  })

  test('empty mediaIDs → empty map', async () => {
    await seedBase()
    const status = await getSequenceReviewStatus(testDbPath, [])
    assert.equal(status.size, 0)
  })
})
