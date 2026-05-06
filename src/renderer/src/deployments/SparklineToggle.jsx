import { BarChart3, LineChart, Grid3x3 } from 'lucide-react'

const MODES = [
  { id: 'bars', label: 'Bars', Icon: BarChart3 },
  { id: 'line', label: 'Line', Icon: LineChart },
  { id: 'heatmap', label: 'Heatmap', Icon: Grid3x3 }
]

/**
 * Three icon buttons cycling the sparkline rendering mode.
 * Pure controlled component — persistence lives in useSparklineMode.
 */
export default function SparklineToggle({ mode, onChange }) {
  return (
    <div className="flex items-center gap-px rounded border border-border bg-card p-px">
      {MODES.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          title={label}
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
      ))}
    </div>
  )
}
