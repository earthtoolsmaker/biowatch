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
