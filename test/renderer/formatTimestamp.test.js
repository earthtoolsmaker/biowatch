import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { formatGridTimestamp } from '../../src/renderer/src/utils/formatTimestamp.js'

describe('formatGridTimestamp', () => {
  test('renders the written clock as "MMM D, YYYY, HH:mm" without a host-timezone shift', () => {
    const result = formatGridTimestamp('2026-04-30T14:34:56Z')
    assert.equal(result, 'Apr 30, 2026, 14:34')
  })

  test('accepts a Date instance', () => {
    const result = formatGridTimestamp(new Date('2026-04-30T14:34:56Z'))
    assert.equal(result, 'Apr 30, 2026, 14:34')
  })
})
