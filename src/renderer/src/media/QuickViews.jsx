import { useEffect, useRef, useState } from 'react'
import { Sparkles, Check, ChevronDown } from 'lucide-react'
import { QUICK_VIEWS } from './quickViews.js'

// Quick-views control: a compact toolbar button that opens a dropdown of the
// preset views. Selecting one applies it (clicking the active one clears it).
// The button reflects the active view's label so it stays discoverable.
export default function QuickViews({ active, counts = {}, onSelect }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const popRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (
        popRef.current &&
        !popRef.current.contains(e.target) &&
        btnRef.current &&
        !btnRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const views = QUICK_VIEWS.filter((qv) => !qv.hidden)
  const activeView = views.find((v) => v.key === active)

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[13px] font-medium ${
          activeView
            ? 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
            : 'bg-card border-border hover:bg-input-background'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5 opacity-80" />
        {activeView ? activeView.label : 'Quick views'}
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </button>

      {open && (
        <div
          ref={popRef}
          className="absolute left-0 top-full mt-1 w-72 bg-card border border-border rounded-lg shadow-lg z-[1100] p-1"
        >
          {views.map((qv) => {
            const isActive = active === qv.key
            const count = counts[qv.key]
            return (
              <button
                key={qv.key}
                type="button"
                onClick={() => {
                  onSelect(isActive ? null : qv.key)
                  setOpen(false)
                }}
                className={`w-full flex items-start justify-between gap-2 px-2 py-1.5 rounded text-[12.5px] text-left ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                    : 'hover:bg-input-background'
                }`}
              >
                <span className="flex items-start gap-2 min-w-0">
                  {isActive ? (
                    <Check
                      size={13}
                      className="mt-0.5 flex-shrink-0 text-blue-600 dark:text-blue-300"
                    />
                  ) : (
                    <span className="inline-block w-[13px] flex-shrink-0" />
                  )}
                  <span className="flex flex-col min-w-0">
                    <span className="text-foreground">{qv.label}</span>
                    {qv.description && (
                      <span className="text-[11px] text-muted-foreground leading-snug">
                        {qv.description}
                      </span>
                    )}
                  </span>
                </span>
                {typeof count === 'number' && (
                  <span className="text-xs text-muted-foreground mt-0.5 flex-shrink-0">
                    {count}
                  </span>
                )}
              </button>
            )
          })}
          {activeView && (
            <button
              type="button"
              onClick={() => {
                onSelect(null)
                setOpen(false)
              }}
              className="w-full text-left px-2 py-1.5 mt-1 border-t border-border text-[12px] text-muted-foreground hover:text-foreground"
            >
              Clear quick view
            </button>
          )}
        </div>
      )}
    </div>
  )
}
