import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  ALL_CHIPS_SELECTED,
  arcToRanges,
  chipsToRanges,
  DAY_PERIOD_ORDER,
  DAY_PERIOD_PRESETS,
  isFullDayArc,
  mergeChipRanges
} from '../../src/renderer/src/utils/dayPeriods.js'

describe('DAY_PERIOD_PRESETS', () => {
  test('exposes dawn/day/dusk/night with non-overlapping hour ranges', () => {
    const keys = Object.keys(DAY_PERIOD_PRESETS).sort()
    assert.deepEqual(keys, ['dawn', 'day', 'dusk', 'night'])
    assert.deepEqual(DAY_PERIOD_PRESETS.dawn.range, { start: 5, end: 8 })
    assert.deepEqual(DAY_PERIOD_PRESETS.day.range, { start: 8, end: 18 })
    assert.deepEqual(DAY_PERIOD_PRESETS.dusk.range, { start: 18, end: 21 })
    assert.deepEqual(DAY_PERIOD_PRESETS.night.range, { start: 21, end: 5 })
  })

  test('DAY_PERIOD_ORDER is chronological', () => {
    assert.deepEqual(DAY_PERIOD_ORDER, ['dawn', 'day', 'dusk', 'night'])
  })
})

describe('chipsToRanges', () => {
  test('empty selection returns empty ranges', () => {
    assert.deepEqual(chipsToRanges(new Set()), [])
  })

  test('single chip returns its range', () => {
    assert.deepEqual(chipsToRanges(new Set(['day'])), [{ start: 8, end: 18 }])
  })

  test('dawn + dusk returns both ranges (crepuscular)', () => {
    assert.deepEqual(chipsToRanges(new Set(['dawn', 'dusk'])), [
      { start: 5, end: 8 },
      { start: 18, end: 21 }
    ])
  })

  test('all four chips returns all four ranges in canonical order', () => {
    assert.deepEqual(chipsToRanges(new Set(['night', 'day', 'dusk', 'dawn'])), [
      { start: 5, end: 8 },
      { start: 8, end: 18 },
      { start: 18, end: 21 },
      { start: 21, end: 5 }
    ])
  })

  test('ignores unknown chip keys', () => {
    assert.deepEqual(chipsToRanges(new Set(['day', 'midnight'])), [{ start: 8, end: 18 }])
  })
})

describe('isFullDayArc', () => {
  test('detects 0–24 as full day', () => {
    assert.equal(isFullDayArc({ start: 0, end: 24 }), true)
  })

  test('detects start === end as full day', () => {
    assert.equal(isFullDayArc({ start: 6, end: 6 }), true)
  })

  test('detects near-full ranges within 0.1h tolerance', () => {
    assert.equal(isFullDayArc({ start: 0.05, end: 23.95 }), true)
  })

  test('partial range is not full day', () => {
    assert.equal(isFullDayArc({ start: 8, end: 18 }), false)
  })
})

describe('arcToRanges', () => {
  test('full-day arc returns empty (no filter)', () => {
    assert.deepEqual(arcToRanges({ start: 0, end: 24 }), [])
  })

  test('partial arc returns single range', () => {
    assert.deepEqual(arcToRanges({ start: 8, end: 18 }), [{ start: 8, end: 18 }])
  })

  test('wrap-around arc returns single range', () => {
    assert.deepEqual(arcToRanges({ start: 21, end: 5 }), [{ start: 21, end: 5 }])
  })
})

describe('ALL_CHIPS_SELECTED', () => {
  test('contains every chip', () => {
    assert.deepEqual([...ALL_CHIPS_SELECTED].sort(), ['dawn', 'day', 'dusk', 'night'])
  })
})

describe('mergeChipRanges', () => {
  test('empty input returns empty', () => {
    assert.deepEqual(mergeChipRanges([]), [])
  })

  test('single range passes through unchanged', () => {
    assert.deepEqual(mergeChipRanges([{ start: 8, end: 18 }]), [{ start: 8, end: 18 }])
  })

  test('two contiguous ranges merge into one', () => {
    assert.deepEqual(
      mergeChipRanges([
        { start: 5, end: 8 },
        { start: 8, end: 18 }
      ]),
      [{ start: 5, end: 18 }]
    )
  })

  test('non-contiguous ranges stay separate (Dawn + Dusk)', () => {
    assert.deepEqual(
      mergeChipRanges([
        { start: 5, end: 8 },
        { start: 18, end: 21 }
      ]),
      [
        { start: 5, end: 8 },
        { start: 18, end: 21 }
      ]
    )
  })

  test('night + dawn merges across midnight (wrap-around)', () => {
    assert.deepEqual(
      mergeChipRanges([
        { start: 5, end: 8 },
        { start: 21, end: 5 }
      ]),
      [{ start: 21, end: 8 }]
    )
  })

  test('all four chips merge to a single full-day sector', () => {
    assert.deepEqual(
      mergeChipRanges([
        { start: 5, end: 8 },
        { start: 8, end: 18 },
        { start: 18, end: 21 },
        { start: 21, end: 5 }
      ]),
      [{ start: 0, end: 24 }]
    )
  })

  test('three contiguous chips merge into one wide range (dawn + day + dusk)', () => {
    assert.deepEqual(
      mergeChipRanges([
        { start: 5, end: 8 },
        { start: 8, end: 18 },
        { start: 18, end: 21 }
      ]),
      [{ start: 5, end: 21 }]
    )
  })
})
