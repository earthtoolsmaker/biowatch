/**
 * The import date transformers must PRESERVE the deployment-local wall clock
 * (and its source offset) rather than normalizing to UTC, so day-period
 * filtering and the gallery read the camera's local time.
 * See docs/dates-and-timezones.md.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { transformDateField as camtrapTransform } from '../../../../../src/main/services/import/parsers/camtrapDP.js'
import { transformDateField as lilaTransform } from '../../../../../src/main/services/import/parsers/lila-helpers.js'

for (const [name, transform] of [
  ['camtrapDP', camtrapTransform],
  ['lila-helpers', lilaTransform]
]) {
  describe(`${name} transformDateField — preserves deployment-local time`, () => {
    test('keeps a positive offset instead of converting to UTC', () => {
      assert.equal(transform('2020-12-16T10:28:18+01:00'), '2020-12-16T10:28:18.000+01:00')
    })

    test('keeps a negative offset', () => {
      assert.equal(transform('2021-07-04T22:15:00-05:00'), '2021-07-04T22:15:00.000-05:00')
    })

    test('leaves a UTC (Z) timestamp as UTC', () => {
      assert.equal(transform('2022-01-01T06:36:00Z'), '2022-01-01T06:36:00.000Z')
    })

    test('returns null for empty input', () => {
      assert.equal(transform(null), null)
      assert.equal(transform(''), null)
    })
  })
}

describe('lila-helpers transformDateField — COCO naive format', () => {
  test('keeps the naive wall clock (hour is not shifted by UTC conversion)', () => {
    // "2022-12-31 09:52:50" → the literal hour 09 must survive (offset is the
    // runtime zone, but the wall clock the filter reads stays 09).
    const out = lilaTransform('2022-12-31 09:52:50')
    assert.match(out, /^2022-12-31T09:52:50/)
  })
})
