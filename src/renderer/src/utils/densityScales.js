// Named color scales for the density encodings (heatmap + hex grid). Each is an
// ordered list of hex stops from low → high activity, spaced evenly. The set is
// chosen so at least one reads well over any basemap: the green-low "Warm" ramp
// disappears into forest canopy, whereas Magma/Viridis keep contrast over green
// imagery. Viridis and Magma are also colorblind-safe.
export const DENSITY_SCALES = [
  { key: 'warm', label: 'Warm', stops: ['#22c55e', '#eab308', '#f97316', '#ef4444'] },
  { key: 'magma', label: 'Magma', stops: ['#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'] },
  {
    key: 'viridis',
    label: 'Viridis',
    stops: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725']
  }
]

export const DEFAULT_DENSITY_SCALE = 'warm'

export function getDensityScale(key) {
  return DENSITY_SCALES.find((s) => s.key === key) || DENSITY_SCALES[0]
}

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

// Interpolate a normalized 0–1 value across an evenly-spaced stop list → 'rgb(...)'.
export function interpolateScale(stops, t) {
  const x = Math.max(0, Math.min(1, t))
  const seg = 1 / (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x / seg))
  const f = (x - i * seg) / seg
  return lerpHexColor(stops[i], stops[i + 1], f)
}

// CSS `linear-gradient(...)` for legend bars and picker swatches.
export function scaleToCssGradient(stops) {
  return `linear-gradient(to right, ${stops.join(', ')})`
}

// leaflet.heat gradient object { position: color } from evenly-spaced stops.
export function scaleToHeatGradient(stops) {
  const gradient = {}
  stops.forEach((color, i) => {
    gradient[i / (stops.length - 1)] = color
  })
  return gradient
}
