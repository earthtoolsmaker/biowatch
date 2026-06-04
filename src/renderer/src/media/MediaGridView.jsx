import { useMemo } from 'react'
import Gallery from './Gallery.jsx'
import { quickViewToQueryPatch } from './quickViews.js'

// Resolves the active filter state (+ quick view) into Gallery's prop surface.
// Date strings from the URL are converted to Date objects; null-timestamp media
// are included by default (browse-everything) and excluded once a date range is
// set. Quick views fold in on top of the base filters via quickViewToQueryPatch.
export default function MediaGridView({ filters, speciesReady = true, onSortChange }) {
  const props = useMemo(() => {
    const patch = quickViewToQueryPatch(filters.quickView)
    const [fromStr, toStr] = filters.dateRange
    const hasDateFilter = !!(fromStr && toStr)
    const onlyNull = patch.onlyNullTimestamps === true

    return {
      species: patch.species ?? filters.species,
      dateRange: [fromStr ? new Date(fromStr) : null, toStr ? new Date(toStr) : null],
      timeRange: filters.timeRange,
      sort: filters.sort,
      // deploymentID accepts arrays (server uses IN); pass the full selection
      // so multi-select filtering works.
      deploymentID: filters.deployments,
      mediaTypes: filters.mediaTypes,
      favorite: patch.favorite === true,
      hideBlank: patch.hideBlank === true,
      onlyNullTimestamps: onlyNull,
      // Show null-timestamp media when browsing everything (no date filter) or
      // when explicitly viewing only-null; hide them once a date range narrows.
      includeNullTimestamps: onlyNull || !hasDateFilter
    }
  }, [filters])

  return (
    <Gallery
      species={props.species}
      dateRange={props.dateRange}
      timeRange={props.timeRange}
      sort={props.sort}
      deploymentID={props.deploymentID}
      mediaTypes={props.mediaTypes}
      favorite={props.favorite}
      hideBlank={props.hideBlank}
      onlyNullTimestamps={props.onlyNullTimestamps}
      includeNullTimestamps={props.includeNullTimestamps}
      speciesReady={speciesReady}
      view={filters.view}
      onSortChange={onSortChange}
      embedded
    />
  )
}
