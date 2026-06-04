import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'
import { getDeploymentComposition } from '../../../../src/main/services/sequences/deploymentComposition.js'

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

describe('getDeploymentComposition', () => {
  test('with no eventID / no gap, each media is its own sequence — composition equals media counts', async () => {
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

    const result = await getDeploymentComposition(testDbPath)
    // No eventIDs + no sequenceGap → each media is its own sequence, so the
    // sequence counts equal the media counts here. d1: 2 image detections. d2:
    // 1 image detection + 1 blank video. d3: no media (still listed). Ordered by
    // total desc, then deploymentID (d1/d2 tie at 2).
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

  test('with a positive sequenceGap, a blank burst collapses to ONE blank sequence', async () => {
    const manager = await createImageDirectoryDatabase(testDbPath)
    // Positive gap → timestamp-proximity grouping (the case where blank media,
    // which have no observations/eventID, actually group). This is the user's
    // scenario: many blank frames → far fewer blank sequences.
    await insertDeployments(manager, {
      d1: {
        deploymentID: 'd1',
        locationID: 'loc-d1',
        locationName: 'Site A',
        deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
        deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
        latitude: 1,
        longitude: 1,
        cameraID: 'cam-d1'
      }
    })
    // 3 blank frames within 60s → one blank sequence; 2 detection frames ~10min
    // later within 60s → one detection sequence. Media-level: 5 (3 blank, 2 det);
    // sequence-level: 2 (1 blank, 1 det).
    const m = (id, iso) => ({
      mediaID: id,
      deploymentID: 'd1',
      timestamp: DateTime.fromISO(iso),
      filePath: `/${id}.jpg`,
      fileName: `${id}.jpg`
    })
    await insertMedia(manager, {
      'b1.jpg': m('b1', '2024-06-01T10:00:00Z'),
      'b2.jpg': m('b2', '2024-06-01T10:00:01Z'),
      'b3.jpg': m('b3', '2024-06-01T10:00:02Z'),
      'k1.jpg': m('k1', '2024-06-01T10:10:00Z'),
      'k2.jpg': m('k2', '2024-06-01T10:10:01Z')
    })
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'k1',
        deploymentID: 'd1',
        scientificName: 'Capreolus capreolus',
        observationType: 'animal'
      },
      {
        observationID: 'o2',
        mediaID: 'k2',
        deploymentID: 'd1',
        scientificName: 'Capreolus capreolus',
        observationType: 'animal'
      }
    ])

    const result = await getDeploymentComposition(testDbPath, 60)
    assert.equal(result.length, 1)
    assert.deepEqual(result[0], {
      deploymentID: 'd1',
      locationName: 'Site A',
      latitude: 1,
      longitude: 1,
      count: 2, // 2 sequences (not 5 media)
      detectionCount: 1,
      blankCount: 1, // 3 blank frames collapse to ONE blank sequence
      imageCount: 2,
      videoCount: 0
    })
  })
})
