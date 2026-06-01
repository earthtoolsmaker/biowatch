/**
 * Pure geometry + interaction helpers for the daytime-filter charts.
 * No React, no DOM — unit-tested in test/renderer/ui/clockGeometry.test.js.
 *
 * Hours are 24h clock values; bands are {start, end} half-open ranges where
 * start > end means the band wraps midnight (e.g. night 21 -> 5).
 */

// Clock angle in degrees, measured clockwise from 0h at the top.
export const timeToAngle = (time) => (time * 15) % 360

// Inverse of timeToAngle for an angle already normalized to [0, 360).
export const angleToTime = (angle) => (angle / 15) % 24

// Whether `cursor` (hours) falls strictly inside a possibly-wrapping band.
export const isInsideBand = (cursor, band) => {
  if (band.start < band.end) return cursor > band.start && cursor < band.end
  return cursor > band.start || cursor < band.end
}

// Whether a band wraps past midnight (start >= end). Single source of truth
// for the wrap convention used by bandWidth, resolveAction, and the views.
export const bandWraps = (band) => band.start >= band.end

// Width in hours of a (possibly wrap-around) band.
export const bandWidth = (band) =>
  bandWraps(band) ? 24 - band.start + band.end : band.end - band.start

// Edge grab-zone half-width (hours): at least 1h so short bands are
// targetable, capped at 2h so it never takes over a wide band.
export const edgeTolFor = (width) => Math.max(1, Math.min(2, width / 3))

// Split one band into renderable [start, end] segments, breaking a
// wrap-around band into two pieces at midnight.
export const bandToSegments = (band) => {
  if (band.start === band.end) return []
  if (band.start < band.end) return [[band.start, band.end]]
  return [
    [band.start, 24],
    [0, band.end]
  ]
}

// Flatten an array of bands into renderable segments.
export const rangesToSegments = (ranges) => ranges.flatMap(bandToSegments)

// Distinct interior boundary hours of a selection, used to draw the dashed
// guide lines in the plots. Endpoints at the 0/24 seam are dropped (they
// coincide with the plot/circle edge), so a full-day selection yields none.
export const rangesToBoundaries = (ranges) => {
  const hours = new Set()
  for (const [s, e] of rangesToSegments(ranges)) {
    if (s !== 0 && s !== 24) hours.add(s)
    if (e !== 0 && e !== 24) hours.add(e)
  }
  return [...hours].sort((a, b) => a - b)
}

// Decide what a click/drag at `cursor` (hours) should do, given the current
// selection. Only a single non-wrap band supports edge-resize; everything
// else is pan (inside) or create (outside / multi-band / empty).
export const resolveAction = (cursor, ranges) => {
  if (ranges.length !== 1) return 'create'
  const { start, end } = ranges[0]
  const isWrap = bandWraps(ranges[0])
  const tol = edgeTolFor(bandWidth(ranges[0]))
  if (!isWrap && cursor >= end - tol && cursor <= end + tol) return 'edge-end'
  if (!isWrap && cursor >= start - tol && cursor <= start + tol) return 'edge-start'
  if (isInsideBand(cursor, { start, end })) return 'pan'
  return 'create'
}
