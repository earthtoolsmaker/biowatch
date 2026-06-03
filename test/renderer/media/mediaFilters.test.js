import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_FILTERS,
  filtersToSearchParams,
  searchParamsToFilters,
  hasActiveFilters
} from '../../../src/renderer/src/media/mediaFilters.js'

describe('mediaFilters round-trip', () => {
  test('defaults serialize to an empty query', () => {
    const sp = filtersToSearchParams(DEFAULT_FILTERS)
    assert.equal(sp.toString(), '')
  })

  test('species + deployment + source round-trip', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      species: ['Panthera pardus', 'Genetta genetta'],
      deployments: ['Cam-A1'],
      sources: ['ndutu_2024']
    }
    const sp = filtersToSearchParams(filters)
    const back = searchParamsToFilters(new URLSearchParams(sp.toString()))
    assert.deepEqual(back.species, ['Panthera pardus', 'Genetta genetta'])
    assert.deepEqual(back.deployments, ['Cam-A1'])
    assert.deepEqual(back.sources, ['ndutu_2024'])
  })

  test('date range + sort + view round-trip', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      dateRange: ['2024-03-01', '2024-03-31'],
      sort: 'oldest',
      view: 'table'
    }
    const back = searchParamsToFilters(filtersToSearchParams(filters))
    assert.deepEqual(back.dateRange, ['2024-03-01', '2024-03-31'])
    assert.equal(back.sort, 'oldest')
    assert.equal(back.view, 'table')
  })

  test('timeRange ranges round-trip', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      timeRange: { ranges: [{ start: 18, end: 24 }, { start: 0, end: 6 }] }
    }
    const back = searchParamsToFilters(filtersToSearchParams(filters))
    assert.deepEqual(back.timeRange.ranges, [
      { start: 18, end: 24 },
      { start: 0, end: 6 }
    ])
  })

  test('quickView round-trips and unknown values are dropped', () => {
    const back = searchParamsToFilters(new URLSearchParams('view=grid&q=needs-review'))
    assert.equal(back.quickView, 'needs-review')
    const bad = searchParamsToFilters(new URLSearchParams('q=bogus'))
    assert.equal(bad.quickView, null)
  })

  test('hasActiveFilters is false for defaults, true when any filter set', () => {
    assert.equal(hasActiveFilters(DEFAULT_FILTERS), false)
    assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, species: ['x'] }), true)
    // sort/view are not "filters"
    assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, sort: 'oldest', view: 'table' }), false)
  })
})
