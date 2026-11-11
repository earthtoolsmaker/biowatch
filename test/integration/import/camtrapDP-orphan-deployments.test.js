import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

import { importCamTrapDatasetWithPath } from '../../../src/main/services/import/parsers/camtrapDP.js'

let testBiowatchDataPath
let testCamTrapDataPath

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    const log = electronLog.default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // electron-log not available in test environment
  }

  testBiowatchDataPath = join(tmpdir(), 'biowatch-camtrap-orphan-test', Date.now().toString())
  mkdirSync(testBiowatchDataPath, { recursive: true })
  testCamTrapDataPath = join(process.cwd(), 'test', 'data', 'camtrap-orphan-deployments')
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

function openDb(dbPath) {
  return new Database(dbPath, { readonly: true })
}

describe('CamTrap-DP orphan deploymentID recovery', () => {
  test('synthesizes a stub deployment for a deploymentID referenced by media but missing from deployments.csv', async () => {
    const studyId = 'orphan-stub-shape'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
    const db = openDb(dbPath)
    try {
      const stub = db.prepare("SELECT * FROM deployments WHERE deploymentID = 'deploy999'").get()
      assert.ok(stub, 'expected a synthesized stub for deploy999')
      assert.equal(stub.locationID, 'deploy999')
      assert.equal(stub.locationName, null)
      assert.equal(stub.latitude, null)
      assert.equal(stub.longitude, null)
      assert.equal(stub.cameraModel, null)
      assert.equal(stub.cameraID, null)
      assert.equal(stub.coordinateUncertainty, null)
    } finally {
      db.close()
    }
  })

  test('stub time window spans union of orphan media timestamps and orphan observation eventStart/eventEnd', async () => {
    const studyId = 'orphan-stub-window'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
    const db = openDb(dbPath)
    try {
      const stub = db.prepare("SELECT * FROM deployments WHERE deploymentID = 'deploy999'").get()
      // media: 2023-05-01..2023-05-15
      // obs002 eventStart 2023-04-25, eventEnd 2023-05-20
      // obs003 eventStart 2023-04-25, eventEnd 2023-04-25
      // → start = 2023-04-25T10:00:00Z, end = 2023-05-20T10:01:00Z
      assert.equal(stub.deploymentStart, '2023-04-25T10:00:00.000Z')
      assert.equal(stub.deploymentEnd, '2023-05-20T10:01:00.000Z')
    } finally {
      db.close()
    }
  })

  test('all orphan media rows are imported once their deploymentID has a stub', async () => {
    const studyId = 'orphan-media-imported'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
    const db = openDb(dbPath)
    try {
      const total = db.prepare('SELECT COUNT(*) AS c FROM media').get().c
      assert.equal(total, 5, 'all 5 media rows should be present')

      const orphans = db
        .prepare("SELECT mediaID FROM media WHERE deploymentID = 'deploy999' ORDER BY mediaID")
        .all()
        .map((r) => r.mediaID)
      assert.deepEqual(orphans, ['media004', 'media005'])
    } finally {
      db.close()
    }
  })

  test('observations referencing a missing mediaID are dropped', async () => {
    const studyId = 'orphan-obs-drop'
    await importCamTrapDatasetWithPath(testCamTrapDataPath, testBiowatchDataPath, studyId)

    const dbPath = join(testBiowatchDataPath, 'studies', studyId, 'study.db')
    const db = openDb(dbPath)
    try {
      const total = db.prepare('SELECT COUNT(*) AS c FROM observations').get().c
      // obs004 references medianeverexisted → dropped. Other 3 stay.
      assert.equal(total, 3)
      const ids = db
        .prepare('SELECT observationID FROM observations ORDER BY observationID')
        .all()
        .map((r) => r.observationID)
      assert.deepEqual(ids, ['obs001', 'obs002', 'obs003'])
    } finally {
      db.close()
    }
  })

  test('returns synthesized counts on the result for the IPC layer to forward', async () => {
    const studyId = 'orphan-result-shape'
    const result = await importCamTrapDatasetWithPath(
      testCamTrapDataPath,
      testBiowatchDataPath,
      studyId
    )
    assert.ok(result.synthesized, 'result.synthesized should be present')
    assert.deepEqual(result.synthesized, {
      deployments: 1,
      orphanMediaRows: 2,
      orphanObservationRows: 2,
      droppedObservationRows: 1
    })
  })
})
