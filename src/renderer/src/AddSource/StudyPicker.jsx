import { useEffect, useState } from 'react'
import { Folder, Package, Globe, X } from 'lucide-react'
import { Button } from '../ui/button.jsx'

const ICON = {
  'camtrap/datapackage': Package,
  'lila/coco': Globe
}

/**
 * Step 2 of the merge wizard — pick a local study to merge into the current one.
 *
 * Already-merged studies are shown disabled. Detection runs in parallel against
 * every candidate via `mergePreflight` (lightweight: counts only, no writes).
 */
export default function StudyPicker({ isOpen, currentStudyId, onBack, onCancel, onPicked }) {
  const [studies, setStudies] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [mergedSet, setMergedSet] = useState(new Set())
  const [loading, setLoading] = useState(true)

  // ESC closes.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onCancel])

  // Load studies once when the picker opens.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setLoading(true)
    window.api.getStudies().then((list) => {
      if (cancelled) return
      setStudies((list || []).filter((s) => s.id !== currentStudyId))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, currentStudyId])

  // Compute already-merged set when the candidate list changes.
  useEffect(() => {
    if (!isOpen || studies.length === 0) return
    let cancelled = false
    Promise.all(
      studies.map((s) =>
        window.api
          .mergePreflight(currentStudyId, s.id)
          .then((pf) => ({ id: s.id, alreadyMerged: pf?.alreadyMerged === true }))
          .catch(() => ({ id: s.id, alreadyMerged: false }))
      )
    ).then((results) => {
      if (cancelled) return
      setMergedSet(new Set(results.filter((r) => r.alreadyMerged).map((r) => r.id)))
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, studies, currentStudyId])

  if (!isOpen) return null

  const showSearch = studies.length > 5
  const visible = showSearch
    ? studies.filter((s) =>
        (s.name || s.id || '').toLowerCase().includes(search.toLowerCase())
      )
    : studies

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-card rounded-lg shadow-xl w-[480px] max-w-[92vw] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-medium text-foreground">
            Add source <span className="text-muted-foreground text-sm">— Pick a study</span>
          </h3>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-2">
          {showSearch && (
            <input
              className="w-full px-3 py-1.5 rounded-md bg-muted border border-border text-sm text-foreground"
              placeholder="Search studies by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          )}
          <div className="border border-border rounded-md max-h-72 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">Loading…</div>
            ) : visible.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                {studies.length === 0
                  ? 'No other local studies to merge from.'
                  : 'No studies match your search.'}
              </div>
            ) : (
              visible.map((s) => {
                const Icon = ICON[s.importerName] || Folder
                const merged = mergedSet.has(s.id)
                const isSelected = selected?.id === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={merged}
                    onClick={() => setSelected(s)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left border-b border-border last:border-none transition-colors
                      ${isSelected ? 'bg-primary/10' : 'hover:bg-accent dark:hover:bg-accent'}
                      ${merged ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <Icon size={16} className="text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-foreground truncate">
                        {s.name || s.id}
                      </span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {s.importerName}
                      </span>
                    </span>
                    {merged && (
                      <span className="text-[10px] uppercase text-muted-foreground flex-shrink-0">
                        Already merged
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>

        <footer className="flex justify-between items-center px-5 py-3 border-t border-border bg-muted">
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" disabled={!selected} onClick={() => onPicked(selected)}>
              Next →
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
