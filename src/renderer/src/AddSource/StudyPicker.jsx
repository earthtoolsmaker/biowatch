import { useEffect, useState } from 'react'
import { Folder, Package, Globe, X, Layers, ChevronRight, Check } from 'lucide-react'
import { Button } from '../ui/button.jsx'
import StudyHoverCard from '../ui/StudyHoverCard.jsx'
import { importerLabel } from '../../../shared/importerLabel.js'

const ICON = {
  'camtrap/datapackage': Package,
  'lila/coco': Globe
}

/**
 * Step 2 of the merge wizard — pick a local study to merge into the current one.
 *
 * Clicking a row advances immediately (no separate Next click). Already-merged
 * studies are shown disabled. Detection is one cheap IPC call on open.
 */
export default function StudyPicker({ isOpen, currentStudyId, onBack, onCancel, onPicked }) {
  const [studies, setStudies] = useState([])
  const [search, setSearch] = useState('')
  const [mergedSet, setMergedSet] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [scrollSignal, setScrollSignal] = useState(0)

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onCancel])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      window.api.getStudies(),
      window.api.listMergedSourceIds(currentStudyId).catch(() => [])
    ]).then(([list, mergedIds]) => {
      if (cancelled) return
      setStudies(
        (list || [])
          .filter((s) => s.id !== currentStudyId)
          .sort((a, b) =>
            (a.name || a.id || '').localeCompare(b.name || b.id || '', undefined, {
              sensitivity: 'base',
              numeric: true
            })
          )
      )
      const set = new Set()
      const shortPrefixes = []
      for (const id of mergedIds) {
        if (id.startsWith('__short:')) shortPrefixes.push(id.slice('__short:'.length))
        else set.add(id)
      }
      if (shortPrefixes.length > 0) {
        for (const s of list || []) {
          if (shortPrefixes.includes((s.id || '').slice(0, 8))) set.add(s.id)
        }
      }
      setMergedSet(set)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, currentStudyId])

  if (!isOpen) return null

  const showSearch = studies.length > 5
  const visible = showSearch
    ? studies.filter((s) => (s.name || s.id || '').toLowerCase().includes(search.toLowerCase()))
    : studies

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]"
      onClick={onCancel}
    >
      <div
        className="bg-card rounded-lg shadow-xl max-w-md w-full mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex justify-between items-start">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-500/20 rounded-full">
              <Layers size={20} className="text-blue-600 dark:text-blue-300" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Merge another study</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Pick a local study to merge into this one.
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          {showSearch && (
            <input
              className="w-full px-3 py-2 rounded-md bg-card border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
              placeholder="Search studies by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          )}
          <div
            className="border border-border/50 rounded-lg overflow-hidden max-h-80 overflow-y-auto"
            onScroll={() => setScrollSignal((s) => s + 1)}
          >
            {loading ? (
              <div className="px-3 py-8 text-sm text-muted-foreground text-center">Loading…</div>
            ) : visible.length === 0 ? (
              <div className="px-3 py-8 text-sm text-muted-foreground text-center">
                {studies.length === 0
                  ? 'No other local studies to merge from.'
                  : 'No studies match your search.'}
              </div>
            ) : (
              visible.map((s) => {
                const Icon = ICON[s.importerName] || Folder
                const merged = mergedSet.has(s.id)
                const row = (
                  <button
                    type="button"
                    disabled={merged}
                    onClick={() => !merged && onPicked(s)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-border/40 last:border-none transition-colors
                      ${
                        merged
                          ? 'opacity-50 cursor-not-allowed bg-muted/30'
                          : 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/15 group'
                      }`}
                  >
                    <div className="p-1.5 rounded-md bg-muted text-muted-foreground flex-shrink-0 transition-colors group-hover:bg-blue-100 group-hover:text-blue-600 dark:group-hover:bg-blue-500/25 dark:group-hover:text-blue-300">
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {s.name || s.id}
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {importerLabel(s.importerName)}
                      </div>
                    </div>
                    {merged ? (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase text-muted-foreground tracking-wide flex-shrink-0">
                        <Check size={11} />
                        Merged
                      </span>
                    ) : (
                      <ChevronRight
                        size={16}
                        className="text-muted-foreground/40 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors flex-shrink-0"
                      />
                    )}
                  </button>
                )
                return (
                  <StudyHoverCard key={s.id} study={s} scrollSignal={scrollSignal}>
                    {row}
                  </StudyHoverCard>
                )
              })
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-between items-center">
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← Back
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
