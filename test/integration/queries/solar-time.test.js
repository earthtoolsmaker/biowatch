import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SunCalc from 'suncalc'
import { Worker } from 'node:worker_threads'
import {
  createImageDirectoryDatabase,
  getSequenceAwareDailyActivitySQL,
  getSequenceAwareHeatmapSQL,
  getSpeciesHeatmapDataByMedia,
  getMediaForSequencePagination,
  hasTimestampedMedia,
  getDeploymentEffortRows
} from '../../../src/main/database/index.js'
import { closeStudyDatabase } from '../../../src/main/database/manager.js'
import { solarHours } from '../../../src/main/services/solarTime.js'
import { getPaginatedSequences } from '../../../src/main/services/sequences/pagination.js'
import {
  groupEffortByHour,
  sumTotalEffort,
  validateDeploymentIntervals
} from '../../../src/main/services/sequences/effort.js'

let root, dbPath, manager
const species = ['Vulpes vulpes']
const lat = 48,
  lon = 2
let noon
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'biowatch-solar-'))
  const dir = join(root, 'studies', 'solar-fixture')
  mkdirSync(dir, { recursive: true })
  dbPath = join(dir, 'study.db')
  manager = await createImageDirectoryDatabase(dbPath)
  const db = manager.getSqlite()
  db.prepare(
    `INSERT INTO deployments (deploymentID, latitude, longitude, deploymentStart, deploymentEnd)
    VALUES (?, ?, ?, '2024-06-17T00:00:00Z', '2024-07-01T00:00:00Z')`
  ).run('d', lat, lon)
  for (const [id, a, b] of [
    ['missing', null, null],
    ['polar', 89, 0],
    ['invalid', 91, 0]
  ])
    db.prepare(`INSERT INTO deployments (deploymentID, latitude, longitude) VALUES (?, ?, ?)`).run(
      id,
      a,
      b
    )
  const times = SunCalc.getTimes(new Date('2024-06-21T12:00:00Z'), lat, lon)
  noon = new Date((+times.sunrise + +times.sunset) / 2).toISOString()
  const media = db.prepare(
    `INSERT INTO media (mediaID, deploymentID, sourceTimestamp, filePath) VALUES (?, ?, ?, ?)`
  )
  const obs = db.prepare(
    `INSERT INTO observations (observationID, mediaID, scientificName, observationType, eventID) VALUES (?, ?, ?, 'animal', ?)`
  )
  const add = (id, deployment, ts, n = 1) => {
    media.run(id, deployment, ts, `${id}.jpg`)
    for (let i = 0; i < n; i++) obs.run(`${id}-${i}`, id, species[0], `event-${id}`)
  }
  add('noon', 'd', noon, 2)
  add('final-week', 'd', '2024-06-30T20:00:00Z')
  add('missing', 'missing', noon)
  add('polar', 'polar', noon)
  add('invalid', 'invalid', noon)
  add('floating', 'd', '2024-06-21T12:00:00')
})
afterEach(async () => {
  await closeStudyDatabase('solar-fixture', dbPath)
  rmSync(root, { recursive: true, force: true })
})

for (const counting of ['individuals', 'observations'])
  for (const gap of [null, 0, 60]) {
    test(`same solar bin in chart, gallery and heatmap: ${counting}, gap=${gap}`, async () => {
      const hour = Math.floor(solarHours(noon, lat, lon))
      const rows = await getSequenceAwareDailyActivitySQL(
        dbPath,
        species,
        undefined,
        undefined,
        gap,
        null,
        counting,
        false,
        'solar'
      )
      assert.equal(rows.find((r) => r.hour === hour)?.count, counting === 'individuals' ? 2 : 1)
      assert.equal(
        rows.reduce((n, r) => n + r.count, 0),
        counting === 'individuals' ? 3 : 2
      )
      const timeRange = { mode: 'solar', ranges: [{ start: hour, end: hour + 1 }] }
      const gallery = await getMediaForSequencePagination(dbPath, { species, timeRange })
      assert.deepEqual(
        gallery.media.map((m) => m.mediaID),
        ['noon']
      )
      assert.equal(gallery.hasMoreNull, false)
      assert.equal(await hasTimestampedMedia(dbPath, { species, timeRange }), true)
      const heat = await getSequenceAwareHeatmapSQL(
        dbPath,
        species,
        undefined,
        undefined,
        timeRange,
        true,
        gap,
        counting
      )
      assert.equal(
        heat.reduce((n, r) => n + r.count, 0),
        counting === 'individuals' ? 2 : 1
      )
      const fallback = await getSpeciesHeatmapDataByMedia(
        dbPath,
        species,
        undefined,
        undefined,
        timeRange,
        true
      )
      assert.deepEqual(
        fallback.map((r) => r.mediaID),
        ['noon']
      )
    })
  }

