import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getSequenceAwareSpeciesCountsSQL,
  getSequenceAwareTimeseriesSQL,
  getSequenceAwareDailyActivitySQL,
  getSpeciesDistributionByMedia,
  getSpeciesTimeseriesByMedia
} from '../../../src/main/database/queries/species.js'

// A study UUID directory so getStudyIdFromPath(dbPath) resolves a stable id.
let dir
let dbPath

// Two deployments: depA inside the test bbox, depB outside it.
// Fox observed at both; Deer only at depB (outside).
const BBOX_IN = { north: 51.0, south: 50.0, east: 5.0, west: 4.0 } // contains depA only

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'bbox-study-'))
  dbPath = join(dir, 'study.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE deployments (
      deploymentID TEXT PRIMARY KEY, locationID TEXT, locationName TEXT,
      deploymentStart TEXT, deploymentEnd TEXT, latitude REAL, longitude REAL,
      cameraModel TEXT, cameraID TEXT, coordinateUncertainty INTEGER
    );
    CREATE TABLE media (
      mediaID TEXT PRIMARY KEY, deploymentID TEXT, timestamp TEXT,
      filePath TEXT, fileName TEXT, fileMediatype TEXT, folderName TEXT
    );
    CREATE TABLE observations (
      observationID TEXT PRIMARY KEY, mediaID TEXT, deploymentID TEXT,
      eventID TEXT, eventStart TEXT, scientificName TEXT, observationType TEXT
    );
    INSERT INTO deployments (deploymentID, latitude, longitude) VALUES
      ('depA', 50.5, 4.5),   -- inside BBOX_IN
      ('depB', 52.0, 6.0);   -- outside BBOX_IN
    INSERT INTO media (mediaID, deploymentID, timestamp, fileMediatype) VALUES
      ('mA1', 'depA', '2024-06-01T08:00:00', 'image/jpeg'),
      ('mB1', 'depB', '2024-06-01T09:00:00', 'image/jpeg'),
      ('mB2', 'depB', '2024-06-01T10:00:00', 'image/jpeg');
    INSERT INTO observations (observationID, mediaID, deploymentID, eventID, eventStart, scientificName) VALUES
      ('oA1', 'mA1', 'depA', 'e1', '2024-06-01T08:00:00', 'Vulpes vulpes'),
      ('oB1', 'mB1', 'depB', 'e2', '2024-06-01T09:00:00', 'Vulpes vulpes'),
      ('oB2', 'mB2', 'depB', 'e3', '2024-06-01T10:00:00', 'Capreolus capreolus');
  `)
  db.close()
})

after(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('species counts: null bbox returns all species (regression guard)', async () => {
  const rows = await getSequenceAwareSpeciesCountsSQL(dbPath, null, null)
  const names = rows.map((r) => r.scientificName).sort()
  assert.deepEqual(names, ['Capreolus capreolus', 'Vulpes vulpes'])
})

test('species counts: bbox restricts to in-bounds deployments', async () => {
  const rows = await getSequenceAwareSpeciesCountsSQL(dbPath, null, BBOX_IN)
  // Only depA (Vulpes) is inside; depB (the only Capreolus) is excluded.
  assert.deepEqual(rows, [{ scientificName: 'Vulpes vulpes', count: 1 }])
})

test('timeseries: null bbox includes out-of-bounds species', async () => {
  const rows = await getSequenceAwareTimeseriesSQL(dbPath, ['Capreolus capreolus'], null, null)
  const total = rows.reduce((s, r) => s + r.count, 0)
  assert.equal(total, 1) // the single depB Capreolus observation
})

test('timeseries: bbox excludes out-of-bounds species entirely', async () => {
  const rows = await getSequenceAwareTimeseriesSQL(dbPath, ['Capreolus capreolus'], null, BBOX_IN)
  assert.deepEqual(rows, []) // Capreolus only exists at depB, which is outside BBOX_IN
})

const START = '2024-01-01T00:00:00'
const END = '2024-12-31T23:59:59'

test('daily-activity: null bbox includes out-of-bounds observations', async () => {
  const rows = await getSequenceAwareDailyActivitySQL(
    dbPath,
    ['Vulpes vulpes'],
    START,
    END,
    null,
    null
  )
  const total = rows.reduce((s, r) => s + r.count, 0)
  assert.equal(total, 2) // Vulpes at depA (08:00) + depB (09:00)
})

test('daily-activity: bbox restricts to in-bounds observations', async () => {
  const rows = await getSequenceAwareDailyActivitySQL(
    dbPath,
    ['Vulpes vulpes'],
    START,
    END,
    null,
    BBOX_IN
  )
  const total = rows.reduce((s, r) => s + r.count, 0)
  assert.equal(total, 1) // only depA Vulpes (08:00) is inside BBOX_IN
})

// Guard the param bind-order in the eventID (gap=0) and positive-gap branches,
// which append bbox params after a different number of leading params.
test('daily-activity: bbox restricts in eventID branch (gap=0)', async () => {
  const rows = await getSequenceAwareDailyActivitySQL(
    dbPath,
    ['Vulpes vulpes'],
    START,
    END,
    0,
    BBOX_IN
  )
  const total = rows.reduce((s, r) => s + r.count, 0)
  assert.equal(total, 1)
})

test('daily-activity: bbox restricts in positive-gap branch', async () => {
  const rows = await getSequenceAwareDailyActivitySQL(
    dbPath,
    ['Vulpes vulpes'],
    START,
    END,
    300,
    BBOX_IN
  )
  const total = rows.reduce((s, r) => s + r.count, 0)
  assert.equal(total, 1)
})
