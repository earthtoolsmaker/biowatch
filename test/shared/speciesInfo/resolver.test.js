import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// node:test has no clean ESM module mocker, so we use a factory function
// (`makeResolver`) that takes the data map directly. The default export
// `resolveSpeciesInfo` is created from the real data.json — exercised by
// the manual smoke test in Task 9.

import { makeResolver } from '../../../src/shared/speciesInfo/resolver.js'

const FIXTURE = {
  'panthera leo': {
    iucn: 'VU',
    blurb: 'The lion is a large cat...',
    imageUrl: 'https://example.test/lion.jpg',
    wikipediaUrl: 'https://en.wikipedia.org/wiki/Lion'
  }
}

describe('resolveSpeciesInfo', () => {
  const resolve = makeResolver(FIXTURE)

  test('returns full record on exact lowercase hit', () => {
    assert.deepEqual(resolve('panthera leo'), FIXTURE['panthera leo'])
  })

  test('is case-insensitive', () => {
    assert.deepEqual(resolve('Panthera Leo'), FIXTURE['panthera leo'])
    assert.deepEqual(resolve('PANTHERA LEO'), FIXTURE['panthera leo'])
  })

  test('trims whitespace', () => {
    assert.deepEqual(resolve('  panthera leo  '), FIXTURE['panthera leo'])
  })

  test('returns null on miss', () => {
    assert.equal(resolve('canis lupus'), null)
  })

  test('returns null for null/empty/undefined', () => {
    assert.equal(resolve(null), null)
    assert.equal(resolve(undefined), null)
    assert.equal(resolve(''), null)
    assert.equal(resolve('   '), null)
  })

  test('returns null for non-string input', () => {
    assert.equal(resolve(42), null)
    assert.equal(resolve({}), null)
  })
})
