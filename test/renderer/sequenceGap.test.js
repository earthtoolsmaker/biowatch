import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  SEQUENCE_GAP_STOPS,
  gapToStopIndex,
  formatGapValue
} from '../../src/renderer/src/utils/sequenceGap.js'
import { metadataUpdateSchema } from '../../src/main/database/validators.js'

describe('SEQUENCE_GAP_STOPS', () => {
  test('spans Off to 120 minutes in increasing order', () => {
    assert.equal(SEQUENCE_GAP_STOPS[0], 0)
    assert.equal(SEQUENCE_GAP_STOPS.at(-1), 7200)
    for (let i = 1; i < SEQUENCE_GAP_STOPS.length; i++) {
      assert.ok(SEQUENCE_GAP_STOPS[i] > SEQUENCE_GAP_STOPS[i - 1])
    }
  })

  test('includes common independence windows', () => {
    for (const s of [1800, 3600, 7200]) assert.ok(SEQUENCE_GAP_STOPS.includes(s))
  })

  test('every stop passes the persisted sequenceGap validator', () => {
    for (const s of SEQUENCE_GAP_STOPS) {
      assert.ok(metadataUpdateSchema.safeParse({ sequenceGap: s }).success, `${s}`)
    }
    assert.ok(!metadataUpdateSchema.safeParse({ sequenceGap: 7201 }).success)
  })
})

describe('gapToStopIndex', () => {
  test('maps null to Off', () => {
    assert.equal(gapToStopIndex(null), 0)
  })

  test('maps exact stops to their index', () => {
    SEQUENCE_GAP_STOPS.forEach((s, i) => assert.equal(gapToStopIndex(s), i))
  })

  test('snaps off-grid values to the nearest stop', () => {
    assert.equal(SEQUENCE_GAP_STOPS[gapToStopIndex(70)], 60)
    assert.equal(SEQUENCE_GAP_STOPS[gapToStopIndex(250)], 240)
    assert.equal(SEQUENCE_GAP_STOPS[gapToStopIndex(99999)], 7200)
  })
})

describe('formatGapValue', () => {
  test('formats each range', () => {
    assert.equal(formatGapValue(null), 'Off')
    assert.equal(formatGapValue(0), 'Off')
    assert.equal(formatGapValue(30), '30s')
    assert.equal(formatGapValue(60), '1min')
    assert.equal(formatGapValue(90), '1min 30s')
    assert.equal(formatGapValue(300), '5min')
    assert.equal(formatGapValue(2700), '45min')
    assert.equal(formatGapValue(3600), '1h')
    assert.equal(formatGapValue(5400), '1h 30min')
    assert.equal(formatGapValue(7200), '2h')
  })
})
