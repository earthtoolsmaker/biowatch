export default function TimeModeToggle({ mode, onChange }) {
  return (
    <div
      role="group"
      aria-label="Time basis"
      className="inline-flex items-stretch rounded-md border border-border bg-background overflow-hidden text-[10px] leading-3"
    >
      {['solar', 'clock'].map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          className={`px-1.5 py-0.5 flex items-center justify-center transition-colors ${value === 'clock' ? 'border-l border-border' : ''} ${mode === value ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400' : 'text-muted-foreground hover:bg-accent'}`}
          onClick={() => onChange(value)}
        >
          {value === 'clock' ? 'Clock' : 'Solar'}
        </button>
      ))}
    </div>
  )
}
