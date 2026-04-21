import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeScientificName } from '../../../src/shared/commonNames/normalize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCES_DIR = path.resolve(__dirname, '../../../src/shared/commonNames/sources')
const DICT_PATH = path.resolve(__dirname, '../../../src/shared/commonNames/dictionary.json')

function keysFor(entry) {
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

/**
 * Mirror of build-common-names-dict.js's filter: entries that the build
 * intentionally drops shouldn't count against coverage.
 */
function isFiltered(entry) {
  const common = (entry.commonName || '').trim().toLowerCase()
  if (!common) return true
  if (common === 'blank') return true
  if (entry.scientificName && common === entry.scientificName.trim().toLowerCase()) return true
  return false
}

describe('dictionary.json coverage', () => {
  const dictionary = JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'))
  const snapshots = fs.readdirSync(SOURCES_DIR).filter((f) => f.endsWith('.json'))

  for (const filename of snapshots) {
    test(`all entries from ${filename} appear in dictionary.json`, () => {
      const snapshot = JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, filename), 'utf8'))
      const missing = []
      for (const entry of snapshot.entries) {
        if (isFiltered(entry)) continue
        for (const key of keysFor(entry)) {
          if (!(key in dictionary)) {
            missing.push({ key, label: entry.label, scientificName: entry.scientificName })
          }
        }
      }
      assert.equal(
        missing.length,
        0,
        `${missing.length} entries missing from dictionary:\n` +
          missing
            .slice(0, 20)
            .map((m) => `  - ${m.key}`)
            .join('\n') +
          (missing.length > 20 ? `\n  ... and ${missing.length - 20} more` : '')
      )
    })
  }
})
