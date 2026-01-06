import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { modelRunOptionsSchema } from '../../../../src/main/database/validators.js'

describe('Model Run Options Zod Validation', () => {
  describe('modelRunOptionsSchema', () => {
    test('should accept valid options with 3-letter country code', () => {
      const validOptions = { country: 'FRA' }

      const result = modelRunOptionsSchema.safeParse(validOptions)
      assert.equal(result.success, true, 'Should accept valid country code')
      assert.deepEqual(result.data, validOptions)
    })

    test('should accept null options', () => {
      const result = modelRunOptionsSchema.safeParse(null)
      assert.equal(result.success, true, 'Should accept null options')
      assert.equal(result.data, null)
    })

    test('should accept empty object', () => {
      const result = modelRunOptionsSchema.safeParse({})
      assert.equal(result.success, true, 'Should accept empty object')
      assert.deepEqual(result.data, {})
    })

    test('should accept options without country field', () => {
      const result = modelRunOptionsSchema.safeParse({})
      assert.equal(result.success, true, 'Should accept options without country')
    })

    test('should reject 2-letter country code', () => {
      const result = modelRunOptionsSchema.safeParse({ country: 'FR' })
      assert.equal(result.success, false, 'Should reject 2-letter country code')
    })

    test('should reject 4-letter country code', () => {
      const result = modelRunOptionsSchema.safeParse({ country: 'FRAN' })
      assert.equal(result.success, false, 'Should reject 4-letter country code')
    })

    test('should reject unknown fields (strict mode)', () => {
      const result = modelRunOptionsSchema.safeParse({
        country: 'FRA',
        unknownField: 'should fail'
      })
      assert.equal(result.success, false, 'Should reject unknown fields')
    })

    test('should accept various valid 3-letter country codes', () => {
      const validCodes = ['USA', 'GBR', 'DEU', 'ESP', 'ITA', 'CHE', 'AUT']

      for (const code of validCodes) {
        const result = modelRunOptionsSchema.safeParse({ country: code })
        assert.equal(result.success, true, `Should accept country code: ${code}`)
      }
    })

    test('should accept lowercase country codes (no case restriction)', () => {
      // Note: Schema allows any 3-character string, validation is length-based
      const result = modelRunOptionsSchema.safeParse({ country: 'fra' })
      assert.equal(result.success, true, 'Should accept lowercase country code')
    })

    test('should reject empty string as country code', () => {
      const result = modelRunOptionsSchema.safeParse({ country: '' })
      assert.equal(result.success, false, 'Should reject empty string country code')
    })

    test('should reject numeric country value', () => {
      const result = modelRunOptionsSchema.safeParse({ country: 123 })
      assert.equal(result.success, false, 'Should reject numeric country')
    })
  })
})
