import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { getMigrationsPath } from '../../../src/main/database/migrations-utils.js'
import { migrateStudyDatabase } from '../../../src/main/database/migrate-study.js'
import { closeStudyDatabase } from '../../../src/main/database/manager.js'
import { registerCameraTimeFunctions } from '../../../src/main/services/cameraTime.js'
import {
  getDeploymentEffortRows,
  getSequenceAwareDailyActivitySQL,
  getSequenceAwareTimeseriesSQL,
  getSpeciesTimeseriesByMedia
} from '../../../src/main/database/queries/species.js'
import { getMediaForSequencePagination } from '../../../src/main/database/queries/sequences.js'
import {
  validateDeploymentIntervals,
  groupEffortByHour
} from '../../../src/main/services/sequences/effort.js'

import {
  calculateSequenceAwareTimeseries,
  pivotPreAggregatedTimeseries
} from '../../../src/main/services/sequences/speciesCounts.js'

const migrationsPath = getMigrationsPath('test')
const journal = JSON.parse(readFileSync(join(migrationsPath, 'meta/_journal.json'), 'utf8'))
const species = 'Vulpes vulpes'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'camera-backfill-'))
  const id = basename(root)
  const dbPath = join(root, 'study.db')
  const prefix = join(root, 'migrations')
  mkdirSync(join(prefix, 'meta'), { recursive: true })
  for (const entry of journal.entries) {
    cpSync(join(migrationsPath, `${entry.tag}.sql`), join(prefix, `${entry.tag}.sql`))
  }
  const db = new Database(dbPath)
  registerCameraTimeFunctions(db)
  const toVersion = (version) => {
    writeFileSync(
      join(prefix, 'meta/_journal.json'),
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx <= version)
      })
    )
    migrate(drizzle(db), { migrationsFolder: prefix })
  }
  toVersion(16)
  const readers = []
  t.after(async () => {
    await closeStudyDatabase(id)
    for (const reader of readers) if (reader.open) reader.close()
    if (db.open) db.close()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    id,
    root,
    dbPath,
    db,
    toVersion,
    read() {
      const reader = new Database(dbPath, { readonly: true })
      readers.push(reader)
      return reader
    },
    async upgrade() {
      db.close()
      const result = await migrateStudyDatabase(id, dbPath, migrationsPath)
      assert.equal(result.success, true, result.error?.message)
      assert.equal(result.database.currentVersion, '0018_backfill_camera_local_time')
      return result
    }
  }
}

function seedUtc(db) {
  db.exec(`
    INSERT INTO metadata (id, name, created, importerName) VALUES ('study', 'Old demo', '2024-05-01T00:00:00Z', 'camtrap/datapackage');
    INSERT INTO deployments (deploymentID, deploymentStart, deploymentEnd, latitude, longitude)
      VALUES ('d', '2024-05-01T00:00:00Z', '2024-05-02T00:00:00Z', 48, 2);
    INSERT INTO media (mediaID, deploymentID, timestamp, fileMediatype, favorite, filePath)
      VALUES ('a', 'd', '2024-05-01T20:30:00Z', 'image/jpeg', 1, '/external/fox.jpg'),
             ('b', 'd', '2024-05-01T20:30:20.000Z', 'image/jpeg', 0, '/external/fox-2.jpg');
    INSERT INTO observations (observationID, mediaID, deploymentID, eventID, eventStart, eventEnd, scientificName, behavior)
      VALUES ('oa', 'a', 'd', 'e', '2024-05-01T20:30:00Z', '2024-05-01T20:30:01Z', '${species}', 'feeding'),
             ('ob', 'b', 'd', 'e', '2024-05-01T20:30:20.000Z', NULL, '${species}', NULL);
  `)
}

