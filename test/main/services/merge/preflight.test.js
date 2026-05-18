import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

import { mergePreflight } from '../../../../src/main/services/merge/preflight.js'

let root
let studiesDir

function newStudy(uuid) {
  const dir = join(studiesDir, uuid)
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'study.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE deployments (deploymentID TEXT PRIMARY KEY, locationID TEXT, locationName TEXT);
    CREATE TABLE media (
      mediaID TEXT PRIMARY KEY,
      deploymentID TEXT,
      filePath TEXT,
      importFolder TEXT
    );
    CREATE TABLE observations (
      observationID TEXT PRIMARY KEY,
      mediaID TEXT,
      deploymentID TEXT
    );
    CREATE TABLE metadata (
      id TEXT PRIMARY KEY, title TEXT, description TEXT, importerName TEXT NOT NULL,
      created TEXT NOT NULL, contributors TEXT, startDate TEXT, endDate TEXT
    );
    CREATE TABLE model_runs (id TEXT PRIMARY KEY, modelID TEXT NOT NULL, modelVersion TEXT NOT NULL, startedAt TEXT NOT NULL, importPath TEXT);
    CREATE TABLE model_outputs (id TEXT PRIMARY KEY, mediaID TEXT, runID TEXT);
  `)
  return { dir, dbPath, db }
}

beforeEach(() => {
  root = join(tmpdir(), 'biowatch-merge-pf-' + Date.now() + '-' + Math.random())
  studiesDir = join(root, 'studies')
  mkdirSync(studiesDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('mergePreflight', () => {
  test('counts are correct, ownedByBiowatchCount is 0 for folder-style B', () => {
    const A = newStudy('aaaaaaaa-1111-4111-9111-111111111111')
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222')
    B.db
      .prepare('INSERT INTO deployments (deploymentID, locationID) VALUES (?, ?)')
      .run('CAM_01', 'CAM_01')
    B.db
      .prepare(
        'INSERT INTO media (mediaID, deploymentID, filePath, importFolder) VALUES (?, ?, ?, ?)'
      )
      .run('m1', 'CAM_01', '/home/user/photos/CAM_01/a.jpg', '/home/user/photos')
    B.db
      .prepare('INSERT INTO observations (observationID, mediaID, deploymentID) VALUES (?, ?, ?)')
      .run('o1', 'm1', 'CAM_01')
    A.db.close()
    B.db.close()

    const out = mergePreflight({
      biowatchDataPath: root,
      targetStudyId: 'aaaaaaaa-1111-4111-9111-111111111111',
      sourceStudyId: 'bbbbbbbb-2222-4222-9222-222222222222'
    })
    assert.equal(out.deploymentCount, 1)
    assert.equal(out.mediaCount, 1)
    assert.equal(out.observationCount, 1)
    assert.equal(out.ownedByBiowatchCount, 0)
    assert.equal(out.alreadyMerged, false)
    assert.equal(out.renameCount, 1)
  })

  test('ownedByBiowatchCount counts media inside <biowatch-data>/studies/<B-uuid>/', () => {
    const A = newStudy('aaaaaaaa-1111-4111-9111-111111111111')
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222')
    const insideBPath = join(B.dir, 'media', 'a.jpg')
    mkdirSync(join(B.dir, 'media'), { recursive: true })
    writeFileSync(insideBPath, 'fake-jpeg')
    B.db.prepare('INSERT INTO deployments (deploymentID) VALUES (?)').run('CAM_01')
    B.db
      .prepare(
        'INSERT INTO media (mediaID, deploymentID, filePath, importFolder) VALUES (?, ?, ?, ?)'
      )
      .run('m1', 'CAM_01', insideBPath, B.dir)
    B.db
      .prepare(
        'INSERT INTO media (mediaID, deploymentID, filePath, importFolder) VALUES (?, ?, ?, ?)'
      )
      .run('m2', 'CAM_01', '/external/x.jpg', '/external')
    A.db.close()
    B.db.close()
    const out = mergePreflight({
      biowatchDataPath: root,
      targetStudyId: 'aaaaaaaa-1111-4111-9111-111111111111',
      sourceStudyId: 'bbbbbbbb-2222-4222-9222-222222222222'
    })
    assert.equal(out.ownedByBiowatchCount, 1)
  })

  test('alreadyMerged flips when A already has B as a merged source', () => {
    const A = newStudy('aaaaaaaa-1111-4111-9111-111111111111')
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222')
    A.db
      .prepare('INSERT INTO media (mediaID, filePath, importFolder) VALUES (?, ?, ?)')
      .run('x', '/y/z', 'merge:bbbbbbbb-2222-4222-9222-222222222222')
    A.db.close()
    B.db.close()
    const out = mergePreflight({
      biowatchDataPath: root,
      targetStudyId: 'aaaaaaaa-1111-4111-9111-111111111111',
      sourceStudyId: 'bbbbbbbb-2222-4222-9222-222222222222'
    })
    assert.equal(out.alreadyMerged, true)
  })

  test('missingFileCount counts local files that are not on disk; URLs skip the check', () => {
    const A = newStudy('aaaaaaaa-1111-4111-9111-111111111111')
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222')
    B.db
      .prepare('INSERT INTO media (mediaID, filePath) VALUES (?, ?)')
      .run('m1', '/nowhere/missing.jpg')
    B.db
      .prepare('INSERT INTO media (mediaID, filePath) VALUES (?, ?)')
      .run('m2', 'https://lila.science/x.jpg')
    A.db.close()
    B.db.close()
    const out = mergePreflight({
      biowatchDataPath: root,
      targetStudyId: 'aaaaaaaa-1111-4111-9111-111111111111',
      sourceStudyId: 'bbbbbbbb-2222-4222-9222-222222222222'
    })
    assert.equal(out.missingFileCount, 1)
  })
})
