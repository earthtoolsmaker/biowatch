import FigureTooltip from './FigureTooltip'
import { formatEffortLabel } from './formatEffort'

const EXPLANATION =
  'Camera effort: how long the camera was active, from deployment start to end. One camera-day is 24 hours of operation, rounded to the nearest whole day.'

const UNAVAILABLE =
  'No valid start and end dates, so camera effort cannot be measured. Fix the dates in the deployment CSV to include them.'

/**
 * Explanatory tooltip for any camera-days figure on the Deployments tab.
 * Wrap the figure (row cell, section header, summary strip, popover row).
 *
 * `detail` is an optional scope line under the headline, e.g. the
 * deployment's date range or "Across 3 deployments at this location". It
 * is shown even when effort is unavailable so aggregate figures can still
 * say how many deployments they cover.
 */
export default function EffortTooltip({ effortDays, detail, side = 'left', children }) {
  const hasEffort = typeof effortDays === 'number'
  return (
    <FigureTooltip
      headline={hasEffort ? formatEffortLabel(effortDays, 'camera-day') : 'Camera-days unavailable'}
      detail={detail}
      explanation={hasEffort ? EXPLANATION : UNAVAILABLE}
      side={side}
    >
      {children}
    </FigureTooltip>
  )
}