for (const alreadyAt17 of [false, true]) {
  test(`0018 backfills old UTC studies (${alreadyAt17 ? '0017 already applied' : '0017 also pending'}) and restores queries`, async (t) => {
    const f = fixture(t)
    seedUtc(f.db)
    const beforeMedia = f.db
      .prepare(
        'SELECT mediaID, favorite, filePath, julianday(timestamp) AS instant FROM media ORDER BY mediaID'
      )
      .all()
    const beforeObs = f.db
      .prepare(
        'SELECT observationID, mediaID, eventID, scientificName, behavior FROM observations ORDER BY observationID'
      )
      .all()
    if (alreadyAt17) {
      f.toVersion(17)
      assert.equal(
        f.db.prepare('SELECT localTimestamp FROM media LIMIT 1').get().localTimestamp,
        null
      )
    }
    await f.upgrade()
    const after = f.read()
    assert.deepEqual(
      after
        .prepare(
          'SELECT mediaID, favorite, filePath, julianday(timestamp) AS instant FROM media ORDER BY mediaID'
        )
        .all(),
      beforeMedia
    )
    assert.deepEqual(
      after
        .prepare(
          'SELECT observationID, mediaID, eventID, scientificName, behavior FROM observations ORDER BY observationID'
        )
        .all(),
      beforeObs
    )
    assert.deepEqual(
      after
        .prepare('SELECT timestamp, sourceTimestamp, localTimestamp FROM media WHERE mediaID = ?')
        .get('a'),
      {
        timestamp: '2024-05-01T20:30:00.000Z',
        sourceTimestamp: '2024-05-01T20:30:00Z',
        localTimestamp: '2024-05-01T20:30:00.000'
      }
    )
    assert.deepEqual(
      after
        .prepare(
          'SELECT sourceDeploymentStart, sourceDeploymentEnd, deploymentStart, deploymentEnd, cameraTimeZone FROM deployments'
        )
        .get(),
      {
        sourceDeploymentStart: '2024-05-01T00:00:00Z',
        sourceDeploymentEnd: '2024-05-02T00:00:00Z',
        deploymentStart: '2024-05-01T00:00:00.000Z',
        deploymentEnd: '2024-05-02T00:00:00.000Z',
        cameraTimeZone: null
      }
    )
    assert.deepEqual(
      after
        .prepare(
          'SELECT sourceEventStart, sourceEventEnd, eventStart, eventEnd FROM observations WHERE observationID = ?'
        )
        .get('oa'),
      {
        sourceEventStart: '2024-05-01T20:30:00Z',
        sourceEventEnd: '2024-05-01T20:30:01Z',
        eventStart: '2024-05-01T20:30:00.000Z',
        eventEnd: '2024-05-01T20:30:01.000Z'
      }
    )
    for (const gap of [null, 0, 30]) {
      for (const counting of ['individuals', 'observations']) {
        const daily = await getSequenceAwareDailyActivitySQL(
          f.dbPath,
          [species],
          '2024-05-01T00:00:00.000Z',
          '2024-05-02T00:00:00.000Z',
          gap,
          null,
          counting
        )
        assert.deepEqual(daily, [
          { scientificName: species, hour: 20, count: gap === null ? 2 : 1 }
        ])
        const weekly = await getSequenceAwareTimeseriesSQL(f.dbPath, [species], gap, null, counting)
        const result =
          weekly === null
            ? calculateSequenceAwareTimeseries(
                await getSpeciesTimeseriesByMedia(f.dbPath, [species]),
                gap,
                counting
              )
            : pivotPreAggregatedTimeseries(weekly)
        assert.deepEqual(result.timeseries, [
          { date: '2024-04-28', [species]: gap === null ? 2 : 1 }
        ])
      }
    }
    const media = await getMediaForSequencePagination(f.dbPath, {
      timeRange: { ranges: [{ start: 20, end: 21 }] }
    })
    assert.equal(media.media.length, 2)
    const effort = validateDeploymentIntervals(await getDeploymentEffortRows(f.dbPath))
    assert.equal(effort.validDeploymentCount, 1)
    const hours = groupEffortByHour(effort.intervals)
    for (const hour of hours) assert.ok(Math.abs(hour - 1 / 24) < 1e-8)
    const history = after.prepare('SELECT * FROM __drizzle_migrations').all()
    const rows = after.prepare('SELECT * FROM media').all()
    assert.equal((await migrateStudyDatabase(f.id, f.dbPath, migrationsPath)).success, true)
    assert.deepEqual(after.prepare('SELECT * FROM __drizzle_migrations').all(), history)
    assert.deepEqual(after.prepare('SELECT * FROM media').all(), rows)
  })
}

