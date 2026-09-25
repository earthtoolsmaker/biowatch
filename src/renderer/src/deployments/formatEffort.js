const EM_DASH = '—'

/**
 * Format camera-days for the Deployments tab: nearest whole day with a
 * thousands separator (same rounding as the Overview camera-days tile), em
 * dash when the deployment has no valid interval. The underlying value
 * stays fractional; only the display rounds.
 */
export function formatEffortDays(days) {
  if (typeof days !== 'number' || Number.isNaN(days)) return EM_DASH
  return Math.round(days).toLocaleString('en-US')
}

/**
 * Camera-days with a pluralized unit: "44 days", "1 day", "< 1 day" for
 * intervals that round to zero, em dash for null. `unit` is the singular
 * ("day" for the column, "camera-day" for tooltip headlines).
 */
export function formatEffortLabel(days, unit) {
  if (typeof days !== 'number' || Number.isNaN(days)) return EM_DASH
  const rounded = Math.round(days)
  if (rounded === 0) return `< 1 ${unit}`
  if (rounded === 1) return `1 ${unit}`
  return `${formatEffortDays(days)} ${unit}s`
}

/**
 * "Jun 4 – Jul 18, 2018" (year once when shared, otherwise on both ends).
 * Local time, matching the settings popover's Start/End rows. Null when
 * either date is missing or unparseable.
 */
export function formatDateRange(start, end) {
  const s = start ? new Date(start) : null
  const e = end ? new Date(end) : null
  if (!s || !e || Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null
  const sameYear = s.getFullYear() === e.getFullYear()
  const monthDay = { month: 'short', day: 'numeric' }
  const full = { ...monthDay, year: 'numeric' }
  const left = s.toLocaleDateString('en-US', sameYear ? monthDay : full)
  const right = e.toLocaleDateString('en-US', full)
  return `${left} – ${right}`
}
