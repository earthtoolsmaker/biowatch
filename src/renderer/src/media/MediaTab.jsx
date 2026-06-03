import { useState } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useMediaFilters } from './useMediaFilters.js'
import MediaToolbar from './MediaToolbar.jsx'
import QuickViews from './QuickViews.jsx'
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
  const [drawerOpen, setDrawerOpen] = useState(false)

  const blankCount = useCount('blankMediaCount', actualStudyId, (s) =>
    window.api.getBlankMediaCount(s)
  )
  const vehicleCount = useCount('vehicleMediaCount', actualStudyId, (s) =>
    window.api.getVehicleMediaCount(s)
  )
  const lowConfidenceCount = useCount('lowConfidenceCount', actualStudyId, (s) =>
    window.api.getLowConfidenceCount(s)
  )

  const quickViewCounts = {
    blank: blankCount,
    vehicle: vehicleCount,
    'low-confidence': lowConfidenceCount
  }

  return (
    <div className="flex flex-col h-full min-h-0 gap-3 px-4 py-3">
      <MediaToolbar
        filters={filters}
        onOpenFilter={() => setDrawerOpen(true)}
        onChange={setFilters}
      />
      <QuickViews
        active={filters.quickView}
        counts={quickViewCounts}
        onSelect={(key) => patch({ quickView: key })}
      />
      <div className="flex-1 min-h-0">
        <MediaGridView filters={filters} speciesReady />
      </div>
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        studyId={actualStudyId}
        path={path}
        filters={filters}
        onChange={setFilters}
      />
    </div>
  )
}
