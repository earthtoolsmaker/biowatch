import { useEffect, useState } from 'react'
import { X, Layers, Camera, Image as ImageIcon, Eye } from 'lucide-react'
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
  const [progress, setProgress] = useState(null) // { phase, done, total }

  // ESC closes — but not during submit. While the merge runs, the only
  // way out is the explicit Cancel merge button.
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
        const title = sourceStudy.name || sourceStudy.id
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
  }, [isOpen, targetStudyId, sourceStudy.id, sourceStudy.name])

  // Subscribe to merge progress while the merge is in flight. The IPC channel
  // delivers `{ phase, done, total }` snapshots every couple thousand rows.
  useEffect(() => {
    if (!submitting) {
      setProgress(null)
      return
    }
    if (!window.api.onMergeProgress) return
    const unsub = window.api.onMergeProgress((payload) => setProgress(payload))
    return unsub
  }, [submitting])

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
      if (result.cancelled) {
        // User cancelled — main rolled the transaction back. Just close.
        onCancel?.()
        return
      }
      onMerged?.()
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  const handleCancelMerge = async () => {
    if (!submitting || !window.api.cancelMerge) return
    try {
      await window.api.cancelMerge(targetStudyId)
    } catch (e) {
      // Swallow — worker may have already exited.
      console.warn('cancelMerge failed:', e?.message)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]"
      onClick={() => !submitting && onCancel()}
    >
      <div
        className="bg-card rounded-lg shadow-xl w-[560px] max-w-[92vw] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex justify-between items-start">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-500/20 rounded-full">
              <Layers size={20} className="text-blue-600 dark:text-blue-300" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Review merge</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Confirm what will be added to this study.
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {!preflight && !error && <PreflightSkeleton />}
          {preflight && (
            <>
              <div className="rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 p-4 text-sm space-y-3">
                <SummaryRow label="From" value={sourceStudy.name || sourceStudy.id} />
                <SummaryRow
                  label="Into"
                  value={targetMeta?.name || targetMeta?.title || targetStudyId}
                />
                <div className="pt-3 border-t border-blue-200/60 dark:border-blue-500/20">
                  <div className="text-muted-foreground mb-2">Adding</div>
                  <div className="flex items-center justify-center gap-x-5 gap-y-2 flex-wrap">
                    <Stat icon={<Camera size={14} />} count={preflight.deploymentCount} label="deployments" />
                    <Stat icon={<ImageIcon size={14} />} count={preflight.mediaCount} label="media" />
                    <Stat icon={<Eye size={14} />} count={preflight.observationCount} label="observations" />
                  </div>
                </div>
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
                  {sourceStudy.name || 'this study'} live inside biowatch&apos;s own storage. They
                  will remain available after the merge, but deleting the source study later will
                  make them unavailable here. You&apos;ll be warned at delete time.
                </p>
              )}

              {preflight.missingFileCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {preflight.missingFileCount} media file
                  {preflight.missingFileCount === 1 ? '' : 's'} could not be found on disk and will
                  be skipped.
                </p>
              )}

              {description.trim() !== '' && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Description
                  </span>
                  <textarea
                    className="w-full mt-1.5 px-3 py-2 rounded-md bg-card border border-border/60 text-sm text-foreground leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
                    rows={6}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              )}

              {contributors.length > 0 &&
                (() => {
                  const origins = new Set(contributors.map((c) => c.origin))
                  const showOriginBadge = origins.size > 1
                  return (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                        Contributors
                      </div>
                      <div className="border border-border/50 rounded-md divide-y divide-border/40 max-h-[155px] overflow-y-auto">
                        {contributors.map((c, i) => (
                          <label
                            key={c.email + i}
                            className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/15"
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
                                <span className="text-muted-foreground"> · {formatRole(c.role)}</span>
                              )}
                            </span>
                            {showOriginBadge && (
                              <span className="text-[10px] uppercase text-muted-foreground">
                                {c.origin}
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })()}

              {submitting && progress && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {progress.phase === 'scanning' ? 'Checking files…' : 'Copying rows…'}
                    </span>
                    <span className="tabular-nums">
                      {Number(progress.done).toLocaleString()} /{' '}
                      {Number(progress.total).toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all duration-150"
                      style={{
                        width: `${
                          progress.total > 0
                            ? Math.min(100, Math.round((progress.done / progress.total) * 100))
                            : 0
                        }%`
                      }}
                    />
                  </div>
                </div>
              )}

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

        <div className="px-6 py-4 border-t border-border flex justify-between items-center">
          <Button variant="ghost" size="sm" onClick={onBack} disabled={submitting}>
            ← Back
          </Button>
          <div className="flex gap-2">
            {submitting ? (
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                onClick={handleCancelMerge}
              >
                Cancel merge
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={onCancel}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleMerge} disabled={!canMerge}>
                  Merge
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PreflightSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Summary card placeholder */}
      <div className="rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 p-4 space-y-3">
        <div className="flex justify-between items-baseline gap-3">
          <div className="h-3 w-12 rounded bg-blue-200/60 dark:bg-blue-500/30" />
          <div className="h-3 w-40 rounded bg-blue-200/60 dark:bg-blue-500/30" />
        </div>
        <div className="flex justify-between items-baseline gap-3">
          <div className="h-3 w-10 rounded bg-blue-200/60 dark:bg-blue-500/30" />
          <div className="h-3 w-28 rounded bg-blue-200/60 dark:bg-blue-500/30" />
        </div>
        <div className="pt-3 border-t border-blue-200/60 dark:border-blue-500/20">
          <div className="h-3 w-14 rounded bg-blue-200/60 dark:bg-blue-500/30 mb-2" />
          <div className="flex items-center justify-center gap-x-5 gap-y-2 flex-wrap">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-4 w-28 rounded bg-blue-200/60 dark:bg-blue-500/30" />
            ))}
          </div>
        </div>
      </div>

      {/* Description block placeholder */}
      <div>
        <div className="h-2 w-20 rounded bg-muted mb-2" />
        <div className="h-28 w-full rounded-md bg-muted/70 border border-border/40" />
      </div>

      {/* Contributors block placeholder */}
      <div>
        <div className="h-2 w-20 rounded bg-muted mb-2" />
        <div className="space-y-2">
          <div className="h-7 w-full rounded bg-muted/70" />
          <div className="h-7 w-full rounded bg-muted/70" />
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex gap-3 items-baseline">
      <span className="text-muted-foreground flex-shrink-0 w-14">{label}</span>
      <span className="font-medium truncate flex-1 min-w-0" title={String(value)}>
        {value}
      </span>
    </div>
  )
}

function Stat({ icon, count, label }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-blue-600 dark:text-blue-300 self-center flex-shrink-0">{icon}</span>
      <span className="text-sm font-semibold text-foreground tabular-nums">
        {Number(count || 0).toLocaleString()}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  )
}

/**
 * Convert a Camtrap DP camelCase role to a human-readable label.
 * `principalInvestigator` → `Principal investigator`
 * `rightsHolder` → `Rights holder`
 * `contact` → `Contact`
 */
function formatRole(role) {
  if (!role) return ''
  return role
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())
}

function buildContributors(aJson, bJson) {
  const aArr = safeParse(aJson)
  const bArr = safeParse(bJson)
  const byEmail = new Map()
  for (const c of aArr) {
    if (!c.email) continue
    byEmail.set(c.email.toLowerCase(), { ...c, origin: 'Existing', checked: true })
  }
  for (const c of bArr) {
    if (!c.email) continue
    const key = c.email.toLowerCase()
    if (byEmail.has(key)) {
      byEmail.get(key).origin = 'Both'
    } else {
      byEmail.set(key, { ...c, origin: 'New', checked: true })
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
