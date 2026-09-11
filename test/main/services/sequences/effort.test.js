import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clipInterval,
  groupEffortByHour,
  groupEffortByLocation,
  groupEffortByWeek,
  intersectRecurringTimeRanges,
  sumTotalEffort,
  validateDeploymentIntervals
} from '../../../../src/main/services/sequences/effort.js'

const interval = (start, end, extra = {}) => ({
  deploymentID: extra.deploymentID || 'd1',
  start: Date.parse(start),
  end: Date.parse(end),
  latitude: extra.latitude ?? 1,
  longitude: extra.longitude ?? 2,
  locationName: extra.locationName || 'Site',
  ...extra
})

const close = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`)

describe('effective camera effort', () => {
  test('keeps fractional camera-days and clips half-open intervals', () => {
    const source = interval('2024-01-01T00:00:00Z', '2024-01-02T12:00:00Z')
    close(sumTotalEffort([source]), 1.5)
    const clipped = clipInterval(source, '2024-01-01T12:00:00Z', '2024-01-02T00:00:00Z')
    close(sumTotalEffort([clipped]), 0.5)
  })

  test('excludes missing, invalid, zero-length, and reversed intervals', () => {
    const rows = [
      { deploymentID: 'ok', deploymentStart: '2024-01-01', deploymentEnd: '2024-01-02' },
      { deploymentID: 'missing', deploymentStart: null, deploymentEnd: '2024-01-02' },
      { deploymentID: 'invalid', deploymentStart: 'bad', deploymentEnd: '2024-01-02' },
      { deploymentID: 'zero', deploymentStart: '2024-01-01', deploymentEnd: '2024-01-01' },
      { deploymentID: 'reverse', deploymentStart: '2024-01-02', deploymentEnd: '2024-01-01' }
    ]
    const validated = validateDeploymentIntervals(rows)
    assert.equal(validated.validDeploymentCount, 1)
    assert.equal(validated.excludedDeploymentCount, 4)
  })

  test('multiple deployments and co-located cameras contribute separately', () => {
    const intervals = [
      interval('2024-01-01', '2024-01-02', { deploymentID: 'a' }),
      interval('2024-01-01', '2024-01-03', { deploymentID: 'b' })
    ]
    close(sumTotalEffort(intervals), 3)
    const grouped = groupEffortByLocation(intervals)
    assert.equal(grouped.size, 1)
    close([...grouped.values()][0].effortDays, 3)
  })

  test('week buckets conserve total effort without double-counting boundaries', () => {
    const intervals = [interval('2024-01-07T12:00:00Z', '2024-01-15T12:00:00Z')]
    const grouped = groupEffortByWeek(intervals)
    close(
      [...grouped.values()].reduce((sum, value) => sum + value, 0),
      8
    )
    assert.deepEqual([...grouped.keys()], ['2023-12-31', '2024-01-07', '2024-01-14'])
  })

  test('hour buckets conserve effort across all 24 hours', () => {
    const grouped = groupEffortByHour([interval('2024-01-01T06:30:00Z', '2024-01-02T08:30:00Z')])
    close(
      grouped.reduce((sum, value) => sum + value, 0),
      26 / 24
    )
    close(grouped[6], 1.5 / 24)
    close(grouped[7], 2 / 24)
  })

  test('recurring ranges form a union and support midnight wrapping', () => {
    const tenDays = interval('2024-01-01', '2024-01-11')
    close(
      intersectRecurringTimeRanges(tenDays, { ranges: [{ start: 18, end: 6 }] }) / 86_400_000,
      5
    )
    close(
      intersectRecurringTimeRanges(tenDays, {
        ranges: [
          { start: 18, end: 6 },
          { start: 20, end: 2 }
        ]
      }) / 86_400_000,
      5
    )
  })

  test('bbox filtering matches the non-antimeridian area rule', () => {
    const rows = [
      {
        deploymentID: 'in',
        deploymentStart: '2024-01-01',
        deploymentEnd: '2024-01-02',
        latitude: 5,
        longitude: 5
      },
      {
        deploymentID: 'out',
        deploymentStart: '2024-01-01',
        deploymentEnd: '2024-01-02',
        latitude: 50,
        longitude: 50
      }
    ]
    const result = validateDeploymentIntervals(rows, {
      bbox: { south: 0, north: 10, west: 0, east: 10 }
    })
    assert.deepEqual(
      result.intervals.map((item) => item.deploymentID),
      ['in']
    )
  })
})
