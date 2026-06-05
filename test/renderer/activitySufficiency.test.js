import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  MIN_ACTIVITY_DETECTIONS,
  MIN_ACTIVITY_DATES,
  sumDailyActivity,
  countActivityDates,
  hasEnoughActivityData
} from '../../src/renderer/src/utils/activitySufficiency.js'

const SCI = 'Vulpes vulpes'

// Build a 24-row hourly histogram where `total` detections are spread so they
// sum to exactly `total` for SCI.
function dailyWith(total) {
  const rows = Array.from({ length: 24 }, (_, hour) => ({ hour, [SCI]: 0 }))
  let left = total
  let h = 0
  while (left > 0) {
    rows[h % 24][SCI] += 1
    left -= 1
    h += 1
  }
  return rows
}

function seriesWithDates(datesWithDetections) {
  return datesWithDetections.map((count, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    [SCI]: count
  }))
}

describe('sumDailyActivity', () => {
  test('sums the hourly bins for the species', () => {
    assert.equal(sumDailyActivity(dailyWith(37), SCI), 37)
  })

  test('ignores other species in the row', () => {
    const rows = [{ hour: 0, [SCI]: 3, 'Canis lupus': 99 }]
    assert.equal(sumDailyActivity(rows, SCI), 3)
  })

  test('returns 0 for null / non-array input', () => {
    assert.equal(sumDailyActivity(null, SCI), 0)
    assert.equal(sumDailyActivity(undefined, SCI), 0)
  })

  test('treats a missing species key as 0', () => {
    assert.equal(sumDailyActivity([{ hour: 0 }], SCI), 0)
  })
})

describe('countActivityDates', () => {
  test('counts only days with a positive detection count', () => {
    assert.equal(countActivityDates(seriesWithDates([0, 2, 0, 5, 1]), SCI), 3)
  })

  test('returns 0 for null / empty input', () => {
    assert.equal(countActivityDates(null, SCI), 0)
    assert.equal(countActivityDates([], SCI), 0)
  })
})

describe('hasEnoughActivityData', () => {
  test('true when both thresholds are met', () => {
    const daily = dailyWith(MIN_ACTIVITY_DETECTIONS)
    const series = seriesWithDates([1, 1])
    assert.equal(hasEnoughActivityData(daily, series, SCI), true)
  })

  test('false when too few detections', () => {
    const daily = dailyWith(MIN_ACTIVITY_DETECTIONS - 1)
    const series = seriesWithDates([5, 5, 5])
    assert.equal(hasEnoughActivityData(daily, series, SCI), false)
  })

  test('false when too few distinct dates (date-only / single-day study)', () => {
    const daily = dailyWith(100)
    const series = seriesWithDates(Array(MIN_ACTIVITY_DATES - 1).fill(50))
    assert.equal(hasEnoughActivityData(daily, series, SCI), false)
  })

  test('false when there is no temporal data at all', () => {
    assert.equal(hasEnoughActivityData([], [], SCI), false)
  })
})
