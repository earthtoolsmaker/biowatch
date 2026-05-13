/**
 * Unit tests for normalizeTimeRange — accepts both the legacy
 * {start, end} shape and the new {ranges: [...]} shape.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeTimeRange } from '../../../../src/main/database/queries/sequences.js'

describe('normalizeTimeRange', () => {
  test('returns [] for undefined/null/empty input', () => {
    assert.deepEqual(normalizeTimeRange(undefined), [])
    assert.deepEqual(normalizeTimeRange(null), [])
    assert.deepEqual(normalizeTimeRange({}), [])
  })

  test('wraps legacy {start, end} into a single-element ranges array', () => {
    assert.deepEqual(normalizeTimeRange({ start: 5, end: 8 }), [{ start: 5, end: 8 }])
  })

  test('passes through {ranges: [...]} unchanged', () => {
    const ranges = [
      { start: 5, end: 8 },
      { start: 18, end: 21 }
    ]
    assert.deepEqual(normalizeTimeRange({ ranges }), ranges)
  })

  test('prefers ranges over start/end when both present', () => {
    const ranges = [{ start: 0, end: 12 }]
    assert.deepEqual(normalizeTimeRange({ ranges, start: 100, end: 200 }), ranges)
  })

  test('returns [] when ranges is an empty array', () => {
    assert.deepEqual(normalizeTimeRange({ ranges: [] }), [])
  })
})
