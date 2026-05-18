#!/usr/bin/env node
/**
 * Build the IUCN link IDs into src/shared/speciesInfo/data.json.
 *
 * Reads assessments.csv from a gitignored IUCN bulk export folder, keeps
 * only the public identifiers for VU/EN/CR rows, and merges them into the
 * existing data.json. No rationale text or other Red List text fields are
 * written into the repo or the bundled app — see IUCN T&C section 4 and
 * the design doc at docs/specs/2026-05-02-iucn-rationale-overview-design.md.
 *
 * Usage:
 *   npm run iucn-link-id:build -- [--from <path>] [--version <id>]
 *
 *   --from <path>     IUCN export folder. Default: most recent
 *                     data/redlist_species_data_* folder.
 *   --version <id>    Source version label written to _iucnSourceVersion
 *                     (e.g. "2025-1"). Default: inferred from folder name,
 *                     else the folder's mtime as YYYY-MM-DD.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import csvParser from 'csv-parser'

import { buildAliasMap } from './lib/aliases.js'
import {
  parseRedlistRow,
  pickLatestPerTaxon,
  mergeIdsIntoSpeciesData,
  inferSourceVersion
} from './build-iucn-link-id.lib.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'data')
const OUTPUT_PATH = path.join(ROOT, 'src/shared/speciesInfo/data.json')

function parseArgs(argv) {
  const out = { from: null, version: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--from') out.from = argv[++i]
    else if (a === '--version') out.version = argv[++i]
    else throw new Error(`unknown flag: ${a}`)
  }
  return out
}

/**
 * Find the most recent data/redlist_species_data_* folder.
 * Folders are uuid-suffixed; we pick by mtime.
 */
function findLatestExport() {
  if (!fs.existsSync(DATA_DIR)) return null
  const candidates = fs
    .readdirSync(DATA_DIR)
    .filter((n) => n.startsWith('redlist_species_data_'))
    .map((n) => {
      const full = path.join(DATA_DIR, n)
      const stat = fs.statSync(full)
      return { name: n, full, mtime: stat.mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
  return candidates[0] || null
}

async function streamRows(csvPath) {
  return new Promise((resolve, reject) => {
    const rows = []
    fs.createReadStream(csvPath)
      .pipe(csvParser())
      .on('data', (row) => {
        const parsed = parseRedlistRow(row)
        if (parsed) rows.push(parsed)
      })
      .on('end', () => resolve(rows))
      .on('error', reject)
  })
}

function loadData() {
  const text = fs.readFileSync(OUTPUT_PATH, 'utf8')
  return JSON.parse(text)
}

function writeData(data) {
  // Sort keys alphabetically for stable diffs. Metadata keys (leading _)
  // sort first under standard string ordering.
  const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)))
  const tmp = `${OUTPUT_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, OUTPUT_PATH)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  let folder
  if (args.from) {
    const stat = fs.statSync(args.from)
    folder = { name: path.basename(args.from), full: args.from, mtime: stat.mtimeMs }
  } else {
    folder = findLatestExport()
    if (!folder) {
      console.error(
        `No IUCN export found at ${DATA_DIR}/redlist_species_data_*. ` +
          `Download a Red List bulk export (filtered to VU/EN/CR) from ` +
          `iucnredlist.org and place it in data/, or pass --from <path>.`
      )
      process.exit(1)
    }
  }

  const csvPath = path.join(folder.full, 'assessments.csv')
  if (!fs.existsSync(csvPath)) {
    console.error(`Missing assessments.csv in ${folder.full}`)
    process.exit(1)
  }

  console.log(`Reading ${csvPath}`)
  const rows = await streamRows(csvPath)
  console.log(`Parsed ${rows.length} VU/EN/CR rows from CSV`)

  const ids = pickLatestPerTaxon(rows)
  console.log(`Collapsed to ${ids.size} unique taxa`)

  const aliases = buildAliasMap()
  const data = loadData()
  const refreshedAt = new Date().toISOString().slice(0, 10)
  const sourceVersion = args.version || inferSourceVersion(folder)
  if (!args.version && sourceVersion === refreshedAt) {
    console.warn(
      `\n[warn] Could not infer a Red List version tag from "${folder.name}". ` +
        `Falling back to today's date for _iucnSourceVersion. ` +
        `Pass --version <id> (e.g. "2025-1") to record the actual Red List version.\n`
    )
  }
  const meta = { sourceVersion, refreshedAt }
  const merged = mergeIdsIntoSpeciesData(data, ids, aliases, meta)

  // Summary
  const threatenedKeys = Object.entries(merged).filter(
    ([k, v]) => !k.startsWith('_') && ['VU', 'EN', 'CR'].includes(v?.iucn)
  )
  const matched = threatenedKeys.filter(([, v]) => v.iucnTaxonId).length
  const unmatched = threatenedKeys.filter(([, v]) => !v.iucnTaxonId).map(([k]) => k)
  console.log(`\n=== summary ===`)
  console.log(`source version : ${meta.sourceVersion}`)
  console.log(`refreshed at   : ${meta.refreshedAt}`)
  console.log(`threatened     : ${threatenedKeys.length}`)
  const pct = threatenedKeys.length ? Math.round((100 * matched) / threatenedKeys.length) : 0
  console.log(`matched        : ${matched} (${pct}%)`)
  console.log(`unmatched      : ${unmatched.length}`)
  if (unmatched.length) console.log(`  sample: ${unmatched.slice(0, 8).join(', ')}`)

  writeData(merged)
  console.log(`\nwrote ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
