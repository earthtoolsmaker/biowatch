export const COUNT_METRIC_INDIVIDUALS = 'individuals'
export const COUNT_METRIC_OBSERVATIONS = 'observations'

export const COUNT_METRICS = [COUNT_METRIC_INDIVIDUALS, COUNT_METRIC_OBSERVATIONS]

/**
 * Validate a count metric at a process boundary. Older callers that omit the
 * option keep the existing sequence-max individual metric; an explicit invalid
 * value is rejected so data can never be cached under the wrong label.
 */
export function normalizeCountMetric(countMetric) {
  if (countMetric == null) return COUNT_METRIC_INDIVIDUALS
  if (COUNT_METRICS.includes(countMetric)) return countMetric
  throw new Error(`Invalid count metric: ${countMetric}`)
}
