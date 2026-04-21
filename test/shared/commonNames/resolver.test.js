import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCommonName } from '../../../src/shared/commonNames/resolver.js'

describe('resolveCommonName', () => {
  test('returns null for null input', () => {
    assert.equal(resolveCommonName(null), null)
  })

  test('returns null for empty string', () => {
    assert.equal(resolveCommonName(''), null)
  })

  test('resolves a binomial scientific name', () => {
    assert.equal(resolveCommonName('Sciurus vulgaris'), 'Eurasian Red Squirrel')
  })

  test('extras override wins over SpeciesNet entry', () => {
    // SpeciesNet ships "eurasian red squirrel" (lowercase); extras override with
    // the capitalized display form.
    assert.equal(resolveCommonName('sciurus vulgaris'), 'Eurasian Red Squirrel')
  })

  test('resolves a DeepFaune non-binomial label', () => {
    assert.equal(resolveCommonName('chamois'), 'Chamois')
  })

  test('resolves case-insensitively', () => {
    assert.equal(resolveCommonName('SCIURUS VULGARIS'), 'Eurasian Red Squirrel')
  })

  test('returns null for unknown scientific name', () => {
    assert.equal(resolveCommonName('Foobar nonexistentium'), null)
  })
})
