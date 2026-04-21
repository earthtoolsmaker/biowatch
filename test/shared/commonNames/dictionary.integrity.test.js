import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeScientificName } from '../../../src/shared/commonNames/normalize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DICT_PATH = path.resolve(__dirname, '../../../src/shared/commonNames/dictionary.json')

describe('dictionary.json integrity', () => {
  const raw = fs.readFileSync(DICT_PATH, 'utf8')
  const dictionary = JSON.parse(raw)

  test('is a non-empty object', () => {
    assert.equal(typeof dictionary, 'object')
    assert.ok(!Array.isArray(dictionary))
    assert.ok(Object.keys(dictionary).length > 0)
  })

  test('has no empty or whitespace-only values', () => {
    for (const [key, value] of Object.entries(dictionary)) {
      assert.equal(typeof value, 'string', `value for "${key}" is not a string`)
      assert.notEqual(value.trim(), '', `value for "${key}" is empty`)
    }
  })

  test('all keys are canonically normalized', () => {
    for (const key of Object.keys(dictionary)) {
      const normalized = normalizeScientificName(key)
      assert.equal(normalized, key, `key "${key}" is not canonically normalized`)
    }
  })

  test('has no duplicate keys in the raw JSON', () => {
    // JSON.parse silently drops duplicates; detect by counting occurrences of
    // quoted keys at the top level of the flat object.
    const keyRe = /^\s*"((?:[^"\\]|\\.)*)"\s*:/gm
    const counts = {}
    for (const match of raw.matchAll(keyRe)) {
      counts[match[1]] = (counts[match[1]] || 0) + 1
    }
    const dupes = Object.entries(counts)
      .filter(([, n]) => n > 1)
      .map(([k]) => k)
    assert.deepEqual(dupes, [], `found duplicate keys: ${dupes.join(', ')}`)
  })
})
