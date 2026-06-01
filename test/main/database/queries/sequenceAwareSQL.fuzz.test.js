/**
 * Randomized parity fuzz: for many seeded-random studies and several gap
 * values, assert the SQL aggregates exactly match the JS reference pipeline for
 * BOTH species-distribution and timeseries. Exercises edge-case interactions
 * (gap boundaries × videos × deployment changes × null timestamps × multi-row
 * per-media counts × week boundaries) that hand-written fixtures miss.
 *
 * Deterministic: a seeded PRNG makes any failure reproducible from the seed
 * printed in the assertion label.
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
  getSpeciesDistributionByMedia,
  getSpeciesTimeseriesByMedia,
  getSequenceAwareSpeciesCountsSQL,
  getSequenceAwareTimeseriesSQL
} from '../../../../src/main/database/index.js'
import {
  calculateSequenceAwareSpeciesCounts,
  calculateSequenceAwareTimeseries
} from '../../../../src/main/services/sequences/speciesCounts.js'

let testBiowatchDataPath
let testDbPath
let testStudyId

beforeEach(async () => {
  try {
    const log = (await import('electron-log')).default
    log.transports.file.level = false
    log.transports.console.level = false
  } catch {
    /* ignore */
  }
  testStudyId = `fuzz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testBiowatchDataPath = join(tmpdir(), 'biowatch-fuzz-test', testStudyId)
  testDbPath = join(testBiowatchDataPath, 'studies', testStudyId, 'study.db')
  mkdirSync(join(testBiowatchDataPath, 'studies', testStudyId), { recursive: true })
})

afterEach(() => {
  if (existsSync(testBiowatchDataPath))
    rmSync(testBiowatchDataPath, { recursive: true, force: true })
})

// mulberry32 — small deterministic PRNG.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SPECIES = ['Deer', 'Fox', 'Boar', 'Hare', 'Badger']
const DEPLOYMENTS = ['d1', 'd2', 'd3']
// Base time near a Sunday week boundary so bursts straddle weeks sometimes.
const BASE = DateTime.fromISO('2024-01-05T12:00:00Z')

function genStudy(rand) {
  const deployments = {}
  for (const id of DEPLOYMENTS) {
    deployments[id] = {
      deploymentID: id,
      locationID: `loc-${id}`,
      locationName: id,
      deploymentStart: DateTime.fromISO('2024-01-01T00:00:00Z'),
      deploymentEnd: DateTime.fromISO('2024-02-01T00:00:00Z'),
      latitude: 0,
      longitude: 0
    }
  }

  const media = {}
  const observations = []
  const videoIds = []
  const nMedia = 40 + Math.floor(rand() * 50)
  for (let i = 0; i < nMedia; i++) {
    const id = `m${i}`
    const isNull = rand() < 0.12
    const isVideo = rand() < 0.1
    // Spread over ~6 days in tight-ish clusters so gaps cross thresholds.
    const offsetSec = Math.floor(rand() * 6 * 24 * 3600)
    const ts = isNull ? null : BASE.plus({ seconds: offsetSec })
    media[`${id}.x`] = {
      mediaID: id,
      deploymentID: DEPLOYMENTS[Math.floor(rand() * DEPLOYMENTS.length)],
      timestamp: ts,
      filePath: `p/${id}`,
      fileName: `${id}.x`,
      importFolder: 'p',
      folderName: 'f'
    }
    if (isVideo) videoIds.push(id)
    // 1-3 distinct species on this media, each with a random per-media count.
    const k = 1 + Math.floor(rand() * 3)
    const used = new Set()
    for (let s = 0; s < k; s++) {
      const sp = SPECIES[Math.floor(rand() * SPECIES.length)]
      if (used.has(sp)) continue
      used.add(sp)
      const cnt = 1 + Math.floor(rand() * 4)
      for (let c = 0; c < cnt; c++) {
        observations.push({
          observationID: `${id}-${sp}-${c}`,
          mediaID: id,
          deploymentID: media[`${id}.x`].deploymentID,
          eventID: null,
          scientificName: sp,
          count: 1
        })
      }
    }
  }
  return { deployments, media, observations, videoIds }
}

async function seed(dbPath, study) {
  const manager = await createImageDirectoryDatabase(dbPath)
  await insertDeployments(manager, study.deployments)
  await insertMedia(manager, study.media)
  await insertObservations(manager, study.observations)
  // insertMedia drops fileMediatype, so mark videos via raw SQL.
  for (const id of study.videoIds) {
    manager
      .getSqlite()
      .prepare('UPDATE media SET fileMediatype = ? WHERE mediaID = ?')
      .run('video/mp4', id)
  }
  return manager
}

const normCounts = (arr) =>
  [...arr]
    .map((r) => ({ s: r.scientificName, c: Number(r.count) }))
    .sort((a, b) => a.s.localeCompare(b.s))

const normTsSql = (rows) =>
  rows.map((r) => `${r.weekStart}|${r.scientificName}=${Number(r.count)}`).sort()
const normTsJs = (js) => {
  const out = []
  for (const wk of js.timeseries)
    for (const [k, v] of Object.entries(wk))
      if (k !== 'date') out.push(`${wk.date}|${k}=${Number(v)}`)
  return out.sort()
}

describe('sequence-aware SQL — randomized parity vs JS reference', () => {
  const GAPS = [null, 0, 30, 90, 300, 3600, 86400]
  const TRIALS = Number(process.env.FUZZ_TRIALS) || 12

  for (let trial = 0; trial < TRIALS; trial++) {
    test(`trial ${trial}`, async () => {
      const seed1 = 1000 + trial * 7919
      const rand = rng(seed1)
      await seed(testDbPath, genStudy(rand))

      const rawDist = await getSpeciesDistributionByMedia(testDbPath)
      const rawTs = await getSpeciesTimeseriesByMedia(testDbPath, [])

      for (const gap of GAPS) {
        // species-distribution
        const sqlD = await getSequenceAwareSpeciesCountsSQL(testDbPath, gap)
        const jsD = calculateSequenceAwareSpeciesCounts(rawDist, gap)
        assert.deepEqual(
          normCounts(sqlD),
          normCounts(jsD),
          `species-distribution mismatch: seed=${seed1} gap=${gap}`
        )

        // timeseries
        const sqlT = await getSequenceAwareTimeseriesSQL(testDbPath, [], gap)
        const jsT = calculateSequenceAwareTimeseries(rawTs, gap)
        assert.deepEqual(
          normTsSql(sqlT),
          normTsJs(jsT),
          `timeseries mismatch: seed=${seed1} gap=${gap}`
        )
      }
    })
  }
})
