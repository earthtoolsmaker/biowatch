/**
 * Maps a deployment's start/end onto the sparkline's x-axis, snapped to
 * bucket edges: the left edge of the first bucket the deployment overlaps
 * and the right edge of the last one. Snapping keeps the marks on the cell
 * boundaries the sparkline already draws instead of landing mid-cell. All
 * rows share the same bucket grid. A missing start or end is open-ended
 * and clamps to the grid edge.
 *
 * @returns {{ leftPct: number, widthPct: number } | null} null when nothing
 *   should be drawn.
 */
export function coverageExtent(periods, deploymentStart, deploymentEnd) {
  if (!periods || periods.length === 0) return null
  if (!deploymentStart && !deploymentEnd) return null
  const n = periods.length
  const start = deploymentStart ? new Date(deploymentStart).getTime() : -Infinity
  const end = deploymentEnd ? new Date(deploymentEnd).getTime() : Infinity
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null

  // First bucket that ends after the start, last bucket that begins before
  // the end. Buckets are half-open [start, end), so a date sitting exactly
  // on a boundary belongs to one bucket only.
  const first = periods.findIndex((p) => new Date(p.end).getTime() > start)
  let last = -1
  for (let i = n - 1; i >= 0; i--) {
    if (new Date(periods[i].start).getTime() < end) {
      last = i
      break
    }
  }
  if (first === -1 || last < first) return null

  return {
    leftPct: (first / n) * 100,
    widthPct: ((last + 1 - first) / n) * 100
  }
}

/**
 * True when a timeline bucket lies entirely before the deployment started
 * or entirely after it ended. Missing dates are open-ended.
 */
export function isOutsideCoverage(bucket, deploymentStart, deploymentEnd) {
  if (deploymentStart && new Date(bucket.end) <= new Date(deploymentStart)) return true
  if (deploymentEnd && new Date(bucket.start) >= new Date(deploymentEnd)) return true
  return false
}
