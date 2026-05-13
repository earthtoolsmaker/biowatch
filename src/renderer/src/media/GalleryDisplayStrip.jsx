import { Eye, EyeOff } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import * as Tooltip from '@radix-ui/react-tooltip'
import { SequenceGapSlider } from '../ui/SequenceGapSlider'
import FilterChartsToggle from '../ui/FilterChartsToggle'
import { useSequenceGap } from '../hooks/useSequenceGap'
import { useShowThumbnailBboxes } from '../hooks/useShowThumbnailBboxes'

/**
 * Borderless display-control strip mounted above the Species panel in the
 * Media tab's right pane. Holds the sequence-gap slider, the thumbnail-bbox
 * toggle, and the filter-charts toggle so they live next to the Species
 * filters rather than above the gallery grid.
 *
 * `hasTemporalData` is forwarded to {@link FilterChartsToggle} so studies
 * without media timestamps don't show a toggle that can't do anything.
 */
export default function GalleryDisplayStrip({
  studyId,
  hasTemporalData,
  isFiltering = false,
  dayFilterLabel = null,
  dateFilterLabel = null,
  onResetFilters = null
}) {
  const { sequenceGap, setSequenceGap } = useSequenceGap(studyId)
  const { showThumbnailBboxes, setShowThumbnailBboxes } = useShowThumbnailBboxes(studyId)

  // On IPC failure we fall back to `false` (toggle hidden), which is the
  // safer default than showing a button that does nothing — matches the
  // resilience pattern in useSequenceGap.
  const { data: studyHasBboxes = false } = useQuery({
    queryKey: ['studyHasAnyBboxes', studyId],
    queryFn: async () => {
      const response = await window.api.studyHasAnyBboxes(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    staleTime: Infinity,
    retry: 1,
    throwOnError: false
  })

  return (
    <div className="flex items-center gap-2 px-2 h-10 flex-shrink-0">
      <SequenceGapSlider value={sequenceGap} onChange={setSequenceGap} variant="compact" />
      <div className="ml-auto flex items-center gap-1">
        {studyHasBboxes && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                onClick={() => setShowThumbnailBboxes((prev) => !prev)}
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                  showThumbnailBboxes
                    ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
                aria-label={showThumbnailBboxes ? 'Hide bounding boxes' : 'Show bounding boxes'}
              >
                {showThumbnailBboxes ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                sideOffset={10}
                align="end"
                className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
              >
                <p className="font-medium mb-1">
                  {showThumbnailBboxes ? 'Hide bounding boxes' : 'Show bounding boxes'}
                </p>
                <p className="text-muted-foreground leading-snug">
                  Outlines AI-detected animals on each thumbnail.
                </p>
                <Tooltip.Arrow className="fill-popover" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )}
        <FilterChartsToggle
          studyId={studyId}
          hasTemporalData={hasTemporalData}
          isFiltering={isFiltering}
          dayFilterLabel={dayFilterLabel}
          dateFilterLabel={dateFilterLabel}
          onResetFilters={onResetFilters}
        />
      </div>
    </div>
  )
}
