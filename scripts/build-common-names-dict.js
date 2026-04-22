#!/usr/bin/env node
/**
 * Build src/shared/commonNames/dictionary.json by merging the four source JSONs.
 *
 * Priority order (later wins on conflict):
 *   SpeciesNet → DeepFaune → Manas → extras.json
 *
 * Keys in the output are either:
 *   - normalized scientific names (lowercase, single-space, NFC-normalized); or
 *   - raw model labels (also normalized), for entries whose scientificName is null.
 *
 * Values are common names lowercased for consistent display and filtering.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeScientificName } from '../src/shared/commonNames/normalize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SOURCES_DIR = path.join(ROOT, 'src/shared/commonNames/sources')
const EXTRAS_PATH = path.join(ROOT, 'src/shared/commonNames/extras.json')
const OUTPUT_PATH = path.join(ROOT, 'src/shared/commonNames/dictionary.json')

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function keysFor(entry) {
  // An entry may have both scientificName and label (e.g. Manas's "panthera
  // uncia" with label "panthera_uncia"). Write both keys so write-path lookups
  // succeed whether the model emits the binomial or the raw label.
  const keys = new Set()
  if (entry.scientificName) {
    const k = normalizeScientificName(entry.scientificName)
    if (k) keys.add(k)
  }
  if (entry.label) {
    const k = normalizeScientificName(entry.label)
    if (k) keys.add(k)
  }
  return [...keys]
}

function mergeEntries(target, entries) {
  for (const entry of entries) {
    if (!entry.commonName || !entry.commonName.trim()) continue
    // Lowercase common-name values so casing matches scientific-name keys.
    // Sources ship inconsistent capitalization (e.g. "Badger" vs "common myna");
    // normalizing here lets the picker filter out placeholder entries where
    // scientific name equals common name, and keeps UI rendering consistent.
    const value = entry.commonName.trim().toLowerCase()

    // Skip placeholder entries where SpeciesNet ships the scientific name as
    // the common name (e.g. "coendou quichua" -> "coendou quichua"). Letting
    // these through would render "coendou quichua (coendou quichua)" in the
    // UI; dropping them lets the render-time cascade fall back to GBIF.
    if (entry.scientificName && value.toLowerCase() === entry.scientificName.trim().toLowerCase()) {
      continue
    }

    // Skip the "blank" -> "blank" placeholder — parseScientificName returns
    // null for blank predictions so it's never looked up, but keeping it in
    // the dictionary is dead data.
    if (value.toLowerCase() === 'blank') continue

    for (const key of keysFor(entry)) {
      target[key] = value
    }
  }
}

function main() {
  const dictionary = {}

  const order = ['speciesnet.json', 'deepfaune.json', 'manas.json']
  for (const filename of order) {
    const snapshot = loadJson(path.join(SOURCES_DIR, filename))
    mergeEntries(dictionary, snapshot.entries)
  }

  const extras = loadJson(EXTRAS_PATH)
  mergeEntries(dictionary, extras.entries)

  const sortedKeys = Object.keys(dictionary).sort()
  const sorted = {}
  for (const k of sortedKeys) sorted[k] = dictionary[k]

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`Wrote ${sortedKeys.length} entries to ${OUTPUT_PATH}`)
}

main()
