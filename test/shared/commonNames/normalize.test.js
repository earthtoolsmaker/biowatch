import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeScientificName } from '../../../src/shared/commonNames/normalize.js'

describe('normalizeScientificName', () => {
  test('returns null for null input', () => {
    assert.equal(normalizeScientificName(null), null)
  })

  test('returns null for empty string', () => {
    assert.equal(normalizeScientificName(''), null)
  })

  test('returns null for whitespace-only string', () => {
    assert.equal(normalizeScientificName('   '), null)
  })

  test('lowercases', () => {
    assert.equal(normalizeScientificName('Sciurus Vulgaris'), 'sciurus vulgaris')
  })

  test('trims and collapses internal whitespace', () => {
    assert.equal(normalizeScientificName('  Sciurus    vulgaris  '), 'sciurus vulgaris')
  })

  test('preserves non-binomial single-word labels', () => {
    assert.equal(normalizeScientificName('chamois'), 'chamois')
    assert.equal(normalizeScientificName('bird'), 'bird')
  })

  test('NFC-normalizes combining characters', () => {
    // "é" as NFD (e + combining acute) should come out as single codepoint
    const nfd = 'café'
    const nfc = 'café'
    assert.equal(normalizeScientificName(nfd), nfc)
  })
})