test('retained positive/negative offsets determine local time without changing instants', async (t) => {
  const f = fixture(t)
  f.db.exec(`
    INSERT INTO deployments (deploymentID, deploymentStart, deploymentEnd) VALUES
      ('east', '2024-05-01T00:00:00+02:00', '2024-05-02T00:00:00+02:00'),
      ('west', '2024-05-01T00:00:00-05:30', '2024-05-02T00:00:00-05:30');
    INSERT INTO media (mediaID, deploymentID, timestamp) VALUES
      ('east', 'east', '2024-05-01T22:30:00+02:00'),
      ('west', 'west', '2024-05-01T22:30:00-05:30');
    INSERT INTO observations (observationID, mediaID, deploymentID, eventStart, scientificName)
      SELECT mediaID, mediaID, deploymentID, timestamp, '${species}' FROM media;
  `)
  const instants = f.db
    .prepare('SELECT mediaID, julianday(timestamp) AS instant FROM media ORDER BY mediaID')
    .all()
  f.toVersion(17)
  await f.upgrade()
  const after = f.read()
  assert.deepEqual(
    after
      .prepare('SELECT mediaID, julianday(timestamp) AS instant FROM media ORDER BY mediaID')
      .all(),
    instants
  )
  assert.deepEqual(
    after
      .prepare('SELECT timestamp, sourceTimestamp, localTimestamp FROM media ORDER BY mediaID')
      .all(),
    [
      {
        timestamp: '2024-05-01T20:30:00.000Z',
        sourceTimestamp: '2024-05-01T22:30:00+02:00',
        localTimestamp: '2024-05-01T22:30:00.000'
      },
      {
        timestamp: '2024-05-02T04:00:00.000Z',
        sourceTimestamp: '2024-05-01T22:30:00-05:30',
        localTimestamp: '2024-05-01T22:30:00.000'
      }
    ]
  )
  assert.deepEqual(
    await getSequenceAwareDailyActivitySQL(
      f.dbPath,
      [species],
      '2024-05-01T00:00:00.000Z',
      '2024-05-03T00:00:00.000Z',
      null
    ),
    [{ scientificName: species, hour: 22, count: 2 }]
  )
})

test('floating, invalid and missing values are retained without inventing UTC instants', async (t) => {
  const f = fixture(t)
  f.db.exec(`
    INSERT INTO deployments (deploymentID, deploymentStart, deploymentEnd) VALUES ('floating', '2024-05-01 00:00:00', '2024-05-02 00:00:00');
    INSERT INTO media (mediaID, deploymentID, timestamp) VALUES
      ('floating', 'floating', '2024-05-01 22:30:00'),
      ('invalid', NULL, 'not a date'), ('missing', NULL, NULL);
    INSERT INTO observations (observationID, mediaID, deploymentID, eventStart, eventEnd)
      VALUES ('o', 'floating', 'floating', '2024-05-01 22:30:00', '2024-05-01 22:30:20');
  `)
  await f.upgrade()
  const after = f.read()
  assert.deepEqual(
    after
      .prepare('SELECT timestamp, sourceTimestamp, localTimestamp FROM media ORDER BY mediaID')
      .all(),
    [
      {
        timestamp: null,
        sourceTimestamp: '2024-05-01 22:30:00',
        localTimestamp: '2024-05-01T22:30:00.000'
      },
      { timestamp: null, sourceTimestamp: 'not a date', localTimestamp: null },
      { timestamp: null, sourceTimestamp: null, localTimestamp: null }
    ]
  )
  assert.deepEqual(
    after
      .prepare(
        'SELECT deploymentStart, deploymentEnd, sourceDeploymentStart, sourceDeploymentEnd FROM deployments'
      )
      .get(),
    {
      deploymentStart: null,
      deploymentEnd: null,
      sourceDeploymentStart: '2024-05-01 00:00:00',
      sourceDeploymentEnd: '2024-05-02 00:00:00'
    }
  )
  assert.deepEqual(
    after
      .prepare('SELECT eventStart, eventEnd, sourceEventStart, sourceEventEnd FROM observations')
      .get(),
    {
      eventStart: null,
      eventEnd: null,
      sourceEventStart: '2024-05-01 22:30:00',
      sourceEventEnd: '2024-05-01 22:30:20'
    }
  )
})

