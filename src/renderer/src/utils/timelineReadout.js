import { COUNTING_OBSERVATIONS, NORMALIZATION_RAI_100 } from '../../../shared/analysisMetric.js'
import { formatAnalysisValue } from './analysisMetric.js'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Hover-readout label for a weekly timeseries row. Rows are labelled with the
 * Sunday before their Monday–Sunday bucket (UTC midnight), so the readout
 * names the Monday the week actually starts on. Formatted in UTC so the
 * viewer's timezone can't shift it by a day.
 */
export function formatWeekLabel(labelMs) {
  return new Date(labelMs + DAY_MS).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

/**
 * Per-species readout entries for one weekly row of real (unscaled) values,
 * highest first. A null value is an RAI week without camera effort: shown as
 * unavailable and listed last. Missing values are weeks with no detections.
 */
export function buildReadoutRows({ row, selectedSpecies, palette, metric }) {
  return selectedSpecies
    .map((species, index) => {
      const value = row[species.scientificName] === null ? null : row[species.scientificName] || 0
      return {
        scientificName: species.scientificName,
        color: palette[index % palette.length],
        value,
        formatted: formatAnalysisValue(value, metric)
      }
    })
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
}

/**
 * Weekly rows whose label falls inside [start, end] (inclusive). With no range
 * set, returns the rows unchanged. Lets a zoomed chart fit its y-axis to the
 * visible weeks instead of the study-wide peak.
 */
export function rowsInRange(rows, [start, end]) {
  if (!start || !end) return rows
  const startMs = start.getTime()
  const endMs = end.getTime()
  return rows.filter((row) => {
    const t = new Date(row.date).getTime()
    return t >= startMs && t <= endMs
  })
}

/** Y-axis title naming what the plotted values count. */
export function yAxisUnitLabel(metric) {
  const basis =
    metric?.counting === COUNTING_OBSERVATIONS ? 'Independent observations' : 'Individuals'
  return metric?.normalization === NORMALIZATION_RAI_100 ? `${basis} per 100 camera-days` : basis
}

/**
 * Y-axis ticks from 0 in a round step (1, 2 or 5 × 10ⁿ), at most five
 * intervals, ending at the first tick at or above `max`.
 */
export function niceYTicks(max) {
  if (!(max > 0)) return [0, 1]
  const mag = 10 ** Math.floor(Math.log10(max / 5))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => Math.ceil(max / s) <= 5)
  const count = Math.ceil(max / step)
  // toFixed trims float noise such as 0.30000000000000004.
  return Array.from({ length: count + 1 }, (_, i) => Number((i * step).toFixed(10)))
}

/**
 * Width of one species' bar in a weekly bar chart: the species share 80% of
 * a week's horizontal slot, so groups keep a gap between weeks. At least 1px.
 */
export function barSizePx({ plotWidth, domainMs, speciesCount }) {
  if (!(plotWidth > 0) || !(domainMs > 0) || !(speciesCount > 0)) return 1
  const slotPx = (plotWidth * 7 * DAY_MS) / domainMs
  return Math.max(1, Math.floor((slotPx * 0.8) / speciesCount))
}

/** Highest value of `keys` across the rows inside the range (0 when none). */
export function maxValueInRange(rows, range, keys) {
  let max = 0
  for (const row of rowsInRange(rows, range)) {
    for (const key of keys) {
      const v = row[key]
      if (typeof v === 'number' && v > max) max = v
    }
  }
  return max
}
