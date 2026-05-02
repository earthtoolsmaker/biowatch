/**
 * Tests for getSpeciesForDeployment — distinct species + media count for
 * a single deployment, used by the species-filter popover in the
 * Deployments tab.
 */

import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getSpeciesForDeployment,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'
import { BLANK_SENTINEL } from '../../../../src/shared/constants.js'

let testBiowatchDataPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    // not available, fine
  }
  testStudyId = `test-species-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-species-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
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
    },
    d2: {
      deploymentID: 'd2',
      locationID: 'loc2',
      locationName: 'Site B',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-12-31T23:59:59Z'),
      latitude: 2,
      longitude: 2,
      cameraID: 'cam2'
    }
  })
  await insertMedia(manager, {
    'd1-a.jpg': {
      mediaID: 'd1-a',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'),
      filePath: '/d1-a.jpg',
      fileName: 'd1-a.jpg'
    },
    'd1-b.jpg': {
      mediaID: 'd1-b',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'),
      filePath: '/d1-b.jpg',
      fileName: 'd1-b.jpg'
    },
    'd1-c.jpg': {
      mediaID: 'd1-c',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-03T10:00:00Z'),
      filePath: '/d1-c.jpg',
      fileName: 'd1-c.jpg'
    },
    'd2-a.jpg': {
      mediaID: 'd2-a',
      deploymentID: 'd2',
      timestamp: DateTime.fromISO('2024-06-04T10:00:00Z'),
      filePath: '/d2-a.jpg',
      fileName: 'd2-a.jpg'
    }
  })
  // d1 observations: 2 fox media, 1 deer media, 1 with empty name (skipped),
  // 1 with NULL name (skipped). d2: 1 boar.
  await insertObservations(manager, [
    { observationID: 'o1', mediaID: 'd1-a', deploymentID: 'd1', scientificName: 'Vulpes vulpes' },
    { observationID: 'o2', mediaID: 'd1-b', deploymentID: 'd1', scientificName: 'Vulpes vulpes' },
    {
      observationID: 'o3',
      mediaID: 'd1-c',
      deploymentID: 'd1',
      scientificName: 'Capreolus capreolus'
    },
    { observationID: 'o4', mediaID: 'd1-a', deploymentID: 'd1', scientificName: '' },
    { observationID: 'o5', mediaID: 'd1-a', deploymentID: 'd1', scientificName: null },
    { observationID: 'o6', mediaID: 'd2-a', deploymentID: 'd2', scientificName: 'Sus scrofa' }
  ])
}

describe('getSpeciesForDeployment', () => {
  test('returns species at the given deployment with media counts, ordered by count desc', async () => {
    await seed()
    const rows = await getSpeciesForDeployment(testDbPath, 'd1')
    assert.deepEqual(rows, [
      { scientificName: 'Vulpes vulpes', count: 2 },
      { scientificName: 'Capreolus capreolus', count: 1 }
    ])
  })

  test('excludes empty and NULL scientificName entries', async () => {
    await seed()
    const rows = await getSpeciesForDeployment(testDbPath, 'd1')
    assert.equal(
      rows.find((r) => r.scientificName === '' || r.scientificName === null),
      undefined
    )
  })

  test('does not leak species from other deployments', async () => {
    await seed()
    const rows = await getSpeciesForDeployment(testDbPath, 'd1')
    assert.equal(
      rows.find((r) => r.scientificName === 'Sus scrofa'),
      undefined
    )
  })

  test('returns empty array for a deployment with no observations', async () => {
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
    const rows = await getSpeciesForDeployment(testDbPath, 'd1')
    assert.deepEqual(rows, [])
  })

  test('returns empty array for a non-existent deploymentID', async () => {
    await seed()
    const rows = await getSpeciesForDeployment(testDbPath, 'does-not-exist')
    assert.deepEqual(rows, [])
  })

  test('appends a BLANK_SENTINEL row at the end when the deployment has media without observations', async () => {
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
      'with-obs.jpg': {
        mediaID: 'with-obs',
        deploymentID: 'd1',
        timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'),
        filePath: '/with-obs.jpg',
        fileName: 'with-obs.jpg'
      },
      'blank-1.jpg': {
        mediaID: 'blank-1',
        deploymentID: 'd1',
        timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'),
        filePath: '/blank-1.jpg',
        fileName: 'blank-1.jpg'
      },
      'blank-2.jpg': {
        mediaID: 'blank-2',
        deploymentID: 'd1',
        timestamp: DateTime.fromISO('2024-06-03T10:00:00Z'),
        filePath: '/blank-2.jpg',
        fileName: 'blank-2.jpg'
      }
    })
    await insertObservations(manager, [
      {
        observationID: 'o1',
        mediaID: 'with-obs',
        deploymentID: 'd1',
        scientificName: 'Vulpes vulpes'
      }
    ])

    const rows = await getSpeciesForDeployment(testDbPath, 'd1')
    // Species first, blanks at the bottom.
    assert.equal(rows[0].scientificName, 'Vulpes vulpes')
    assert.equal(rows[0].count, 1)
    assert.equal(rows[rows.length - 1].scientificName, BLANK_SENTINEL)
    assert.equal(rows[rows.length - 1].count, 2)
  })

  test('returns only the BLANK_SENTINEL row when the deployment has only blank media', async () => {
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
      'blank-1.jpg': {
        mediaID: 'blank-1',
        deploymentID: 'd1',
        timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'),
        filePath: '/blank-1.jpg',
        fileName: 'blank-1.jpg'
      },
      'blank-2.jpg': {
        mediaID: 'blank-2',
        deploymentID: 'd1',
        timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'),
        filePath: '/blank-2.jpg',
        fileName: 'blank-2.jpg'
      },
      'blank-3.jpg': {
        mediaID: 'blank-3',
        deploymentID: 'd1',
        timestamp: DateTime.fromISO('2024-06-03T10:00:00Z'),
        filePath: '/blank-3.jpg',
        fileName: 'blank-3.jpg'
      }
    })
    // No observations at all — every media is blank.

    const rows = await getSpeciesForDeployment(testDbPath, 'd1')
    assert.deepEqual(rows, [{ scientificName: BLANK_SENTINEL, count: 3 }])
  })

  test('omits the BLANK_SENTINEL row when there are no blanks', async () => {
    await seed() // every d1 media has at least one observation
    const rows = await getSpeciesForDeployment(testDbPath, 'd1')
    assert.equal(
      rows.find((r) => r.scientificName === BLANK_SENTINEL),
      undefined
    )
  })
})
