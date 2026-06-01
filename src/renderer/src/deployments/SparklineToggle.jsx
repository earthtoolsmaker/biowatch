import { BarChart3, LineChart, Grid3x3 } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'

const MODES = [
  {
    id: 'bars',
    label: 'Bars',
    Icon: BarChart3,
    description:
      "Each deployment's activity over time as a bar chart — taller bars mean more captures."
  },
  {
    id: 'line',
    label: 'Line',
    Icon: LineChart,
    description:
      "Each deployment's activity over time as a smooth area line — good for spotting trends."
  },
  {
    id: 'heatmap',
    label: 'Heatmap',
    Icon: Grid3x3,
    description:
      "Each deployment's activity over time as colored cells — darker means more captures."
  }
]

/**
 * Three icon buttons cycling the sparkline rendering mode.
 * Pure controlled component — persistence lives in useSparklineMode.
 */
export default function SparklineToggle({ mode, onChange }) {
  return (
    <div className="flex items-center gap-px rounded border border-border bg-card p-px">
      {MODES.map(({ id, label, Icon, description }) => (
        <Tooltip.Root key={id}>
          <Tooltip.Trigger asChild>
            <button
              onClick={() => onChange(id)}
              aria-label={`Sparkline: ${label}`}
              aria-pressed={mode === id}
              className={`p-1 rounded ${
                mode === id
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <Icon size={14} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="top"
              sideOffset={8}
              className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
            >
              <div className="font-medium mb-1">{label}</div>
              <p className="text-muted-foreground leading-snug">{description}</p>
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      ))}
    </div>
  )
}
