import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildComparativeDensities,
  buildProjectedDensities,
  getComparativeBounds,
  colorizeComparison,
  compareDensityGrids,
  getComparativeGrid,
  resolveComparativeMode,
  resolveMapEncoding
} from '../../src/renderer/src/utils/comparativeDensity.js'

const sum = (values) => values.reduce((total, value) => total + value, 0)
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≠ ${expected}`)
const frame = {
  width: 400,
  height: 300,
  zoom: 8,
  project: (lat, lng) => ({ x: lng * 10, y: lat * 10 })
}
const site = (lat, lng, counts) => ({ lat, lng, counts })
const build = (locations, names = ['a', 'b'], options = {}) =>
  buildProjectedDensities(locations, names, { ...frame, ...options })

describe('area-normalized comparative KDE', () => {
  test('normalizes each density independently, including kernels cut by area edges', () => {
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

  test('filters out coordinates outside the analysis frame and invalid locations', () => {
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

  test('uses the supplied analysis projection and resolution', () => {
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

  test('zero-sized analysis frame does not produce nonfinite densities', () => {
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

describe('area-filter comparison scope', () => {
  const locations = [site(0, -3, { a: 5 }), site(0, 0, { a: 5, b: 50 }), site(0, 3, { b: 50 })]
  const names = ['a', 'b']
  const area = { north: 1, south: -1, west: -4, east: -2 }

  test('no area filter includes the complete study extent', () => {
    const density = buildComparativeDensities(locations, names, null)
    assert.ok(density.bounds.west < -3 && density.bounds.east > 3)
    density.grids.forEach((grid) => close(sum(grid), 1))
    close(compareDensityGrids(density.grids, 'overlap').score, 0.5)
  })

  test('applied area filters observations before KDE normalization', () => {
    const density = buildComparativeDensities(locations, names, area)
    assert.deepEqual(density.bounds, area)
    close(sum(density.grids[0]), 1)
    assert.equal(sum(density.grids[1]), 0)
    assert.equal(compareDensityGrids(density.grids, 'overlap').score, 0)
    assert.equal(compareDensityGrids(density.grids, 'difference').score, 1)
    assert.deepEqual(density, buildComparativeDensities([locations[0]], names, area))
  })

  test('clearing the filter restores the all-study calculation', () => {
    const initial = buildComparativeDensities(locations, names, null)
    const filtered = buildComparativeDensities(locations, names, area)
    assert.notDeepEqual(filtered.grids, initial.grids)
    assert.deepEqual(buildComparativeDensities(locations, names, null), initial)
  })

  test('an empty filtered area produces an empty raster and no score', () => {
    const density = buildComparativeDensities(locations, names, { ...area, west: 40, east: 42 })
    assert.equal(compareDensityGrids(density.grids, 'overlap').score, null)
    assert.ok(density.grids.every((grid) => grid.every((value) => value === 0)))
  })

  test('antimeridian areas and wrapped world copies use equivalent analytical frames', () => {
    const points = [site(0, 179, { a: 1 }), site(0, -179, { b: 1 })]
    const crossing = { north: 5, south: -5, west: 170, east: -170 }
    const density = buildComparativeDensities(points, names, crossing)
    density.grids.forEach((grid) => close(sum(grid), 1))
    assert.deepEqual(density.bounds, { ...crossing, east: 190 })
    assert.deepEqual(density, buildComparativeDensities(points, names, { ...crossing, east: 190 }))
    const wrapped = buildComparativeDensities(points, names, { ...crossing, west: 530, east: 550 })
    close(
      compareDensityGrids(density.grids, 'overlap').score,
      compareDensityGrids(wrapped.grids, 'overlap').score
    )
    const bounds = getComparativeBounds(points, null)
    assert.ok(bounds.east - bounds.west < 3)
  })

  test('single-site and empty studies have valid, deterministic extents', () => {
    const density = buildComparativeDensities([site(50, 5, { a: 1, b: 100 })], names, null)
    assert.ok(density.bounds.north > density.bounds.south)
    assert.ok(density.bounds.east > density.bounds.west)
    close(compareDensityGrids(density.grids, 'overlap').score, 1)
    const empty = buildComparativeDensities([], names, null)
    assert.equal(empty.bounds, null)
    assert.equal(compareDensityGrids(empty.grids, 'overlap').score, null)
    assert.equal(getComparativeBounds([site(NaN, 0, {})], null), null)
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
