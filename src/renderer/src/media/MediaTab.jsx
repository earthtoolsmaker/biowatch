import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useMediaFilters } from './useMediaFilters.js'
import MediaToolbar from './MediaToolbar.jsx'
import MediaGridView from './MediaGridView.jsx'
import FilterDrawer from './FilterDrawer.jsx'

// Helper: unwrap the { data } / { error } IPC envelope into a number or undefined.
function useCount(key, studyId, fetcher) {
  const { data } = useQuery({
    queryKey: [key, studyId],
    queryFn: async () => {
      const res = await fetcher(studyId)
      if (res?.error) throw new Error(res.error)
      return res?.data ?? res
    },
    enabled: !!studyId,
    staleTime: 60000
  })
  return typeof data === 'number' ? data : undefined
}

// Redesigned Media tab: a focused, URL-addressable browser for sequences.
// Toolbar (filter + chips + sort + view toggle) over a quick-views row over a
// full-bleed grid that reuses the existing Gallery + media modal.
export default function MediaTab({ studyId, path }) {
  const { id } = useParams()
  const actualStudyId = studyId || id
  const { filters, setFilters, patch } = useMediaFilters()
  const [drawerOpen, setDrawerOpen] = useState(true)

  const noTimestampCount = useCount('noTimestampCount', actualStudyId, (s) =>
    window.api.countMediaWithNullTimestamps(s)
  )
  const favoriteCount = useCount('favoriteCount', actualStudyId, (s) =>
    window.api.countFavoriteMedia(s)
  )

  // Map deploymentID -> location name so the toolbar's deployment chips show a
  // readable name instead of the raw ID. Shares the drawer's query cache.
  const { data: deploymentDist } = useQuery({
    queryKey: ['mediaFilterDeploymentDistribution', actualStudyId],
    queryFn: async () => {
      const res = await window.api.getDeploymentDistribution(actualStudyId)
      if (res?.error) throw new Error(res.error)
      return res?.data ?? res
    },
    enabled: !!actualStudyId,
    staleTime: 60000
  })
  const deploymentNames = useMemo(() => {
    const m = {}
    for (const d of deploymentDist ?? []) m[d.deploymentID] = d.locationName
    return m
  }, [deploymentDist])

  // Blank/Vehicle counts are sequence-aware (one unit per sequence, not per
  // frame) so they match the species counts, the table rows, and the deployment
  // composition. Grouping is deployment-scoped, so the study-wide total is the
  // sum of each deployment's sequence count. undefined while the composition
  // loads so the badge stays hidden rather than flashing 0.
  const { blankCount, vehicleCount } = useMemo(() => {
    if (!deploymentDist) return { blankCount: undefined, vehicleCount: undefined }
    return {
      blankCount: deploymentDist.reduce((s, d) => s + (d.blankCount || 0), 0),
      vehicleCount: deploymentDist.reduce((s, d) => s + (d.vehicleCount || 0), 0)
    }
  }, [deploymentDist])

  const quickViewCounts = {
    blank: blankCount,
    vehicle: vehicleCount,
    'no-timestamp': noTimestampCount,
    favorites: favoriteCount
  }

  return (
    <div className="flex flex-col h-full min-h-0 gap-3 px-4 py-3">
      <MediaToolbar
        filters={filters}
        filterOpen={drawerOpen}
        onToggleFilter={() => setDrawerOpen((o) => !o)}
        onChange={setFilters}
        quickViewCounts={quickViewCounts}
        deploymentNames={deploymentNames}
      />
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0">
          <MediaGridView filters={filters} speciesReady onSortChange={(sort) => patch({ sort })} />
        </div>
        <FilterDrawer
          open={drawerOpen}
          studyId={actualStudyId}
          path={path}
          filters={filters}
          onChange={setFilters}
          blankCount={blankCount}
        />
      </div>
    </div>
  )
}
