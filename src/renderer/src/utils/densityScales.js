/**
 * Color scales for the Explore map's density encodings (heatmap + hex grid).
 *
 * A scale is an ordered list of `#rrggbb` stops from low → high activity, read
 * as evenly spaced across the 0–1 range (the helpers below interpolate between
 * them). The set is deliberately small but covers the common failure mode:
 * the green-low "Warm" ramp vanishes into forest canopy, so "Magma" and
 * "Viridis" — which start dark/purple — are offered for green basemaps. Magma
 * and Viridis are also colorblind-safe.
 *
 * @typedef {{ key: string, label: string, stops: string[] }} DensityScale
 * @type {DensityScale[]}
 */
export const DENSITY_SCALES = [
  { key: 'warm', label: 'Warm', stops: ['#22c55e', '#eab308', '#f97316', '#ef4444'] },
  { key: 'magma', label: 'Magma', stops: ['#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'] },
  {
    key: 'viridis',
    label: 'Viridis',
    stops: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725']
  }
]

/** Key of the scale used when a study has no saved preference. */
export const DEFAULT_DENSITY_SCALE = 'warm'

/**
 * Look up a scale by key, falling back to the first scale for an unknown or
 * stale key (e.g. a persisted value left over from a removed scale).
 *
 * @param {string} key
 * @returns {DensityScale}
 */
export function getDensityScale(key) {
  return DENSITY_SCALES.find((s) => s.key === key) || DENSITY_SCALES[0]
}

/**
 * Linearly interpolate between two `#rrggbb` colors.
 *
 * @param {string} c1 Start color, `#rrggbb`.
 * @param {string} c2 End color, `#rrggbb`.
 * @param {number} f Fraction in [0, 1]; 0 returns `c1`, 1 returns `c2`.
 * @returns {string} An `rgb(r,g,b)` string.
 */
function lerpHexColor(c1, c2, f) {
  const channels = (c) => [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16)
  ]
  const [r1, g1, b1] = channels(c1)
  const [r2, g2, b2] = channels(c2)
  const mix = (a, b) => Math.round(a + (b - a) * f)
  return `rgb(${mix(r1, r2)},${mix(g1, g2)},${mix(b1, b2)})`
}

/**
 * Sample a scale's stop list at a normalized position — used to color each
 * hex-bin cell by its intensity. Stops are treated as evenly spaced, so the
 * value is mapped onto the matching segment and interpolated within it.
 *
 * @param {string[]} stops Evenly-spaced `#rrggbb` stops (low → high).
 * @param {number} t Normalized intensity; clamped to [0, 1].
 * @returns {string} An `rgb(r,g,b)` string.
 */
export function interpolateScale(stops, t) {
  const x = Math.max(0, Math.min(1, t))
  const seg = 1 / (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x / seg))
  const f = (x - i * seg) / seg
  return lerpHexColor(stops[i], stops[i + 1], f)
}

/**
 * Build a CSS `linear-gradient(...)` from a stop list, for the legend bar and
 * the picker swatches. The browser handles the interpolation here, so the raw
 * stops are passed straight through.
 *
 * @param {string[]} stops
 * @returns {string} A CSS `linear-gradient(to right, …)` value.
 */
export function scaleToCssGradient(stops) {
  return `linear-gradient(to right, ${stops.join(', ')})`
}

/**
 * Convert a stop list into the `{ position: color }` gradient object that
 * leaflet.heat expects, placing each stop at an even position across [0, 1].
 *
 * @param {string[]} stops
 * @returns {Record<number, string>} Position (0–1) → `#rrggbb`.
 */
export function scaleToHeatGradient(stops) {
  const gradient = {}
  stops.forEach((color, i) => {
    gradient[i / (stops.length - 1)] = color
  })
  return gradient
}
