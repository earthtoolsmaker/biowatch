/**
 * Compact "MMM D, YYYY, h:mm AM/PM" formatter used by the media-tab grid cell
 * timestamp overlay (and the best-media carousel). Pure, no React, safe to
 * unit-test.
 *
 * Renders the capture time in the *deployment's* local timezone — i.e. the
 * offset stored in the timestamp string (e.g. "+02:00") — NOT the viewer's
 * machine timezone. This keeps the displayed time in lock-step with the
 * day-period filter, which reads the same stored local hour
 * (src/main/database/queries/sequences.js → localHourExpr). See
 * docs/dates-and-timezones.md.
 *
 * Timestamps imported as UTC (trailing "Z", before timestamps were stored
 * deployment-local) render in UTC until the study is re-imported.
 *
 * @param {string | number | Date} timestamp - Anything Luxon can parse. ISO
 *   strings carry their offset; Date/number inputs have no offset and fall back
 *   to the runtime's local zone.
 * @returns {string} Formatted string, e.g. "Apr 30, 2026, 2:34 PM".
 */
import { DateTime } from 'luxon'

const GRID_FORMAT = 'LLL d, yyyy, h:mm a'
const EDIT_FORMAT = 'LLL d, yyyy, h:mm:ss a'

export function formatGridTimestamp(timestamp) {
  const dt =
    timestamp instanceof Date
      ? DateTime.fromJSDate(timestamp)
      : typeof timestamp === 'number'
        ? DateTime.fromMillis(timestamp)
        : DateTime.fromISO(timestamp, { setZone: true })
  return dt.setLocale('en-US').toFormat(GRID_FORMAT)
}

/**
 * Render a timestamp for the editable timestamp field, in the deployment's
 * local zone (the stored offset), including seconds. Mirrors formatGridTimestamp
 * but keeps seconds so edits don't silently truncate them.
 *
 * @param {string} timestamp - ISO timestamp string
 * @returns {string} e.g. "Apr 30, 2026, 2:34:56 PM"
 */
export function formatEditableTimestamp(timestamp) {
  return DateTime.fromISO(timestamp, { setZone: true }).setLocale('en-US').toFormat(EDIT_FORMAT)
}

/**
 * Parse an edited wall-clock string back into an ISO timestamp in the SAME
 * timezone offset as the original timestamp, so saving preserves the
 * deployment-local zone rather than rebasing onto the viewer's machine zone.
 *
 * The freeform input is parsed leniently with the platform Date parser (which
 * reads it in the machine zone); we then reinterpret those wall-clock
 * components in the original timestamp's offset. See docs/dates-and-timezones.md.
 *
 * @param {string} input - User-entered date/time (e.g. "Dec 25, 2024, 2:30:00 PM")
 * @param {string} originalTimestamp - The media's current stored timestamp
 * @returns {string|null} ISO string with the original offset, or null if unparseable
 */
export function parseEditedTimestampToISO(input, originalTimestamp) {
  const js = new Date(input)
  if (isNaN(js.getTime())) return null

  const original = DateTime.fromISO(originalTimestamp, { setZone: true })
  const zone = original.isValid ? original.zone : 'local'

  const rebuilt = DateTime.fromObject(
    {
      year: js.getFullYear(),
      month: js.getMonth() + 1,
      day: js.getDate(),
      hour: js.getHours(),
      minute: js.getMinutes(),
      second: js.getSeconds()
    },
    { zone }
  )
  return rebuilt.isValid ? rebuilt.toISO() : null
}
