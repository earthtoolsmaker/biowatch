import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

import { mergeStudy } from '../../../src/main/services/merge/index.js'

let root
let studiesDir
const A_UUID = 'aaaaaaaa-1111-4111-9111-111111111111'
const B_UUID = 'bbbbbbbb-2222-4222-9222-222222222222'

function bootstrapStudy(uuid, { title, importerName, contributors }) {
  const dir = join(studiesDir, uuid)
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'study.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE deployments (
      deploymentID TEXT PRIMARY KEY, locationID TEXT, locationName TEXT,
      deploymentStart TEXT, deploymentEnd TEXT, latitude REAL, longitude REAL,
      cameraModel TEXT, cameraID TEXT, coordinateUncertainty INTEGER
    );
    CREATE TABLE media (
      mediaID TEXT PRIMARY KEY,
      deploymentID TEXT REFERENCES deployments(deploymentID),
      timestamp TEXT, filePath TEXT, fileName TEXT,
      importFolder TEXT, folderName TEXT, fileMediatype TEXT,
      exifData TEXT, favorite INTEGER
    );
    CREATE TABLE model_runs (
      id TEXT PRIMARY KEY, modelID TEXT NOT NULL, modelVersion TEXT NOT NULL,
      startedAt TEXT NOT NULL, status TEXT, importPath TEXT, options TEXT
    );
    CREATE TABLE model_outputs (
      id TEXT PRIMARY KEY,
      mediaID TEXT NOT NULL REFERENCES media(mediaID),
      runID TEXT NOT NULL REFERENCES model_runs(id),
      rawOutput TEXT,
      UNIQUE (mediaID, runID)
    );
    CREATE TABLE observations (
      observationID TEXT PRIMARY KEY,
      mediaID TEXT REFERENCES media(mediaID),
      deploymentID TEXT REFERENCES deployments(deploymentID),
      modelOutputID TEXT REFERENCES model_outputs(id),
      eventID TEXT, eventStart TEXT, eventEnd TEXT,
      scientificName TEXT, observationType TEXT, commonName TEXT,
      classificationProbability REAL, count INTEGER,
      lifeStage TEXT, age TEXT, sex TEXT, behavior TEXT,
      bboxX REAL, bboxY REAL, bboxWidth REAL, bboxHeight REAL,
      detectionConfidence REAL,
      classificationMethod TEXT, classifiedBy TEXT, classificationTimestamp TEXT
    );
    CREATE TABLE metadata (
      id TEXT PRIMARY KEY, name TEXT, title TEXT, description TEXT,
      created TEXT NOT NULL, importerName TEXT NOT NULL,
      contributors TEXT, updatedAt TEXT, startDate TEXT, endDate TEXT,
      sequenceGap INTEGER
    );
  `)
  db.prepare(
    `INSERT INTO metadata (id, title, importerName, created, contributors, startDate, endDate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uuid,
    title,
    importerName,
    '2026-01-01T00:00:00Z',
    JSON.stringify(contributors || []),
    null,
    null
  )
  return { uuid, dir, dbPath, db }
}

