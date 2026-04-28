#!/usr/bin/env node
/**
 * Build src/shared/speciesInfo/data.json by enriching the common-name
 * dictionary with GBIF (IUCN status) and Wikipedia (blurb + image).
 *
 * Usage:
 *   node scripts/build-species-info.js                  # full run
 *   node scripts/build-species-info.js --resume         # skip already-fetched
 *   node scripts/build-species-info.js --force          # refetch everything
 *   node scripts/build-species-info.js --limit 25       # cap candidates
 *   node scripts/build-species-info.js --dry-run        # don't write file
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

import {
  isSpeciesCandidate,
  parseGbifMatch,
  parseGbifIucn,
  parseWikipediaSummary
} from './build-species-info.lib.js'
import dictionary from '../src/shared/commonNames/dictionary.json' with { type: 'json' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUTPUT_PATH = path.join(ROOT, 'src/shared/speciesInfo/data.json')

const POLITE_DELAY_MS = 500
const RETRIES = 3
const RETRY_BASE_MS = 1000
const FLUSH_EVERY_N = 25

function parseArgs(argv) {
  const out = { resume: false, force: false, dryRun: false, limit: Infinity }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--resume') out.resume = true
    else if (a === '--force') out.force = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--limit') out.limit = Number(argv[++i])
    else throw new Error(`unknown flag: ${a}`)
  }
  return out
}

async function fetchJson(url) {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'biowatch-species-info-builder' } })
      if (res.status === 404) return null
      if (res.status === 429) {
        // Honor Retry-After if Wikipedia/GBIF tells us how long to wait;
        // fall back to a generous backoff that covers their typical cooldown.
        const retryAfter = Number(res.headers.get('retry-after')) || 30
        if (attempt === RETRIES) throw new Error(`HTTP 429 (rate limited)`)
        await sleep(retryAfter * 1000)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      if (attempt === RETRIES) throw err
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1))
    }
  }
}

async function fetchSpecies(name) {
  const match = await fetchJson(
    `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}`
  )
  const verdict = parseGbifMatch(match)
  if (!verdict.accept) return { skip: verdict.reason }

  // allSettled so a Wikipedia 429 doesn't wipe out the IUCN value (or vice versa).
  const [iucnSettled, wikiSettled] = await Promise.allSettled([
    fetchJson(`https://api.gbif.org/v1/species/${verdict.usageKey}/iucnRedListCategory`),
    fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`)
  ])

  const iucn = iucnSettled.status === 'fulfilled' ? parseGbifIucn(iucnSettled.value) : null
  const wiki =
    wikiSettled.status === 'fulfilled'
      ? parseWikipediaSummary(wikiSettled.value)
      : { blurb: null, imageUrl: null, wikipediaUrl: null }

  const errors = []
  if (iucnSettled.status === 'rejected') errors.push(`iucn: ${iucnSettled.reason.message}`)
  if (wikiSettled.status === 'rejected') errors.push(`wiki: ${wikiSettled.reason.message}`)

  const entry = {}
  if (iucn) entry.iucn = iucn
  if (wiki.blurb) entry.blurb = wiki.blurb
  if (wiki.imageUrl) entry.imageUrl = wiki.imageUrl
  if (wiki.wikipediaUrl) entry.wikipediaUrl = wiki.wikipediaUrl
  if (Object.keys(entry).length) {
    return { entry, partial: errors.length ? errors.join('; ') : null }
  }
  return { skip: errors.length ? errors.join('; ') : 'no usable fields' }
}

function loadExisting() {
  try {
    const text = fs.readFileSync(OUTPUT_PATH, 'utf8')
    return JSON.parse(text) || {}
  } catch {
    return {}
  }
}

function writeOutput(map) {
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
  // Write to a temp file in the same directory, then rename — atomic on POSIX,
  // so a SIGKILL or power loss mid-write can't truncate the canonical file.
  const tmpPath = `${OUTPUT_PATH}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
  fs.renameSync(tmpPath, OUTPUT_PATH)
}

function diffSummary(prev, next) {
  const added = []
  const removed = []
  const changed = []
  for (const k of Object.keys(next)) {
    if (!(k in prev)) added.push(k)
    else if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) changed.push(k)
  }
  for (const k of Object.keys(prev)) {
    if (!(k in next)) removed.push(k)
  }
  return { added, removed, changed }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const existing = loadExisting()
  const out = { ...existing }

  const allKeys = Object.keys(dictionary)
  const candidates = allKeys.filter(isSpeciesCandidate)
  const skippedFilter = allKeys.length - candidates.length

  console.log(`dictionary: ${allKeys.length}, species candidates: ${candidates.length}`)
  console.log(`pre-filter skipped: ${skippedFilter}`)

  let processed = 0
  let kept = 0
  const skipReasons = new Map()
  const queue = candidates.slice(0, args.limit)

  // Install SIGINT handler so we flush partial work before exit.
  let interrupted = false
  process.on('SIGINT', () => {
    interrupted = true
    console.log('\n[SIGINT] flushing progress and exiting...')
  })

  for (const name of queue) {
    if (interrupted) break
    if (args.resume && !args.force && out[name]) continue
    processed++
    try {
      const result = await fetchSpecies(name)
      if (result.entry) {
        out[name] = result.entry
        kept++
        const tag = result.partial ? `[ok*]  ` : `[ok]   `
        console.log(`${tag}${name}${result.partial ? ` — partial: ${result.partial}` : ''}`)
      } else {
        skipReasons.set(result.skip, (skipReasons.get(result.skip) ?? 0) + 1)
        console.log(`[skip] ${name} — ${result.skip}`)
      }
    } catch (err) {
      console.warn(`[err]  ${name} — ${err.message}`)
    }

    // Periodic flush so a crash doesn't lose in-flight work. The pretty-print
    // is cheap (~600KB once full); for partial runs it's tiny.
    if (!args.dryRun && processed % FLUSH_EVERY_N === 0) {
      writeOutput(out)
      console.log(`[flush] wrote ${Object.keys(out).length} entries`)
    }

    await sleep(POLITE_DELAY_MS)
  }

  const { added, removed, changed } = diffSummary(existing, out)
  console.log('\n=== summary ===')
  console.log(`processed: ${processed}, kept: ${kept}`)
  for (const [r, n] of skipReasons) console.log(`skip "${r}": ${n}`)
  console.log(`diff vs previous: +${added.length} / -${removed.length} / ~${changed.length}`)

  if (args.dryRun) {
    console.log('--dry-run: not writing file')
    return
  }
  writeOutput(out)
  console.log(`wrote ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
