// Data-sufficiency gate for the Explore species hovercard's activity charts.
//
// The card shows two all-time charts (daytime 24h activity + activity over
// time) for the hovered species. We gate them all-or-nothing: unless the
// species has enough timestamped detections spanning enough distinct dates,
// we hide the whole activity section and fall back to the plain card. This
// single gate covers the no-temporal-data, date-only, single-day and
// 1-3-detection cases uniformly.

// Minimum timestamped detections (summed across the 24 hourly bins) before
// the daytime clock is meaningful rather than noise.
export const MIN_ACTIVITY_DETECTIONS = 10

// Minimum distinct dates with detections before the over-time line is more
// than a single point.
export const MIN_ACTIVITY_DATES = 2

// Total timestamped detections for `scientificName` across the hourly bins
// returned by sequences:get-daily-activity (rows of { hour, [sci]: count }).
export function sumDailyActivity(dailyActivity, scientificName) {
  if (!Array.isArray(dailyActivity)) return 0
  return dailyActivity.reduce((sum, row) => sum + (row?.[scientificName] || 0), 0)
}

// Number of distinct dates with at least one detection for `scientificName`
// in the per-day series from sequences:get-timeseries (rows of
// { date, [sci]: count }).
export function countActivityDates(timeseries, scientificName) {
  if (!Array.isArray(timeseries)) return 0
  return timeseries.reduce((n, day) => n + ((day?.[scientificName] || 0) > 0 ? 1 : 0), 0)
}

// All-or-nothing gate: both charts show only when the species clears both
// thresholds.
export function hasEnoughActivityData(dailyActivity, timeseries, scientificName) {
  return (
    sumDailyActivity(dailyActivity, scientificName) >= MIN_ACTIVITY_DETECTIONS &&
    countActivityDates(timeseries, scientificName) >= MIN_ACTIVITY_DATES
  )
}
