import { COUNTING_OBSERVATIONS, NORMALIZATION_RAI_100 } from '../../../shared/analysisMetric.js'

const integerFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const rateFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
})

export function formatAnalysisValue(value, metric) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return metric?.normalization === NORMALIZATION_RAI_100
    ? rateFormatter.format(Number(value))
    : integerFormatter.format(Number(value))
}

export function analysisMetricUnit(metric) {
  if (metric?.normalization === NORMALIZATION_RAI_100) return 'per 100 camera-days'
  return metric?.counting === COUNTING_OBSERVATIONS ? 'Independent observations' : 'Individuals'
}

export function deriveMetricValue(rawCount, effortDays, metric) {
  if (metric?.normalization !== NORMALIZATION_RAI_100) return rawCount
  return effortDays > 0 ? (100 * rawCount) / effortDays : null
}

/** Sum rate components first, then derive a rate; rates themselves are never additive. */
export function aggregateAnalysisLocations(locations, selectedSpecies, metric) {
  const rawCounts = Object.fromEntries(
    selectedSpecies.map((species) => [species.scientificName, 0])
  )
  let effortDays = 0
  for (const location of locations) {
    effortDays += Number(location.effortDays) || 0
    for (const scientificName of Object.keys(rawCounts)) {
      rawCounts[scientificName] += Number(location.rawCounts?.[scientificName]) || 0
    }
  }
  const values = Object.fromEntries(
    Object.entries(rawCounts).map(([scientificName, rawCount]) => [
      scientificName,
      deriveMetricValue(rawCount, effortDays, metric)
    ])
  )
  return { rawCounts, effortDays, values }
}
