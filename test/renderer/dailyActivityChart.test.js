import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatHourRange,
  hourBarSizePx,
  polarPoint,
  sectorPath
} from '../../src/renderer/src/utils/dailyActivityChart.js'

const close = (a, b) => Math.abs(a - b) < 1e-9

describe('daily activity chart helpers', () => {
  test('labels an hourly bin with its start and end', () => {
    assert.equal(formatHourRange(6), '06:00–07:00')
    assert.equal(formatHourRange(0), '00:00–01:00')
    assert.equal(formatHourRange(23), '23:00–24:00')
  })

  test('bars split 80% of each hour slot between species, at least 1px', () => {
    // 2400px / 24 hours → 100px slots → 80px for the group.
    assert.equal(hourBarSizePx({ plotWidth: 2400, speciesCount: 2 }), 40)
    assert.equal(hourBarSizePx({ plotWidth: 100, speciesCount: 5 }), 1)
    assert.equal(hourBarSizePx({ plotWidth: 0, speciesCount: 0 }), 1)
  })

  test('polar points run clockwise from midnight at the top', () => {
    const at = (h) => polarPoint({ cx: 100, cy: 100, r: 50, hour: h })
    assert.ok(close(at(0).x, 100) && close(at(0).y, 50))
    assert.ok(close(at(6).x, 150) && close(at(6).y, 100))
    assert.ok(close(at(12).x, 100) && close(at(12).y, 150))
    assert.ok(close(at(18).x, 50) && close(at(18).y, 100))
  })

  test('a sector is a closed wedge from the centre between two hours', () => {
    const d = sectorPath({ cx: 100, cy: 100, r: 50, start: 0, end: 6 })
    assert.match(d, /^M 100 100 L 100 50 A 50 50 0 0 1 150 100 Z$/)
  })

  test('sectors wider than half a day use the large arc', () => {
    const d = sectorPath({ cx: 0, cy: 0, r: 10, start: 0, end: 18 })
    assert.match(d, / A 10 10 0 1 1 /)
  })
})
