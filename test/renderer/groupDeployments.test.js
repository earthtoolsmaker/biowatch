import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { groupDeploymentsByLocation } from '../../src/renderer/src/deployments/groupDeployments.js'

const mkPeriod = (count) => ({ start: '2024-01-01', end: '2024-02-01', count })

describe('groupDeploymentsByLocation', () => {
  test('returns empty array for empty input', () => {
    assert.deepEqual(groupDeploymentsByLocation([]), [])
    assert.deepEqual(groupDeploymentsByLocation(null), [])
    assert.deepEqual(groupDeploymentsByLocation(undefined), [])
  })

  test('treats single deployment as singleton group', () => {
    const result = groupDeploymentsByLocation([
      {
        deploymentID: 'd1',
        locationID: 'loc-A',
        locationName: 'Alpha',
        latitude: 1,
        longitude: 2,
        deploymentStart: '2024-01-01',
        periods: [mkPeriod(10)]
      }
    ])
    assert.equal(result.length, 1)
    assert.equal(result[0].isSingleDeployment, true)
    assert.equal(result[0].locationID, 'loc-A')
  })

  test('groups deployments sharing locationID', () => {
    const result = groupDeploymentsByLocation([
      {
        deploymentID: 'd1',
        locationID: 'loc-A',
        locationName: 'Alpha',
        deploymentStart: '2024-01-01',
        periods: [mkPeriod(5)]
      },
      {
        deploymentID: 'd2',
        locationID: 'loc-A',
        locationName: 'Alpha',
        deploymentStart: '2025-01-01',
        periods: [mkPeriod(7)]
      }
    ])
    assert.equal(result.length, 1)
    assert.equal(result[0].isSingleDeployment, false)
    assert.equal(result[0].deployments.length, 2)
    // Most recent first within group
    assert.equal(result[0].deployments[0].deploymentID, 'd2')
  })

  test('aggregates periods within a group by summing per-bucket counts', () => {
    const result = groupDeploymentsByLocation([
      {
        deploymentID: 'd1',
        locationID: 'loc-A',
        locationName: 'Alpha',
        deploymentStart: '2024-01-01',
        periods: [mkPeriod(5), mkPeriod(3)]
      },
      {
        deploymentID: 'd2',
        locationID: 'loc-A',
        locationName: 'Alpha',
        deploymentStart: '2025-01-01',
        periods: [mkPeriod(2), mkPeriod(8)]
      }
    ])
    assert.deepEqual(
      result[0].aggregatedPeriods.map((p) => p.count),
      [7, 11]
    )
  })

  test('sorts alphabetically with sections interleaved with singletons (NOT groups-first)', () => {
    const result = groupDeploymentsByLocation([
      {
        deploymentID: 'd1',
        locationID: 'loc-Z',
        locationName: 'Zulu',
        deploymentStart: '2024-01-01',
        periods: [mkPeriod(1)]
      },
      {
        deploymentID: 'd2',
        locationID: 'loc-M',
        locationName: 'Mike',
        deploymentStart: '2024-01-01',
        periods: [mkPeriod(1)]
      },
      {
        deploymentID: 'd3',
        locationID: 'loc-M',
        locationName: 'Mike',
        deploymentStart: '2025-01-01',
        periods: [mkPeriod(1)]
      },
      {
        deploymentID: 'd4',
        locationID: 'loc-A',
        locationName: 'Alpha',
        deploymentStart: '2024-01-01',
        periods: [mkPeriod(1)]
      }
    ])
    // Expected order: Alpha (singleton), Mike (group), Zulu (singleton)
    assert.equal(result[0].locationName, 'Alpha')
    assert.equal(result[1].locationName, 'Mike')
    assert.equal(result[2].locationName, 'Zulu')
  })

  test('falls back to locationID when locationName is missing', () => {
    const result = groupDeploymentsByLocation([
      {
        deploymentID: 'd1',
        locationID: 'loc-Beta',
        locationName: null,
        deploymentStart: '2024-01-01',
        periods: [mkPeriod(1)]
      },
      {
        deploymentID: 'd2',
        locationID: 'loc-Alpha',
        locationName: null,
        deploymentStart: '2024-01-01',
        periods: [mkPeriod(1)]
      }
    ])
    assert.equal(result[0].locationID, 'loc-Alpha')
    assert.equal(result[1].locationID, 'loc-Beta')
  })

  test('falls back to deploymentID when locationID is missing', () => {
    const result = groupDeploymentsByLocation([
      {
        deploymentID: 'd1',
        locationID: null,
        locationName: 'Alpha',
        deploymentStart: '2024-01-01',
        periods: [mkPeriod(1)]
      }
    ])
    assert.equal(result.length, 1)
    assert.equal(result[0].locationID, 'd1')
  })

  test('group carries the earliest start and latest end of its children', () => {
    const result = groupDeploymentsByLocation([
      {
        deploymentID: 'd1',
        locationID: 'loc-A',
        locationName: 'Alpha',
        deploymentStart: '2024-01-01',
        deploymentEnd: '2024-03-01',
        periods: [mkPeriod(1)]
      },
      {
        deploymentID: 'd2',
        locationID: 'loc-A',
        locationName: 'Alpha',
        deploymentStart: '2024-06-01',
        deploymentEnd: '2024-09-01',
        periods: [mkPeriod(1)]
      }
    ])
    assert.equal(result[0].deploymentStart, '2024-01-01')
    assert.equal(result[0].deploymentEnd, '2024-09-01')
  })

  test('a missing child end leaves the group open-ended', () => {
    const result = groupDeploymentsByLocation([
      {
        deploymentID: 'd1',
        locationID: 'loc-A',
        locationName: 'Alpha',
        deploymentStart: '2024-01-01',
        deploymentEnd: '2024-03-01',
        periods: [mkPeriod(1)]
      },
      {
        deploymentID: 'd2',
        locationID: 'loc-A',
        locationName: 'Alpha',
        deploymentStart: '2024-06-01',
        deploymentEnd: null,
        periods: [mkPeriod(1)]
      }
    ])
    assert.equal(result[0].deploymentStart, '2024-01-01')
    assert.equal(result[0].deploymentEnd, null)
  })

  test('ignores unparseable child dates in the union regardless of order', () => {
    const mk = (id, start, end) => ({
      deploymentID: id,
      locationID: 'loc-A',
      locationName: 'Alpha',
      deploymentStart: start,
      deploymentEnd: end,
      periods: [mkPeriod(1)]
    })
    const forward = groupDeploymentsByLocation([
      mk('d1', 'not-a-date', 'garbage'),
      mk('d2', '2024-06-01', '2024-09-01')
    ])
    const reversed = groupDeploymentsByLocation([
      mk('d2', '2024-06-01', '2024-09-01'),
      mk('d1', 'not-a-date', 'garbage')
    ])
    for (const result of [forward, reversed]) {
      assert.equal(result[0].deploymentStart, '2024-06-01')
      assert.equal(result[0].deploymentEnd, '2024-09-01')
    }
  })
})
