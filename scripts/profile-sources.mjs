#!/usr/bin/env node
/**
 * Profile getSourcesData against real study databases.
 * Usage: node scripts/profile-sources.mjs <output-dir> <db1> [db2 ...]
 *
 * Writes one JSON file per DB into <output-dir> with the source rows
 * (deterministically sorted) and a duration_ms field. Diff before/after
 * to verify behavior preservation across optimization iterations.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, basename, dirname } from 'path'
import { getSourcesData } from '../src/main/database/queries/media.js'

const outDir = process.argv[2]
const dbPaths = process.argv.slice(3)
if (!outDir || dbPaths.length === 0) {
  console.error('usage: profile-sources.mjs <output-dir> <db...>')
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

// Silence electron-log if present
try {
  const mod = await import('electron-log')
  mod.default.transports.file.level = false
  mod.default.transports.console.level = false
} catch {
  /* not available outside electron, fine */
}

function studyId(dbPath) {
  // <root>/studies/<uuid>/study.db
  return basename(dirname(dbPath))
}

function canonicalize(rows) {
  // Sort sources by importFolder; within each, sort deployments by deploymentID.
  // Keep numeric/boolean fields as-is. We do NOT canonicalize values themselves —
  // any structural change between before/after will surface in the diff.
  return rows
    .slice()
    .sort((a, b) => String(a.importFolder).localeCompare(String(b.importFolder)))
    .map((s) => ({
      ...s,
      deployments: s.deployments
        .slice()
        .sort((x, y) => String(x.deploymentID).localeCompare(String(y.deploymentID)))
    }))
}

for (const dbPath of dbPaths) {
  const id = studyId(dbPath)
  const start = Date.now()
  let rows
  try {
    rows = await getSourcesData(dbPath)
  } catch (err) {
    console.error(`FAIL ${id}: ${err.message}`)
    writeFileSync(join(outDir, `${id}.error.txt`), err.stack || err.message)
    continue
  }
  const duration_ms = Date.now() - start
  const canonical = canonicalize(rows)
  writeFileSync(
    join(outDir, `${id}.json`),
    JSON.stringify({ duration_ms, sourceCount: canonical.length, sources: canonical }, null, 2)
  )
  console.log(`OK   ${id}  sources=${canonical.length}  ${duration_ms}ms`)
}
