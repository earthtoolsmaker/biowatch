import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  clientXToDate,
  zoomAroundAnchor,
  shouldClearToFullExtent,
  clampPanToBounds,
  clampMinRange,
  resolveAction,
  pxToDateMs,
  DAY_MS,
  MIN_RANGE_MS,
  CLEAR_TOLERANCE_MS,
  EDGE_PX_TOLERANCE
} from '../../src/renderer/src/utils/timelineZoom.js'

const D = (iso) => new Date(iso)
const RECT = { left: 0, width: 1000 }
const MARGIN = 4
const INNER = RECT.width - MARGIN * 2
const DOMAIN = [D('2024-01-01T00:00:00Z'), D('2024-12-31T00:00:00Z')]
const FULL_EXTENT = DOMAIN

describe('constants', () => {
  test('DAY_MS = 24h in ms', () => {
    assert.equal(DAY_MS, 24 * 60 * 60 * 1000)
  })
  test('MIN_RANGE_MS defaults to one day', () => {
    assert.equal(MIN_RANGE_MS, DAY_MS)
  })
  test('CLEAR_TOLERANCE_MS = 12h', () => {
    assert.equal(CLEAR_TOLERANCE_MS, 12 * 60 * 60 * 1000)
  })
  test('EDGE_PX_TOLERANCE = 10', () => {
    assert.equal(EDGE_PX_TOLERANCE, 10)
  })
})

describe('clientXToDate', () => {
  test('left edge maps to domain[0]', () => {
    const d = clientXToDate({
      clientX: MARGIN,
      rect: RECT,
      marginX: MARGIN,
      domain: DOMAIN
    })
    assert.equal(d.getTime(), DOMAIN[0].getTime())
  })

  test('right edge maps to domain[1]', () => {
    const d = clientXToDate({
      clientX: RECT.width - MARGIN,
      rect: RECT,
      marginX: MARGIN,
      domain: DOMAIN
    })
    assert.equal(d.getTime(), DOMAIN[1].getTime())
  })

  test('midpoint maps to midpoint of domain', () => {
    const d = clientXToDate({
      clientX: MARGIN + INNER / 2,
      rect: RECT,
      marginX: MARGIN,
      domain: DOMAIN
    })
    const midMs = (DOMAIN[0].getTime() + DOMAIN[1].getTime()) / 2
    assert.equal(d.getTime(), midMs)
  })

  test('clamp=true keeps result inside domain when cursor is outside', () => {
    const d = clientXToDate({
      clientX: -50,
      rect: RECT,
      marginX: MARGIN,
      domain: DOMAIN,
      clamp: true
    })
    assert.equal(d.getTime(), DOMAIN[0].getTime())
  })

  test('clamp=false lets result fall outside domain (for pan)', () => {
    const d = clientXToDate({
      clientX: -50,
      rect: RECT,
      marginX: MARGIN,
      domain: DOMAIN,
      clamp: false
    })
    assert.ok(d.getTime() < DOMAIN[0].getTime())
  })

  test('returns null when chart inner width is zero or negative', () => {
    const d = clientXToDate({
      clientX: 10,
      rect: { left: 0, width: 4 },
      marginX: MARGIN,
      domain: DOMAIN
    })
    assert.equal(d, null)
  })
})

describe('zoomAroundAnchor', () => {
  test('factor=1 returns unchanged range', () => {
    const [s, e] = zoomAroundAnchor({
      start: DOMAIN[0],
      end: DOMAIN[1],
      anchor: D('2024-06-01'),
      factor: 1
    })
    assert.equal(s.getTime(), DOMAIN[0].getTime())
    assert.equal(e.getTime(), DOMAIN[1].getTime())
  })

  test('factor=0.5 halves both halves around the anchor', () => {
    const anchor = D('2024-06-01T12:00:00Z')
    const [s, e] = zoomAroundAnchor({
      start: D('2024-01-01'),
      end: D('2024-12-01'),
      anchor,
      factor: 0.5
    })
    const halfStart = anchor.getTime() - (anchor.getTime() - D('2024-01-01').getTime()) * 0.5
    const halfEnd = anchor.getTime() + (D('2024-12-01').getTime() - anchor.getTime()) * 0.5
    assert.equal(s.getTime(), halfStart)
    assert.equal(e.getTime(), halfEnd)
  })

  test('factor=2 doubles both halves (zoom out)', () => {
    const anchor = D('2024-06-15')
    const start = D('2024-06-01')
    const end = D('2024-07-01')
    const [s, e] = zoomAroundAnchor({ start, end, anchor, factor: 2 })
    assert.equal(s.getTime(), anchor.getTime() - (anchor.getTime() - start.getTime()) * 2)
    assert.equal(e.getTime(), anchor.getTime() + (end.getTime() - anchor.getTime()) * 2)
  })
})

describe('shouldClearToFullExtent', () => {
  test('exact match → true', () => {
    assert.equal(
      shouldClearToFullExtent({ range: [DOMAIN[0], DOMAIN[1]], fullExtent: FULL_EXTENT }),
      true
    )
  })

  test('within 12h tolerance on both ends → true', () => {
    const r = [
      new Date(DOMAIN[0].getTime() - 6 * 60 * 60 * 1000),
      new Date(DOMAIN[1].getTime() + 6 * 60 * 60 * 1000)
    ]
    assert.equal(shouldClearToFullExtent({ range: r, fullExtent: FULL_EXTENT }), true)
  })

  test('beyond tolerance → false', () => {
    const r = [DOMAIN[0], new Date(DOMAIN[1].getTime() - 7 * 24 * 60 * 60 * 1000)]
    assert.equal(shouldClearToFullExtent({ range: r, fullExtent: FULL_EXTENT }), false)
  })

  test('null range → false', () => {
    assert.equal(
      shouldClearToFullExtent({ range: [null, null], fullExtent: FULL_EXTENT }),
      false
    )
  })
})

