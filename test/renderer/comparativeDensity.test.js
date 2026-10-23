import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildViewportDensities,
  colorizeComparison,
  compareDensityGrids,
  getComparativeGrid,
  resolveComparativeMode,
  resolveMapEncoding
} from '../../src/renderer/src/utils/comparativeDensity.js'

const sum = (values) => values.reduce((total, value) => total + value, 0)
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≠ ${expected}`)
const viewport = {
  width: 400,
  height: 300,
  zoom: 8,
  project: (lat, lng) => ({ x: lng * 10, y: lat * 10 })
}
const site = (lat, lng, counts) => ({ lat, lng, counts })
const build = (locations, names = ['a', 'b'], options = {}) =>
  buildViewportDensities(locations, names, { ...viewport, ...options })

describe('viewport-normalized comparative KDE', () => {
  test('normalizes each density independently, including kernels cut by viewport edges', () => {
    const { grids } = build([site(0, 0, { a: 1000, b: 1 }), site(15, 20, { a: 400, b: 3 })])
    grids.forEach((grid) => close(sum(grid), 1))
    assert.ok(grids.every((grid) => grid.every((value) => Number.isFinite(value) && value >= 0)))
  })

  test('unequal counts at identical locations yield full overlap and no difference', () => {
    const { grids } = build([site(15, 20, { a: 3, b: 900 }), site(12, 17, { a: 1, b: 300 })])
    close(compareDensityGrids(grids, 'overlap').score, 1)
    const difference = compareDensityGrids(grids, 'difference')
    close(difference.score, 0)
    assert.equal(difference.peak, 0)
  })

  test('filters out offscreen and invalid coordinates before generating KDEs', () => {
    const visible = [site(15, 20, { a: 1, b: 2 })]
    const baseline = build(visible)
    const filtered = build([
      ...visible,
      site(15, 41, { a: 1e6, b: 1 }),
      site(-1, 20, { a: 1e6, b: 1 }),
      site(31, 20, { a: 1e6, b: 1 }),
      site(15, -1, { a: 1e6, b: 1 }),
      site(NaN, 2, { a: 1e6 }),
      site(2, Infinity, { a: 1e6 }),
      site(91, 2, { a: 1e6 }),
      site(2, 181, { a: 1e6 })
    ])
    assert.deepEqual(filtered, baseline)
  })

  test('pan, zoom, and resize regenerate the visible distributions', () => {
    const locations = [site(15, 10, { a: 1 }), site(15, 30, { b: 1 })]
    const initial = build(locations)
    const panned = build(locations, ['a', 'b'], {
      project: (lat, lng) => ({ x: lng * 10 - 200, y: lat * 10 })
    })
    assert.equal(sum(panned.grids[0]), 0)
    close(sum(panned.grids[1]), 1)
    assert.notDeepEqual(build(locations, ['a', 'b'], { zoom: 16 }), initial)
    assert.notEqual(build(locations, ['a', 'b'], { width: 200 }).columns, initial.columns)
  })

  test('keeps genuinely separated support transparent', () => {
    const { grids } = build([site(15, 0, { a: 1 }), site(15, 40, { b: 1 })])
    const overlap = compareDensityGrids(grids, 'overlap')
    assert.equal(overlap.score, 0)
    assert.equal(overlap.peak, 0)
    assert.ok(colorizeComparison(overlap, 'overlap').every((channel) => channel === 0))
    close(compareDensityGrids(grids, 'difference').score, 1)
  })

  test('ignores missing rates, nonfinite, negative, and zero counts', () => {
    const { grids } = build([
      site(1, 1, { a: null, b: NaN }),
      site(2, 2, { a: -1, b: Infinity }),
      site(3, 3, { a: 0 })
    ])
    assert.equal(sum(grids[0]), 0)
    assert.equal(sum(grids[1]), 0)
    assert.equal(compareDensityGrids(grids, 'overlap').score, null)
    assert.equal(compareDensityGrids(grids, 'difference').score, null)
  })

  test('zero-sized map does not produce nonfinite densities', () => {
    const { grids } = build([site(0, 0, { a: 1, b: 1 })], ['a', 'b'], { width: 0, height: 0 })
    assert.ok(grids.every((grid) => grid.every((value) => value === 0)))
  })

  test('grid resolution and bandwidth scale with zoom while raster dimensions stay bounded', () => {
    const low = getComparativeGrid(1000, 800, 2)
    const high = getComparativeGrid(1000, 800, 16)
    assert.ok(high.columns > low.columns)
    assert.ok(high.bandwidth > low.bandwidth)
    for (const zoom of [0, 8, 20]) {
      const grid = getComparativeGrid(8000, 4000, zoom)
      assert.ok(grid.columns <= 256 && grid.rows <= 256)
    }
  })
})

describe('comparative surface mathematics and colors', () => {
  test('overlap is the N-way minimum, not pairwise averaging', () => {
    const grids = [
      [0.5, 0.5, 0],
      [0.25, 0.5, 0.25],
      [0.75, 0.1, 0.15]
    ]
    const result = compareDensityGrids(grids, 'overlap')
    assert.deepEqual([...result.values], [0.25, 0.1, 0])
    close(result.score, 0.35)
    assert.equal(result.peak, 0.25)
    close(compareDensityGrids([grids[2], grids[0], grids[1]], 'overlap').score, result.score)
  })

  test('difference preserves selection order and uses absolute imbalance, not a zero signed sum', () => {
    const grids = [
      [0.75, 0.25],
      [0.25, 0.75]
    ]
    const result = compareDensityGrids(grids, 'difference')
    assert.deepEqual([...result.values], [0.5, -0.5])
    assert.equal(sum(result.values), 0)
    assert.equal(result.score, 0.5)
    const reversed = compareDensityGrids([...grids].reverse(), 'difference')
    assert.deepEqual([...reversed.values], [-0.5, 0.5])
    assert.equal(reversed.score, result.score)
  })

  test('a missing group gives zero overlap and full pairwise imbalance, with explicit empty-group metadata', () => {
    const grids = [
      [0.5, 0.5],
      [0, 0]
    ]
    assert.equal(compareDensityGrids(grids, 'overlap').score, 0)
    const difference = compareDensityGrids(grids, 'difference')
    assert.equal(difference.score, 1)
    assert.deepEqual(difference.emptyGroups, [1])
    assert.equal(
      compareDensityGrids(
        [
          [0, 0],
          [0, 0]
        ],
        'difference'
      ).score,
      null
    )
  })

  test('rejects invalid group counts, mismatched grids, and unknown modes', () => {
    assert.throws(() => compareDensityGrids([[1]], 'overlap'), /at least two/)
    assert.throws(() => compareDensityGrids([[1], [1], [1]], 'difference'), /exactly two/)
    assert.throws(() => compareDensityGrids([[1], [1, 0]], 'overlap'), /dimensions/)
    assert.throws(() => compareDensityGrids([[1], [1]], 'other'), /Unknown/)
  })

  test('difference colors match first/second selection, and equal/absent cells are transparent', () => {
    const surface = { values: [1, 0, -1], peak: 1 }
    const pixels = colorizeComparison(surface, 'difference', [
      [255, 0, 0],
      [0, 0, 255]
    ])
    assert.deepEqual([...pixels], [255, 0, 0, 210, 0, 0, 0, 0, 0, 0, 255, 210])
    const overlap = colorizeComparison({ values: [0, 1], peak: 1 }, 'overlap')
    assert.deepEqual([...overlap.slice(0, 4)], [0, 0, 0, 0])
    assert.deepEqual([...overlap.slice(4)], [29, 78, 216, 210])
  })
})

describe('comparative selection constraints', () => {
  test('comparative falls back to abundance below two tags without overwriting the preference', () => {
    for (const count of [0, 1]) {
      assert.equal(resolveMapEncoding('comparative', count), 'graduated')
      assert.equal(resolveMapEncoding('pies', count), 'graduated')
      assert.equal(resolveMapEncoding('heatmap', count), 'heatmap')
    }
    assert.equal(resolveMapEncoding('comparative', 2), 'comparative')
    assert.equal(resolveMapEncoding('comparative', 3), 'comparative')
  })

  test('difference is only effective with exactly two tags; overlap supports N groups', () => {
    assert.equal(resolveComparativeMode('difference', 2), 'difference')
    for (const count of [0, 1, 3, 4]) {
      assert.equal(resolveComparativeMode('difference', count), 'overlap')
    }
    assert.equal(resolveComparativeMode('overlap', 2), 'overlap')
    assert.equal(resolveComparativeMode('overlap', 4), 'overlap')
  })
})
