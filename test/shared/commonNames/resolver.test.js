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
    assert.equal(resolveCommonName('Sciurus vulgaris'), 'eurasian red squirrel')
  })

  test('extras override wins over SpeciesNet entry', () => {
    // Dictionary values are lowercased at build time for consistent display
    // and filtering; the extras override still wins on content.
    assert.equal(resolveCommonName('sciurus vulgaris'), 'eurasian red squirrel')
  })

  test('resolves a DeepFaune non-binomial label', () => {
    assert.equal(resolveCommonName('chamois'), 'chamois')
  })

  test('resolves case-insensitively', () => {
    assert.equal(resolveCommonName('SCIURUS VULGARIS'), 'eurasian red squirrel')
  })

  test('returns null for unknown scientific name', () => {
    assert.equal(resolveCommonName('Foobar nonexistentium'), null)
  })

  test('resolves MegaDetector pseudo-species labels (animal/person/vehicle)', () => {
    assert.equal(resolveCommonName('animal'), 'animal')
    assert.equal(resolveCommonName('person'), 'person')
    assert.equal(resolveCommonName('vehicle'), 'vehicle')
  })
})
