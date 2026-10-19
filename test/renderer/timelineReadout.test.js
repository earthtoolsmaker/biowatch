import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  barSizePx,
  buildReadoutRows,
  formatWeekLabel,
  maxValueInRange,
  niceYTicks,
  rowsInRange,
  yAxisUnitLabel
} from '../../src/renderer/src/utils/timelineReadout.js'

const raw = { counting: 'individuals', normalization: 'none' }
const rai = { counting: 'observations', normalization: 'RAI100' }
const palette = ['#2563eb', '#f59e0b', '#10b981']
const selected = [{ scientificName: 'Vulpes vulpes' }, { scientificName: 'Martes martes' }]

describe('timeline readout', () => {
  test('labels a weekly row by the Monday after its Sunday label', () => {
    // Rows are labelled with the Sunday before their Monday–Sunday bucket.
    const sunday = new Date('2025-08-03').getTime()
    assert.equal(
      formatWeekLabel(sunday),
      new Date(Date.UTC(2025, 7, 4)).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
      })
    )
  })

  test('lists species highest value first with their palette color', () => {
    const rows = buildReadoutRows({
      row: { 'Vulpes vulpes': 3, 'Martes martes': 42 },
      selectedSpecies: selected,
      palette,
      metric: raw
    })
    assert.deepEqual(
      rows.map((r) => [r.scientificName, r.color, r.formatted]),
      [
        ['Martes martes', '#f59e0b', '42'],
        ['Vulpes vulpes', '#2563eb', '3']
      ]
    )
  })

  test('missing species values read as zero', () => {
    const rows = buildReadoutRows({ row: {}, selectedSpecies: selected, palette, metric: raw })
    assert.deepEqual(
      rows.map((r) => r.formatted),
      ['0', '0']
    )
  })

  test('RAI values keep one decimal and weeks without effort read as unavailable, last', () => {
    const rows = buildReadoutRows({
      row: { 'Vulpes vulpes': null, 'Martes martes': 12.44 },
      selectedSpecies: selected,
      palette,
      metric: rai
    })
    assert.deepEqual(
      rows.map((r) => [r.scientificName, r.formatted]),
      [
        ['Martes martes', '12.4'],
        ['Vulpes vulpes', '—']
      ]
    )
  })

  test('keeps only weekly rows inside the date range, inclusive', () => {
    const rows = ['2025-01-05', '2025-01-12', '2025-01-19', '2025-01-26'].map((date) => ({ date }))
    const range = [new Date('2025-01-12'), new Date('2025-01-19')]
    assert.deepEqual(
      rowsInRange(rows, range).map((r) => r.date),
      ['2025-01-12', '2025-01-19']
    )
  })

  test('returns every row when no range is set', () => {
    const rows = [{ date: '2025-01-05' }, { date: '2025-01-12' }]
    assert.equal(rowsInRange(rows, [null, null]), rows)
  })

  test('y-axis unit names the counting basis, per 100 camera-days for RAI', () => {
    assert.equal(yAxisUnitLabel({ counting: 'individuals', normalization: 'none' }), 'Individuals')
    assert.equal(
      yAxisUnitLabel({ counting: 'observations', normalization: 'none' }),
      'Independent observations'
    )
    assert.equal(
      yAxisUnitLabel({ counting: 'individuals', normalization: 'RAI100' }),
      'Individuals per 100 camera-days'
    )
    assert.equal(
      yAxisUnitLabel({ counting: 'observations', normalization: 'RAI100' }),
      'Independent observations per 100 camera-days'
    )
  })

  test('peak value across species only counts rows inside the range', () => {
    const rows = [
      { date: Date.UTC(2025, 0, 5), a: 90, b: 1 },
      { date: Date.UTC(2025, 0, 12), a: 4, b: 7 },
      { date: Date.UTC(2025, 0, 19), a: 2, b: null }
    ]
    const range = [new Date(Date.UTC(2025, 0, 12)), new Date(Date.UTC(2025, 0, 19))]
    assert.equal(maxValueInRange(rows, range, ['a', 'b']), 7)
    assert.equal(maxValueInRange(rows, [null, null], ['a', 'b']), 90)
    assert.equal(maxValueInRange([], range, ['a']), 0)
  })

  test('y ticks are round steps from zero that cover the peak', () => {
    assert.deepEqual(niceYTicks(230.6), [0, 50, 100, 150, 200, 250])
    assert.deepEqual(niceYTicks(931), [0, 200, 400, 600, 800, 1000])
    assert.deepEqual(niceYTicks(7), [0, 2, 4, 6, 8])
    assert.deepEqual(niceYTicks(0.34), [0, 0.1, 0.2, 0.3, 0.4])
    assert.deepEqual(niceYTicks(0), [0, 1])
  })

  test('bars split 80% of each week slot between species, at least 1px', () => {
    const WEEK = 7 * 24 * 60 * 60 * 1000
    // 10 weeks across 1000px → 100px slots → 80px for the group.
    assert.equal(barSizePx({ plotWidth: 1000, domainMs: 10 * WEEK, speciesCount: 2 }), 40)
    assert.equal(barSizePx({ plotWidth: 1000, domainMs: 10 * WEEK, speciesCount: 1 }), 80)
    // Years of weeks on a narrow plot still draw something.
    assert.equal(barSizePx({ plotWidth: 300, domainMs: 500 * WEEK, speciesCount: 3 }), 1)
    assert.equal(barSizePx({ plotWidth: 0, domainMs: 0, speciesCount: 0 }), 1)
  })
})
