/**
 * Sequence gap slider stops, in seconds (0 = Off). Non-linear so short gaps
 * (burst grouping) and long gaps (30min–2h independence windows) are both
 * reachable without a 720-position slider.
 */
export const SEQUENCE_GAP_STOPS = [
  0, 10, 20, 30, 45, 60, 90, 120, 180, 240, 300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200
]

/**
 * Index of the stop closest to a gap value (null = Off → 0).
 * @param {number | null} seconds
 * @returns {number}
 */
export function gapToStopIndex(seconds) {
  const s = seconds ?? 0
  let best = 0
  for (let i = 1; i < SEQUENCE_GAP_STOPS.length; i++) {
    if (Math.abs(SEQUENCE_GAP_STOPS[i] - s) < Math.abs(SEQUENCE_GAP_STOPS[best] - s)) best = i
  }
  return best
}

/**
 * Format sequence gap value for display
 * @param {number | null} seconds - The gap in seconds, or null for Off
 * @returns {string} - Formatted string (e.g., "Off", "30s", "1min 30s", "2min", "1h 30min")
 */
export function formatGapValue(seconds) {
  if (seconds === null || seconds === 0) return 'Off'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 120 && seconds % 60) return `${Math.floor(seconds / 60)}min ${seconds % 60}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return minutes ? `${hours}h ${minutes}min` : `${hours}h`
}
