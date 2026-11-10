// Temporary, synthetic study only. Run with the Node-compatible SQLite build:
// node test/benchmark/solar-time.js [number-of-media]
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { performance } from 'node:perf_hooks'
import { createImageDirectoryDatabase } from '../../src/main/database/index.js'
import { closeStudyDatabase } from '../../src/main/database/manager.js'

const size = Number(process.argv[2] || 100000)
assert.ok(Number.isSafeInteger(size) && size > 0)
const root = mkdtempSync(join(tmpdir(), 'biowatch-solar-benchmark-'))
const dir = join(root, 'studies', 'solar-benchmark')
mkdirSync(dir, { recursive: true })
const dbPath = join(dir, 'study.db')
const species = 'Vulpes vulpes'
try {
  const manager = await createImageDirectoryDatabase(dbPath)
  const db = manager.getSqlite()
  db.exec(`INSERT INTO deployments (deploymentID, latitude, longitude, deploymentStart, deploymentEnd)
    VALUES ('d', 48, 2, '2024-01-01T00:00:00Z', '2025-01-01T00:00:00Z')`)
  const media = db.prepare(
    `INSERT INTO media (mediaID, deploymentID, sourceTimestamp) VALUES (?, 'd', ?)`
  )
  const obs = db.prepare(
    `INSERT INTO observations (observationID, mediaID, deploymentID, scientificName) VALUES (?, ?, 'd', ?)`
  )
  db.transaction(() => {
    for (let i = 0; i < size; i++) {
      const id = `m${i}`
      media.run(id, new Date(Date.UTC(2024, 0, 1) + i * ((365 * 86400000) / size)).toISOString())
      obs.run(`o${i}`, id, species)
    }
  })()
  for (const timeMode of ['clock', 'solar']) {
    const start = performance.now()
    const rows = await new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL('../../src/main/services/sequences/worker.js', import.meta.url),
        {
          workerData: {
            type: 'daily-activity',
            dbPath,
            studyId: 'solar-benchmark',
            speciesNames: [species],
            gapSeconds: null,
            timeMode,
            metric: { counting: 'individuals', normalization: 'RAI100' }
          }
        }
      )
      worker.once('error', reject)
      worker.once('message', (result) =>
        result.error ? reject(new Error(result.error)) : resolve(result.data)
      )
    })
    const count = rows.reduce((n, row) => n + row.rawCounts[species], 0)
    const days = rows.reduce((n, row) => n + row.effortDays, 0)
    assert.equal(count, size)
    assert.ok(Math.abs(days - 366) < 1e-8)
    console.log(
      JSON.stringify({
        timeMode,
        media: size,
        elapsedMs: Math.round(performance.now() - start),
        outputRows: rows.length,
        count,
        effortDays: days
      })
    )
  }
} finally {
  await closeStudyDatabase('solar-benchmark', dbPath)
  rmSync(root, { recursive: true, force: true })
}
