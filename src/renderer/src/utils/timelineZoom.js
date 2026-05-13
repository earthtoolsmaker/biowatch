/**
 * Pure helpers for the TimelineChart brush + zoom + filter behavior.
 *
 * Vocabulary:
 *   - "range"      → [Date, Date] viewport+filter window. Equal to the
 *                    chart's visible x-axis domain and the date filter.
 *   - "fullExtent" → [Date, Date] full data extent (dataMin/dataMax),
 *                    typically derived from the first and last entries
 *                    of timeseriesData.
 *   - "domain"     → [Date, Date] the chart's current XAxis domain,
 *                    either equal to range or to fullExtent when cleared.
 *
 * All math is in millisecond time. No DOM. No React.
 */

export const DAY_MS = 24 * 60 * 60 * 1000
export const MIN_RANGE_MS = DAY_MS
export const CLEAR_TOLERANCE_MS = 12 * 60 * 60 * 1000
export const EDGE_PX_TOLERANCE = 10

export function clientXToDate({ clientX, rect, marginX, domain, clamp = true }) {
  const innerWidth = rect.width - marginX * 2
  if (innerWidth <= 0) return null
  const xPx = clientX - rect.left - marginX
  const rawRatio = xPx / innerWidth
  const ratio = clamp ? Math.max(0, Math.min(1, rawRatio)) : rawRatio
  const ms = domain[0].getTime() + ratio * (domain[1].getTime() - domain[0].getTime())
  return new Date(ms)
}

export function zoomAroundAnchor({ start, end, anchor, factor }) {
  const startMs = start.getTime()
  const endMs = end.getTime()
  const anchorMs = anchor.getTime()
  return [
    new Date(anchorMs - (anchorMs - startMs) * factor),
    new Date(anchorMs + (endMs - anchorMs) * factor)
  ]
}

export function shouldClearToFullExtent({ range, fullExtent, toleranceMs = CLEAR_TOLERANCE_MS }) {
  if (!range[0] || !range[1] || !fullExtent[0] || !fullExtent[1]) return false
  const startDiff = range[0].getTime() - fullExtent[0].getTime()
  const endDiff = fullExtent[1].getTime() - range[1].getTime()
  return startDiff <= toleranceMs && endDiff <= toleranceMs
}

export function clampPanToBounds({ start, end, fullExtent }) {
  const width = end.getTime() - start.getTime()
  const minMs = fullExtent[0].getTime()
  const maxMs = fullExtent[1].getTime()
  let s = start.getTime()
  let e = end.getTime()
  if (s < minMs) {
    s = minMs
    e = s + width
  }
  if (e > maxMs) {
    e = maxMs
    s = e - width
  }
  if (s < minMs) s = minMs
  return [new Date(s), new Date(e)]
}

export function clampMinRange({ start, end, minMs = MIN_RANGE_MS, anchorSide }) {
  if (end.getTime() - start.getTime() >= minMs) return [start, end]
  if (anchorSide === 'start') return [start, new Date(start.getTime() + minMs)]
  return [new Date(end.getTime() - minMs), end]
}

export function pxToDateMs({ px, rect, marginX, domain }) {
  const innerWidth = rect.width - marginX * 2
  if (innerWidth <= 0) return 0
  return (px * (domain[1].getTime() - domain[0].getTime())) / innerWidth
}

export function resolveAction({ cursorDate, range, fullExtent, edgeTolMs }) {
  const cursorMs = cursorDate.getTime()
  const cleared = !range[0] || !range[1]
  if (cleared) {
    const leftEdgeMs = fullExtent[0].getTime() + edgeTolMs
    const rightEdgeMs = fullExtent[1].getTime() - edgeTolMs
    if (cursorMs <= leftEdgeMs) return 'edge-start'
    if (cursorMs >= rightEdgeMs) return 'edge-end'
    return 'create'
  }
  const startMs = range[0].getTime()
  const endMs = range[1].getTime()
  if (Math.abs(cursorMs - startMs) <= edgeTolMs) return 'edge-start'
  if (Math.abs(cursorMs - endMs) <= edgeTolMs) return 'edge-end'
  return 'pan'
}