test('one sequence spanning adjacent solar bins contributes to both bins without changing UTC gaps', async () => {
  const db = manager.getSqlite()
  const events = SunCalc.getTimes(new Date('2024-06-21T12:00:00Z'), lat, lon)
  const boundary = (+events.sunrise + +events.sunset) / 2
  db.prepare("DELETE FROM observations WHERE mediaID = 'noon'").run()
  db.prepare("DELETE FROM media WHERE mediaID = 'noon'").run()
  for (const [id, ms, count] of [
    ['before', boundary - 10000, 3],
    ['after', boundary + 10000, 2]
  ]) {
    db.prepare("INSERT INTO media (mediaID, deploymentID, sourceTimestamp) VALUES (?, 'd', ?)").run(
      id,
      new Date(ms).toISOString()
    )
    for (let i = 0; i < count; i++)
      db.prepare(
        "INSERT INTO observations (observationID, mediaID, scientificName, eventID) VALUES (?, ?, ?, 'same-event')"
      ).run(`${id}-${i}`, id, species[0])
  }
  for (const counting of ['individuals', 'observations'])
    for (const gap of [0, 60]) {
      const rows = await getSequenceAwareDailyActivitySQL(
        dbPath,
        species,
        '2024-06-21T00:00:00.000Z',
        '2024-06-22T00:00:00.000Z',
        gap,
        null,
        counting,
        false,
        'solar'
      )
      assert.equal(rows.find((r) => r.hour === 11).count, counting === 'individuals' ? 3 : 1)
      assert.equal(rows.find((r) => r.hour === 12).count, counting === 'individuals' ? 2 : 1)
    }
})

test('All time includes final week, one-week data, and clipping stays absolute', async () => {
  const daily = (start, end) => getSequenceAwareDailyActivitySQL(dbPath, species, start, end, null)
  assert.equal(
    (await daily()).reduce((n, r) => n + r.count, 0),
    6
  )
  assert.equal(
    (await daily('2024-06-30T00:00:00.000Z', '2024-06-30T23:59:59.999Z')).reduce(
      (n, r) => n + r.count,
      0
    ),
    1
  )
  manager.getSqlite().prepare("DELETE FROM observations WHERE mediaID = 'final-week'").run()
  manager.getSqlite().prepare("DELETE FROM media WHERE mediaID = 'final-week'").run()
  assert.ok((await daily()).length > 0)
})

test('unavailable media remain unfiltered but not in active solar filters or null cursors', async () => {
  const all = await getPaginatedSequences(dbPath, {
    gapSeconds: 0,
    limit: 100,
    filters: { timeRange: { mode: 'solar', ranges: [] } }
  })
  const next = await getPaginatedSequences(dbPath, {
    gapSeconds: 0,
    limit: 100,
    cursor: all.nextCursor,
    filters: { timeRange: { mode: 'solar', ranges: [] } }
  })
  assert.equal([...all.sequences, ...next.sequences].flatMap((s) => s.items).length, 6)
  const filters = { timeRange: { mode: 'solar', ranges: [{ start: 0, end: 24 }] } }
  const filtered = await getPaginatedSequences(dbPath, { gapSeconds: 0, limit: 100, filters })
  assert.equal(filtered.sequences.flatMap((s) => s.items).length, 2)
  const nulls = await getPaginatedSequences(dbPath, {
    gapSeconds: 0,
    limit: 100,
    cursor: Buffer.from(JSON.stringify({ phase: 'null', offset: 0 })).toString('base64'),
    filters
  })
  assert.equal(nulls.sequences.length, 0)
})

test('solar multi-range union and wraparound agree with continuous conversion', async () => {
  const ranges = [
    { start: 18, end: 6 },
    { start: 11.5, end: 12.5 }
  ]
  const gallery = await getMediaForSequencePagination(dbPath, {
    timeRange: { mode: 'solar', ranges }
  })
  const expected = ['noon', 'final-week'].filter((id) => {
    const ts = id === 'noon' ? noon : '2024-06-30T20:00:00.000Z'
    const h = solarHours(ts, lat, lon)
    return h >= 18 || h < 6 || (h >= 11.5 && h < 12.5)
  })
  assert.deepEqual(gallery.media.map((m) => m.mediaID).sort(), expected.sort())
})

