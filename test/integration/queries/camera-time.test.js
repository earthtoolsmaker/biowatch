import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  registerCameraTimeFunctions,
  parseCameraTime
} from '../../../src/main/services/cameraTime.js'
import { setCameraTimeZone } from '../../../src/main/services/setCameraTimeZone.js'
import {
  getSequenceAwareDailyActivitySQL,
  getSequenceAwareTimeseriesSQL,
  getDeploymentEffortRows
} from '../../../src/main/database/queries/species.js'
import { getMediaForSequencePagination } from '../../../src/main/database/queries/sequences.js'
import { closeStudyDatabase } from '../../../src/main/database/manager.js'
import { migrateStudyConnection } from '../../../src/main/database/migrate-study.js'
import { getBestMedia } from '../../../src/main/database/queries/best-media.js'
import { updateMediaTimestamp } from '../../../src/main/database/queries/media.js'
import { importCamTrapDatasetWithPath } from '../../../src/main/services/import/parsers/camtrapDP.js'
import {
  validateDeploymentIntervals,
  groupEffortByHour,
  groupEffortByWeek
} from '../../../src/main/services/sequences/effort.js'

const migrations = new URL('../../../src/main/database/migrations/', import.meta.url)
const sp = 'Vulpes vulpes'
async function study(run) {
  const dir = mkdtempSync(join(tmpdir(), 'camera-time-'))
  const path = join(dir, 'study.db')
  const db = new Database(path)
  registerCameraTimeFunctions(db)
  // Exercise triggers even with recursive triggers enabled.
  db.pragma('recursive_triggers = ON')
  migrateStudyConnection(db)
  try {
    await run(db, path)
  } finally {
    await closeStudyDatabase(dir.split('/').at(-1))
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}
function seed(db, zone = null) {
  db.prepare(
    `INSERT INTO deployments (deploymentID, deploymentStart, deploymentEnd, cameraTimeZone, latitude, longitude)
    VALUES ('d', '2024-05-01T21:00:00+02:00', '2024-05-02T01:00:00+02:00', ?, 48, 2)`
  ).run(zone)
  db.exec(`INSERT INTO media (mediaID, deploymentID, timestamp, fileMediatype) VALUES
    ('a', 'd', '2024-05-01T22:30:00+02:00', 'image/jpeg'),
    ('b', 'd', '2024-05-01T22:30:20+02:00', 'image/jpeg');
    INSERT INTO observations (observationID, mediaID, deploymentID, eventID, eventStart, scientificName)
    VALUES ('oa', 'a', 'd', 'e', '2024-05-01T22:30:00+02:00', 'Vulpes vulpes'),
           ('ob', 'b', 'd', 'e', '2024-05-01T22:30:20+02:00', 'Vulpes vulpes');`)
}

test('source clock, UTC ordering, activity, gallery filters and effort agree', async () =>
  study(async (db, path) => {
    seed(db)
    assert.deepEqual(
      db
        .prepare('SELECT timestamp, sourceTimestamp, localTimestamp FROM media WHERE mediaID = ?')
        .get('a'),
      {
        timestamp: '2024-05-01T20:30:00.000Z',
        sourceTimestamp: '2024-05-01T22:30:00+02:00',
        localTimestamp: '2024-05-01T22:30:00.000'
      }
    )
    for (const gap of [null, 0, 30]) {
      for (const metric of ['individuals', 'observations']) {
        const rows = await getSequenceAwareDailyActivitySQL(
          path,
          [sp],
          '2024-05-01T00:00:00.000Z',
          '2024-05-03T00:00:00.000Z',
          gap,
          null,
          metric
        )
        assert.deepEqual(rows, [{ scientificName: sp, hour: 22, count: gap === null ? 2 : 1 }])
      }
    }
    const result = await getMediaForSequencePagination(path, {
      timeRange: { ranges: [{ start: 22, end: 23 }] }
    })
    assert.equal(result.media.length, 2)
    const wrongHour = await getMediaForSequencePagination(path, {
      timeRange: { ranges: [{ start: 20, end: 21 }] }
    })
    assert.equal(wrongHour.media.length, 0)
    const validated = validateDeploymentIntervals(await getDeploymentEffortRows(path))
    assert.equal(validated.validDeploymentCount, 1)
    const effort = groupEffortByHour(validated.intervals)
    assert.ok(Math.abs(effort[22] - 1 / 24) < 1e-8)
    assert.equal(effort[20], 0)
  }))

test('RAI excludes deployments whose source offsets contradict the configured effort clock', async () =>
  study(async (db, path) => {
    seed(db)
    setCameraTimeZone(db, 'd', 'UTC+08:00')
    const rows = await getSequenceAwareDailyActivitySQL(
      path,
      [sp],
      '2024-05-01T00:00:00.000Z',
      '2024-05-03T00:00:00.000Z',
      null,
      null,
      'individuals',
      true
    )
    assert.deepEqual(rows, [])
    const validated = validateDeploymentIntervals(await getDeploymentEffortRows(path))
    assert.equal(validated.excludedDeploymentCount, 1)
  }))

test('raw daily activity includes floating camera clocks in every counting and grouping mode', async () =>
  study(async (db, path) => {
    db.exec(`INSERT INTO deployments (deploymentID, deploymentStart, deploymentEnd, latitude, longitude)
      VALUES ('d', '2021-06-25T11:00:00', '2021-06-25T18:00:00', 48, 2);
      INSERT INTO media (mediaID, deploymentID, sourceTimestamp, fileMediatype) VALUES
        ('a', 'd', '2021:06:25 14:56:22', 'image/jpeg'),
        ('b', 'd', '2021:06:25 14:56:42', 'image/jpeg'),
        ('c', 'd', '2021:06:25 15:39:54', 'image/jpeg');
      INSERT INTO observations (observationID, mediaID, deploymentID, eventID, scientificName) VALUES
        ('oa1', 'a', 'd', 'e1', 'Vulpes vulpes'),
        ('oa2', 'a', 'd', 'e1', 'Vulpes vulpes'),
        ('ob', 'b', 'd', 'e1', 'Vulpes vulpes'),
        ('oc', 'c', 'd', 'e2', 'Vulpes vulpes');`)
    for (const gap of [null, 0, 120]) {
      for (const counting of ['individuals', 'observations']) {
        const rows = await getSequenceAwareDailyActivitySQL(
          path,
          [sp],
          undefined,
          undefined,
          gap,
          null,
          counting
        )
        assert.deepEqual(rows, [
          {
            scientificName: sp,
            hour: 14,
            count: counting === 'individuals' ? (gap === null ? 3 : 2) : gap === null ? 2 : 1
          },
          { scientificName: sp, hour: 15, count: 1 }
        ])
        const clipped = await getSequenceAwareDailyActivitySQL(
          path,
          [sp],
          '2021-06-25T15:00:00.000Z',
          '2021-06-25T16:00:00.000Z',
          gap,
          null,
          counting
        )
        assert.deepEqual(clipped, [{ scientificName: sp, hour: 15, count: 1 }])
        for (const [timeMode, requireEffort] of [
          ['solar', false],
          ['clock', true],
          ['solar', true]
        ]) {
          assert.deepEqual(
            await getSequenceAwareDailyActivitySQL(
              path,
              [sp],
              undefined,
              undefined,
              gap,
              null,
              counting,
              requireEffort,
              timeMode
            ),
            []
          )
        }
      }
    }
    // Reading raw clock activity never manufactures an instant or camera setting.
    assert.equal(db.prepare('SELECT COUNT(timestamp) AS n FROM media').get().n, 0)
    assert.equal(db.prepare('SELECT cameraTimeZone FROM deployments').get().cameraTimeZone, null)
  }))

test('raw daily activity filters the written camera calendar, not UTC or the host timezone', async () =>
  study(async (db, path) => {
    seed(db)
    for (const gap of [null, 0, 30]) {
      for (const counting of ['individuals', 'observations']) {
        const rows = await getSequenceAwareDailyActivitySQL(
          path,
          [sp],
          '2024-05-01T22:00:00.000Z',
          '2024-05-01T23:00:00.000Z',
          gap,
          null,
          counting
        )
        assert.deepEqual(rows, [{ scientificName: sp, hour: 22, count: gap === null ? 2 : 1 }])
        assert.deepEqual(
          await getSequenceAwareDailyActivitySQL(
            path,
            [sp],
            '2024-05-01T20:00:00.000Z',
            '2024-05-01T21:00:00.000Z',
            gap,
            null,
            counting
          ),
          []
        )
        // RAI still clips by absolute UTC instants, not floating wall time.
        const rai = await getSequenceAwareDailyActivitySQL(
          path,
          [sp],
          '2024-05-01T20:00:00.000Z',
          '2024-05-01T21:00:00.000Z',
          gap,
          null,
          counting,
          true
        )
        assert.deepEqual(rai, [{ scientificName: sp, hour: 22, count: gap === null ? 2 : 1 }])
      }
    }
  }))

test('raw clock gaps use wall time while effort-normalized gaps retain elapsed UTC time', async () =>
  study(async (db, path) => {
    db.exec(`INSERT INTO deployments (deploymentID, deploymentStart, deploymentEnd, cameraTimeZone)
      VALUES ('d', '2024-10-27T00:00:00+02:00', '2024-10-27T05:00:00+01:00', 'Europe/Paris');
      INSERT INTO media (mediaID, deploymentID, sourceTimestamp, fileMediatype) VALUES
        ('a', 'd', '2024-10-27T02:30:00+02:00', 'image/jpeg'),
        ('b', 'd', '2024-10-27T02:30:20+01:00', 'image/jpeg');
      INSERT INTO observations (observationID, mediaID, deploymentID, scientificName) VALUES
        ('oa', 'a', 'd', 'Vulpes vulpes'),
        ('ob', 'b', 'd', 'Vulpes vulpes');`)
    for (const counting of ['individuals', 'observations']) {
      const raw = await getSequenceAwareDailyActivitySQL(
        path,
        [sp],
        undefined,
        undefined,
        120,
        null,
        counting
      )
      assert.deepEqual(raw, [{ scientificName: sp, hour: 2, count: 1 }])
      const rai = await getSequenceAwareDailyActivitySQL(
        path,
        [sp],
        undefined,
        undefined,
        120,
        null,
        counting,
        true
      )
      assert.deepEqual(rai, [{ scientificName: sp, hour: 2, count: 2 }])
    }
  }))

test('offset-free values wait for a confirmed camera zone, never use the host zone', async () =>
  study(async (db) => {
    db.exec(`INSERT INTO deployments (deploymentID, deploymentStart, deploymentEnd) VALUES ('d', '2024-05-01 21:00:00', '2024-05-02 01:00:00');
    INSERT INTO media (mediaID, deploymentID, timestamp) VALUES ('a', 'd', '2024-05-01 22:30:00');
    INSERT INTO observations (observationID, mediaID, deploymentID, eventStart) VALUES ('o', 'a', 'd', '2024-05-01 22:30:00');`)
    assert.equal(db.prepare('SELECT timestamp FROM media').get().timestamp, null)
    assert.equal(setCameraTimeZone(db, 'd', 'UTC+02:00').unresolvedCount, 0)
    assert.equal(
      db.prepare('SELECT timestamp FROM media').get().timestamp,
      '2024-05-01T20:30:00.000Z'
    )
    assert.equal(
      db.prepare('SELECT eventStart FROM observations').get().eventStart,
      '2024-05-01T20:30:00.000Z'
    )
    setCameraTimeZone(db, 'd', 'Europe/Paris')
    assert.equal(
      db.prepare('SELECT localTimestamp FROM media').get().localTimestamp,
      '2024-05-01T22:30:00.000'
    )
    assert.equal(setCameraTimeZone(db, 'd', null).unresolvedCount, 1)
    assert.throws(() => setCameraTimeZone(db, 'd', 'bogus'), /IANA/)
    assert.throws(() => setCameraTimeZone(db, 'missing', 'UTC'), /not found/)
  }))

test('changing camera settings never overwrites explicit source offsets; timestamp edits keep both views in sync', async () =>
  study(async (db) => {
    seed(db)
    setCameraTimeZone(db, 'd', 'UTC+08:00')
    assert.equal(
      db.prepare('SELECT timestamp FROM media WHERE mediaID = ?').get('a').timestamp,
      '2024-05-01T20:30:00.000Z'
    )
    db.exec("UPDATE media SET timestamp = '2024-05-01T23:30:00+02:00' WHERE mediaID = 'a'")
    const row = db.prepare("SELECT * FROM media WHERE mediaID = 'a'").get()
    assert.equal(row.localTimestamp, '2024-05-01T23:30:00.000')
    assert.equal(row.timestamp, '2024-05-01T21:30:00.000Z')
    assert.equal(row.sourceTimestamp, '2024-05-01T23:30:00+02:00')
  }))

test('week buckets follow the camera date even when the UTC date is Sunday', async () =>
  study(async (db, path) => {
    db.exec(`INSERT INTO deployments (deploymentID, deploymentStart, deploymentEnd) VALUES ('d', '2024-05-06T00:00:00+08:00', '2024-05-06T01:00:00+08:00');
    INSERT INTO media (mediaID, deploymentID, timestamp) VALUES ('a', 'd', '2024-05-06T00:30:00+08:00');
    INSERT INTO observations (observationID, mediaID, deploymentID, scientificName) VALUES ('o', 'a', 'd', 'Vulpes vulpes');`)
    const rows = await getSequenceAwareTimeseriesSQL(path, [sp], null)
    assert.equal(rows[0].weekStart, '2024-05-05')
    const validated = validateDeploymentIntervals(await getDeploymentEffortRows(path))
    const weeks = groupEffortByWeek(validated.intervals)
    assert.deepEqual([...weeks.keys()], ['2024-05-05'])
  }))

test('best-media daylight scoring uses the camera hour, not UTC', async () =>
  study(async (db, path) => {
    db.exec(`INSERT INTO deployments (deploymentID) VALUES ('d');
    INSERT INTO media (mediaID, deploymentID, timestamp, fileMediatype) VALUES
      ('day', 'd', '2024-05-01T12:00:00+08:00', 'image/jpeg'),
      ('night', 'd', '2024-05-01T22:00:00+08:00', 'image/jpeg');
    INSERT INTO observations (observationID, mediaID, deploymentID, scientificName, bboxX, bboxY, bboxWidth, bboxHeight, detectionConfidence, classificationProbability) VALUES
      ('day-o', 'day', 'd', 'Vulpes vulpes', 0.2, 0.2, 0.5, 0.5, 0.95, 0.95),
      ('night-o', 'night', 'd', 'Vulpes vulpes', 0.2, 0.2, 0.5, 0.5, 0.95, 0.95);`)
    const best = await getBestMedia(path, { limit: 1 })
    assert.equal(best[0].mediaID, 'day')
  }))

test('editing a UTC instant preserves the camera offset and observation duration', async () =>
  study(async (db, path) => {
    seed(db)
    db.exec(
      "UPDATE observations SET eventEnd = '2024-05-01T22:30:10+02:00' WHERE observationID = 'oa'"
    )
    await updateMediaTimestamp(path, 'a', '2024-05-01T21:30:00Z')
    const media = db.prepare("SELECT * FROM media WHERE mediaID = 'a'").get()
    const obs = db.prepare("SELECT * FROM observations WHERE observationID = 'oa'").get()
    assert.equal(media.localTimestamp, '2024-05-01T23:30:00.000')
    assert.equal(obs.sourceEventStart, '2024-05-01T23:30:00.000+02:00')
    assert.equal(Date.parse(obs.eventEnd) - Date.parse(obs.eventStart), 10_000)
  }))

test('Camtrap imports retain source offsets and the optional civil camera setting, including expanded events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'camera-import-'))
  const input = join(root, 'input')
  mkdirSync(input)
  writeFileSync(join(input, 'datapackage.json'), JSON.stringify({ name: 'camera-test' }))
  writeFileSync(
    join(input, 'deployments.csv'),
    'deploymentID,deploymentStart,deploymentEnd,latitude,longitude,cameraTimeZone\n' +
      'd,2024-05-01T00:00:00+02:00,2024-05-02T00:00:00+02:00,48,2,Europe/Paris\n'
  )
  writeFileSync(
    join(input, 'media.csv'),
    'mediaID,deploymentID,timestamp,filePath\n' +
      'a,d,2024-05-01T22:30:00+02:00,https://example.test/a.jpg\n'
  )
  writeFileSync(
    join(input, 'observations.csv'),
    'observationID,deploymentID,eventID,eventStart,eventEnd,scientificName\n' +
      'o,d,e,2024-05-01T22:29:00+02:00,2024-05-01T22:31:00+02:00,Vulpes vulpes\n'
  )
  const id = 'camera-source-import'
  let reader
  try {
    await importCamTrapDatasetWithPath(input, root, id)
    reader = new Database(join(root, 'studies', id, 'study.db'), { readonly: true })
    const media = reader.prepare('SELECT * FROM media').get()
    assert.equal(media.timestamp, '2024-05-01T20:30:00.000Z')
    assert.equal(media.localTimestamp, '2024-05-01T22:30:00.000')
    assert.equal(media.sourceTimestamp, '2024-05-01T22:30:00+02:00')
    assert.equal(
      reader.prepare('SELECT cameraTimeZone FROM deployments').get().cameraTimeZone,
      'Europe/Paris'
    )
    const obs = reader.prepare('SELECT * FROM observations WHERE mediaID = ?').get('a')
    assert.equal(obs.sourceEventStart, '2024-05-01T22:29:00+02:00')
    assert.equal(obs.eventStart, '2024-05-01T20:29:00.000Z')
  } finally {
    reader?.close()
    await closeStudyDatabase(id)
    rmSync(root, { recursive: true, force: true })
  }
})

