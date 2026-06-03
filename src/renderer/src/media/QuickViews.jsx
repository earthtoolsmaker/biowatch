import { QUICK_VIEWS } from './quickViews.js'

// The quick-views pill row. Clicking a pill toggles it as the active quick view
// (clicking the active one clears it). `counts` is an optional map of
// key -> number; a count is shown only when provided.
export default function QuickViews({ active, counts = {}, onSelect }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground mr-1">
        Quick views
      </span>
      {QUICK_VIEWS.map((qv) => {
        const isActive = active === qv.key
        const count = counts[qv.key]
        const warn = qv.tone === 'warn'
        const base =
          'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12.5px] font-medium border transition-colors cursor-pointer'
        const tone = isActive
          ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
          : warn
            ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30'
            : 'bg-card text-foreground border-border hover:bg-input-background'
        return (
          <button
            key={qv.key}
            type="button"
            className={`${base} ${tone}`}
            aria-pressed={isActive}
            onClick={() => onSelect(isActive ? null : qv.key)}
          >
            {qv.label}
            {typeof count === 'number' && (
              <span
                className={`text-[11.5px] ${isActive ? 'opacity-80' : 'text-muted-foreground'}`}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
