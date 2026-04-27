import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  isSpeciesCandidate,
  parseGbifMatch,
  parseGbifIucn,
  parseWikipediaSummary
} from '../../scripts/build-species-info.lib.js'

describe('isSpeciesCandidate', () => {
  test('accepts plain binomial scientific names', () => {
    assert.equal(isSpeciesCandidate('panthera leo'), true)
    assert.equal(isSpeciesCandidate('acinonyx jubatus'), true)
  })

  test('accepts trinomial (subspecies) names', () => {
    assert.equal(isSpeciesCandidate('felis silvestris lybica'), true)
  })

  test('rejects single-token entries (orders, classes, genera-only)', () => {
    assert.equal(isSpeciesCandidate('accipitriformes'), false)
    assert.equal(isSpeciesCandidate('madoqua'), false)
    assert.equal(isSpeciesCandidate('aves'), false)
  })

  test('rejects entries with rank keywords', () => {
    assert.equal(isSpeciesCandidate('aburria species'), false)
    assert.equal(isSpeciesCandidate('acanthizidae family'), false)
    assert.equal(isSpeciesCandidate('accipitriformes order'), false)
    assert.equal(isSpeciesCandidate('felidae class'), false)
    assert.equal(isSpeciesCandidate('panthera genus'), false)
    assert.equal(isSpeciesCandidate('caprinae subfamily'), false)
  })

  test('handles null / empty / non-string input', () => {
    assert.equal(isSpeciesCandidate(null), false)
    assert.equal(isSpeciesCandidate(''), false)
    assert.equal(isSpeciesCandidate('   '), false)
    assert.equal(isSpeciesCandidate(undefined), false)
    assert.equal(isSpeciesCandidate(42), false)
  })
})

describe('parseGbifMatch', () => {
  test('returns usageKey for SPECIES rank', () => {
    const r = parseGbifMatch({ usageKey: 5219404, rank: 'SPECIES', matchType: 'EXACT' })
    assert.deepEqual(r, { usageKey: 5219404, accept: true, reason: null })
  })

  test('accepts SUBSPECIES', () => {
    const r = parseGbifMatch({ usageKey: 1, rank: 'SUBSPECIES', matchType: 'EXACT' })
    assert.equal(r.accept, true)
  })

  test('rejects GENUS / FAMILY / ORDER', () => {
    assert.equal(parseGbifMatch({ usageKey: 1, rank: 'GENUS', matchType: 'EXACT' }).accept, false)
    assert.equal(parseGbifMatch({ usageKey: 1, rank: 'FAMILY', matchType: 'EXACT' }).accept, false)
    assert.equal(parseGbifMatch({ usageKey: 1, rank: 'ORDER', matchType: 'EXACT' }).accept, false)
  })

  test('rejects matchType NONE', () => {
    const r = parseGbifMatch({ matchType: 'NONE' })
    assert.equal(r.accept, false)
    assert.match(r.reason, /no match/i)
  })

  test('rejects missing usageKey', () => {
    assert.equal(parseGbifMatch({ rank: 'SPECIES', matchType: 'EXACT' }).accept, false)
  })
})

describe('parseGbifIucn', () => {
  test('returns category code from threats response', () => {
    assert.equal(parseGbifIucn({ category: 'VU' }), 'VU')
    assert.equal(parseGbifIucn({ category: 'LC' }), 'LC')
  })

  test('maps GBIF verbose categories to 2-letter codes', () => {
    assert.equal(parseGbifIucn({ category: 'LEAST_CONCERN' }), 'LC')
    assert.equal(parseGbifIucn({ category: 'NEAR_THREATENED' }), 'NT')
    assert.equal(parseGbifIucn({ category: 'VULNERABLE' }), 'VU')
    assert.equal(parseGbifIucn({ category: 'ENDANGERED' }), 'EN')
    assert.equal(parseGbifIucn({ category: 'CRITICALLY_ENDANGERED' }), 'CR')
    assert.equal(parseGbifIucn({ category: 'EXTINCT_IN_THE_WILD' }), 'EW')
    assert.equal(parseGbifIucn({ category: 'EXTINCT' }), 'EX')
    assert.equal(parseGbifIucn({ category: 'DATA_DEFICIENT' }), 'DD')
    assert.equal(parseGbifIucn({ category: 'NOT_EVALUATED' }), 'NE')
  })

  test('returns null for unknown verbose values', () => {
    assert.equal(parseGbifIucn({ category: 'FOOBAR_LEVEL' }), null)
  })

  test('returns null when missing', () => {
    assert.equal(parseGbifIucn({}), null)
    assert.equal(parseGbifIucn(null), null)
    assert.equal(parseGbifIucn(undefined), null)
  })
})

describe('parseWikipediaSummary', () => {
  test('extracts blurb, image, and page URL from full summary response', () => {
    const r = parseWikipediaSummary({
      extract: 'The lion (Panthera leo) is a large cat...',
      thumbnail: { source: 'https://upload.wikimedia.org/.../320px-Lion.jpg' },
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Lion' } }
    })
    assert.equal(r.blurb, 'The lion (Panthera leo) is a large cat...')
    assert.equal(r.imageUrl, 'https://upload.wikimedia.org/.../320px-Lion.jpg')
    assert.equal(r.wikipediaUrl, 'https://en.wikipedia.org/wiki/Lion')
  })

  test('returns null fields when summary is partial', () => {
    const r = parseWikipediaSummary({ extract: 'A short blurb.' })
    assert.equal(r.blurb, 'A short blurb.')
    assert.equal(r.imageUrl, null)
    assert.equal(r.wikipediaUrl, null)
  })

  test('returns all-null on empty / null input', () => {
    assert.deepEqual(parseWikipediaSummary(null), {
      blurb: null,
      imageUrl: null,
      wikipediaUrl: null
    })
  })

  test('skips disambiguation pages', () => {
    const r = parseWikipediaSummary({
      type: 'disambiguation',
      extract: 'Lion may refer to:'
    })
    assert.equal(r.blurb, null)
  })
})