beforeEach(() => {
  root = join(tmpdir(), 'biowatch-mergeint-' + Date.now() + '-' + Math.random())
  studiesDir = join(root, 'studies')
  mkdirSync(studiesDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('mergeStudy', () => {
  test('inserts B rows into A with prefixed PKs, importFolder set, files unchanged', () => {
    const A = bootstrapStudy(A_UUID, {
      title: 'A',
      importerName: 'local/images',
      contributors: [{ title: 'Alice', email: 'alice@x', role: 'contact' }]
    })
    const B = bootstrapStudy(B_UUID, {
      title: 'B',
      importerName: 'camtrap/datapackage',
      contributors: [{ title: 'Bob', email: 'bob@x', role: 'contributor' }]
    })

    B.db
      .prepare('INSERT INTO deployments (deploymentID, locationID) VALUES (?, ?)')
      .run('CAM_01', 'CAM_01')
    B.db
      .prepare(
        `INSERT INTO media (mediaID, deploymentID, filePath, importFolder)
         VALUES (?, ?, ?, ?)`
      )
      .run('IMG1', 'CAM_01', 'https://example.com/IMG1.jpg', '/external')
    B.db
      .prepare(
        `INSERT INTO observations (observationID, mediaID, deploymentID, scientificName)
         VALUES (?, ?, ?, ?)`
      )
      .run('obs1', 'IMG1', 'CAM_01', 'Lepus europaeus')

    A.db.close()
    B.db.close()

    const result = mergeStudy({
      biowatchDataPath: root,
      targetStudyId: A_UUID,
      sourceStudyId: B_UUID,
      reviewed: {
        description: 'merged',
        contributorEmails: ['alice@x', 'bob@x']
      }
    })

    assert.equal(result.success, true)
    assert.equal(result.alreadyMerged, undefined)

    const a = new Database(A.dbPath, { readonly: true })
    try {
      const dep = a.prepare('SELECT * FROM deployments').all()
      assert.equal(dep.length, 1)
      assert.equal(dep[0].deploymentID, 'study:bbbbbbbb:CAM_01')
      assert.equal(dep[0].locationID, 'CAM_01')

      const med = a.prepare('SELECT * FROM media').all()
      assert.equal(med.length, 1)
      assert.equal(med[0].mediaID, 'study:bbbbbbbb:IMG1')
      assert.equal(med[0].deploymentID, 'study:bbbbbbbb:CAM_01')
      assert.equal(med[0].filePath, 'https://example.com/IMG1.jpg')
      assert.equal(med[0].importFolder, `merge:${B_UUID}`)

      const obs = a.prepare('SELECT * FROM observations').all()
      assert.equal(obs.length, 1)
      assert.equal(obs[0].observationID, 'study:bbbbbbbb:obs1')
      assert.equal(obs[0].mediaID, 'study:bbbbbbbb:IMG1')
      assert.equal(obs[0].deploymentID, 'study:bbbbbbbb:CAM_01')

      const meta = a.prepare('SELECT * FROM metadata').get()
      assert.equal(meta.description, 'merged')
      const contributors = JSON.parse(meta.contributors)
      assert.equal(contributors.length, 2)
      assert.ok(contributors.find((c) => c.email === 'alice@x'))
      assert.ok(contributors.find((c) => c.email === 'bob@x'))
    } finally {
      a.close()
    }
  })

  test('returns { alreadyMerged: true } on second merge of same B', () => {
    const A = bootstrapStudy(A_UUID, { title: 'A', importerName: 'local/images' })
    const B = bootstrapStudy(B_UUID, { title: 'B', importerName: 'local/images' })
    B.db.prepare('INSERT INTO deployments (deploymentID) VALUES (?)').run('CAM_01')
    B.db
      .prepare('INSERT INTO media (mediaID, deploymentID, filePath) VALUES (?, ?, ?)')
      .run('IMG1', 'CAM_01', 'https://example.com/a.jpg')
    A.db.close()
    B.db.close()

    const first = mergeStudy({
      biowatchDataPath: root,
      targetStudyId: A_UUID,
      sourceStudyId: B_UUID,
      reviewed: { description: '', contributorEmails: [] }
    })
    assert.equal(first.success, true)

    const second = mergeStudy({
      biowatchDataPath: root,
      targetStudyId: A_UUID,
      sourceStudyId: B_UUID,
      reviewed: { description: '', contributorEmails: [] }
    })
    assert.equal(second.success, true)
    assert.equal(second.alreadyMerged, true)
  })

  test('refuses self-merge', () => {
    const A = bootstrapStudy(A_UUID, { title: 'A', importerName: 'local/images' })
    A.db.close()
    assert.throws(
      () =>
        mergeStudy({
          biowatchDataPath: root,
          targetStudyId: A_UUID,
          sourceStudyId: A_UUID,
          reviewed: { description: '', contributorEmails: [] }
        }),
      /self-merge/i
    )
  })

  test('reports missingFileCount but inserts every row — broken filePaths are B-level, not merge-level', () => {
    const A = bootstrapStudy(A_UUID, { title: 'A', importerName: 'local/images' })
    const B = bootstrapStudy(B_UUID, { title: 'B', importerName: 'local/images' })
    const existing = join(B.dir, 'x.jpg')
    writeFileSync(existing, 'x')
    B.db.prepare('INSERT INTO deployments (deploymentID) VALUES (?)').run('CAM_01')
    B.db
      .prepare('INSERT INTO media (mediaID, deploymentID, filePath) VALUES (?, ?, ?)')
      .run('OK', 'CAM_01', existing)
    B.db
      .prepare('INSERT INTO media (mediaID, deploymentID, filePath) VALUES (?, ?, ?)')
      .run('GONE', 'CAM_01', '/nowhere/missing.jpg')
    B.db.prepare('INSERT INTO observations (observationID, mediaID) VALUES (?, ?)').run('o1', 'OK')
    B.db
      .prepare('INSERT INTO observations (observationID, mediaID) VALUES (?, ?)')
      .run('o2', 'GONE')
    A.db.close()
    B.db.close()

    const result = mergeStudy({
      biowatchDataPath: root,
      targetStudyId: A_UUID,
      sourceStudyId: B_UUID,
      reviewed: { description: '', contributorEmails: [] }
    })
    assert.equal(result.success, true)
    // Informational only: we surface that 1 file is gone on disk, but every
    // row still gets copied (broken filePaths are B's problem, not merge's).
    assert.equal(result.missingFileCount, 1)

    const a = new Database(A.dbPath, { readonly: true })
    try {
      assert.equal(a.prepare('SELECT COUNT(*) AS n FROM media').get().n, 2)
      assert.equal(a.prepare('SELECT COUNT(*) AS n FROM observations').get().n, 2)
    } finally {
      a.close()
    }
  })

  test('contributorEmails: [] drops every contributor (explicit user intent)', () => {
    const A = bootstrapStudy(A_UUID, {
      title: 'A',
      importerName: 'local/images',
      contributors: [{ title: 'Alice', email: 'alice@x', role: 'contact' }]
    })
    const B = bootstrapStudy(B_UUID, {
      title: 'B',
      importerName: 'local/images',
      contributors: [{ title: 'Bob', email: 'bob@x', role: 'contributor' }]
    })
    A.db.close()
    B.db.close()

    mergeStudy({
      biowatchDataPath: root,
      targetStudyId: A_UUID,
      sourceStudyId: B_UUID,
      reviewed: { description: 'merged', contributorEmails: [] }
    })

    const a = new Database(join(studiesDir, A_UUID, 'study.db'), { readonly: true })
    try {
      const meta = a.prepare('SELECT contributors FROM metadata').get()
      assert.deepEqual(JSON.parse(meta.contributors), [])
    } finally {
      a.close()
    }
  })

  test('merges date ranges: min of starts, max of ends', () => {
    const A = bootstrapStudy(A_UUID, { title: 'A', importerName: 'local/images' })
    const B = bootstrapStudy(B_UUID, { title: 'B', importerName: 'local/images' })
    A.db
      .prepare('UPDATE metadata SET startDate = ?, endDate = ?')
      .run('2023-05-01T00:00:00Z', '2023-08-31T00:00:00Z')
    B.db
      .prepare('UPDATE metadata SET startDate = ?, endDate = ?')
      .run('2023-04-12T00:00:00Z', '2023-09-30T00:00:00Z')
    A.db.close()
    B.db.close()
    mergeStudy({
      biowatchDataPath: root,
      targetStudyId: A_UUID,
      sourceStudyId: B_UUID,
      reviewed: { description: '', contributorEmails: [] }
    })
    const a = new Database(join(studiesDir, A_UUID, 'study.db'), { readonly: true })
    try {
      const m = a.prepare('SELECT startDate, endDate FROM metadata').get()
      assert.equal(m.startDate, '2023-04-12T00:00:00Z')
      assert.equal(m.endDate, '2023-09-30T00:00:00Z')
    } finally {
      a.close()
    }
  })
})
