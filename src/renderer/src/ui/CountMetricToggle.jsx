import * as Tooltip from '@radix-ui/react-tooltip'
import { COUNT_METRIC_INDIVIDUALS, COUNT_METRIC_OBSERVATIONS } from '../../../shared/countMetric.js'

const OPTIONS = [
  {
    value: COUNT_METRIC_INDIVIDUALS,
    shortLabel: 'N ind.',
    label: 'Individuals',
    description:
      'Maximum detections of the species in one frame per sequence, summed across sequences.'
  },
  {
    value: COUNT_METRIC_OBSERVATIONS,
    shortLabel: 'N obs.',
    label: 'Independent observations',
    description:
      'Number of sequences in which the species was observed. Each sequence contributes once.'
  }
]

export default function CountMetricToggle({ value, onChange }) {
  const move = (event, index) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const next = (index + direction + OPTIONS.length) % OPTIONS.length
    onChange(OPTIONS[next].value)
    event.currentTarget.parentElement?.querySelectorAll('[role="radio"]')[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="Count metric"
      className="inline-flex shrink-0 rounded-md bg-card p-0.5"
    >
      {OPTIONS.map((option, index) => {
        const selected = value === option.value
        return (
          <Tooltip.Root key={option.value}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={option.label}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(option.value)}
                onKeyDown={(event) => move(event, index)}
                className={`rounded px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                  selected
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {option.shortLabel}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                sideOffset={8}
                className="z-[10000] max-w-[17rem] rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
              >
                <p className="mb-1 font-medium">{option.label}</p>
                <p className="leading-snug text-muted-foreground">{option.description}</p>
                <Tooltip.Arrow className="fill-popover" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )
      })}
    </div>
  )
}
