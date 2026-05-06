import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { createPreferencesStore } from '../../../src/main/services/preferences.js'

let testDir

beforeEach(() => {
  testDir = join(tmpdir(), 'biowatch-prefs-test', Date.now().toString() + Math.random())
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
})

describe('preferences store', () => {
  test('reads {} when file does not exist', () => {
    const store = createPreferencesStore(testDir)
    assert.deepEqual(store.read(), {})
  })

  test('reads {} when file is corrupt JSON', () => {
    writeFileSync(join(testDir, 'preferences.json'), '{not json')
    const store = createPreferencesStore(testDir)
    assert.deepEqual(store.read(), {})
  })

  test('round-trips a write', () => {
    const store = createPreferencesStore(testDir)
    store.write({ theme: { source: 'dark' } })
    assert.deepEqual(store.read(), { theme: { source: 'dark' } })
  })

  test('write is atomic (no .tmp file left over)', () => {
    const store = createPreferencesStore(testDir)
    store.write({ theme: { source: 'system' } })
    const entries = readdirSync(testDir)
    assert.deepEqual(entries.sort(), ['preferences.json'])
  })

  test('write fully replaces the file', () => {
    const store = createPreferencesStore(testDir)
    store.write({ theme: { source: 'dark' }, other: 'foo' })
    store.write({ theme: { source: 'light' } })
    assert.deepEqual(store.read(), { theme: { source: 'light' } })
  })
})
