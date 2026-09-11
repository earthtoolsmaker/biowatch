import { useCallback, useMemo, useState } from 'react'
import { DEFAULT_ANALYSIS_METRIC, normalizeAnalysisMetric } from '../../../shared/analysisMetric.js'

export function readExploreMetric(studyId, storage = localStorage) {
  if (!studyId) return DEFAULT_ANALYSIS_METRIC
  const stored = storage.getItem(`exploreAnalysisMetric:${studyId}`)
  if (!stored) return DEFAULT_ANALYSIS_METRIC
  try {
    return normalizeAnalysisMetric(JSON.parse(stored))
  } catch {
    return DEFAULT_ANALYSIS_METRIC
  }
}

/** Per-study renderer preference for the Explore analysis metric. */
export function useExploreMetric(studyId) {
  const [preference, setPreference] = useState(() => ({
    studyId,
    value: readExploreMetric(studyId)
  }))
  // Resolve a newly navigated study synchronously, before effects and queries,
  // so the previous study's preference never leaks into its first render. The
  // memo also keeps one stable object reference until the selection changes.
  const navigatedMetric = useMemo(() => readExploreMetric(studyId), [studyId])
  const metric = preference.studyId === studyId ? preference.value : navigatedMetric

  const setMetric = useCallback(
    (value) => {
      let next
      try {
        next = normalizeAnalysisMetric(value)
      } catch {
        next = DEFAULT_ANALYSIS_METRIC
      }
      if (studyId) localStorage.setItem(`exploreAnalysisMetric:${studyId}`, JSON.stringify(next))
      setPreference({ studyId, value: next })
    },
    [studyId]
  )

  return { metric, setMetric }
}
