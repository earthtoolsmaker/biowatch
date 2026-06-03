import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getDeploymentDistribution,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'

let testBiowatchDataPath, testDbPath, testStudyId

beforeEach(() => {
  testStudyId = `test-depdist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-depdist-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

describe('getDeploymentDistribution', () => {
  test('returns deployments with observation counts, descending; includes zero-obs deployments', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    const dep = (id, name) => ({
      deploymentID: id,
      locationID: `loc-${id}`,
      locationName: name,
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 1,
      longitude: 1,
      cameraID: `cam-${id}`
    })
    await insertDeployments(manager, { d1: dep('d1', 'Site A'), d2: dep('d2', 'Site B'), d3: dep('d3', 'Site C') })
    await insertMedia(manager, {
      'm1.jpg': { mediaID: 'm1', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'), filePath: '/m1.jpg', fileName: 'm1.jpg' },
      'm2.jpg': { mediaID: 'm2', deploymentID: 'd1', timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'), filePath: '/m2.jpg', fileName: 'm2.jpg' },
      'm3.jpg': { mediaID: 'm3', deploymentID: 'd2', timestamp: DateTime.fromISO('2024-06-03T10:00:00Z'), filePath: '/m3.jpg', fileName: 'm3.jpg' }
    })
    await insertObservations(manager, [
      { observationID: 'o1', mediaID: 'm1', deploymentID: 'd1', scientificName: 'Panthera pardus', observationType: 'animal' },
      { observationID: 'o2', mediaID: 'm1', deploymentID: 'd1', scientificName: 'Genetta genetta', observationType: 'animal' },
      { observationID: 'o3', mediaID: 'm2', deploymentID: 'd1', scientificName: 'Panthera pardus', observationType: 'animal' },
      { observationID: 'o4', mediaID: 'm3', deploymentID: 'd2', scientificName: 'Sus scrofa', observationType: 'animal' }
    ])

    const result = await getDeploymentDistribution(testDbPath)
    // d1: 3 obs, d2: 1 obs, d3: 0 obs (still listed)
    assert.deepEqual(result, [
      { deploymentID: 'd1', locationName: 'Site A', count: 3 },
      { deploymentID: 'd2', locationName: 'Site B', count: 1 },
      { deploymentID: 'd3', locationName: 'Site C', count: 0 }
    ])
  })
})
