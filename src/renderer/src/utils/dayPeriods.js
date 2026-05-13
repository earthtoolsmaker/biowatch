/**
 * Day-period presets and the helpers that translate UI selection state
 * (chip set, drag-arc) into the {ranges: [...]} shape consumed by the
 * backend timeRange filter.
 *
 * Hour ranges are half-open [start, end) in 24h local clock time. Night
 * wraps midnight (start > end).
 */

export const DAY_PERIOD_PRESETS = {
  dawn: {
    key: 'dawn',
    label: 'Dawn',
    range: { start: 5, end: 8 },
    description:
      'Sunrise window — peak activity for many mammals as day-active species emerge and night-active species return to cover.'
  },
  day: {
    key: 'day',
    label: 'Day',
    range: { start: 8, end: 18 },
    description:
      'Daytime hours — when diurnal species are active (squirrels, most birds, deer in open habitats).'
  },
  dusk: {
    key: 'dusk',
    label: 'Dusk',
    range: { start: 18, end: 21 },
    description:
      'Sunset window — second daily activity peak. Mirrors dawn for many crepuscular species.'
  },
  night: {
    key: 'night',
    label: 'Night',
    range: { start: 21, end: 5 },
    description:
      'Nocturnal hours — when night-active species are out (owls, bats, badgers, many cats and small mammals).'
  }
}

/**
 * Format a {start, end} hour range as "HH:00 → HH:00".
 */
export function formatRange({ start, end }) {
  const fmt = (h) => `${String(h).padStart(2, '0')}:00`
  return `${fmt(start)} → ${fmt(end)}`
}

// Canonical render order: chronological, dawn first.
export const DAY_PERIOD_ORDER = ['dawn', 'day', 'dusk', 'night']

/**
 * The default chip selection — all four chips active, equivalent to
 * "no filter" but visually expressing "full day selected" (mirrors the
 * timeline filter, which defaults to the full date range).
 */
export const ALL_CHIPS_SELECTED = new Set(DAY_PERIOD_ORDER)

/**
 * Convert a chip selection (Set<string>) into an ordered ranges array.
 * Unknown keys are ignored.
 */
export function chipsToRanges(selection) {
  return DAY_PERIOD_ORDER.filter((key) => selection.has(key)).map(
    (key) => DAY_PERIOD_PRESETS[key].range
  )
}

/**
 * Whether a freeform drag-arc {start, end} effectively covers the whole
 * day. Tolerance handles fractional-hour drift from the polar drag.
 */
export function isFullDayArc(arc) {
  if (!arc) return true
  const { start, end } = arc
  if (start === end) return true
  return Math.abs(end - start) >= 23.9
}

/**
 * Convert a drag-arc {start, end} into the ranges array. Returns [] when
 * the arc is full-day (== no filter).
 */
export function arcToRanges(arc) {
  if (isFullDayArc(arc)) return []
  return [{ start: arc.start, end: arc.end }]
}

/**
 * Merge contiguous integer-hour ranges (handles wrap-around at midnight).
 * Used to convert chip selections into the smallest set of arcs/bands the
 * UI should draw — so {dawn, day} renders as a single 5→18 arc instead of
 * two abutting arcs, and {dawn, day, dusk, night} renders as a single
 * full-day sweep instead of four pie slices.
 *
 * Output uses half-open [start, end) hour ranges; full-day collapses to
 * a single [{start: 0, end: 24}] sector.
 */
export function mergeChipRanges(ranges) {
  if (ranges.length === 0) return []
  const covered = new Array(24).fill(false)
  for (const { start, end } of ranges) {
    if (start === end) continue
    if (start < end) {
      for (let h = start; h < end; h++) covered[h] = true
    } else {
      for (let h = start; h < 24; h++) covered[h] = true
      for (let h = 0; h < end; h++) covered[h] = true
    }
  }
  if (covered.every(Boolean)) return [{ start: 0, end: 24 }]

  const runs = []
  let i = 0
  while (i < 24) {
    if (covered[i]) {
      const start = i
      while (i < 24 && covered[i]) i++
      runs.push({ start, end: i })
    } else {
      i++
    }
  }
  // Wrap-around: first run touches 0 and last run touches 24 → merge
  // into one wrap-around range (start > end).
  if (runs.length >= 2 && runs[0].start === 0 && runs[runs.length - 1].end === 24) {
    const last = runs.pop()
    runs[0] = { start: last.start, end: runs[0].end }
  }
  return runs
}
