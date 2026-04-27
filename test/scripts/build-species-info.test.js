import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { isSpeciesCandidate } from '../../scripts/build-species-info.lib.js'

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
