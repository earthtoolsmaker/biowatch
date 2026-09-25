import EffortTooltip from './EffortTooltip'
import { formatEffortLabel } from './formatEffort'

/**
 * Camera-days column shared by deployment rows and section headers. Null
 * effort (missing/invalid deployment dates) reads as "—", and the tooltip
 * explains why, so an unknown interval is never mistaken for zero.
 */
export default function EffortCell({ effortDays, detail }) {
  return (
    <EffortTooltip effortDays={effortDays} detail={detail}>
      <div className="flex-shrink-0 w-20 text-right text-xs text-muted-foreground tabular-nums">
        {formatEffortLabel(effortDays, 'day')}
      </div>
    </EffortTooltip>
  )
}
