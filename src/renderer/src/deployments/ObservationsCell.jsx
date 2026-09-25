import FigureTooltip from './FigureTooltip'

const EXPLANATION =
  'Observation records: one per detected animal, person, or vehicle in each image or video. Not sequence-adjusted, so a burst of the same animal counts once per frame.'

/**
 * Observation-count column shared by deployment rows and section headers,
 * with a tooltip explaining what is being counted. `detail` is an optional
 * scope line, e.g. "Summed across 3 deployments at this location".
 */
export default function ObservationsCell({ count, detail }) {
  const total = count ?? 0
  const formatted = total.toLocaleString('en-US')
  return (
    <FigureTooltip
      headline={`${formatted} ${total === 1 ? 'observation' : 'observations'}`}
      detail={detail}
      explanation={EXPLANATION}
    >
      <div className="flex-shrink-0 w-16 text-right text-xs text-muted-foreground tabular-nums">
        {formatted}
      </div>
    </FigureTooltip>
  )
}
