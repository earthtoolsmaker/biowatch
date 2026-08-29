import { useCallback, useState } from 'react'
import { COUNT_METRICS, COUNT_METRIC_INDIVIDUALS } from '../../../shared/countMetric.js'

export function readExploreCountMetric(studyId, storage = localStorage) {
  if (!studyId) return COUNT_METRIC_INDIVIDUALS
  const stored = storage.getItem(`exploreCountMetric:${studyId}`)
  return COUNT_METRICS.includes(stored) ? stored : COUNT_METRIC_INDIVIDUALS
}

/** Per-study renderer preference for the Explore analytical count metric. */
export function useExploreCountMetric(studyId) {
  const [preference, setPreference] = useState(() => ({
    studyId,
    value: readExploreCountMetric(studyId)
  }))
  // Resolve a newly navigated study synchronously, before effects and queries,
  // so the previous study's preference never leaks into its first render.
  const countMetric =
    preference.studyId === studyId ? preference.value : readExploreCountMetric(studyId)

  const setCountMetric = useCallback(
    (value) => {
      const next = COUNT_METRICS.includes(value) ? value : COUNT_METRIC_INDIVIDUALS
      if (studyId) localStorage.setItem(`exploreCountMetric:${studyId}`, next)
      setPreference({ studyId, value: next })
    },
    [studyId]
  )

  return { countMetric, setCountMetric }
}