test('mixed old/new data preserves source offsets, clock settings and completed new rows', async (t) => {
  const f = fixture(t)
  seedUtc(f.db)
  f.toVersion(17)
  f.db
    .exec(`INSERT INTO deployments (deploymentID, sourceDeploymentStart, sourceDeploymentEnd, cameraTimeZone)
      VALUES ('new', '2024-05-01 00:00:00', '2024-05-02 00:00:00', 'UTC+02:00');
    INSERT INTO media (mediaID, deploymentID, sourceTimestamp, favorite)
      VALUES ('new', 'new', '2024-05-01T22:30:00+02:00', 1);
    INSERT INTO observations (observationID, mediaID, deploymentID, sourceEventStart, sourceEventEnd, scientificName)
      VALUES ('new', 'new', 'new', '2024-05-01T22:30:00+02:00', '2024-05-01T22:30:10+02:00', '${species}');
    INSERT INTO media (mediaID, deploymentID, sourceTimestamp)
      VALUES ('partial', 'new', '2024-05-01T23:30:00+02:00');
    UPDATE media SET localTimestamp = NULL WHERE mediaID = 'partial';`)
  const newRows = {
    deployment: f.db.prepare("SELECT * FROM deployments WHERE deploymentID = 'new'").get(),
    media: f.db.prepare("SELECT * FROM media WHERE mediaID = 'new'").get(),
    observation: f.db.prepare("SELECT * FROM observations WHERE observationID = 'new'").get()
  }
  await f.upgrade()
  const after = f.read()
  assert.deepEqual(
    after.prepare("SELECT * FROM deployments WHERE deploymentID = 'new'").get(),
    newRows.deployment
  )
  assert.deepEqual(after.prepare("SELECT * FROM media WHERE mediaID = 'new'").get(), newRows.media)
  assert.deepEqual(
    after.prepare("SELECT * FROM observations WHERE observationID = 'new'").get(),
    newRows.observation
  )
  assert.equal(
    after.prepare("SELECT localTimestamp FROM media WHERE mediaID = 'partial'").get()
      .localTimestamp,
    '2024-05-01T23:30:00.000'
  )
  assert.equal(
    after.prepare("SELECT cameraTimeZone FROM deployments WHERE deploymentID = 'd'").get()
      .cameraTimeZone,
    null
  )
  assert.equal(
    after.prepare("SELECT sourceTimestamp FROM media WHERE mediaID = 'a'").get().sourceTimestamp,
    '2024-05-01T20:30:00Z'
  )
})

for (const alreadyAt17 of [false, true]) {
  test(`backfill failure rolls back all pending changes (${alreadyAt17 ? '0017 already applied' : '0017 also pending'})`, async (t) => {
    const f = fixture(t)
    seedUtc(f.db)
    if (alreadyAt17) f.toVersion(17)
    const beforeDeployments = f.db.prepare('SELECT * FROM deployments').all()
    const beforeMedia = f.db.prepare('SELECT * FROM media').all()
    const beforeObservations = f.db.prepare('SELECT * FROM observations').all()
    const beforeHistory = f.db.prepare('SELECT * FROM __drizzle_migrations').all()
    // Abort after deployment/media backfill has started, proving the whole
    // pending transaction (including 0017, when pending) is rolled back.
    f.db.exec(
      "CREATE TRIGGER fail_backfill BEFORE UPDATE ON observations BEGIN SELECT RAISE(ABORT, 'deliberate backfill failure'); END"
    )
    f.db.close()
    const result = await migrateStudyDatabase(f.id, f.dbPath, migrationsPath)
    assert.equal(result.success, false)
    assert.match(result.database.message, /deliberate backfill failure/)
    const after = f.read()
    assert.deepEqual(after.prepare('SELECT * FROM deployments').all(), beforeDeployments)
    assert.deepEqual(after.prepare('SELECT * FROM media').all(), beforeMedia)
    assert.deepEqual(after.prepare('SELECT * FROM observations').all(), beforeObservations)
    assert.deepEqual(after.prepare('SELECT * FROM __drizzle_migrations').all(), beforeHistory)
  })
}
