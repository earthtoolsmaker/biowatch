/**
 * Benchmark the sequence-aware SQL aggregates against the real studies in the
 * local Biowatch data dir. Measures the positive-gap (time-gap window-function)
 * path that replaced the JS row-dump, plus null/0 for comparison.
 *
 * Requires better-sqlite3 built for Node (npm rebuild better-sqlite3).
 *
 * Usage:
 *   node scripts/bench-seq-sql.mjs [gapSeconds] [topN]
 */
import { readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

import {
  getSequenceAwareSpeciesCountsSQL,
  getSequenceAwareTimeseriesSQL
} from '../src/main/database/index.js'

const GAP = Number(process.argv[2] ?? 120)
const TOP_N = Number(process.argv[3] ?? 8)
const STUDIES = join(homedir(), '.config', 'biowatch', 'biowatch-data', 'studies')

// Silence electron-log so the benchmark output stays clean.
try {
  const log = (await import('electron-log')).default
  log.transports.file.level = false
  log.transports.console.level = false
} catch {
  /* not available */
}

function fmtBytes(n) {
  if (n > 1e9) return (n / 1e9).toFixed(1) + 'GB'
  if (n > 1e6) return (n / 1e6).toFixed(0) + 'MB'
  return (n / 1e3).toFixed(0) + 'KB'
}

async function timeIt(fn) {
  const t = process.hrtime.bigint()
  const rows = await fn()
  const ms = Number(process.hrtime.bigint() - t) / 1e6
  return { ms, n: rows?.length ?? 0 }
}

const dbs = readdirSync(STUDIES)
  .map((id) => ({ id, path: join(STUDIES, id, 'study.db') }))
  .filter((s) => existsSync(s.path))
  .map((s) => ({ ...s, size: statSync(s.path).size }))
  .sort((a, b) => b.size - a.size)
  .slice(0, TOP_N)

console.log(`Benchmarking ${dbs.length} studies, gap=${GAP}s (positive → window-function path)\n`)
console.log(
  [
    'study'.padEnd(10),
    'db'.padStart(6),
    'spDist(+gap)'.padStart(14),
    'timeseries(+gap)'.padStart(17),
    'spDist(0)'.padStart(11)
  ].join('  ')
)
console.log('-'.repeat(66))

for (const db of dbs) {
  try {
    // Cold then warm — report warm (second) run; FS cache makes the first noisy.
    await getSequenceAwareSpeciesCountsSQL(db.path, GAP)
    const sp = await timeIt(() => getSequenceAwareSpeciesCountsSQL(db.path, GAP))
    const ts = await timeIt(() => getSequenceAwareTimeseriesSQL(db.path, [], GAP))
    const sp0 = await timeIt(() => getSequenceAwareSpeciesCountsSQL(db.path, 0))
    console.log(
      [
        db.id.slice(0, 8).padEnd(10),
        fmtBytes(db.size).padStart(6),
        `${sp.ms.toFixed(0)}ms/${sp.n}`.padStart(14),
        `${ts.ms.toFixed(0)}ms/${ts.n}`.padStart(17),
        `${sp0.ms.toFixed(0)}ms`.padStart(11)
      ].join('  ')
    )
  } catch (e) {
    console.log(`${db.id.slice(0, 8).padEnd(10)}  ERROR: ${e.message}`)
  }
}
process.exit(0)
