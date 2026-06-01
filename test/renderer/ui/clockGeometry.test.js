import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  timeToAngle,
  angleToTime,
  isInsideBand,
  edgeTolFor,
  bandToSegments,
  rangesToSegments,
  resolveAction
} from '../../../src/renderer/src/ui/clockGeometry.js'

describe('timeToAngle / angleToTime', () => {
  test('0h is 0deg, 6h is 90deg, 18h is 270deg', () => {
    assert.equal(timeToAngle(0), 0)
    assert.equal(timeToAngle(6), 90)
    assert.equal(timeToAngle(18), 270)
  })
  test('24h wraps to 0deg', () => {
    assert.equal(timeToAngle(24), 0)
  })
  test('angleToTime inverts within [0,360)', () => {
    assert.equal(angleToTime(0), 0)
    assert.equal(angleToTime(90), 6)
    assert.equal(angleToTime(270), 18)
  })
})

describe('isInsideBand', () => {
  test('non-wrap band: strictly between start and end', () => {
    assert.equal(isInsideBand(10, { start: 8, end: 18 }), true)
    assert.equal(isInsideBand(8, { start: 8, end: 18 }), false)
    assert.equal(isInsideBand(20, { start: 8, end: 18 }), false)
  })
  test('wrap band (start > end): outside the gap', () => {
    assert.equal(isInsideBand(23, { start: 21, end: 5 }), true)
    assert.equal(isInsideBand(3, { start: 21, end: 5 }), true)
    assert.equal(isInsideBand(12, { start: 21, end: 5 }), false)
  })
})

describe('edgeTolFor', () => {
  test('clamps to [1, 2]', () => {
    assert.equal(edgeTolFor(1.5), 1) // 0.5 -> floored at 1
    assert.equal(edgeTolFor(6), 2) // 2 -> capped at 2
    assert.equal(edgeTolFor(4.5), 1.5) // 1.5 in range
  })
})

describe('bandToSegments', () => {
  test('empty band (start === end) yields nothing', () => {
    assert.deepEqual(bandToSegments({ start: 7, end: 7 }), [])
  })
  test('non-wrap band yields one segment', () => {
    assert.deepEqual(bandToSegments({ start: 7, end: 18 }), [[7, 18]])
  })
  test('wrap band splits at midnight', () => {
    assert.deepEqual(bandToSegments({ start: 21, end: 5 }), [
      [21, 24],
      [0, 5]
    ])
  })
})

describe('rangesToSegments', () => {
  test('flattens multiple ranges, splitting wrap-arounds', () => {
    assert.deepEqual(
      rangesToSegments([
        { start: 5, end: 8 },
        { start: 21, end: 5 }
      ]),
      [
        [5, 8],
        [21, 24],
        [0, 5]
      ]
    )
  })
  test('full-day range yields a single full segment', () => {
    assert.deepEqual(rangesToSegments([{ start: 0, end: 24 }]), [[0, 24]])
  })
})

describe('resolveAction', () => {
  test('no single band -> create', () => {
    assert.equal(resolveAction(10, []), 'create')
    assert.equal(resolveAction(10, [{ start: 5, end: 8 }, { start: 18, end: 21 }]), 'create')
  })
  test('near end edge -> edge-end', () => {
    assert.equal(resolveAction(17.5, [{ start: 8, end: 18 }]), 'edge-end')
  })
  test('near start edge -> edge-start', () => {
    assert.equal(resolveAction(8.5, [{ start: 8, end: 18 }]), 'edge-start')
  })
  test('inside band, away from edges -> pan', () => {
    assert.equal(resolveAction(13, [{ start: 8, end: 18 }]), 'pan')
  })
  test('outside band -> create', () => {
    assert.equal(resolveAction(2, [{ start: 8, end: 18 }]), 'create')
  })
  test('wrap band is panned, not edge-slid', () => {
    assert.equal(resolveAction(23, [{ start: 21, end: 5 }]), 'pan')
  })
})
