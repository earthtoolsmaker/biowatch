import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { coverageExtent, isOutsideCoverage } from '../../src/renderer/src/deployments/coverage.js'

// Grid spans 2024-01-01 → 2024-01-11 (10 days) in 5 two-day buckets.
const periods = [
  { start: '2024-01-01T00:00:00.000Z', end: '2024-01-03T00:00:00.000Z', count: 0 },
  { start: '2024-01-03T00:00:00.000Z', end: '2024-01-05T00:00:00.000Z', count: 0 },
  { start: '2024-01-05T00:00:00.000Z', end: '2024-01-07T00:00:00.000Z', count: 0 },
  { start: '2024-01-07T00:00:00.000Z', end: '2024-01-09T00:00:00.000Z', count: 0 },
  { start: '2024-01-09T00:00:00.000Z', end: '2024-01-11T00:00:00.000Z', count: 0 }
]

describe('coverageExtent', () => {
  test('maps start/end on bucket boundaries to percentages of the grid', () => {
    const r = coverageExtent(periods, '2024-01-03T00:00:00.000Z', '2024-01-07T00:00:00.000Z')
    assert.deepEqual(r, { leftPct: 20, widthPct: 40 })
  })

  test('snaps mid-bucket dates outward to the edges of the buckets they fall in', () => {
    const r = coverageExtent(periods, '2024-01-04T00:00:00.000Z', '2024-01-06T00:00:00.000Z')
    assert.deepEqual(r, { leftPct: 20, widthPct: 40 })
  })

  test('a date exactly on a boundary does not bleed into the neighbouring bucket', () => {
    // start at bucket 2's start, end at bucket 2's end → only bucket 2.
    const r = coverageExtent(periods, '2024-01-05T00:00:00.000Z', '2024-01-07T00:00:00.000Z')
    assert.deepEqual(r, { leftPct: 40, widthPct: 20 })
  })

  test('missing start clamps to the grid start', () => {
    const r = coverageExtent(periods, null, '2024-01-06T00:00:00.000Z')
    assert.deepEqual(r, { leftPct: 0, widthPct: 60 })
  })

  test('missing end clamps to the grid end', () => {
    const r = coverageExtent(periods, '2024-01-09T00:00:00.000Z', null)
    assert.deepEqual(r, { leftPct: 80, widthPct: 20 })
  })

  test('returns null when both dates are missing', () => {
    assert.equal(coverageExtent(periods, null, null), null)
  })

  test('returns null when there are no periods', () => {
    assert.equal(coverageExtent([], '2024-01-03', '2024-01-07'), null)
    assert.equal(coverageExtent(undefined, '2024-01-03', '2024-01-07'), null)
  })

  test('clamps dates that fall outside the grid', () => {
    const r = coverageExtent(periods, '2023-12-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')
    assert.deepEqual(r, { leftPct: 0, widthPct: 100 })
  })

  test('returns null for an unparseable date', () => {
    assert.equal(coverageExtent(periods, 'garbage', '2024-01-07T00:00:00.000Z'), null)
    assert.equal(coverageExtent(periods, '2024-01-03T00:00:00.000Z', 'garbage'), null)
  })

  test('returns null when the deployment lies wholly outside the grid', () => {
    assert.equal(coverageExtent(periods, null, '2023-12-01T00:00:00.000Z'), null)
    assert.equal(coverageExtent(periods, '2025-01-01T00:00:00.000Z', null), null)
  })

  test('returns null when end is not after start', () => {
    assert.equal(
      coverageExtent(periods, '2024-01-07T00:00:00.000Z', '2024-01-03T00:00:00.000Z'),
      null
    )
  })
})

describe('isOutsideCoverage', () => {
  const bucket = { start: '2024-01-05T00:00:00.000Z', end: '2024-01-07T00:00:00.000Z' }

  test('false when the bucket overlaps the deployment', () => {
    assert.equal(
      isOutsideCoverage(bucket, '2024-01-06T00:00:00.000Z', '2024-01-20T00:00:00.000Z'),
      false
    )
  })

  test('true when the bucket ends before the deployment starts', () => {
    assert.equal(
      isOutsideCoverage(bucket, '2024-01-07T00:00:00.000Z', '2024-01-20T00:00:00.000Z'),
      true
    )
  })

  test('true when the bucket begins after the deployment ends', () => {
    assert.equal(
      isOutsideCoverage(bucket, '2024-01-01T00:00:00.000Z', '2024-01-05T00:00:00.000Z'),
      true
    )
  })

  test('missing dates are open-ended', () => {
    assert.equal(isOutsideCoverage(bucket, null, '2024-01-20T00:00:00.000Z'), false)
    assert.equal(isOutsideCoverage(bucket, '2024-01-01T00:00:00.000Z', null), false)
    assert.equal(isOutsideCoverage(bucket, null, null), false)
  })
})
