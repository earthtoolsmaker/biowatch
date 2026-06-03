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
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-pag-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-pag-review-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

describe('getPaginatedSequences — reviewed flag', () => {
  test('sequence whose media are all human-classified is reviewed=true; machine is false', async () => {
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
    // Two media a day apart → with a tiny gap each is its own sequence
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

    const result = await getPaginatedSequences(testDbPath, { gapSeconds: 1, limit: 20 })
    const byMedia = {}
    for (const seq of result.sequences) {
      byMedia[seq.items[0].mediaID] = seq.reviewed
    }
    assert.equal(byMedia.m1, true)
    assert.equal(byMedia.m2, false)
  })
})
