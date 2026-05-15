import { useEffect } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from './ui/button.jsx'

/**
 * Transitional "Starting import…" modal shown right after the user kicks
 * off an import. Tells them what is happening now and where to look for
 * ongoing progress, so by the time it closes they know to expect the
 * (subtle) header progress UI and media appearing on the page.
 *
 * The parent is responsible for deciding when the modal opens / closes;
 * this component just renders the shell and forwards dismiss events.
 */
export default function StartingImportModal({
  isOpen,
  folderPath,
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

          <div className="rounded-md border border-border bg-muted/50 dark:bg-muted px-3 py-3">
            <p className="text-xs font-medium text-foreground mb-2">What happens next</p>
            <ul className="text-xs text-muted-foreground space-y-1.5 leading-relaxed list-disc list-inside">
              <li>A progress bar appears in the top-right header — pause or resume from there.</li>
              <li>Images appear in the Media tab as they get classified. No need to refresh.</li>
              <li>You can keep using the app while this runs in the background.</li>
            </ul>
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
