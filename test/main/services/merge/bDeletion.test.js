import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

import { getAtRiskMergeBreaks } from '../../../../src/main/services/merge/bDeletion.js'

let root
let studiesDir

function newStudy(uuid, title) {
  const dir = join(studiesDir, uuid)
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'study.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE media (mediaID TEXT PRIMARY KEY, filePath TEXT, importFolder TEXT);
    CREATE TABLE metadata (id TEXT PRIMARY KEY, title TEXT, importerName TEXT NOT NULL, created TEXT NOT NULL);
  `)
  db.prepare('INSERT INTO metadata (id, title, importerName, created) VALUES (?, ?, ?, ?)').run(
    uuid,
    title,
    'local/images',
    new Date().toISOString()
  )
  return { uuid, dir, dbPath, db }
}

beforeEach(() => {
  root = join(tmpdir(), 'biowatch-bdel-' + Date.now() + '-' + Math.random())
  studiesDir = join(root, 'studies')
  mkdirSync(studiesDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('getAtRiskMergeBreaks', () => {
  test('returns [] when B has not been merged anywhere', () => {
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222', 'B')
    newStudy('aaaaaaaa-1111-4111-9111-111111111111', 'A')
    B.db.close()
    const out = getAtRiskMergeBreaks({ biowatchDataPath: root, sourceStudyId: B.uuid })
    assert.deepEqual(out, [])
  })

  test('returns [] when B has been merged but no filePaths point inside B', () => {
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222', 'B')
    const A = newStudy('aaaaaaaa-1111-4111-9111-111111111111', 'A')
    A.db
      .prepare('INSERT INTO media (mediaID, filePath, importFolder) VALUES (?, ?, ?)')
      .run('m1', '/external/x.jpg', `merge:${B.uuid}`)
    A.db.close()
    B.db.close()
    const out = getAtRiskMergeBreaks({ biowatchDataPath: root, sourceStudyId: B.uuid })
    assert.deepEqual(out, [])
  })

  test('returns the dependent study + broken count when filePaths point inside B', () => {
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222', 'B')
    const A = newStudy('aaaaaaaa-1111-4111-9111-111111111111', 'A')
    const insideB = join(B.dir, 'pkg', 'a.jpg')
    A.db
      .prepare('INSERT INTO media (mediaID, filePath, importFolder) VALUES (?, ?, ?)')
      .run('m1', insideB, `merge:${B.uuid}`)
    A.db.close()
    B.db.close()
    const out = getAtRiskMergeBreaks({ biowatchDataPath: root, sourceStudyId: B.uuid })
    assert.deepEqual(out, [
      { studyId: 'aaaaaaaa-1111-4111-9111-111111111111', title: 'A', brokenMediaCount: 1 }
    ])
  })

  test('skips the source study itself', () => {
    const B = newStudy('bbbbbbbb-2222-4222-9222-222222222222', 'B')
    B.db
      .prepare('INSERT INTO media (mediaID, filePath, importFolder) VALUES (?, ?, ?)')
      .run('m1', join(B.dir, 'x.jpg'), `merge:${B.uuid}`)
    B.db.close()
    const out = getAtRiskMergeBreaks({ biowatchDataPath: root, sourceStudyId: B.uuid })
    assert.deepEqual(out, [])
  })
})
