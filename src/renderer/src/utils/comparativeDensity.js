/**
 * Viewport-local KDEs. Work is bounded by a 256 × 256 grid, not observation
 * count × pixels: deposit weighted sites, then apply a separable Gaussian.
 * Pixel-space bandwidth shrinks in geographic units as the user zooms in.
 */
export function getComparativeGrid(width, height, zoom) {
  const cellSize = Math.max(3, 8 - zoom / 4, width / 256, height / 256)
  return {
    columns: Math.max(1, Math.ceil(width / cellSize)),
    rows: Math.max(1, Math.ceil(height / cellSize)),
    bandwidth: Math.max(24, Math.min(56, 24 + zoom * 1.5))
  }
}

function gaussianBlur(grid, columns, rows, sigmaX, sigmaY) {
  let input = grid
  for (const [sigma, horizontal] of [
    [sigmaX, true],
    [sigmaY, false]
  ]) {
    // A finite three-sigma kernel keeps truly disjoint support transparent.
    const radius = Math.ceil(3 * sigma)
    const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) =>
      Math.exp(-0.5 * ((i - radius) / sigma) ** 2)
    )
    const output = new Float64Array(grid.length)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        let value = 0
        for (let offset = -radius; offset <= radius; offset++) {
          const nx = horizontal ? x + offset : x
          const ny = horizontal ? y : y + offset
          if (nx >= 0 && nx < columns && ny >= 0 && ny < rows) {
            value += input[ny * columns + nx] * kernel[offset + radius]
          }
        }
        output[y * columns + x] = value
      }
    }
    input = output
  }
  const total = input.reduce((sum, value) => sum + value, 0)
  if (total > 0) {
    for (let i = 0; i < input.length; i++) input[i] /= total
  }
  return input
}

/**
 * `project(lat, lng)` returns viewport pixel coordinates (Leaflet handles the
 * projection). Only visible, valid locations participate; counts are the
 * active Explore metric values, so date/time and counting filters are shared
 * with the other map encodings. A missing/null rate is not an observation.
 */
export function buildViewportDensities(locations, speciesNames, { width, height, zoom, project }) {
  const { columns, rows, bandwidth } = getComparativeGrid(width, height, zoom)
  const grids = speciesNames.map(() => new Float64Array(columns * rows))
  if (width <= 0 || height <= 0) return { columns, rows, grids }

  for (const location of locations) {
    const { lat, lng } = location
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      continue
    }
    const point = project(lat, lng)
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.x > width ||
      point.y < 0 ||
      point.y > height
    ) {
      continue
    }

    // Bilinear deposition avoids snapping sites to a single cell when panning.
    const gx = Math.max(0, Math.min(columns - 1, (point.x / width) * columns - 0.5))
    const gy = Math.max(0, Math.min(rows - 1, (point.y / height) * rows - 0.5))
    const x = Math.floor(gx)
    const y = Math.floor(gy)
    const dx = gx - x
    const dy = gy - y
    speciesNames.forEach((name, index) => {
      const weight = location.counts?.[name]
      if (!Number.isFinite(weight) || weight <= 0) return
      const grid = grids[index]
      grid[y * columns + x] += weight * (1 - dx) * (1 - dy)
      if (x + 1 < columns) grid[y * columns + x + 1] += weight * dx * (1 - dy)
      if (y + 1 < rows) grid[(y + 1) * columns + x] += weight * (1 - dx) * dy
      if (x + 1 < columns && y + 1 < rows) grid[(y + 1) * columns + x + 1] += weight * dx * dy
    })
  }

  return {
    columns,
    rows,
    grids: grids.map((grid) =>
      grid.some((value) => value > 0)
        ? gaussianBlur(
            grid,
            columns,
            rows,
            (bandwidth * columns) / width,
            (bandwidth * rows) / height
          )
        : grid
    )
  }
}

/**
 * Overlap = sum of the N-way pointwise minimum (0–1).
 * Imbalance = sum |A − B| / (sum A + sum B), i.e. total variation distance
 * when both normalized distributions are present. Unlike sum(A − B), this
 * does not trivially vanish after normalization. An empty frame has no score.
 */
export function compareDensityGrids(grids, mode) {
  if (grids.length < 2 || (mode === 'difference' && grids.length !== 2)) {
    throw new Error('Overlap requires at least two groups; difference requires exactly two')
  }
  if (mode !== 'overlap' && mode !== 'difference') throw new Error('Unknown comparison mode')
  const length = grids[0].length
  if (grids.some((grid) => grid.length !== length)) throw new Error('Grid dimensions must match')
  const masses = grids.map((grid) => grid.reduce((sum, value) => sum + value, 0))
  const emptyGroups = masses.flatMap((mass, index) => (mass === 0 ? [index] : []))
  const values = new Float64Array(length)
  let total = 0
  let peak = 0
  for (let i = 0; i < length; i++) {
    let value
    if (mode === 'difference') {
      value = grids[0][i] - grids[1][i]
      // Don't turn floating-point cancellation into a full-strength raster
      // when two identical distributions have different observation totals.
      const tolerance = 16 * Number.EPSILON * Math.max(grids[0][i], grids[1][i])
      if (Math.abs(value) <= tolerance) value = 0
    } else {
      value = grids[0][i]
      for (let group = 1; group < grids.length; group++) value = Math.min(value, grids[group][i])
    }
    values[i] = value
    total += Math.abs(value)
    peak = Math.max(peak, Math.abs(value))
  }
  const mass = masses.reduce((sum, value) => sum + value, 0)
  const score =
    mass === 0 ? null : Math.max(0, Math.min(1, mode === 'difference' ? total / mass : total))
  return { values, peak, score, emptyGroups }
}

/** RGBA raster: exact zero is transparent; signed differences use species colors. */
export function colorizeComparison({ values, peak }, mode, colors) {
  const pixels = new Uint8ClampedArray(values.length * 4)
  if (peak === 0) return pixels
  for (let i = 0; i < values.length; i++) {
    const intensity = Math.sqrt(Math.abs(values[i]) / peak)
    if (intensity === 0) continue
    const color = mode === 'overlap' ? [29, 78, 216] : colors[values[i] > 0 ? 0 : 1]
    const base = mode === 'overlap' ? [219, 234, 254] : [255, 255, 255]
    for (let channel = 0; channel < 3; channel++) {
      pixels[i * 4 + channel] = base[channel] + (color[channel] - base[channel]) * intensity
    }
    pixels[i * 4 + 3] = Math.round(210 * intensity)
  }
  return pixels
}

// Derive validity rather than mutating the user's preference as tags change.
export function resolveComparativeMode(mode, selectionCount) {
  return mode === 'difference' && selectionCount === 2 ? 'difference' : 'overlap'
}

export function resolveMapEncoding(encoding, selectionCount) {
  return selectionCount < 2 && (encoding === 'pies' || encoding === 'comparative')
    ? 'graduated'
    : encoding
}
