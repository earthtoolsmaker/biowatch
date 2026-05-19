import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { sql } from 'drizzle-orm'

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
  test('emits per-batch progress when source observations > batchSize', async () => {
    const manager = await getStudyDatabase(studyId, dbPath)
    const db = manager.getDb()
    await seed(db, 5, 25) // 25 source obs × 5 matching media each = 125 pairs

    const events = []
    const result = await expandObservationsToMedia(db, (p) => events.push(p), /* batchSize */ 10)

    assert.equal(result.created, 125, 'created should equal total pairs inserted')
    assert.equal(result.expanded, 25, 'expanded should equal source observations deleted')

    // Initial event (insertedRows=0) + 3 batch events (10, 20, 25 source obs processed)
    const expandingEvents = events.filter((e) => e.phase === 'expanding')
    assert.ok(
      expandingEvents.length >= 4,
      `expected ≥4 expanding events, got ${expandingEvents.length}`
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
      25,
      'final insertedRows should equal totalSourceCount'
    )
    assert.equal(
      expandingEvents[expandingEvents.length - 1].totalRows,
      25,
      'totalRows should be source observation count'
    )
  })

  test('returns {0,0} and emits no expanding events when there are no source observations', async () => {
    const manager = await getStudyDatabase(studyId, dbPath)
    const db = manager.getDb()
    // Seed deployment + media but no event-based observations
    await seed(db, 5, 0)

    const events = []
    const result = await expandObservationsToMedia(db, (p) => events.push(p), 10)

    assert.deepEqual(result, { expanded: 0, created: 0 })
    assert.equal(events.filter((e) => e.phase === 'expanding').length, 0)
  })

  test('single batch when source observations ≤ batchSize', async () => {
    const manager = await getStudyDatabase(studyId, dbPath)
    const db = manager.getDb()
    await seed(db, 3, 1) // 1 source obs × 3 media = 3 pairs

    const events = []
    const result = await expandObservationsToMedia(db, (p) => events.push(p), 100)

    assert.equal(result.created, 3)
    assert.equal(result.expanded, 1)
    const expandingEvents = events.filter((e) => e.phase === 'expanding')
    // Initial (0) + exactly one batch event
    assert.equal(expandingEvents.length, 2)
    assert.equal(expandingEvents[0].insertedRows, 0)
    assert.equal(expandingEvents[1].insertedRows, 1, 'final insertedRows = 1 source obs processed')
  })

  test('cursor advances past an orphan at a batch boundary', async () => {
    // Reproduces the case where an orphan source obs (no matching media)
    // is the last rowid in a batch — the cursor must still advance past it.
    // Without correct cursor handling, the next iteration would re-fetch
    // the same orphan forever (infinite loop) or skip valid source obs.
    const manager = await getStudyDatabase(studyId, dbPath)
    const db = manager.getDb()

    // Seed 2 source obs with matching media (rowids 1-2 in observations).
    await seed(db, 2, 2)

    // Insert an orphan as the 3rd source obs — same deployment but event
    // window is in the future, so no media matches. This row gets rowid 3
    // and is the last rowid in batch 1 below (batchSize=3).
    await db.insert(observations).values({
      observationID: 'obs-orphan-boundary',
      mediaID: null,
      deploymentID: 'd1',
      eventID: 'orphan-boundary-event',
      eventStart: '2099-01-01T00:00:00Z',
      eventEnd: '2099-01-01T01:00:00Z',
      scientificName: 'orphan species',
      observationType: 'animal'
    })

    // Insert 2 more source obs WITH matching media (rowids 4-5).
    for (let i = 0; i < 2; i++) {
      await db.insert(observations).values({
        observationID: `obs-after-orphan-${i}`,
        mediaID: null,
        deploymentID: 'd1',
        eventID: `late-event-${i}`,
        eventStart: '2024-01-01T00:00:00Z',
        eventEnd: '2024-01-01T01:00:00Z',
        scientificName: 'late species',
        observationType: 'animal'
      })
    }

    // batchSize=3 → batch 1 covers rowids 1-3 (2 matching + orphan), batch 2
    // covers rowids 4-5. If the cursor doesn't advance past the orphan,
    // batch 2 would never reach rowids 4-5.
    const result = await expandObservationsToMedia(db, null, 3)

    assert.equal(result.expanded, 4, '4 source obs with matches should be deleted')
    assert.equal(result.created, 8, '4 source obs × 2 media = 8 new observations')

    // Orphan must still exist and have mediaID NULL
    const orphanRows = await db.all(
      sql`SELECT * FROM observations WHERE observationID = 'obs-orphan-boundary'`
    )
    assert.equal(orphanRows.length, 1, 'orphan at batch boundary should still exist')
    assert.equal(orphanRows[0].mediaID, null)

    // The late source obs (rowids 4-5) must have been expanded too —
    // proves the cursor moved past the orphan.
    const lateExpanded = await db.all(
      sql`SELECT * FROM observations WHERE scientificName = 'late species' AND mediaID IS NOT NULL`
    )
    assert.equal(lateExpanded.length, 4, 'late source obs must have been expanded (2 × 2 media)')
  })

  test('preserves source observations with no matching media (orphans)', async () => {
    const manager = await getStudyDatabase(studyId, dbPath)
    const db = manager.getDb()
    // Seed 2 source obs with matching media + 1 with NO matching media
    await seed(db, 2, 2)
    // Add a source obs whose eventStart/eventEnd is far in the future (no matches)
    await db.insert(observations).values({
      observationID: 'obs-orphan',
      mediaID: null,
      deploymentID: 'd1',
      eventID: 'orphan-event',
      eventStart: '2099-01-01T00:00:00Z',
      eventEnd: '2099-01-01T01:00:00Z',
      scientificName: 'orphan species',
      observationType: 'animal'
    })

    const result = await expandObservationsToMedia(db, null, 10)

    assert.equal(result.expanded, 2, 'only source obs with matches should be deleted')
    assert.equal(result.created, 4, '2 source obs × 2 media = 4 new observations')

    // Verify orphan is preserved
    const orphanRows = await db.all(
      sql`SELECT * FROM observations WHERE observationID = 'obs-orphan'`
    )
    assert.equal(orphanRows.length, 1, 'orphan source obs should still exist')
    assert.equal(orphanRows[0].mediaID, null, 'orphan should still have NULL mediaID')
  })
})
