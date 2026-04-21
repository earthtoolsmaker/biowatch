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
  insertObservations,
  updateObservationClassification
} from '../../../src/main/database/index.js'

let testBiowatchDataPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    const log = electronLog.default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // electron-log not available in test environment, that's fine
  }

  testStudyId = `test-update-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-update-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')

  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seedObservation() {
  const manager = await createImageDirectoryDatabase(testDbPath)

  await insertDeployments(manager, {
    d1: {
      deploymentID: 'd1',
      locationID: 'loc1',
      locationName: 'Test',
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-01-02T00:00:00Z'),
      latitude: 0,
      longitude: 0
    }
  })

  await insertMedia(manager, {
    'img.jpg': {
      mediaID: 'm1',
      deploymentID: 'd1',
      timestamp: DateTime.fromISO('2024-01-01T00:00:00Z'),
      filePath: '/fake/img.jpg',
      fileName: 'img.jpg'
    }
  })

  await insertObservations(manager, [
    {
      observationID: 'obs1',
      mediaID: 'm1',
      deploymentID: 'd1',
      eventID: 'e1',
      eventStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      eventEnd: DateTime.fromISO('2024-01-01T00:00:00Z'),
      scientificName: 'capreolus capreolus',
      commonName: 'Roe Deer',
      count: 1
    }
  ])
}

describe('updateObservationClassification: three-case write logic', () => {
  test('picker-list selection (both values provided) saves both', async () => {
    await seedObservation()
    const result = await updateObservationClassification(testDbPath, 'obs1', {
      scientificName: 'cervus elaphus',
      commonName: 'Red Deer'
    })
    assert.equal(result.scientificName, 'cervus elaphus')
    assert.equal(result.commonName, 'Red Deer')
  })

  test('custom entry (scientificName only, commonName absent) clears commonName', async () => {
    await seedObservation()
    const result = await updateObservationClassification(testDbPath, 'obs1', {
      scientificName: 'custom typed value'
    })
    assert.equal(result.scientificName, 'custom typed value')
    assert.equal(result.commonName, null)
  })

  test('custom entry (scientificName only, commonName: null) clears commonName', async () => {
    // Matches handleSelectSpecies(scientificName, null) — the default-param case.
    await seedObservation()
    const result = await updateObservationClassification(testDbPath, 'obs1', {
      scientificName: 'another custom value',
      commonName: null
    })
    assert.equal(result.scientificName, 'another custom value')
    assert.equal(result.commonName, null)
  })

  test('species cleared (scientificName: null) clears commonName too', async () => {
    await seedObservation()
    const result = await updateObservationClassification(testDbPath, 'obs1', {
      scientificName: null
    })
    assert.equal(result.scientificName, null)
    assert.equal(result.commonName, null)
  })

  test('species cleared (scientificName: "") clears commonName too', async () => {
    await seedObservation()
    const result = await updateObservationClassification(testDbPath, 'obs1', {
      scientificName: ''
    })
    assert.equal(result.scientificName, null)
    assert.equal(result.commonName, null)
  })

  test('commonName-only update with empty string normalizes to null', async () => {
    await seedObservation()
    const result = await updateObservationClassification(testDbPath, 'obs1', {
      commonName: ''
    })
    // scientificName untouched (no key in payload); commonName normalized to null.
    assert.equal(result.scientificName, 'capreolus capreolus')
    assert.equal(result.commonName, null)
  })

  test('commonName-only update with non-empty string saves it', async () => {
    await seedObservation()
    const result = await updateObservationClassification(testDbPath, 'obs1', {
      commonName: 'Red Deer'
    })
    assert.equal(result.scientificName, 'capreolus capreolus')
    assert.equal(result.commonName, 'Red Deer')
  })

  test('unrelated field update (sex) does not touch scientificName or commonName', async () => {
    await seedObservation()
    const result = await updateObservationClassification(testDbPath, 'obs1', {
      sex: 'female'
    })
    assert.equal(result.scientificName, 'capreolus capreolus')
    assert.equal(result.commonName, 'Roe Deer')
    assert.equal(result.sex, 'female')
  })
})
