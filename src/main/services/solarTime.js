import SunCalc from 'suncalc'

export const SOLAR_DAY_MS = 86_400_000
export const SOLAR_CACHE_LIMIT = 2048

export function validSolarCoordinates(latitude, longitude) {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180
  )
}

// Canonical instants only: never interpret floating strings in the host timezone.
function instantMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !/T.*Z$/.test(value)) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** Cache astronomy by coordinates and mean-solar date, never by observation. */
export function createSolarClock({ getTimes = SunCalc.getTimes, limit = SOLAR_CACHE_LIMIT } = {}) {
  const cache = new Map()
  const cycle = (day, latitude, longitude) => {
    const key = `${latitude},${longitude},${day}`
    if (cache.has(key)) {
      const value = cache.get(key)
      cache.delete(key)
      cache.set(key, value)
      return value
    }
    // Sample near mean-solar noon so getTimes selects this cycle even at ±180°.
    const times = getTimes(
      new Date((day + 0.5 - longitude / 360) * SOLAR_DAY_MS),
      latitude,
      longitude
    )
    const sunrise = times.sunrise?.getTime()
    const sunset = times.sunset?.getTime()
    const value = {
      sunrise: Number.isFinite(sunrise) ? sunrise : null,
      sunset: Number.isFinite(sunset) ? sunset : null
    }
    cache.set(key, value)
    while (cache.size > Math.max(1, limit)) cache.delete(cache.keys().next().value)
    return value
  }
  function* segments(start, end, latitude, longitude) {
    if (
      !validSolarCoordinates(latitude, longitude) ||
      !Number.isFinite(start) ||
      !Number.isFinite(end)
    )
      return
    const first = Math.floor(start / SOLAR_DAY_MS + longitude / 360) - 1
    const last = Math.floor(end / SOLAR_DAY_MS + longitude / 360) + 1
    for (let day = first; day <= last; day++) {
      const today = cycle(day, latitude, longitude)
      const next = cycle(day + 1, latitude, longitude)
      // Only consecutive cycles. A missing polar event is a gap, not a season-long night.
      if (today.sunrise != null && today.sunset != null && today.sunset > today.sunrise) {
        if (today.sunset > start && today.sunrise < end)
          yield { start: today.sunrise, end: today.sunset, solarStart: 6 }
      }
      if (
        today.sunset != null &&
        next.sunrise != null &&
        next.sunrise > today.sunset &&
        next.sunrise - today.sunset < 2 * SOLAR_DAY_MS
      ) {
        if (next.sunrise > start && today.sunset < end)
          yield { start: today.sunset, end: next.sunrise, solarStart: 18 }
      }
    }
  }
  const hours = (instant, latitude, longitude) => {
    const ms = instantMs(instant)
    if (ms == null) return null
    for (const segment of segments(ms, ms + 1, latitude, longitude)) {
      if (ms >= segment.start && ms < segment.end)
        return (
          (segment.solarStart + (12 * (ms - segment.start)) / (segment.end - segment.start)) % 24
        )
    }
    return null
  }
  return {
    hours,
    segments,
    get cacheSize() {
      return cache.size
    }
  }
}

export const solarClock = createSolarClock()
export const solarHours = solarClock.hours

/** Inverse-map each solar boundary; accumulate actual milliseconds, not normalized hours. */
export function solarExposure(interval, ranges = []) {
  const totals = Array(24).fill(0)
  for (const segment of solarClock.segments(
    interval.start,
    interval.end,
    interval.latitude,
    interval.longitude
  )) {
    const unit = (segment.end - segment.start) / 12
    for (let i = 0; i < 12; i++) {
      const hour = (segment.solarStart + i) % 24
      const selections = ranges.length ? ranges : [{ start: 0, end: 24 }]
      // Union selected portions inside this bin (also supports fractional ranges).
      const portions = selections
        .flatMap(({ start, end }) =>
          start === end
            ? []
            : start < end
              ? [[start, end]]
              : [
                  [start, 24],
                  [0, end]
                ]
        )
        .map(([a, b]) => [Math.max(hour, a), Math.min(hour + 1, b)])
        .filter(([a, b]) => b > a)
        .sort((a, b) => a[0] - b[0])
      let usedEnd = hour
      for (const [a, b] of portions) {
        const from = Math.max(a, usedEnd)
        usedEnd = Math.max(usedEnd, b)
        if (b <= from) continue
        const start = Math.max(interval.start, segment.start + (i + from - hour) * unit)
        const end = Math.min(interval.end, segment.start + (i + b - hour) * unit)
        totals[hour] += Math.max(0, end - start)
      }
    }
  }
  return totals
}

export function registerSolarTimeFunctions(sqlite) {
  sqlite.function('solar_hours', { deterministic: true }, solarHours)
}
