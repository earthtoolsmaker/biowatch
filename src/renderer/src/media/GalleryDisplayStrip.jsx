import { SequenceGapSlider } from '../ui/SequenceGapSlider'
import FilterChartsToggle from '../ui/FilterChartsToggle'
import ThumbnailBboxToggle from '../ui/ThumbnailBboxToggle'
import { useSequenceGap } from '../hooks/useSequenceGap'

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

  return (
    <div className="flex items-center gap-2 px-2 h-10 flex-shrink-0">
      <SequenceGapSlider value={sequenceGap} onChange={setSequenceGap} variant="compact" />
      <div className="ml-auto flex items-center gap-1">
        <ThumbnailBboxToggle studyId={studyId} />
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
