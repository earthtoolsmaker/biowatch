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
