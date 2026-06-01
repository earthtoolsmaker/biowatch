/**
 * Parity tests for the timeseries SQL-aggregate path vs the JS pipeline.
 *
 * For each fixture + gap value, assert that getSequenceAwareTimeseriesSQL
 * produces the same per-(week, species) counts as
 * calculateSequenceAwareTimeseries(getSpeciesTimeseriesByMedia(...), gap).
 *
 * The JS path groups observations by week FIRST, then sequence-groups the
 * global media stream within each week (not per species) — so a burst that
 * straddles a week boundary becomes two sequences. The SQL path mirrors that by
 * sequencing media partitioned on weekStart, then taking per-species MAX.
 */

import { test, beforeEach, afterEach, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DateTime } from 'luxon'

import {
  createImageDirectoryDatabase,
  insertDeployments,
  insertMedia,
  insertObservations,
  getSpeciesTimeseriesByMedia,
  getSequenceAwareTimeseriesSQL
} from '../../../../src/main/database/index.js'
import { calculateSequenceAwareTimeseries } from '../../../../src/main/services/sequences/speciesCounts.js'

let testDbPath
let testStudyId
let testBiowatchDataPath

beforeEach(async () => {
  try {
    const electronLog = await import('electron-log')
    const log = electronLog.default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    // not available, fine
  }
  testStudyId = `test-ts-agg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-ts-agg-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath)) {
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
  }
})

async function seed(dbPath, { deployments, media, observations }) {
  const manager = await createImageDirectoryDatabase(dbPath)
  await insertDeployments(manager, deployments)
  await insertMedia(manager, media)
  await insertObservations(manager, observations)
  return manager
}

// Flatten the JS { timeseries: [{date, [sp]: n}], ... } shape into the flat
// `weekStart|species=count` keys the SQL path returns, for order-insensitive
// comparison.
function normFromJs(jsResult) {
  const out = []
  for (const week of jsResult.timeseries) {
    for (const [k, v] of Object.entries(week)) {
      if (k === 'date') continue
      out.push(`${week.date}|${k}=${Number(v)}`)
    }
  }
  return out.sort()
}

function normFromSql(rows) {
  return rows.map((r) => `${r.weekStart}|${r.scientificName}=${Number(r.count)}`).sort()
}

async function assertTsParity(dbPath, speciesNames, gapSeconds, label) {
  const raw = await getSpeciesTimeseriesByMedia(dbPath, speciesNames)
  const js = calculateSequenceAwareTimeseries(raw, gapSeconds)
  const sql = await getSequenceAwareTimeseriesSQL(dbPath, speciesNames, gapSeconds)
  assert.notEqual(sql, null, `SQL path returned null (unhandled) for gap=${gapSeconds} (${label})`)
  assert.deepEqual(
    normFromSql(sql),
    normFromJs(js),
    `timeseries SQL vs JS parity mismatch for gap=${gapSeconds} (${label})`
  )
}

const dep = (id) => ({
  deploymentID: id,
  locationID: `loc-${id}`,
  locationName: id,
  deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
  deploymentEnd: DateTime.fromISO('2024-02-28T00:00:00Z'),
  latitude: 0,
  longitude: 0
})
const med = (id, deploymentID, iso) => ({
  mediaID: id,
  deploymentID,
  timestamp: iso ? DateTime.fromISO(iso) : null,
  filePath: `p/${id}.jpg`,
  fileName: `${id}.jpg`,
  importFolder: 'p',
  folderName: 'f'
})
const obs = (mediaID, deploymentID, scientificName, cnt) =>
  Array.from({ length: cnt }, (_, i) => ({
    observationID: `${mediaID}-${scientificName}-${i}`,
    mediaID,
    deploymentID,
    eventID: null,
    scientificName,
    count: 1
  }))

describe('getSequenceAwareTimeseriesSQL — positive-gap parity with JS pipeline', () => {
  test('within-week time-gap split', async () => {
    await seed(testDbPath, {
      deployments: { d1: dep('d1') },
      media: {
        'm1.jpg': med('m1', 'd1', '2024-01-09T10:00:00Z'),
        'm2.jpg': med('m2', 'd1', '2024-01-09T10:00:30Z'),
        'm3.jpg': med('m3', 'd1', '2024-01-09T10:05:00Z')
      },
      observations: [
        ...obs('m1', 'd1', 'Deer', 2),
        ...obs('m2', 'd1', 'Deer', 5),
        ...obs('m3', 'd1', 'Deer', 3)
      ]
    })
    await assertTsParity(testDbPath, [], 120, 'within-week split')
    await assertTsParity(testDbPath, [], 20, 'within-week singletons')
  })

  test('burst across a week boundary splits into per-week sequences', async () => {
    // 2024-01-07 is a Sunday → start of a new week for date(.., 'weekday 0','-7 days').
    await seed(testDbPath, {
      deployments: { d1: dep('d1') },
      media: {
        'm1.jpg': med('m1', 'd1', '2024-01-06T23:59:30Z'), // Saturday, week A
        'm2.jpg': med('m2', 'd1', '2024-01-07T00:00:30Z') // Sunday, week B (60s later)
      },
      observations: [...obs('m1', 'd1', 'Deer', 4), ...obs('m2', 'd1', 'Deer', 6)]
    })
    // Within gap=120 by time, but different weeks → two sequences → week A=4, week B=6.
    await assertTsParity(testDbPath, [], 120, 'week-spanning burst')
  })

  test('species filter under positive gap', async () => {
    await seed(testDbPath, {
      deployments: { d1: dep('d1') },
      media: {
        'm1.jpg': med('m1', 'd1', '2024-01-09T10:00:00Z'),
        'm2.jpg': med('m2', 'd1', '2024-01-09T10:00:30Z'),
        'm3.jpg': med('m3', 'd1', '2024-01-09T10:01:00Z')
      },
      observations: [
        ...obs('m1', 'd1', 'Deer', 2),
        ...obs('m2', 'd1', 'Fox', 5),
        ...obs('m3', 'd1', 'Deer', 3)
      ]
    })
    await assertTsParity(testDbPath, ['Deer'], 120, 'filter to Deer')
    await assertTsParity(testDbPath, [], 120, 'all species')
  })

  test('a media of another species bridges a time gap within a week (global)', async () => {
    // Same discriminator as the species-counts suite: m2(Fox) at t=50s bridges
    // the 100s Deer-to-Deer gap so all three are one sequence in the week.
    // Deer = max(2,3) = 3, not 2+3 = 5. Regression guard for global sequencing.
    await seed(testDbPath, {
      deployments: { d1: dep('d1') },
      media: {
        'm1.jpg': med('m1', 'd1', '2024-01-09T10:00:00Z'),
        'm2.jpg': med('m2', 'd1', '2024-01-09T10:00:50Z'),
        'm3.jpg': med('m3', 'd1', '2024-01-09T10:01:40Z')
      },
      observations: [
        ...obs('m1', 'd1', 'Deer', 2),
        ...obs('m2', 'd1', 'Fox', 1),
        ...obs('m3', 'd1', 'Deer', 3)
      ]
    })
    const sql = await getSequenceAwareTimeseriesSQL(testDbPath, [], 90)
    const deer = sql
      .filter((r) => r.scientificName === 'Deer')
      .reduce((a, r) => a + Number(r.count), 0)
    assert.equal(deer, 3, 'bridged → one sequence within the week')
    await assertTsParity(testDbPath, [], 90, 'cross-species bridge within week')
  })

  test('null-timestamp media excluded from timeseries', async () => {
    await seed(testDbPath, {
      deployments: { d1: dep('d1') },
      media: {
        'm1.jpg': med('m1', 'd1', '2024-01-09T10:00:00Z'),
        'm2.jpg': med('m2', 'd1', null)
      },
      observations: [...obs('m1', 'd1', 'Deer', 2), ...obs('m2', 'd1', 'Deer', 9)]
    })
    await assertTsParity(testDbPath, [], 120, 'null-ts excluded')
  })

  test('deployment boundary within a week never groups', async () => {
    await seed(testDbPath, {
      deployments: { d1: dep('d1'), d2: dep('d2') },
      media: {
        'm1.jpg': med('m1', 'd1', '2024-01-09T10:00:00Z'),
        'm2.jpg': med('m2', 'd2', '2024-01-09T10:00:10Z')
      },
      observations: [...obs('m1', 'd1', 'Deer', 2), ...obs('m2', 'd2', 'Deer', 5)]
    })
    await assertTsParity(testDbPath, [], 120, 'cross-deployment within week')
  })

  test('video boundary within a week never groups', async () => {
    const manager = await seed(testDbPath, {
      deployments: { d1: dep('d1') },
      media: {
        'm1.jpg': med('m1', 'd1', '2024-01-09T10:00:00Z'),
        'm2.mp4': med('m2', 'd1', '2024-01-09T10:00:05Z'),
        'm3.jpg': med('m3', 'd1', '2024-01-09T10:00:10Z')
      },
      observations: [
        ...obs('m1', 'd1', 'Deer', 2),
        ...obs('m2', 'd1', 'Deer', 7),
        ...obs('m3', 'd1', 'Deer', 3)
      ]
    })
    manager
      .getSqlite()
      .prepare("UPDATE media SET fileMediatype = 'video/mp4' WHERE mediaID = 'm2'")
      .run()
    await assertTsParity(testDbPath, [], 120, 'video isolated within week')
  })

  test('non-null but unparseable timestamps are excluded (no null-week row)', async () => {
    // insertMedia rejects bad timestamps (.toISO()), so corrupt them via raw SQL.
    const manager = await seed(testDbPath, {
      deployments: { d1: dep('d1') },
      media: {
        'm1.jpg': med('m1', 'd1', '2024-01-09T10:00:00Z'),
        'm2.jpg': med('m2', 'd1', '2024-01-09T10:00:30Z'),
        'm3.jpg': med('m3', 'd1', '2024-01-09T10:01:00Z')
      },
      observations: [
        ...obs('m1', 'd1', 'Deer', 2),
        ...obs('m2', 'd1', 'Deer', 9),
        ...obs('m3', 'd1', 'Deer', 4)
      ]
    })
    manager
      .getSqlite()
      .prepare("UPDATE media SET timestamp = 'not-a-date' WHERE mediaID = 'm2'")
      .run()
    manager.getSqlite().prepare("UPDATE media SET timestamp = '' WHERE mediaID = 'm3'").run()
    const sql = await getSequenceAwareTimeseriesSQL(testDbPath, [], 120)
    assert.equal(
      sql.filter((r) => r.weekStart == null).length,
      0,
      'must not emit weekStart=null rows for unparseable timestamps'
    )
    await assertTsParity(testDbPath, [], 120, 'unparseable timestamps excluded')
  })

  test('empty DB returns empty array for positive gap', async () => {
    await createImageDirectoryDatabase(testDbPath)
    const sql = await getSequenceAwareTimeseriesSQL(testDbPath, [], 120)
    assert.deepEqual(sql, [])
  })
})
