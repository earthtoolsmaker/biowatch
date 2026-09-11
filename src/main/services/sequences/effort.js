import { isAreaBboxApplicable } from '../../database/queries/bbox.js'
import { normalizeTimeRange } from '../../database/queries/sequences.js'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const WEEK_MS = 7 * DAY_MS

function asMillis(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function insideBbox(row, bbox) {
  if (!isAreaBboxApplicable(bbox)) return true
  if (row.latitude == null || row.longitude == null) return false
  const latitude = Number(row.latitude)
  const longitude = Number(row.longitude)
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= bbox.south &&
    latitude <= bbox.north &&
    longitude >= bbox.west &&
    longitude <= bbox.east
  )
}

/** Validate and normalize deployment rows to half-open millisecond intervals. */
export function validateDeploymentIntervals(
  rows,
  { bbox = null, requireCoordinates = false } = {}
) {
  const intervals = []
  let excludedDeploymentCount = 0
  for (const row of rows || []) {
    if (!insideBbox(row, bbox)) continue
    const latitude = row.latitude == null ? null : Number(row.latitude)
    const longitude = row.longitude == null ? null : Number(row.longitude)
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
    const start = asMillis(row.startMs !== undefined ? row.startMs : row.deploymentStart)
    const end = asMillis(row.endMs !== undefined ? row.endMs : row.deploymentEnd)
    if (start == null || end == null || end <= start || (requireCoordinates && !hasCoordinates)) {
      excludedDeploymentCount += 1
      continue
    }
    intervals.push({
      deploymentID: row.deploymentID,
      start,
      end,
      latitude: hasCoordinates ? latitude : null,
      longitude: hasCoordinates ? longitude : null,
      locationName: row.locationName || null
    })
  }
  return {
    intervals,
    validDeploymentCount: intervals.length,
    excludedDeploymentCount
  }
}

export function clipInterval(interval, start, end) {
  const filterStart = asMillis(start)
  const filterEnd = asMillis(end)
  const clippedStart = filterStart == null ? interval.start : Math.max(interval.start, filterStart)
  const clippedEnd = filterEnd == null ? interval.end : Math.min(interval.end, filterEnd)
  return clippedEnd > clippedStart ? { ...interval, start: clippedStart, end: clippedEnd } : null
}

function selectedHours(timeRange) {
  const ranges = normalizeTimeRange(timeRange)
  if (ranges.length === 0) return null
  const selected = new Set()
  for (let hour = 0; hour < 24; hour += 1) {
    if (
      ranges.some(({ start, end }) => {
        if (start === end) return false
        return start < end ? hour >= start && hour < end : hour >= start || hour < end
      })
    ) {
      selected.add(hour)
    }
  }
  return selected
}

function addPartialHours(target, start, end, allowedHours) {
  let cursor = start
  while (cursor < end) {
    const date = new Date(cursor)
    const hourStart = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours()
    )
    const next = Math.min(end, hourStart + HOUR_MS)
    const hour = date.getUTCHours()
    if (!allowedHours || allowedHours.has(hour)) target[hour] += next - cursor
    cursor = next
  }
}

function addIntervalByHour(target, interval, allowedHours = null) {
  let cursor = interval.start
  const startDate = new Date(cursor)
  const nextMidnight = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate() + 1
  )
  const firstEnd = Math.min(interval.end, nextMidnight)
  addPartialHours(target, cursor, firstEnd, allowedHours)
  cursor = firstEnd

  const fullDays = Math.floor((interval.end - cursor) / DAY_MS)
  if (fullDays > 0) {
    for (let hour = 0; hour < 24; hour += 1) {
      if (!allowedHours || allowedHours.has(hour)) target[hour] += fullDays * HOUR_MS
    }
    cursor += fullDays * DAY_MS
  }
  if (cursor < interval.end) addPartialHours(target, cursor, interval.end, allowedHours)
}

/** Duration of one clipped interval after recurring hour-range intersection. */
export function intersectRecurringTimeRanges(interval, timeRange) {
  const hours = selectedHours(timeRange)
  if (!hours) return interval.end - interval.start
  const totals = Array(24).fill(0)
  addIntervalByHour(totals, interval, hours)
  return totals.reduce((sum, value) => sum + value, 0)
}

export function sumTotalEffort(intervals, { start = null, end = null, timeRange = null } = {}) {
  let milliseconds = 0
  for (const interval of intervals) {
    const clipped = clipInterval(interval, start, end)
    if (clipped) milliseconds += intersectRecurringTimeRanges(clipped, timeRange)
  }
  return milliseconds / DAY_MS
}

function mondayStart(ms) {
  const date = new Date(ms)
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return midnight - ((date.getUTCDay() + 6) % 7) * DAY_MS
}

function weekLabel(mondayMs) {
  return new Date(mondayMs - DAY_MS).toISOString().slice(0, 10)
}

/** Group camera effort into the existing Monday–Sunday buckets (labelled by Sunday). */
export function groupEffortByWeek(intervals, { start = null, end = null } = {}) {
  const effortByWeek = new Map()
  for (const interval of intervals) {
    const clipped = clipInterval(interval, start, end)
    if (!clipped) continue
    let bucketStart = mondayStart(clipped.start)
    while (bucketStart < clipped.end) {
      const overlapStart = Math.max(clipped.start, bucketStart)
      const overlapEnd = Math.min(clipped.end, bucketStart + WEEK_MS)
      if (overlapEnd > overlapStart) {
        const label = weekLabel(bucketStart)
        effortByWeek.set(
          label,
          (effortByWeek.get(label) || 0) + (overlapEnd - overlapStart) / DAY_MS
        )
      }
      bucketStart += WEEK_MS
    }
  }
  return effortByWeek
}

/** Group clipped camera duration into UTC hour buckets, matching SQLite strftime('%H'). */
export function groupEffortByHour(intervals, { start = null, end = null } = {}) {
  const milliseconds = Array(24).fill(0)
  for (const interval of intervals) {
    const clipped = clipInterval(interval, start, end)
    if (clipped) addIntervalByHour(milliseconds, clipped)
  }
  return milliseconds.map((value) => value / DAY_MS)
}

/** Sum effort once per deployment at each coordinate pair. */
export function groupEffortByLocation(
  intervals,
  { start = null, end = null, timeRange = null } = {}
) {
  const locations = new Map()
  for (const interval of intervals) {
    if (interval.latitude == null || interval.longitude == null) continue
    const clipped = clipInterval(interval, start, end)
    if (!clipped) continue
    const effortDays = intersectRecurringTimeRanges(clipped, timeRange) / DAY_MS
    const key = `${interval.latitude},${interval.longitude}`
    const current = locations.get(key) || {
      lat: interval.latitude,
      lng: interval.longitude,
      locationName: interval.locationName,
      effortDays: 0
    }
    current.effortDays += effortDays
    if (!current.locationName && interval.locationName) current.locationName = interval.locationName
    locations.set(key, current)
  }
  return locations
}

export { DAY_MS, HOUR_MS }
