import { DateTime, FixedOffsetZone, IANAZone } from 'luxon'

// Camera clocks may follow civil time, or remain on one fixed offset all year.
export function cameraZone(value) {
  if (!value) return null
  if (value === 'UTC' || IANAZone.isValidZone(value)) return value
  const match = /^UTC([+-])(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const minutes = Number(match[2]) * 60 + Number(match[3])
  if (Number(match[2]) > 14 || Number(match[3]) > 59 || minutes > 840) return null
  return FixedOffsetZone.instance((match[1] === '-' ? -1 : 1) * minutes)
}

export function hasExplicitOffset(value) {
  return typeof value === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
}

/** Parse without ever consulting the host timezone. Naive values remain floating. */
export function parseCameraTime(value, timeZone = null) {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  if (!/^\d{4}[-:]\d{2}[-:]\d{2}(?:[T ]|$)/.test(text)) return null
  const explicit = hasExplicitOffset(text)
  const zone = explicit ? 'UTC' : cameraZone(timeZone)
  const options = { zone: zone || 'UTC', setZone: true }
  let date = DateTime.fromISO(text, options)
  if (!date.isValid) date = DateTime.fromSQL(text, options)
  if (!date.isValid) date = DateTime.fromFormat(text, 'yyyy:MM:dd HH:mm:ss', options)
  if (!date.isValid) return null

  // Luxon shifts nonexistent spring-forward times and chooses an offset for
  // ambiguous fall-back times. Neither is evidence of the camera's instant.
  if (!explicit && zone) {
    const wall = parseCameraTime(text)
    if (!wall || wall.local !== date.toISO({ includeOffset: false })) return null
    if (date.getPossibleOffsets().length !== 1) return null
  }
  return {
    local: date.toISO({ includeOffset: false }),
    utc: explicit || zone ? date.toUTC().toISO() : null,
    zoned: explicit || zone ? date.toISO() : null,
    offset: explicit || zone ? date.offset : null
  }
}

/** Offset evidence for effort when no named camera time setting was supplied. */
export function fixedCameraZone(start, end) {
  if (!hasExplicitOffset(start) || !hasExplicitOffset(end)) return null
  const a = parseCameraTime(start)
  const b = parseCameraTime(end)
  if (!a || !b || a.offset !== b.offset) return null
  const offset = a.offset
  if (offset === 0) return 'UTC'
  return `UTC${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`
}

export function effortCameraZone(start, end, setting) {
  const zone = cameraZone(setting)
  if (!zone) return fixedCameraZone(start, end)
  // Explicit source offsets win. A contradictory clock setting cannot be
  // used as their effort denominator.
  for (const source of [start, end]) {
    if (!hasExplicitOffset(source)) continue
    const parsed = parseCameraTime(source)
    if (!parsed || DateTime.fromISO(parsed.utc).setZone(zone).offset !== parsed.offset) return null
  }
  return setting
}

/** Read EXIF clocks as strings, combining their separately stored offset tags. */
export function exifCameraTimestamp(exif) {
  const fields = [
    ['DateTimeOriginal', 'OffsetTimeOriginal'],
    ['CreateDate', 'OffsetTimeDigitized'],
    ['MediaCreateDate', 'OffsetTime']
  ]
  for (const [field, offsetField] of fields) {
    const value = exif[field]
    const parsed = parseCameraTime(value)
    if (!parsed) continue
    if (hasExplicitOffset(value)) return value
    const offset = exif[offsetField] || exif.OffsetTime
    if (typeof offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(offset)) {
      const combined = parsed.local + offset
      if (parseCameraTime(combined)) return combined
    }
    return value
  }
  return null
}

/** Export a real instant with the camera's offset so a reimport retains its clock. */
export function formatCameraTimestamp(utc, source, timeZone = null) {
  if (!utc) return null
  const sourceTime = parseCameraTime(source)
  const zone =
    hasExplicitOffset(source) && sourceTime
      ? FixedOffsetZone.instance(sourceTime.offset)
      : cameraZone(timeZone)
  return zone ? DateTime.fromISO(utc, { zone: 'UTC' }).setZone(zone).toISO() : utc
}

/** Installed on every writing connection; triggers maintain the two time bases. */
export function registerCameraTimeFunctions(sqlite) {
  // Trigger statements request local and UTC forms repeatedly for one row.
  // A one-entry cache avoids repeated Luxon parsing without retaining a study.
  let previousValue, previousZone, previousResult
  const parse = (value, zone) => {
    if (value !== previousValue || zone !== previousZone) {
      previousValue = value
      previousZone = zone
      previousResult = parseCameraTime(value, zone)
    }
    return previousResult
  }
  sqlite.function(
    'camera_utc',
    { deterministic: true },
    (value, zone) => parse(value, zone)?.utc ?? null
  )
  sqlite.function(
    'camera_local',
    { deterministic: true },
    (value, zone) => parse(value, zone)?.local ?? null
  )
  sqlite.function('camera_effort_zone', { deterministic: true }, effortCameraZone)
}