test('0017 alone adds the new model without rewriting existing records', () => {
  const db = new Database(':memory:')
  registerCameraTimeFunctions(db)
  try {
    const files = readdirSync(migrations)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    for (const file of files.filter((f) => f < '0017_'))
      db.exec(readFileSync(new URL(file, migrations), 'utf8'))
    db.exec("INSERT INTO media (mediaID, timestamp) VALUES ('old', '2024-05-01T20:30:00.000Z')")
    db.exec(readFileSync(new URL('0017_camera_local_time.sql', migrations), 'utf8'))
    assert.deepEqual(
      db.prepare('SELECT timestamp, sourceTimestamp, localTimestamp FROM media').get(),
      {
        timestamp: '2024-05-01T20:30:00.000Z',
        sourceTimestamp: null,
        localTimestamp: null
      }
    )
  } finally {
    db.close()
  }
})

test('ambiguous and nonexistent naive civil times are not silently assigned an instant', () => {
  assert.equal(parseCameraTime('2024-03-31T02:30:00', 'Europe/Paris'), null)
  assert.equal(parseCameraTime('2024-10-27T02:30:00', 'Europe/Paris'), null)
  assert.equal(
    parseCameraTime('2024-10-27T02:30:00+01:00', 'Europe/Paris').utc,
    '2024-10-27T01:30:00.000Z'
  )
})
