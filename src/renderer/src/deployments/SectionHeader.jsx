import { memo, useCallback } from 'react'
import EditableLocationName from './EditableLocationName'
import EffortCell from './EffortCell'
import { countMissingEffort } from './groupDeployments'
import ObservationsCell from './ObservationsCell'
import Sparkline from './Sparkline'

/**
 * Always-expanded section header for co-located deployments. Clicking
 * the header flies the map to the bounds of the group's children — it
 * does NOT change the current deployment selection (the detail pane
 * stays put if open).
 */
const SectionHeader = memo(function SectionHeader({
  group,
  sparklineMode,
  percentile90Count,
  isSelected,
  onRenameLocation,
  onSectionClick,
  hasTimestamps = true
}) {
  const handleClick = useCallback(() => {
    onSectionClick(group)
  }, [group, onSectionClick])

  const total = group.deployments.reduce((sum, d) => sum + (d.totalCount || 0), 0)
  const scope = `Summed across ${group.deployments.length} deployments at this location`
  const missingEffort = countMissingEffort(group.deployments)
  const effortScope = missingEffort > 0 ? `${scope} · ${missingEffort} without valid dates` : scope

  return (
    <div
      onClick={handleClick}
      className={`group/row flex gap-3 items-center px-3 h-9 bg-muted hover:bg-accent cursor-pointer border-b border-border transition-colors ${
        isSelected ? 'border-l-4 border-l-blue-500 pl-2' : 'border-l-4 border-l-transparent'
      }`}
    >
      <div className="flex items-center gap-2 w-[140px] min-w-0">
        <div className="min-w-0 flex-1">
          <EditableLocationName
            locationID={group.locationID}
            locationName={group.locationName}
            isSelected={isSelected}
            onRename={onRenameLocation}
          />
        </div>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-medium flex-shrink-0">
          {group.deployments.length}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        {hasTimestamps && (
          <Sparkline
            periods={group.aggregatedPeriods}
            mode={sparklineMode}
            percentile90Count={percentile90Count}
            deploymentStart={group.deploymentStart}
            deploymentEnd={group.deploymentEnd}
            muted
          />
        )}
      </div>

      <ObservationsCell count={total} detail={scope} />

      {hasTimestamps && <EffortCell effortDays={group.aggregatedEffortDays} detail={effortScope} />}
    </div>
  )
})

export default SectionHeader
