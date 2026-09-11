export const COUNTING_INDIVIDUALS = 'individuals'
export const COUNTING_OBSERVATIONS = 'observations'
export const COUNTING_VALUES = Object.freeze([COUNTING_INDIVIDUALS, COUNTING_OBSERVATIONS])

export const NORMALIZATION_NONE = 'none'
export const NORMALIZATION_RAI_100 = 'RAI100'
export const NORMALIZATION_VALUES = Object.freeze([NORMALIZATION_NONE, NORMALIZATION_RAI_100])

export const DEFAULT_ANALYSIS_METRIC = Object.freeze({
  counting: COUNTING_INDIVIDUALS,
  normalization: NORMALIZATION_NONE
})

export const ANALYSIS_METRICS = Object.freeze(
  NORMALIZATION_VALUES.flatMap((normalization) =>
    COUNTING_VALUES.map((counting) => Object.freeze({ counting, normalization }))
  )
)

/**
 * Validate an analysis metric at a persistence or process boundary. An omitted
 * metric keeps generic callers on N ind.; explicit malformed values are
 * rejected so they cannot be cached or displayed under the wrong label.
 */
export function normalizeAnalysisMetric(metric) {
  if (metric === undefined) return DEFAULT_ANALYSIS_METRIC
  if (!metric || Array.isArray(metric) || typeof metric !== 'object') {
    throw new Error('Invalid analysis metric')
  }
  const keys = Object.keys(metric)
  if (keys.length !== 2 || !keys.includes('counting') || !keys.includes('normalization')) {
    throw new Error('Invalid analysis metric shape')
  }
  if (!COUNTING_VALUES.includes(metric.counting)) {
    throw new Error(`Invalid analysis metric counting: ${metric.counting}`)
  }
  if (!NORMALIZATION_VALUES.includes(metric.normalization)) {
    throw new Error(`Invalid analysis metric normalization: ${metric.normalization}`)
  }
  return Object.freeze({ counting: metric.counting, normalization: metric.normalization })
}

/** Validate the primitive raw-count dimension used by low-level count helpers. */
export function normalizeCounting(counting) {
  if (counting === undefined) return COUNTING_INDIVIDUALS
  if (COUNTING_VALUES.includes(counting)) return counting
  throw new Error(`Invalid counting mode: ${counting}`)
}

export function analysisMetricsEqual(left, right) {
  return !!(
    left &&
    right &&
    left.counting === right.counting &&
    left.normalization === right.normalization
  )
}
