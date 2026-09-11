import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readExploreMetric } from '../../src/renderer/src/hooks/useExploreMetric.js'
import {
  DEFAULT_ANALYSIS_METRIC,
  normalizeAnalysisMetric
} from '../../src/shared/analysisMetric.js'

function storageWith(entries = {}) {
  return { getItem: (key) => entries[key] ?? null }
}

const combinations = [
  ['individuals', 'none'],
  ['observations', 'none'],
  ['individuals', 'RAI100'],
  ['observations', 'RAI100']
]

describe('Explore analysis metric', () => {
  test('validates all four combinations and strips object identity', () => {
    for (const [counting, normalization] of combinations) {
      const input = { counting, normalization }
      const output = normalizeAnalysisMetric(input)
      assert.deepEqual(output, input)
      assert.notEqual(output, input)
    }
  })

  test('defaults an omitted generic metric and rejects explicit malformed values', () => {
    assert.equal(normalizeAnalysisMetric(undefined), DEFAULT_ANALYSIS_METRIC)
    for (const invalid of [
      null,
      [],
      'individuals',
      {},
      { counting: 'rows', normalization: 'none' }
    ]) {
      assert.throws(() => normalizeAnalysisMetric(invalid), /Invalid analysis metric/)
    }
    assert.throws(
      () =>
        normalizeAnalysisMetric({ counting: 'individuals', normalization: 'none', stale: true }),
      /shape/
    )
  })

  test('reads complete JSON preferences independently per study', () => {
    const storage = storageWith({
      'exploreAnalysisMetric:a': JSON.stringify({
        counting: 'observations',
        normalization: 'RAI100'
      }),
      'exploreAnalysisMetric:b': JSON.stringify({
        counting: 'individuals',
        normalization: 'none'
      })
    })
    assert.deepEqual(readExploreMetric('a', storage), {
      counting: 'observations',
      normalization: 'RAI100'
    })
    assert.deepEqual(readExploreMetric('b', storage), DEFAULT_ANALYSIS_METRIC)
  })

  test('malformed JSON, stale shapes, and the old string key use the default', () => {
    assert.equal(
      readExploreMetric(
        'a',
        storageWith({
          'exploreAnalysisMetric:a': '{bad',
          'exploreCountMetric:a': 'observations'
        })
      ),
      DEFAULT_ANALYSIS_METRIC
    )
    assert.equal(
      readExploreMetric(
        'a',
        storageWith({
          'exploreAnalysisMetric:a': JSON.stringify({ counting: 'observations' })
        })
      ),
      DEFAULT_ANALYSIS_METRIC
    )
  })
})