describe('clampPanToBounds', () => {
  test('range inside bounds → unchanged', () => {
    const start = D('2024-03-01')
    const end = D('2024-04-01')
    const [s, e] = clampPanToBounds({ start, end, fullExtent: FULL_EXTENT })
    assert.equal(s.getTime(), start.getTime())
    assert.equal(e.getTime(), end.getTime())
  })

  test('range overshoots left → shifted right, width preserved', () => {
    const width = 30 * DAY_MS
    const start = new Date(DOMAIN[0].getTime() - 10 * DAY_MS)
    const end = new Date(start.getTime() + width)
    const [s, e] = clampPanToBounds({ start, end, fullExtent: FULL_EXTENT })
    assert.equal(s.getTime(), DOMAIN[0].getTime())
    assert.equal(e.getTime() - s.getTime(), width)
  })

  test('range overshoots right → shifted left, width preserved', () => {
    const width = 30 * DAY_MS
    const end = new Date(DOMAIN[1].getTime() + 10 * DAY_MS)
    const start = new Date(end.getTime() - width)
    const [s, e] = clampPanToBounds({ start, end, fullExtent: FULL_EXTENT })
    assert.equal(e.getTime(), DOMAIN[1].getTime())
    assert.equal(e.getTime() - s.getTime(), width)
  })
})

describe('clampMinRange', () => {
  test('range above minimum → unchanged', () => {
    const start = D('2024-03-01')
    const end = D('2024-03-10')
    const [s, e] = clampMinRange({ start, end, anchorSide: 'start' })
    assert.equal(s.getTime(), start.getTime())
    assert.equal(e.getTime(), end.getTime())
  })

  test('range below minimum, anchorSide=start → end pushed out', () => {
    const start = D('2024-03-01T00:00:00Z')
    const end = D('2024-03-01T01:00:00Z')
    const [s, e] = clampMinRange({ start, end, anchorSide: 'start' })
    assert.equal(s.getTime(), start.getTime())
    assert.equal(e.getTime() - s.getTime(), MIN_RANGE_MS)
  })

  test('range below minimum, anchorSide=end → start pulled back', () => {
    const start = D('2024-03-01T23:00:00Z')
    const end = D('2024-03-02T00:00:00Z')
    const [s, e] = clampMinRange({ start, end, anchorSide: 'end' })
    assert.equal(e.getTime(), end.getTime())
    assert.equal(e.getTime() - s.getTime(), MIN_RANGE_MS)
  })
})

describe('pxToDateMs', () => {
  test('10px on a 992-wide chart of 365-day domain', () => {
    const tol = pxToDateMs({ px: 10, rect: RECT, marginX: MARGIN, domain: DOMAIN })
    const totalMs = DOMAIN[1].getTime() - DOMAIN[0].getTime()
    assert.equal(tol, (10 * totalMs) / INNER)
  })

  test('zero inner width → 0', () => {
    const tol = pxToDateMs({
      px: 10,
      rect: { left: 0, width: 4 },
      marginX: MARGIN,
      domain: DOMAIN
    })
    assert.equal(tol, 0)
  })
})

describe('resolveAction', () => {
  const range = [D('2024-04-01'), D('2024-08-01')]
  const edgeTolMs = 2 * DAY_MS

  test('cursor near start edge → edge-start', () => {
    const cursor = D('2024-04-02')
    assert.equal(
      resolveAction({ cursorDate: cursor, range, fullExtent: FULL_EXTENT, edgeTolMs }),
      'edge-start'
    )
  })

  test('cursor near end edge → edge-end', () => {
    const cursor = D('2024-07-31')
    assert.equal(
      resolveAction({ cursorDate: cursor, range, fullExtent: FULL_EXTENT, edgeTolMs }),
      'edge-end'
    )
  })

  test('cursor inside band, away from edges → pan', () => {
    const cursor = D('2024-06-01')
    assert.equal(
      resolveAction({ cursorDate: cursor, range, fullExtent: FULL_EXTENT, edgeTolMs }),
      'pan'
    )
  })

  test('null range, cursor near full-extent left edge → edge-start', () => {
    const cursor = new Date(FULL_EXTENT[0].getTime() + DAY_MS)
    assert.equal(
      resolveAction({
        cursorDate: cursor,
        range: [null, null],
        fullExtent: FULL_EXTENT,
        edgeTolMs
      }),
      'edge-start'
    )
  })

  test('null range, cursor near full-extent right edge → edge-end', () => {
    const cursor = new Date(FULL_EXTENT[1].getTime() - DAY_MS)
    assert.equal(
      resolveAction({
        cursorDate: cursor,
        range: [null, null],
        fullExtent: FULL_EXTENT,
        edgeTolMs
      }),
      'edge-end'
    )
  })

  test('null range, cursor in middle → create', () => {
    const cursor = D('2024-06-01')
    assert.equal(
      resolveAction({
        cursorDate: cursor,
        range: [null, null],
        fullExtent: FULL_EXTENT,
        edgeTolMs
      }),
      'create'
    )
  })
})
