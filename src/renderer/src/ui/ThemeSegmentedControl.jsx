import { Monitor, Sun, Moon } from 'lucide-react'

const SEGMENTS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon }
]

export default function ThemeSegmentedControl({ value, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-lg border border-border bg-card p-1"
    >
      {SEGMENTS.map(({ value: segValue, label, icon: Icon }) => {
        const selected = value === segValue
        return (
          <button
            key={segValue}
            role="radio"
            aria-checked={selected}
            data-testid={`theme-segment-${segValue}`}
            onClick={() => onChange(segValue)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
              selected
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        )
      })}
    </div>
  )
}
