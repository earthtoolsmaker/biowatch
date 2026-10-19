const pad = (h) => `${String(h).padStart(2, '0')}:00`

/** Readout label for an hourly bin, e.g. 6 → "06:00–07:00". */
export function formatHourRange(hour) {
  return `${pad(hour)}–${pad(hour + 1)}`
}

/**
 * Width of one species' bar in a 24-bin hourly chart: the species share 80%
 * of an hour's slot, so groups keep a gap between hours. At least 1px.
 */
export function hourBarSizePx({ plotWidth, speciesCount }) {
  if (!(plotWidth > 0) || !(speciesCount > 0)) return 1
  return Math.max(1, Math.floor(((plotWidth / 24) * 0.8) / speciesCount))
}

// Two decimals keep SVG paths readable and free of float noise.
const round = (v) => Number(v.toFixed(2))

/**
 * Screen position of `hour` on a 24-hour clock face: midnight at the top,
 * running clockwise — the same layout Recharts' RadarChart uses by default
 * (start angle 90°, end angle -270°).
 */
export function polarPoint({ cx, cy, r, hour }) {
  const a = (hour / 24) * 2 * Math.PI
  return { x: round(cx + r * Math.sin(a)), y: round(cy - r * Math.cos(a)) }
}

/** SVG path of the wedge between two hours (start < end, within one day). */
export function sectorPath({ cx, cy, r, start, end }) {
  const span = end - start
  if (span >= 24) {
    // A full day: a circle drawn as two half arcs.
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`
  }
  const p0 = polarPoint({ cx, cy, r, hour: start })
  const p1 = polarPoint({ cx, cy, r, hour: end })
  const largeArc = span > 12 ? 1 : 0
  return `M ${cx} ${cy} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArc} 1 ${p1.x} ${p1.y} Z`
}
