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
  if (existsSync(testBiowatchDataPath))
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

describe('getDeploymentDistribution', () => {
  test('returns per-deployment media composition (detections/blank, images/videos), descending; includes zero-media deployments', async () => {
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
    await insertDeployments(manager, {
      d1: dep('d1', 'Site A'),
      d2: dep('d2', 'Site B'),
      d3: dep('d3', 'Site C')
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
        deploymentID: 'd2',
        timestamp: DateTime.fromISO('2024-06-03T10:00:00Z'),
        filePath: '/m3.jpg',
        fileName: 'm3.jpg'
      },
      // d2 also has a video with no observation -> counts as blank + video.
      'm4.mp4': {
        mediaID: 'm4',
        deploymentID: 'd2',
        timestamp: DateTime.fromISO('2024-06-04T10:00:00Z'),
        filePath: '/m4.mp4',
        fileName: 'm4.mp4',
        fileMediatype: 'video/mp4'
      }
    })
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'm1',
        deploymentID: 'd1',
        scientificName: 'Panthera pardus',
        observationType: 'animal'
      },
      {
        observationID: 'o2',
        mediaID: 'm1',
        deploymentID: 'd1',
        scientificName: 'Genetta genetta',
        observationType: 'animal'
      },
      {
        observationID: 'o3',
        mediaID: 'm2',
        deploymentID: 'd1',
        scientificName: 'Panthera pardus',
        observationType: 'animal'
      },
      {
        observationID: 'o4',
        mediaID: 'm3',
        deploymentID: 'd2',
        scientificName: 'Sus scrofa',
        observationType: 'animal'
      }
    ])

    const result = await getDeploymentDistribution(testDbPath)
    // Counts are media-level. d1: 2 images, both detections. d2: 1 image
    // detection + 1 blank video. d3: no media (still listed). Ordered by total
    // media desc, then locationID (d1/d2 tie at 2 -> loc-d1 before loc-d2).
    assert.deepEqual(result, [
      {
        deploymentID: 'd1',
        locationName: 'Site A',
        latitude: 1,
        longitude: 1,
        count: 2,
        detectionCount: 2,
        blankCount: 0,
        imageCount: 2,
        videoCount: 0
      },
      {
        deploymentID: 'd2',
        locationName: 'Site B',
        latitude: 1,
        longitude: 1,
        count: 2,
        detectionCount: 1,
        blankCount: 1,
        imageCount: 1,
        videoCount: 1
      },
      {
        deploymentID: 'd3',
        locationName: 'Site C',
        latitude: 1,
        longitude: 1,
        count: 0,
        detectionCount: 0,
        blankCount: 0,
        imageCount: 0,
        videoCount: 0
      }
    ])
  })
})
