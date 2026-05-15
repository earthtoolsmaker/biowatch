import { useEffect } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from './ui/button.jsx'

/**
 * Transitional "Starting import…" modal shown right after the user kicks
 * off an import. Surfaces live progress (bar + counts + speed + ETA) so
 * the user has concrete evidence work is happening before the modal
 * closes.
 *
 * The parent is responsible for deciding when the modal opens / closes;
 * this component just renders the shell and forwards dismiss events.
 */
export default function StartingImportModal({
  isOpen,
  folderPath,
  importStatus,
  onDismiss,
  dismissLabel = 'Continue in background',
  dismissEnabled = true
}) {
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissEnabled) onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, dismissEnabled, onDismiss])

  if (!isOpen) return null

  const total = importStatus?.total ?? 0
  const done = importStatus?.done ?? 0
  const speed = importStatus?.speed ?? 0
  const etaMinutes = importStatus?.estimatedMinutesRemaining
  const hasData = total > 0
  const progress = hasData ? (done / total) * 100 : 0

  const finishTime =
    hasData && etaMinutes != null && etaMinutes > 0
      ? new Date(
          // eslint-disable-next-line react-hooks/purity -- intentional: import polls re-render every second, refreshing the wall-clock finish time
          Date.now() + etaMinutes * 60_000
        ).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        })
      : null

  const infoLineParts = []
  if (hasData && speed > 0) infoLineParts.push(`${speed} media/min`)
  if (finishTime) infoLineParts.push(`finishes ≈ ${finishTime}`)

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={() => dismissEnabled && onDismiss()}
    >
      <div
        className="bg-card rounded-lg shadow-xl w-[480px] max-w-[92vw] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-medium text-foreground">Starting import…</h3>
          <button
            onClick={onDismiss}
            disabled={!dismissEnabled}
            className="text-muted-foreground hover:text-muted-foreground disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-6 space-y-4">
          <div className="flex items-start gap-3">
            <Loader2
              size={20}
              className="animate-spin text-blue-600 dark:text-blue-400 mt-0.5 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm text-foreground font-medium">Queueing images for analysis</p>
              <p
                className="text-xs font-mono text-muted-foreground truncate mt-0.5"
                style={folderPath ? { direction: 'rtl', textAlign: 'left' } : undefined}
                title={folderPath || ''}
              >
                {folderPath ? `‎${folderPath}` : ''}
              </p>
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/50 dark:bg-muted px-3 py-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-medium text-foreground">Progress</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {hasData ? `${Math.round(progress)}%` : ''}
              </p>
            </div>
            <div className="w-full bg-background dark:bg-muted-foreground/10 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-500 ease-in-out rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {hasData
                ? `${done.toLocaleString()} of ${total.toLocaleString()} media`
                : 'Queueing…'}
            </p>
            {infoLineParts.length > 0 && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {infoLineParts.join(' · ')}
              </p>
            )}
          </div>
        </div>

        <footer className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-border bg-gray-50 dark:bg-muted">
          <Button size="sm" onClick={onDismiss} disabled={!dismissEnabled}>
            {dismissLabel}
          </Button>
        </footer>
      </div>
    </div>
  )
}
