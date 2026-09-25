import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatDateRange,
  formatEffortDays,
  formatEffortLabel
} from '../../../src/renderer/src/deployments/formatEffort.js'

describe('formatEffortLabel', () => {
  test('pluralizes whole days', () => {
    assert.equal(formatEffortLabel(44.2, 'day'), '44 days')
    assert.equal(formatEffortLabel(1234.6, 'camera-day'), '1,235 camera-days')
  })

  test('uses the singular for exactly one rounded day', () => {
    assert.equal(formatEffortLabel(1.2, 'day'), '1 day')
    assert.equal(formatEffortLabel(0.8, 'camera-day'), '1 camera-day')
  })

  test('shows less-than-one for intervals that round to zero', () => {
    assert.equal(formatEffortLabel(0.25, 'day'), '< 1 day')
  })

  test('renders an em dash for null', () => {
    assert.equal(formatEffortLabel(null, 'day'), '—')
  })
})

// Instants at 12:00Z keep the local-time date stable in every timezone.
describe('formatDateRange', () => {
  test('formats a start and end date with the year once', () => {
    assert.equal(
      formatDateRange('2018-06-04T12:00:00Z', '2018-07-18T12:00:00Z'),
      'Jun 4 – Jul 18, 2018'
    )
  })

  test('repeats the year when the range spans years', () => {
    assert.equal(
      formatDateRange('2023-11-20T12:00:00Z', '2024-02-02T12:00:00Z'),
      'Nov 20, 2023 – Feb 2, 2024'
    )
  })

  test('returns null when either date is missing or invalid', () => {
    assert.equal(formatDateRange(null, '2024-02-02T12:00:00Z'), null)
    assert.equal(formatDateRange('2024-02-02T12:00:00Z', 'nope'), null)
  })
})

describe('formatEffortDays', () => {
  test('rounds to the nearest whole day', () => {
    assert.equal(formatEffortDays(42.4), '42')
    assert.equal(formatEffortDays(42.5), '43')
  })

  test('shows whole numbers without decimals', () => {
    assert.equal(formatEffortDays(10), '10')
  })

  test('rounds a near-whole interval up to the whole day', () => {
    assert.equal(formatEffortDays(30.999988), '31')
  })

  test('uses a thousands separator', () => {
    assert.equal(formatEffortDays(1234.56), '1,235')
  })

  test('renders an em dash for null', () => {
    assert.equal(formatEffortDays(null), '—')
  })

  test('renders an em dash for undefined', () => {
    assert.equal(formatEffortDays(undefined), '—')
  })
})
