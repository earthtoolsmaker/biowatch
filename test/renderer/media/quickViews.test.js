import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { QUICK_VIEWS, quickViewToQueryPatch } from '../../../src/renderer/src/media/quickViews.js'
import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../../../src/shared/constants.js'

describe('quickViews', () => {
  test('every quick view has a key, label and tone', () => {
    for (const qv of QUICK_VIEWS) {
      assert.ok(qv.key && qv.label && qv.tone)
      assert.ok(['neutral', 'warn'].includes(qv.tone))
    }
  })

  test('blank maps to the BLANK_SENTINEL species bucket', () => {
    assert.deepEqual(quickViewToQueryPatch('blank'), { species: [BLANK_SENTINEL] })
  })

  test('vehicle maps to the VEHICLE_SENTINEL species bucket', () => {
    assert.deepEqual(quickViewToQueryPatch('vehicle'), { species: [VEHICLE_SENTINEL] })
  })

  test('no-timestamp maps to the null-timestamp-only flag', () => {
    assert.deepEqual(quickViewToQueryPatch('no-timestamp'), { onlyNullTimestamps: true })
  })

  test('reviewed / needs-review / favorites / low-confidence map to server flags', () => {
    assert.deepEqual(quickViewToQueryPatch('reviewed'), { reviewed: true })
    assert.deepEqual(quickViewToQueryPatch('needs-review'), { reviewed: false })
    assert.deepEqual(quickViewToQueryPatch('favorites'), { favorite: true })
    assert.deepEqual(quickViewToQueryPatch('low-confidence'), { lowConfidence: true })
  })

  test('null / unknown quick view → empty patch', () => {
    assert.deepEqual(quickViewToQueryPatch(null), {})
    assert.deepEqual(quickViewToQueryPatch('bogus'), {})
  })
})
