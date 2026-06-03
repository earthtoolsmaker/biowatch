import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  bulkSetSpecies,
  bulkMarkBlank,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations,
  getMediaBboxes
} from '../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-bulkspecies-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-bulkspecies-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

async function seedTwoMachineObs() {
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
    }
  })
  await insertObservations(manager, [
    {
      observationID: 'o1',
      mediaID: 'm1',
      deploymentID: 'd1',
      scientificName: 'Genetta genetta',
      observationType: 'animal',
      classificationMethod: 'machine'
    },
    {
      observationID: 'o2',
      mediaID: 'm2',
      deploymentID: 'd1',
      scientificName: 'Genetta genetta',
      observationType: 'animal',
      classificationMethod: 'machine'
    }
  ])
}

describe('bulkSetSpecies', () => {
  test('relabels every observation for the media and marks them human', async () => {
    await seedTwoMachineObs()
    const res = await bulkSetSpecies(testDbPath, ['m1', 'm2'], {
      scientificName: 'Tragelaphus scriptus'
    })
    assert.equal(res.updated >= 2, true)

    // normalizeScientificName canonicalizes to lowercase to prevent mixed-case
    // duplicates (same as the single-observation update path).
    const obs = await getMediaBboxes(testDbPath, 'm1', true)
    assert.equal(obs[0].scientificName, 'tragelaphus scriptus')
    assert.equal(obs[0].classificationMethod, 'human')
    assert.equal(obs[0].classificationProbability, null)
  })
})

describe('bulkMarkBlank', () => {
  test('sets observationType blank and clears species', async () => {
    await seedTwoMachineObs()
    const res = await bulkMarkBlank(testDbPath, ['m1'])
    assert.equal(res.updated >= 1, true)

    const obs = await getMediaBboxes(testDbPath, 'm1', true)
    assert.equal(obs[0].scientificName, null)
    assert.equal(obs[0].observationType, 'blank')
    assert.equal(obs[0].classificationMethod, 'human')
  })
})
