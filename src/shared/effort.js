const DAY_MS = 86_400_000

/**
 * Camera effort of one deployment in fractional camera-days.
 *
 * A deployment contributes effort only when both dates parse and the end is
 * strictly after the start; otherwise the result is null (never 0), so
 * callers can distinguish "no valid dates" from "zero-length". No rounding
 * is applied. Same validity rule as validateDeploymentIntervals in
 * src/main/services/sequences/effort.js (the Explore RAI denominator), so
 * per-deployment camera-days here agree with Explore's effort.
 * Note the Overview tile's SQL camera-days use a looser rule (it sums
 * julianday differences, including inverted intervals), so its total can
 * differ on studies with bad dates.
 *
 * @param {string|null|undefined} start - deploymentStart (ISO text column)
 * @param {string|null|undefined} end - deploymentEnd (ISO text column)
 * @returns {number|null}
 */
export function deploymentEffortDays(start, end) {
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null
  return (endMs - startMs) / DAY_MS
}
