import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateAnalysisLocations,
  formatAnalysisValue
} from '../../src/renderer/src/utils/analysisMetric.js'

const rai = { counting: 'observations', normalization: 'RAI100' }
const raw = { counting: 'observations', normalization: 'none' }
const selected = [{ scientificName: 'Deer' }]

describe('renderer analysis metric helpers', () => {
  test('formats raw values as integers and rates to one decimal', () => {
    assert.equal(formatAnalysisValue(1234, raw).replace(/\D/g, ''), '1234')
    assert.equal(formatAnalysisValue(12.44, rai), '12.4')
    assert.equal(formatAnalysisValue(null, rai), '—')
  })

  test('matches the 9 / 2 / 40 camera-day RAI fixture', () => {
    const individuals = aggregateAnalysisLocations(
      [{ rawCounts: { Deer: 9 }, effortDays: 40 }],
      selected,
      { counting: 'individuals', normalization: 'RAI100' }
    )
    const observations = aggregateAnalysisLocations(
      [{ rawCounts: { Deer: 2 }, effortDays: 40 }],
      selected,
      rai
    )
    assert.equal(individuals.values.Deer, 22.5)
    assert.equal(observations.values.Deer, 5)
  })

  test('aggregates raw count and effort before deriving RAI', () => {
    const result = aggregateAnalysisLocations(
      [
        { rawCounts: { Deer: 10 }, effortDays: 100 },
        { rawCounts: { Deer: 10 }, effortDays: 10 }
      ],
      selected,
      rai
    )
    assert.equal(result.rawCounts.Deer, 20)
    assert.equal(result.effortDays, 110)
    assert.ok(Math.abs(result.values.Deer - 18.181818) < 1e-6)
  })

  test('surveyed zero-detection locations participate in the denominator', () => {
    const result = aggregateAnalysisLocations(
      [
        { rawCounts: { Deer: 10 }, effortDays: 10 },
        { rawCounts: { Deer: 0 }, effortDays: 90 }
      ],
      selected,
      rai
    )
    assert.equal(result.values.Deer, 10)
  })

  test('zero effort produces an unavailable value', () => {
    const result = aggregateAnalysisLocations(
      [{ rawCounts: { Deer: 5 }, effortDays: 0 }],
      selected,
      rai
    )
    assert.equal(result.values.Deer, null)
  })
})
