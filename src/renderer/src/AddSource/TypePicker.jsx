import { useEffect } from 'react'
import { FolderOpen, Layers, X, Plus } from 'lucide-react'
import { Button } from '../ui/button.jsx'

/**
 * Step 1 of the Add Source wizard — pick the source type.
 *
 * Selecting a card advances immediately (no separate Next click).
 */
export default function TypePicker({ isOpen, onPick, onCancel }) {
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onCancel])

  if (!isOpen) return null

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
              <Plus size={20} className="text-blue-600 dark:text-blue-300" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Add source</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Choose where the new data should come from.
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

        <div className="px-6 py-5 space-y-3">
          <OptionCard
            icon={<FolderOpen size={22} />}
            title="Images directory"
            subtitle="Scan a local folder of images with an AI model"
            onClick={() => onPick('folder')}
          />
          <OptionCard
            icon={<Layers size={22} />}
            title="Another study"
            subtitle="Merge data from a study already in Biowatch"
            onClick={() => onPick('merge')}
          />
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

function OptionCard({ icon, title, subtitle, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full flex items-start gap-3 px-4 py-3.5 rounded-lg border border-border/50 bg-card text-left transition-all hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-500/15 dark:hover:border-blue-400 hover:shadow-sm"
    >
      <div className="p-2 rounded-md flex-shrink-0 bg-muted text-muted-foreground transition-colors group-hover:bg-blue-100 group-hover:text-blue-600 dark:group-hover:bg-blue-500/25 dark:group-hover:text-blue-300">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{subtitle}</div>
      </div>
    </button>
  )
}
