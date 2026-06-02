import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatGridTimestamp,
  formatEditableTimestamp,
  parseEditedTimestampToISO
} from '../../src/renderer/src/utils/formatTimestamp.js'

describe('formatGridTimestamp', () => {
  test('renders the stored offset wall clock, independent of machine timezone', () => {
    // 14:34 in +09:00 must render as 2:34 PM everywhere — NOT converted to the
    // runtime zone. This is what keeps the gallery in step with the day filter.
    assert.equal(formatGridTimestamp('2026-04-30T14:34:56+09:00'), 'Apr 30, 2026, 2:34 PM')
  })

  test('renders a UTC (Z) timestamp in UTC', () => {
    assert.equal(formatGridTimestamp('2026-04-30T14:34:56Z'), 'Apr 30, 2026, 2:34 PM')
  })

  test('accepts a Date instance (no offset → runtime zone), matching the shape', () => {
    const result = formatGridTimestamp(new Date('2026-04-30T14:34:56Z'))
    assert.match(result, /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s(AM|PM)$/)
  })
})

describe('formatEditableTimestamp', () => {
  test('renders the stored offset wall clock with seconds', () => {
    assert.equal(formatEditableTimestamp('2026-04-30T14:34:56+09:00'), 'Apr 30, 2026, 2:34:56 PM')
  })
})

describe('parseEditedTimestampToISO', () => {
  test('round-trips through formatEditableTimestamp, preserving the original offset', () => {
    const original = '2026-04-30T14:34:56.000+09:00'
    const display = formatEditableTimestamp(original)
    assert.equal(parseEditedTimestampToISO(display, original), original)
  })

  test('applies the original offset to an edited wall clock', () => {
    // User changes the time to 6:00:00 AM; result keeps the deployment +09:00.
    assert.equal(
      parseEditedTimestampToISO('Apr 30, 2026, 6:00:00 AM', '2020-01-01T00:00:00.000+09:00'),
      '2026-04-30T06:00:00.000+09:00'
    )
  })

  test('keeps a UTC original in UTC', () => {
    assert.equal(
      parseEditedTimestampToISO('Apr 30, 2026, 6:00:00 AM', '2020-01-01T00:00:00.000Z'),
      '2026-04-30T06:00:00.000Z'
    )
  })

  test('returns null for unparseable input', () => {
    assert.equal(parseEditedTimestampToISO('not a date', '2020-01-01T00:00:00.000Z'), null)
  })
})
