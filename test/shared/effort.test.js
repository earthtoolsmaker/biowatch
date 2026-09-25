import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { deploymentEffortDays } from '../../src/shared/effort.js'

describe('deploymentEffortDays', () => {
  test('returns whole camera-days for a multi-day interval', () => {
    assert.equal(deploymentEffortDays('2024-01-01T00:00:00Z', '2024-01-11T00:00:00Z'), 10)
  })

  test('keeps partial days fractional without rounding', () => {
    assert.equal(deploymentEffortDays('2024-01-01T00:00:00Z', '2024-01-02T12:00:00Z'), 1.5)
  })

  test('returns null when start is missing', () => {
    assert.equal(deploymentEffortDays(null, '2024-01-11T00:00:00Z'), null)
  })

  test('returns null when end is missing', () => {
    assert.equal(deploymentEffortDays('2024-01-01T00:00:00Z', undefined), null)
  })

  test('returns null when a date does not parse', () => {
    assert.equal(deploymentEffortDays('not a date', '2024-01-11T00:00:00Z'), null)
  })

  test('returns null when end is before start', () => {
    assert.equal(deploymentEffortDays('2024-01-11T00:00:00Z', '2024-01-01T00:00:00Z'), null)
  })

  test('returns null when end equals start', () => {
    assert.equal(deploymentEffortDays('2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'), null)
  })
})
