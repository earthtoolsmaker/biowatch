import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readExploreCountMetric } from '../../src/renderer/src/hooks/useExploreCountMetric.js'
import { normalizeCountMetric } from '../../src/shared/countMetric.js'

function storageWith(entries = {}) {
  return { getItem: (key) => entries[key] ?? null }
}

describe('Explore count metric preference', () => {
  test('defaults missing and stale per-study values to individuals', () => {
    assert.equal(readExploreCountMetric('a', storageWith()), 'individuals')
    assert.equal(
      readExploreCountMetric('a', storageWith({ 'exploreCountMetric:a': 'old-value' })),
      'individuals'
    )
  })

  test('reads each study independently', () => {
    const storage = storageWith({
      'exploreCountMetric:a': 'observations',
      'exploreCountMetric:b': 'individuals'
    })
    assert.equal(readExploreCountMetric('a', storage), 'observations')
    assert.equal(readExploreCountMetric('b', storage), 'individuals')
  })

  test('boundary validation defaults omissions and rejects explicit invalid values', () => {
    assert.equal(normalizeCountMetric(undefined), 'individuals')
    assert.equal(normalizeCountMetric('observations'), 'observations')
    assert.throws(() => normalizeCountMetric('rows'), /Invalid count metric/)
  })
})