test('worker RAI sums real solar exposure, clips absolute dates, and preserves overall rates', async () => {
  const startDate = '2024-06-20T00:00:00.000Z'
  const endDate = '2024-06-22T00:00:00.000Z'
  const db = manager.getSqlite()
  db.exec(`INSERT INTO deployments (deploymentID, latitude, longitude, deploymentStart, deploymentEnd)
    VALUES ('south', -34, 18, '2024-06-21T00:00:00Z', '2024-06-22T00:00:00Z')`)
  db.prepare(
    "INSERT INTO media (mediaID, deploymentID, sourceTimestamp) VALUES ('south', 'south', ?)"
  ).run(noon)
  db.prepare(
    "INSERT INTO observations (observationID, mediaID, scientificName) VALUES ('south', 'south', ?)"
  ).run(species[0])
  const run = (timeMode, counting) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL('../../../src/main/services/sequences/worker.js', import.meta.url),
        {
          workerData: {
            type: 'daily-activity',
            dbPath,
            studyId: 'solar-fixture',
            speciesNames: species,
            gapSeconds: null,
            startDate,
            endDate,
            timeMode,
            metric: { counting, normalization: 'RAI100' }
          }
        }
      )
      worker.once('error', reject)
      worker.once('message', (result) =>
        result.error ? reject(new Error(result.error)) : resolve(result.data)
      )
    })
  for (const counting of ['individuals', 'observations']) {
    const clock = await run('clock', counting)
    const solar = await run('solar', counting)
    const totals = (rows) => ({
      count: rows.reduce((n, r) => n + r.rawCounts[species[0]], 0),
      exposure: rows.reduce((n, r) => n + r.effortDays, 0)
    })
    assert.equal(totals(solar).count, counting === 'individuals' ? 3 : 2)
    assert.ok(Math.abs(totals(solar).exposure - 3) < 1e-8)
    assert.equal(totals(clock).count, totals(solar).count)
    assert.ok(Math.abs(totals(clock).exposure - totals(solar).exposure) < 1e-8)
    const expectedExposure = groupEffortByHour(
      validateDeploymentIntervals(await getDeploymentEffortRows(dbPath), { timeMode: 'solar' })
        .intervals,
      { timeMode: 'solar', start: startDate, end: endDate }
    )
    for (const bin of solar) {
      assert.equal(bin.effortDays, expectedExposure[bin.hour])
      assert.equal(bin[species[0]], (100 * bin.rawCounts[species[0]]) / bin.effortDays)
      assert.equal(bin.excludedDeploymentCount, 3)
    }
  }
})

test('active solar heatmap RAI uses matching continuous real exposure, independent of camera clock eligibility', async () => {
  manager
    .getSqlite()
    .prepare(
      "UPDATE deployments SET cameraTimeZone = 'America/Los_Angeles' WHERE deploymentID = 'd'"
    )
    .run()
  const timeRange = {
    mode: 'solar',
    ranges: [
      { start: 11.5, end: 12.5 },
      { start: 12, end: 12.25 }
    ]
  }
  const startDate = '2024-06-20T00:00:00.000Z',
    endDate = '2024-06-22T00:00:00.000Z'
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../../../src/main/services/sequences/worker.js', import.meta.url),
      {
        workerData: {
          type: 'heatmap',
          dbPath,
          studyId: 'solar-fixture',
          speciesNames: species,
          gapSeconds: 60,
          startDate,
          endDate,
          timeRange,
          includeNullTimestamps: true,
          metric: { counting: 'individuals', normalization: 'RAI100' }
        }
      }
    )
    worker.once('error', reject)
    worker.once('message', (result) =>
      result.error ? reject(new Error(result.error)) : resolve(result.data)
    )
  })
  const validated = validateDeploymentIntervals(await getDeploymentEffortRows(dbPath), {
    timeMode: 'solar'
  })
  const exposure = sumTotalEffort(validated.intervals, {
    start: startDate,
    end: endDate,
    timeRange
  })
  assert.equal(result.locations.length, 1)
  const site = result.locations[0]
  assert.equal(site.rawCounts[species[0]], 2)
  assert.equal(site.effortDays, exposure)
  assert.equal(site.values[species[0]], 200 / exposure)
})

test('eligible RAI counts and total real exposure agree across modes', async () => {
  const effortRows = await getDeploymentEffortRows(dbPath)
  const clock = validateDeploymentIntervals(effortRows)
  const solar = validateDeploymentIntervals(effortRows, { timeMode: 'solar' })
  const hours = groupEffortByHour(solar.intervals, { timeMode: 'solar' })
  assert.ok(Math.abs(hours.reduce((a, b) => a + b, 0) - sumTotalEffort(clock.intervals)) < 1e-8)
  for (const mode of ['clock', 'solar']) {
    const rows = await getSequenceAwareDailyActivitySQL(
      dbPath,
      species,
      undefined,
      undefined,
      null,
      null,
      'individuals',
      true,
      mode
    )
    assert.equal(
      rows.reduce((n, r) => n + r.count, 0),
      3
    )
  }
})
