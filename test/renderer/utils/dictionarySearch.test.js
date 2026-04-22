import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  searchSpecies,
  _dictionaryEntries
} from '../../../src/renderer/src/utils/dictionarySearch.js'

describe('dictionary filter', () => {
  test('drops entries where commonName equals scientificName', () => {
    const sciNames = new Set(_dictionaryEntries.map((e) => e.scientificName))
    // Higher-taxa / identical-key entries must be filtered out.
    assert.equal(sciNames.has('accipitridae family'), false)
    assert.equal(sciNames.has('aburria species'), false)
    assert.equal(sciNames.has('badger'), false)
  })

  test('keeps proper species where commonName differs from scientificName', () => {
    const byName = new Map(_dictionaryEntries.map((e) => [e.scientificName, e.commonName]))
    assert.equal(byName.get('aburria aburri'), 'wattled guan')
    assert.equal(byName.get('acinonyx jubatus'), 'cheetah')
  })

  test('every kept entry has a distinct commonName', () => {
    for (const entry of _dictionaryEntries) {
      assert.notEqual(entry.commonName, entry.scientificName)
    }
  })
})

describe('searchSpecies — below threshold', () => {
  const studyList = [
    { scientificName: 'panthera leo', commonName: 'lion', observationCount: 3 },
    { scientificName: 'canis lupus', commonName: 'wolf', observationCount: 1 }
  ]

  test('empty query returns study list unchanged', () => {
    const result = searchSpecies('', studyList)
    assert.deepEqual(result, studyList)
  })

  test('query shorter than 3 chars returns study list unchanged (no dictionary)', () => {
    const result = searchSpecies('ab', studyList)
    assert.deepEqual(result, studyList)
  })

  test('null/undefined query returns study list unchanged', () => {
    assert.deepEqual(searchSpecies(null, studyList), studyList)
    assert.deepEqual(searchSpecies(undefined, studyList), studyList)
  })
})

describe('searchSpecies — fuzzy + ranking', () => {
  test('matches on common name with a small typo', () => {
    const results = searchSpecies('wattle', [])
    const sciNames = results.map((r) => r.scientificName)
    assert.ok(
      sciNames.includes('aburria aburri'),
      `expected 'aburria aburri' (wattled guan) in results, got: ${sciNames.slice(0, 10).join(', ')}`
    )
  })

  test('matches on scientific name', () => {
    const results = searchSpecies('acinonyx', [])
    const sciNames = results.map((r) => r.scientificName)
    assert.ok(
      sciNames.includes('acinonyx jubatus'),
      `expected 'acinonyx jubatus' (cheetah) in results, got: ${sciNames.slice(0, 10).join(', ')}`
    )
  })

  test('dictionary-only result has inStudy: false', () => {
    const results = searchSpecies('cheetah', [])
    const cheetah = results.find((r) => r.scientificName === 'acinonyx jubatus')
    assert.ok(cheetah, 'expected cheetah in results')
    assert.equal(cheetah.inStudy, false)
  })

  test('deduplicates when species exists in both study and dictionary', () => {
    const studyList = [
      { scientificName: 'acinonyx jubatus', commonName: 'cheetah', observationCount: 5 }
    ]
    const results = searchSpecies('cheetah', studyList)
    const cheetahMatches = results.filter((r) => r.scientificName === 'acinonyx jubatus')
    assert.equal(cheetahMatches.length, 1, 'expected exactly one cheetah row')
    assert.equal(cheetahMatches[0].inStudy, true)
    assert.equal(cheetahMatches[0].observationCount, 5)
  })

  test('caps results at 50', () => {
    // Broad common-name substring that matches many rows.
    const results = searchSpecies('bird', [])
    assert.ok(results.length <= 50, `expected <= 50 results, got ${results.length}`)
  })

  test('study match ranks first when it shares a scientific name with a dictionary entry', () => {
    const studyList = [
      { scientificName: 'acinonyx jubatus', commonName: 'cheetah', observationCount: 5 }
    ]
    const results = searchSpecies('cheetah', studyList)
    assert.equal(results[0].scientificName, 'acinonyx jubatus')
    assert.equal(results[0].inStudy, true)
  })
})
