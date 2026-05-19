import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  getStudyDatabase,
  closeStudyDatabase,
  deployments,
  media,
  observations
} from '../../../../../src/main/database/index.js'
import { expandObservationsToMedia } from '../../../../../src/main/services/import/parsers/camtrapDP.js'

let testBiowatchDataPath
let studyId
let dbPath

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    electronLog.default.transports.file.level = false
    electronLog.default.transports.console.level = false
  } catch {
    // ignore in test env
  }

  testBiowatchDataPath = join(
    tmpdir(),
    'biowatch-expand-test',
    Date.now().toString() + Math.random()
  )
  mkdirSync(testBiowatchDataPath, { recursive: true })
  studyId = 'test-expand-' + Math.random().toString(36).slice(2)
  dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', studyId), { recursive: true })
})

afterEach(async () => {
  try {
    await closeStudyDatabase(studyId, dbPath)
  } catch {
    /* noop */
  }
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seed(db, numMedia, numEventObs) {
  // 1 deployment, numMedia media all within a single 1-hour window,
  // numEventObs event-based observations each covering all media.
  // Pairs = numMedia × numEventObs.
  await db.insert(deployments).values({
    deploymentID: 'd1',
    locationID: 'L1',
    deploymentStart: '2024-01-01T00:00:00Z',
    deploymentEnd: '2024-01-01T01:00:00Z'
  })

  const mediaRows = Array.from({ length: numMedia }, (_, i) => ({
    mediaID: `m${i}`,
    deploymentID: 'd1',
    timestamp: `2024-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`,
    filePath: `/tmp/m${i}.jpg`,
    fileName: `m${i}.jpg`,
    fileMediatype: 'image/jpeg'
  }))
  for (const row of mediaRows) await db.insert(media).values(row)

  for (let i = 0; i < numEventObs; i++) {
    await db.insert(observations).values({
      observationID: `obs-e${i}`,
      mediaID: null,
      deploymentID: 'd1',
      eventID: `event${i}`,
      eventStart: '2024-01-01T00:00:00Z',
      eventEnd: '2024-01-01T01:00:00Z',
      scientificName: 'test species',
      observationType: 'animal'
    })
  }
}

describe('expandObservationsToMedia (chunked)', () => {
  test('emits per-batch progress when pairs > batchSize', async () => {
    const manager = await getStudyDatabase(studyId, dbPath)
    const db = manager.getDb()
    await seed(db, 10, 5) // 10 × 5 = 50 pairs

    const events = []
    const result = await expandObservationsToMedia(
      db,
      (p) => events.push(p),
      /* batchSize */ 10
    )

    assert.equal(result.created, 50, 'created should equal pairCount')
    assert.equal(result.expanded, 5, 'expanded should equal originalCount')

    // Initial event (insertedRows=0) + at least 5 batch events with insertedRows>0
    const expandingEvents = events.filter((e) => e.phase === 'expanding')
    assert.ok(
      expandingEvents.length >= 6,
      `expected ≥6 expanding events, got ${expandingEvents.length}`
    )

    const insertedSeries = expandingEvents.map((e) => e.insertedRows)
    for (let i = 1; i < insertedSeries.length; i++) {
      assert.ok(
        insertedSeries[i] >= insertedSeries[i - 1],
        'insertedRows must be monotonic non-decreasing'
      )
    }
    assert.equal(
      insertedSeries[insertedSeries.length - 1],
      50,
      'final insertedRows should equal pairCount'
    )
  })

  test('returns {0,0} and emits no expanding events when there are no pairs', async () => {
    const manager = await getStudyDatabase(studyId, dbPath)
    const db = manager.getDb()
    // Seed deployment + media but no event-based observations
    await seed(db, 5, 0)

    const events = []
    const result = await expandObservationsToMedia(db, (p) => events.push(p), 10)

    assert.deepEqual(result, { expanded: 0, created: 0 })
    assert.equal(events.filter((e) => e.phase === 'expanding').length, 0)
  })

  test('single batch when pairs ≤ batchSize', async () => {
    const manager = await getStudyDatabase(studyId, dbPath)
    const db = manager.getDb()
    await seed(db, 3, 1) // 3 pairs

    const events = []
    const result = await expandObservationsToMedia(db, (p) => events.push(p), 100)

    assert.equal(result.created, 3)
    const expandingEvents = events.filter((e) => e.phase === 'expanding')
    // Initial (0) + exactly one batch event
    assert.equal(expandingEvents.length, 2)
    assert.equal(expandingEvents[0].insertedRows, 0)
    assert.equal(expandingEvents[1].insertedRows, 3)
  })

  test('drops the temp table after a successful run', async () => {
    const manager = await getStudyDatabase(studyId, dbPath)
    const db = manager.getDb()
    const sqlite = manager.getSqlite()
    await seed(db, 4, 2) // 8 pairs

    await expandObservationsToMedia(db, null, 10)

    const tempTables = sqlite
      .prepare(`SELECT name FROM sqlite_temp_master WHERE type='table'`)
      .all()
    const found = tempTables.find((t) => t.name === '__expansion_pairs')
    assert.equal(found, undefined, '__expansion_pairs temp table should be gone after expansion')
  })
})
