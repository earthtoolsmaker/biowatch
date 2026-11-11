import { DateTime, FixedOffsetZone } from 'luxon'

const formatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  // UTC is only a formatting carrier for wall-clock components. Never let
  // Intl reinterpret a camera clock in the viewer's computer timezone.
  timeZone: 'UTC'
}
const FORMATTER = new Intl.DateTimeFormat('en-US', formatOptions)
const DETAIL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  ...formatOptions,
  second: '2-digit'
})
const hasOffset = (value) => typeof value === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)

/** Interpret the written clock components without applying any timezone shift. */
export function wallTimeToDate(value) {
  const text = value instanceof Date ? value.toISOString() : value
  if (typeof text !== 'string') return null
  const date = DateTime.fromISO(text, { zone: 'UTC', setZone: true })
  if (!date.isValid) return null
  return new Date(
    Date.UTC(
      date.year,
      date.month - 1,
      date.day,
      date.hour,
      date.minute,
      date.second,
      date.millisecond
    )
  )
}

/** Compact wall-clock formatter; an explicit offset never changes its written hour. */
export function formatGridTimestamp(timestamp) {
  const date = wallTimeToDate(timestamp)
  return date ? FORMATTER.format(date) : ''
}

/** A confirmed camera setting changes presentation, never the stored instant/source. */
function getCameraDisplayTime(media) {
  if (!media?.cameraTimeZone || !hasOffset(media.timestamp)) return null
  const zone = FixedOffsetZone.parseSpecifier(media.cameraTimeZone) || media.cameraTimeZone
  const date = DateTime.fromISO(media.timestamp, { zone: 'UTC' }).setZone(zone)
  return date.isValid ? date : null
}

/** Display/editor clock: confirmed camera setting, source clock, then UTC fallback. */
export function getMediaWallTime(media) {
  const cameraTime = getCameraDisplayTime(media)
  if (cameraTime) return cameraTime.toISO({ includeOffset: false })
  if (wallTimeToDate(media?.localTimestamp)) return media.localTimestamp
  if (typeof media?.timestamp !== 'string') return ''
  const instant = DateTime.fromISO(media.timestamp, { zone: 'UTC' })
  return instant.isValid ? instant.toUTC().toISO({ includeOffset: false }) : ''
}

/** Shared by gallery captions, the media viewer and best-media previews. */
export function formatMediaTimestamp(media, { seconds = false } = {}) {
  const date = wallTimeToDate(getMediaWallTime(media))
  if (!date) return 'No timestamp'
  const source = hasOffset(media.sourceTimestamp)
    ? DateTime.fromISO(media.sourceTimestamp, { zone: 'UTC', setZone: true })
    : null
  const cameraTime = getCameraDisplayTime(media)
  const offset = cameraTime
    ? cameraTime.offset
    : !wallTimeToDate(media.localTimestamp)
      ? 0
      : source?.isValid
        ? source.offset
        : null
  const basis =
    offset === null
      ? ' (timezone unknown)'
      : offset === 0
        ? ' UTC'
        : ` UTC${FixedOffsetZone.instance(offset).formatOffset(0, 'short')}`
  return `${(seconds ? DETAIL_FORMATTER : FORMATTER).format(date)}${basis}`
}

/** Resolve edits in the displayed clock; source offsets still preserve the stored instant. */
export function resolveMediaTimestamp(wallTime, media) {
  const wall = DateTime.fromISO(wallTime, { zone: 'UTC', setZone: true })
  if (!wall.isValid || hasOffset(wallTime)) {
    throw new Error('Enter a valid camera-local date and time')
  }
  const source = hasOffset(media.sourceTimestamp)
    ? DateTime.fromISO(media.sourceTimestamp, { zone: 'UTC', setZone: true })
    : null
  const cameraTime = getCameraDisplayTime(media)
  const zone = cameraTime
    ? cameraTime.zone
    : source?.isValid
      ? FixedOffsetZone.instance(source.offset)
      : FixedOffsetZone.parseSpecifier(media.cameraTimeZone || '') || media.cameraTimeZone
  if (!zone) {
    throw new Error('Set the deployment camera timezone before editing this timestamp')
  }
  const resolved = DateTime.fromISO(wallTime, { zone, setZone: true })
  if (
    !resolved.isValid ||
    resolved.toISO({ includeOffset: false }) !== wall.toISO({ includeOffset: false }) ||
    ((cameraTime || !source) && resolved.getPossibleOffsets().length !== 1)
  ) {
    throw new Error('This camera time is invalid or ambiguous in the deployment timezone')
  }
  return resolved.toISO()
}
