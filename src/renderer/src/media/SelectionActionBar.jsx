import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tag, Eraser, Check, X } from 'lucide-react'

// Floating bulk-action bar shown when ≥1 sequence is selected. Acts on the
// resolved member mediaIDs via the Plan-1 bulk IPCs, then asks the caller to
// refresh + clear selection.
export default function SelectionActionBar({ studyId, count, mediaIds, onApplied, onClear }) {
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const speciesQuery = useQuery({
    queryKey: ['distinctSpecies', studyId],
    queryFn: async () => {
      const res = await window.api.getDistinctSpecies(studyId)
      if (res?.error) throw new Error(res.error)
      return res?.data ?? res ?? []
    },
    enabled: pickerOpen && !!studyId,
    staleTime: 60000
  })

  const run = async (fn) => {
    if (busy || !mediaIds.length) return
    setBusy(true)
    try {
      const res = await fn()
      if (res?.error) throw new Error(res.error)
      await onApplied()
    } catch (err) {
      // Surface failures rather than silently clearing the selection.

      window.alert(`Bulk action failed: ${err.message}`)
    } finally {
      setBusy(false)
      setPickerOpen(false)
    }
  }

  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-40">
      <div className="flex items-center gap-2.5 bg-slate-900 text-white rounded-xl px-3 py-2 shadow-lg">
        <span className="bg-blue-600 rounded-md px-2.5 py-1 text-[12px] font-semibold">
          {count} selected
        </span>

        <div className="relative">
          <button
            type="button"
            disabled={busy}
            onClick={() => setPickerOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 rounded-md px-2.5 py-1 text-[12px]"
          >
            <Tag size={13} /> Set species ▾
          </button>
          {pickerOpen && (
            <div className="absolute bottom-full mb-1 left-0 w-56 max-h-64 overflow-y-auto bg-card text-foreground border border-border rounded-lg shadow-xl p-1">
              {!speciesQuery.data ? (
                <div className="px-2 py-1.5 text-[12px] text-muted-foreground">Loading…</div>
              ) : speciesQuery.data.length === 0 ? (
                <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No species</div>
              ) : (
                speciesQuery.data.map((s) => {
                  const name = typeof s === 'string' ? s : s.scientificName
                  if (!name) return null
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() =>
                        run(() =>
                          window.api.bulkSetSpecies(studyId, mediaIds, { scientificName: name })
                        )
                      }
                      className="w-full text-left px-2 py-1.5 text-[12.5px] rounded hover:bg-blue-50 dark:hover:bg-blue-500/15"
                    >
                      {name}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => window.api.bulkMarkBlank(studyId, mediaIds))}
          className="inline-flex items-center gap-1.5 bg-amber-900/80 hover:bg-amber-900 text-amber-100 rounded-md px-2.5 py-1 text-[12px]"
        >
          <Eraser size={13} /> Mark blank
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => window.api.bulkMarkReviewed(studyId, mediaIds))}
          className="inline-flex items-center gap-1.5 bg-green-900/80 hover:bg-green-900 text-green-100 rounded-md px-2.5 py-1 text-[12px]"
        >
          <Check size={13} /> Mark reviewed
        </button>

        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="opacity-70 hover:opacity-100 pl-1"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
