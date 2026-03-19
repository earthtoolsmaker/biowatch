/**
 * Benchmark script for CamTrap DP import performance.
 *
 * Usage:
 *   node test/benchmark/import-camtrapDP.js /path/to/extracted/camtrap-dp-directory
 *
 * The directory must contain datapackage.json plus deployments.csv, media.csv,
 * and/or observations.csv.
 */

import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// Suppress library logging (electron-log + console logger fallback)
try {
  const electronLog = await import('electron-log')
  electronLog.default.transports.file.level = false
  electronLog.default.transports.console.level = false
} catch {
  // electron-log not available
}
const noop = () => {}
console.info = noop
console.debug = noop
console.warn = noop

import { importCamTrapDatasetWithPath } from '../../src/main/services/import/parsers/camtrapDP.js'

const directoryPath = process.argv[2]

if (!directoryPath || !existsSync(directoryPath)) {
  console.error('Usage: node test/benchmark/import-camtrapDP.js <camtrap-dp-directory>')
  console.error('The directory must contain datapackage.json')
  process.exit(1)
}

if (!existsSync(join(directoryPath, 'datapackage.json'))) {
  console.error(`Error: datapackage.json not found in ${directoryPath}`)
  process.exit(1)
}

// Temp output directory for the database
const benchId = randomUUID()
const biowatchDataPath = join(tmpdir(), 'biowatch-bench', benchId)
mkdirSync(biowatchDataPath, { recursive: true })

// Track per-file timing
const fileTimings = {}
let currentFile = null
let currentFileStart = null

function onProgress(progress) {
  const { currentFile: file, phase, insertedRows, totalRows } = progress

  // Track file transitions
  if (file !== currentFile) {
    if (currentFile && currentFileStart) {
      fileTimings[currentFile] = {
        ...fileTimings[currentFile],
        durationMs: performance.now() - currentFileStart
      }
    }
    currentFile = file
    currentFileStart = performance.now()
    fileTimings[file] = { phase, insertedRows: 0, totalRows: 0 }
  }

  fileTimings[file].phase = phase
  fileTimings[file].insertedRows = insertedRows || fileTimings[file].insertedRows
  fileTimings[file].totalRows = totalRows || fileTimings[file].totalRows
}

console.log(`\nBenchmark: CamTrap DP import`)
console.log(`Directory: ${directoryPath}`)
console.log(`Output:    ${biowatchDataPath}`)
console.log(`---`)

const startTime = performance.now()

try {
  const result = await importCamTrapDatasetWithPath(
    directoryPath,
    biowatchDataPath,
    benchId,
    onProgress
  )

  // Close timing for the last file
  if (currentFile && currentFileStart) {
    fileTimings[currentFile] = {
      ...fileTimings[currentFile],
      durationMs: performance.now() - currentFileStart
    }
  }

  const totalMs = performance.now() - startTime

  console.log(`\nResults:`)
  console.log(`Total time: ${(totalMs / 1000).toFixed(2)}s`)
  console.log(``)

  for (const [file, timing] of Object.entries(fileTimings)) {
    const duration = timing.durationMs ? `${(timing.durationMs / 1000).toFixed(2)}s` : '?'
    const rows = timing.totalRows || timing.insertedRows || 0
    const rowsPerSec =
      timing.durationMs && rows ? Math.round(rows / (timing.durationMs / 1000)) : '-'
    console.log(`  ${file}: ${rows} rows in ${duration} (${rowsPerSec} rows/s)`)
  }

  console.log(`\nDatabase: ${result.dbPath}`)
} catch (error) {
  const totalMs = performance.now() - startTime
  console.error(`\nFailed after ${(totalMs / 1000).toFixed(2)}s:`, error.message)
  process.exit(1)
} finally {
  // Clean up
  if (existsSync(biowatchDataPath)) {
    rmSync(biowatchDataPath, { recursive: true, force: true })
  }
}
