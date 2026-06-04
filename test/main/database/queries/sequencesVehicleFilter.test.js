/**
 * Tests for the VEHICLE_SENTINEL and updated BLANK_SENTINEL semantics in
 * getMediaForSequencePagination. Covers each pseudo-species request shape
 * (vehicle alone, blank alone, both, mixed with regular species).
 */

import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  getMediaForSequencePagination,
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations
} from '../../../../src/main/database/index.js'
import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../../../../src/shared/constants.js'

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
  testStudyId = `test-vehicle-filter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-vehicle-filter-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seed() {
  // Seed: 5 timestamped media at deployment d1
  //   m-animal: animal observation (Sus scrofa)
  //   m-vehicle: vehicle observation (no species)
  //   m-blanktyped: blank-typed observation (no species)
  //   m-zeroobs: no observations at all
  //   m-mix: animal + vehicle observations
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
    'm-animal.jpg': {
      mediaID: 'm-animal',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-01T10:00:00Z'),
      filePath: '/m-animal.jpg',
      fileName: 'm-animal.jpg'
    },
    'm-vehicle.jpg': {
      mediaID: 'm-vehicle',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-02T10:00:00Z'),
      filePath: '/m-vehicle.jpg',
      fileName: 'm-vehicle.jpg'
    },
    'm-blanktyped.jpg': {
      mediaID: 'm-blanktyped',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-03T10:00:00Z'),
      filePath: '/m-blanktyped.jpg',
      fileName: 'm-blanktyped.jpg'
    },
    'm-zeroobs.jpg': {
      mediaID: 'm-zeroobs',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-04T10:00:00Z'),
      filePath: '/m-zeroobs.jpg',
      fileName: 'm-zeroobs.jpg'
    },
    'm-mix.jpg': {
      mediaID: 'm-mix',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-06-05T10:00:00Z'),
      filePath: '/m-mix.jpg',
      fileName: 'm-mix.jpg'
    }
  })
  await insertObservations(manager, [
    {
      observationID: 'o1',
      mediaID: 'm-animal',
      deploymentID: 'd1',
      observationType: 'animal',
      scientificName: 'Sus scrofa'
    },
    {
      observationID: 'o2',
      mediaID: 'm-vehicle',
      deploymentID: 'd1',
      observationType: 'vehicle',
      scientificName: null
    },
    {
      observationID: 'o3',
      mediaID: 'm-blanktyped',
      deploymentID: 'd1',
      observationType: 'blank',
      scientificName: null
    },
    {
      observationID: 'o4',
      mediaID: 'm-mix',
      deploymentID: 'd1',
      observationType: 'animal',
      scientificName: 'Sus scrofa'
    },
    {
      observationID: 'o5',
      mediaID: 'm-mix',
      deploymentID: 'd1',
      observationType: 'vehicle',
      scientificName: null
    }
  ])
}

function ids(rows) {
  return rows.map((r) => r.mediaID).sort()
}

describe('getMediaForSequencePagination — vehicle/blank pseudo-species', () => {
  test('VEHICLE_SENTINEL alone returns only vehicle media (incl. mixed)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: [VEHICLE_SENTINEL]
    })
    assert.deepEqual(ids(result.media), ['m-mix', 'm-vehicle'])
  })

  test('BLANK_SENTINEL alone returns ALL media tagged with isDetection (pagination filters to no-detection sequences)', async () => {
    // Pure-Blank is sequence-aware: "blank" means a whole sequence with no
    // detection, which can only be determined after grouping. So the query
    // returns every media with an isDetection flag and the pagination layer
    // keeps the no-detection sequences. (Filtering to blank MEDIA here would
    // split mixed bursts and over-count blanks.)
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: [BLANK_SENTINEL]
    })
    assert.deepEqual(ids(result.media), [
      'm-animal',
      'm-blanktyped',
      'm-mix',
      'm-vehicle',
      'm-zeroobs'
    ])
    const det = Object.fromEntries(result.media.map((r) => [r.mediaID, !!Number(r.isDetection)]))
    assert.deepEqual(det, {
      'm-animal': true,
      'm-vehicle': true,
      'm-mix': true,
      'm-blanktyped': false,
      'm-zeroobs': false
    })
  })

  test('species + VEHICLE returns animal media + vehicle media (deduped)', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: [VEHICLE_SENTINEL, 'Sus scrofa']
    })
    assert.deepEqual(ids(result.media), ['m-animal', 'm-mix', 'm-vehicle'])
  })

  test('media matching both species and vehicle arms keeps the species label', async () => {
    // Regression: dedupByMediaID picks the species-arm row over the vehicle-arm
    // row so the gallery card shows "Sus scrofa" not "Vehicle". m-mix has both
    // an animal Sus scrofa observation and a vehicle observation.
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: [VEHICLE_SENTINEL, 'Sus scrofa']
    })
    const mixRow = result.media.find((r) => r.mediaID === 'm-mix')
    assert.ok(mixRow, 'm-mix should be in the result')
    assert.equal(
      mixRow.scientificName,
      'Sus scrofa',
      'species arm must win over vehicle arm in dedup so the card carries the real species name'
    )
  })

  test('pure-vehicle arm rows carry VEHICLE_SENTINEL as scientificName', async () => {
    // The gallery's SpeciesCountLabel uses scientificName=VEHICLE_SENTINEL
    // to render "Vehicle". Without the sentinel projection the row would
    // get NULL scientificName and label as "Blank".
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: [VEHICLE_SENTINEL]
    })
    const vehicleRow = result.media.find((r) => r.mediaID === 'm-vehicle')
    assert.ok(vehicleRow)
    assert.equal(vehicleRow.scientificName, VEHICLE_SENTINEL)
  })

  test('BLANK + VEHICLE returns blank media + vehicle media', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: [BLANK_SENTINEL, VEHICLE_SENTINEL]
    })
    assert.deepEqual(ids(result.media), ['m-blanktyped', 'm-mix', 'm-vehicle', 'm-zeroobs'])
  })

  test('species + BLANK + VEHICLE returns everything', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: [BLANK_SENTINEL, VEHICLE_SENTINEL, 'Sus scrofa']
    })
    assert.deepEqual(ids(result.media), [
      'm-animal',
      'm-blanktyped',
      'm-mix',
      'm-vehicle',
      'm-zeroobs'
    ])
  })

  test('Sus scrofa alone (regular species path) is unaffected by the refactor', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {
      species: ['Sus scrofa']
    })
    assert.deepEqual(ids(result.media), ['m-animal', 'm-mix'])
  })

  test('no species filter returns all 5 media', async () => {
    await seed()
    const result = await getMediaForSequencePagination(testDbPath, {})
    assert.equal(result.media.length, 5)
  })
})
