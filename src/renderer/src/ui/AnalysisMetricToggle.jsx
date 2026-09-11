import * as Tooltip from '@radix-ui/react-tooltip'
import {
  COUNTING_INDIVIDUALS,
  COUNTING_OBSERVATIONS,
  NORMALIZATION_NONE,
  NORMALIZATION_RAI_100
} from '../../../shared/analysisMetric.js'

const COUNTING_OPTIONS = [
  {
    value: COUNTING_INDIVIDUALS,
    shortLabel: 'Ind.',
    label: 'Individuals',
    description:
      'Maximum detections of the species in one frame per sequence, summed across sequences.'
  },
  {
    value: COUNTING_OBSERVATIONS,
    shortLabel: 'Obs.',
    label: 'Independent observations',
    description:
      'Number of sequences in which the species was observed. Each sequence contributes once.'
  }
]

const NORMALIZATION_OPTIONS = [
  {
    value: NORMALIZATION_NONE,
    shortLabel: 'Count',
    label: 'Counts',
    description: 'Show sequence-adjusted counts without camera-effort normalization.'
  },
  {
    value: NORMALIZATION_RAI_100,
    shortLabel: 'RAI',
    label: 'Relative abundance index',
    description:
      'Show the selected counting basis per 100 effective camera-days. Encounter-rate index; not an estimate of population size or density.'
  }
]

function MetricGroup({ label, options, value, onChange }) {
  const move = (event, index) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const next = (index + direction + options.length) % options.length
    onChange(options[next].value)
    event.currentTarget.parentElement?.querySelectorAll('[role="radio"]')[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 rounded-md bg-card p-0.5"
    >
      {options.map((option, index) => {
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
                className={`rounded px-2 py-1 text-[10px] font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
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
                className="z-[10000] max-w-[19rem] rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
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

export default function AnalysisMetricToggle({ value, onChange }) {
  return (
    <div
      role="group"
      className="inline-flex shrink-0 items-center gap-1"
      aria-label="Analysis metric"
    >
      <MetricGroup
        label="Counting basis"
        options={COUNTING_OPTIONS}
        value={value.counting}
        onChange={(counting) => onChange({ ...value, counting })}
      />
      <MetricGroup
        label="Normalization"
        options={NORMALIZATION_OPTIONS}
        value={value.normalization}
        onChange={(normalization) => onChange({ ...value, normalization })}
      />
    </div>
  )
}
