import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { DEFAULT_FILTERS, filtersToSearchParams, searchParamsToFilters } from './mediaFilters.js'

// Single source of truth for the Media tab's filter/sort/view state, backed by
// the URL so deep-links and the back button work. Reads derive from the URL;
// writes push a new URLSearchParams.
export function useMediaFilters() {
  const [searchParams, setSearchParams] = useSearchParams()

  const filters = useMemo(() => searchParamsToFilters(searchParams), [searchParams])

  const setFilters = useCallback(
    (next) => {
      const resolved =
        typeof next === 'function' ? next(searchParamsToFilters(searchParams)) : next
      setSearchParams(filtersToSearchParams(resolved), { replace: false })
    },
    [searchParams, setSearchParams]
  )

  const patch = useCallback((delta) => setFilters((f) => ({ ...f, ...delta })), [setFilters])

  const reset = useCallback(() => setFilters(DEFAULT_FILTERS), [setFilters])

  return { filters, setFilters, patch, reset }
}
