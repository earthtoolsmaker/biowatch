import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { formatGridTimestamp } from '../../src/renderer/src/utils/formatTimestamp.js'

describe('formatGridTimestamp', () => {
  test('renders an ISO timestamp as "MMM D, h:mm AM/PM"', () => {
    const result = formatGridTimestamp('2026-04-30T14:34:56Z')
    // Shape only — actual hour depends on test runner's local timezone.
    // Examples: "Apr 30, 2:34 PM", "Apr 30, 10:34 AM", "May 1, 12:34 AM".
    assert.match(
      result,
      /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s(AM|PM)$/,
      `unexpected shape: "${result}"`
    )
  })

  test('accepts a Date instance', () => {
    const result = formatGridTimestamp(new Date('2026-04-30T14:34:56Z'))
    assert.match(result, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s(AM|PM)$/)
  })
})
