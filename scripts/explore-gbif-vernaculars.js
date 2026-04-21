#!/usr/bin/env node
/**
 * Fetch raw GBIF vernacularNames data for each species in scripts/audit-set.txt
 * and write one JSON file per species to scripts/output/gbif-dumps/.
 *
 * Used at design time to produce data for reviewing the English-detection scorer.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const AUDIT_SET = path.join(ROOT, 'scripts/audit-set.txt')
const OUT_DIR = path.join(ROOT, 'scripts/output/gbif-dumps')

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function fetchFor(scientificName) {
  const matchUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`
  const matchRes = await fetch(matchUrl)
  const matchData = await matchRes.json()
  if (!matchData.usageKey) {
    return { scientificName, matchData, vernacularData: null }
  }
  const vernUrl = `https://api.gbif.org/v1/species/${matchData.usageKey}/vernacularNames?limit=100`
  const vernRes = await fetch(vernUrl)
  const vernacularData = await vernRes.json()
  return { scientificName, matchData, vernacularData }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const species = fs
    .readFileSync(AUDIT_SET, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  console.log(`Fetching GBIF data for ${species.length} species...`)
  let i = 0
  for (const s of species) {
    i++
    const outPath = path.join(OUT_DIR, `${slug(s)}.json`)
    if (fs.existsSync(outPath)) {
      continue
    }
    try {
      const result = await fetchFor(s)
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n')
      if (i % 25 === 0) console.log(`  [${i}/${species.length}] ${s}`)
    } catch (e) {
      console.warn(`  [${i}/${species.length}] FAIL ${s}: ${e.message}`)
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  console.log('Done.')
}

main()
