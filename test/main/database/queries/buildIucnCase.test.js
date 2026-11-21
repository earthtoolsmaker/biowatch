import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  IUCN_BOOST,
  groupSpeciesByIucnTier,
  buildIucnCase
} from '../../../../src/main/database/queries/best-media.js'

describe('IUCN_BOOST constant', () => {
  test('has the documented per-tier boost values', () => {
    assert.equal(IUCN_BOOST.CR, 0.25)
    assert.equal(IUCN_BOOST.EW, 0.25)
    assert.equal(IUCN_BOOST.EX, 0.25)
    assert.equal(IUCN_BOOST.EN, 0.18)
    assert.equal(IUCN_BOOST.VU, 0.1)
    assert.equal(IUCN_BOOST.NT, 0.03)
  })

  test('is frozen so callers cannot mutate it at runtime', () => {
    assert.equal(Object.isFrozen(IUCN_BOOST), true)
  })

  test('does not assign a boost to LC, DD, NE, or unknown tiers', () => {
    for (const tier of ['LC', 'DD', 'NE', 'XX', '']) {
      assert.equal(IUCN_BOOST[tier], undefined)
    }
  })
})

describe('groupSpeciesByIucnTier', () => {
  // Stub resolver so tests do not depend on the bundled dictionary.
  const stubMap = {
    'panthera tigris': { iucn: 'EN' },
    'panthera leo': { iucn: 'VU' },
    'diceros bicornis': { iucn: 'CR' },
    'vulpes vulpes': { iucn: 'LC' },
    'unknown species x': null
  }
  const stubResolver = (name) => stubMap[name?.toLowerCase()] ?? null

  test('groups species into the boost-eligible tiers', () => {
    const distinct = [
      { scientificName: 'Diceros bicornis' },
      { scientificName: 'Panthera tigris' },
      { scientificName: 'Panthera leo' },
      { scientificName: 'Vulpes vulpes' },
      { scientificName: 'Unknown species X' }
    ]
    const byTier = groupSpeciesByIucnTier(distinct, stubResolver)
    assert.deepEqual(byTier.CR, ['Diceros bicornis'])
    assert.deepEqual(byTier.EN, ['Panthera tigris'])
    assert.deepEqual(byTier.VU, ['Panthera leo'])
    assert.deepEqual(byTier.NT, [])
    assert.deepEqual(byTier.EW, [])
    assert.deepEqual(byTier.EX, [])
  })

  test('LC, DD, and unresolved species are dropped (not zero-bucketed)', () => {
    const distinct = [{ scientificName: 'Vulpes vulpes' }, { scientificName: 'Unknown species X' }]
    const byTier = groupSpeciesByIucnTier(distinct, stubResolver)
    for (const tier of ['CR', 'EW', 'EX', 'EN', 'VU', 'NT']) {
      assert.deepEqual(byTier[tier], [])
    }
  })

  test('preserves the original (un-normalized) scientific name in the bucket', () => {
    // The SQL CASE matches against o.scientificName as stored in the DB,
    // so we must keep the source casing/whitespace and only normalize for lookup.
    const distinct = [{ scientificName: 'Panthera Tigris' }]
    const byTier = groupSpeciesByIucnTier(distinct, (n) =>
      n?.toLowerCase() === 'panthera tigris' ? { iucn: 'EN' } : null
    )
    assert.deepEqual(byTier.EN, ['Panthera Tigris'])
  })
})

describe('buildIucnCase', () => {
  test('emits one IN-branch per non-empty tier with the correct boost literal', () => {
    const byTier = {
      CR: ['Diceros bicornis'],
      EW: [],
      EX: [],
      EN: ['Panthera tigris', 'Loxodonta africana'],
      VU: ['Panthera leo'],
      NT: []
    }
    const { expr, params } = buildIucnCase(byTier)
    assert.equal((expr.match(/WHEN/g) || []).length, 3)
    assert.match(expr, /THEN 0\.25/)
    assert.match(expr, /THEN 0\.18/)
    assert.match(expr, /THEN 0\.1/) // 0.10 may print as 0.1
    assert.match(expr, /ELSE 0 END\s*$/)
    assert.equal(params.length, 4)
    assert.deepEqual(params, [
      'Diceros bicornis',
      'Panthera tigris',
      'Loxodonta africana',
      'Panthera leo'
    ])
  })

  test('returns the literal "0" expression and zero params when all tiers empty', () => {
    const byTier = { CR: [], EW: [], EX: [], EN: [], VU: [], NT: [] }
    const { expr, params } = buildIucnCase(byTier)
    assert.equal(expr, '0')
    assert.equal(params.length, 0)
  })

  test('CR/EW/EX share the 0.25 boost (each gets its own branch)', () => {
    const byTier = {
      CR: ['A a'],
      EW: ['B b'],
      EX: ['C c'],
      EN: [],
      VU: [],
      NT: []
    }
    const { expr, params } = buildIucnCase(byTier)
    // Three branches, all THEN 0.25
    assert.equal((expr.match(/THEN 0\.25/g) || []).length, 3)
    assert.deepEqual(params, ['A a', 'B b', 'C c'])
  })
})
