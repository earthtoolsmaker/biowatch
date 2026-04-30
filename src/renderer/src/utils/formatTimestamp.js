/**
 * Compact "MMM D, h:mm AM/PM" formatter used by the media-tab grid cell
 * timestamp overlay. Pure, no React, safe to unit-test.
 *
 * Uses the runtime's local timezone — camera-trap timestamps in the DB are
 * already display-time at the camera, and the rest of the app uses local
 * time elsewhere (e.g. inline editor timestamps).
 *
 * @param {string | number | Date} timestamp - Anything `new Date(x)` accepts.
 * @returns {string} Formatted string, e.g. "Apr 30, 2:34 PM".
 */
const FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

export function formatGridTimestamp(timestamp) {
  return FORMATTER.format(timestamp instanceof Date ? timestamp : new Date(timestamp))
}
