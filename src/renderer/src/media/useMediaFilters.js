import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { DEFAULT_FILTERS, filtersToSearchParams, searchParamsToFilters } from './mediaFilters.js'
import { useTimeFilter } from '../hooks/useTimeFilter.js'

// Non-hour Media filters/sort/view are URL-backed. Hours and their time basis
// use the shared per-study source of truth, also consumed by Explore.
export function useMediaFilters(studyId) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { timeRange, setTimeRange } = useTimeFilter(studyId)
  const filters = useMemo(
    () => ({ ...searchParamsToFilters(searchParams), timeRange }),
    [searchParams, timeRange]
  )

  const setFilters = useCallback(
    (next, opts) => {
      const resolved = typeof next === 'function' ? next(filters) : next
      if (JSON.stringify(resolved.timeRange) !== JSON.stringify(timeRange))
        setTimeRange(resolved.timeRange)
      // Hours have one shared persisted source of truth; URL/session restoration
      // must not replay an old selection after a mode switch in Explore.
      const params = filtersToSearchParams(resolved)
      params.delete('time')
      setSearchParams(params, { replace: opts?.replace ?? false })
    },
    [filters, timeRange, setTimeRange, setSearchParams]
  )

  const patch = useCallback(
    (delta, opts) => setFilters((f) => ({ ...f, ...delta }), opts),
    [setFilters]
  )

  const reset = useCallback(() => setFilters(DEFAULT_FILTERS), [setFilters])

  return { filters, setFilters, patch, reset }
}
