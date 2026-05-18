import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '../ui/button.jsx'

/**
 * Step 3 of the merge wizard — review pre-filled metadata + confirm merge.
 */
export default function ReviewStep({
  isOpen,
  targetStudyId,
  sourceStudy,
  onBack,
  onCancel,
  onMerged
}) {
  const [preflight, setPreflight] = useState(null)
  const [targetMeta, setTargetMeta] = useState(null)
  const [description, setDescription] = useState('')
  const [contributors, setContributors] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // ESC closes.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape' && !submitting) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onCancel, submitting])

  // Load preflight + both metadata records once on open.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    Promise.all([
      window.api.mergePreflight(targetStudyId, sourceStudy.id),
      window.api.getStudyMetadata(targetStudyId),
      window.api.getStudyMetadata(sourceStudy.id)
    ])
      .then(([pf, a, b]) => {
        if (cancelled) return
        setPreflight(pf)
        setTargetMeta(a)
        const aDesc = a?.description || ''
        const bDesc = b?.description || ''
        const title = sourceStudy.title || sourceStudy.id
        const merged =
          aDesc.length || bDesc.length
            ? `${aDesc}\n\n---\n\n## Merged from ${title}\n\n${bDesc}`.trim()
            : ''
        setDescription(merged)
        setContributors(buildContributors(a?.contributors, b?.contributors))
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Failed to load preflight')
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, targetStudyId, sourceStudy.id, sourceStudy.title])

  const canMerge = !!preflight && !preflight.alreadyMerged && !submitting

  const handleMerge = async () => {
    if (!canMerge) return
    setSubmitting(true)
    setError(null)
    try {
      const reviewed = {
        description,
        contributorEmails: contributors.filter((c) => c.checked).map((c) => c.email)
      }
      const result = await window.api.mergeStudy(targetStudyId, sourceStudy.id, reviewed)
      if (!result || result.success !== true) {
        throw new Error(result?.error || 'Merge failed')
      }
      onMerged?.()
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={() => !submitting && onCancel()}
    >
      <div
        className="bg-card rounded-lg shadow-xl w-[520px] max-w-[92vw] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-medium text-foreground">
            Add source <span className="text-muted-foreground text-sm">— Review merge</span>
          </h3>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {!preflight && !error && (
            <p className="text-sm text-muted-foreground">Computing pre-flight…</p>
          )}
          {preflight && (
            <>
              <div className="bg-muted rounded-md p-3 text-sm space-y-1">
                <SummaryRow
                  label="From"
                  value={sourceStudy.title || sourceStudy.id}
                />
                <SummaryRow label="Into" value={targetMeta?.title || targetStudyId} />
                <SummaryRow
                  label="Adding"
                  value={`${preflight.deploymentCount} deployments · ${preflight.mediaCount} media · ${preflight.observationCount} observations`}
                />
              </div>

              {preflight.alreadyMerged && (
                <div className="text-xs text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-md px-3 py-2">
                  This study has already been merged here. Nothing to do.
                </div>
              )}

              {preflight.ownedByBiowatchCount > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {preflight.ownedByBiowatchCount} file
                  {preflight.ownedByBiowatchCount === 1 ? '' : 's'} in{' '}
                  {sourceStudy.title || 'this study'} live inside biowatch's own storage. They will
                  remain available after the merge, but deleting the source study later will make
                  them unavailable here. You'll be warned at delete time.
                </p>
              )}

              {preflight.renameCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {preflight.renameCount} deployment ID
                  {preflight.renameCount === 1 ? '' : 's'} from the source will be renamed (e.g.{' '}
                  <code className="font-mono text-[10px]">
                    CAM_01 → study:{(sourceStudy.id || '').slice(0, 8)}:CAM_01
                  </code>
                  ) to avoid collisions. Informational — IDs are internal.
                </p>
              )}

              {preflight.missingFileCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {preflight.missingFileCount} media file
                  {preflight.missingFileCount === 1 ? '' : 's'} could not be found on disk and will
                  be skipped.
                </p>
              )}

              <label className="block">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Description
                </span>
                <textarea
                  className="w-full mt-1.5 px-3 py-2 rounded-md bg-muted border border-border text-sm font-mono text-foreground"
                  rows={6}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={submitting}
                />
              </label>

              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                  Contributors
                </div>
                {contributors.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No contributors to merge.</p>
                ) : (
                  <div className="border border-border rounded-md divide-y divide-border">
                    {contributors.map((c, i) => (
                      <label
                        key={c.email + i}
                        className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent"
                      >
                        <input
                          type="checkbox"
                          checked={c.checked}
                          onChange={(e) =>
                            setContributors((prev) =>
                              prev.map((p, idx) =>
                                idx === i ? { ...p, checked: e.target.checked } : p
                              )
                            )
                          }
                          disabled={submitting}
                        />
                        <span className="flex-1">
                          {c.title || c.email}
                          {c.role && (
                            <span className="text-muted-foreground"> · {c.role}</span>
                          )}
                        </span>
                        <span className="text-[10px] uppercase text-muted-foreground">
                          {c.origin}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-md px-3 py-2 dark:text-red-400">
                  {error}
                </div>
              )}
            </>
          )}
          {error && !preflight && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-md px-3 py-2 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <footer className="flex justify-between items-center px-5 py-3 border-t border-border bg-muted">
          <Button variant="ghost" size="sm" onClick={onBack} disabled={submitting}>
            ← Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleMerge} disabled={!canMerge}>
              {submitting ? 'Merging…' : 'Merge'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground flex-shrink-0">{label}</span>
      <span className="font-medium text-right truncate">{value}</span>
    </div>
  )
}

function buildContributors(aJson, bJson) {
  const aArr = safeParse(aJson)
  const bArr = safeParse(bJson)
  const byEmail = new Map()
  for (const c of aArr) {
    if (!c.email) continue
    byEmail.set(c.email.toLowerCase(), { ...c, origin: 'A only', checked: true })
  }
  for (const c of bArr) {
    if (!c.email) continue
    const key = c.email.toLowerCase()
    if (byEmail.has(key)) {
      byEmail.get(key).origin = 'A + B'
    } else {
      byEmail.set(key, { ...c, origin: 'B only', checked: true })
    }
  }
  return [...byEmail.values()]
}

function safeParse(v) {
  if (!v) return []
  if (Array.isArray(v)) return v
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
