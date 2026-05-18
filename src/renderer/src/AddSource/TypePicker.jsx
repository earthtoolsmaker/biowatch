import { useEffect } from 'react'
import { FolderOpen, Layers, X } from 'lucide-react'
import { Button } from '../ui/button.jsx'

/**
 * Step 1 of the Add Source wizard — pick the source type.
 */
export default function TypePicker({ isOpen, selected, onSelect, onCancel, onNext }) {
  // ESC closes.
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
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-card rounded-lg shadow-xl w-[480px] max-w-[92vw] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-medium text-foreground">Add source</h3>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-muted-foreground">What would you like to add?</p>
          <Card
            icon={<FolderOpen size={20} />}
            title="Images directory"
            subtitle="Scan a local folder of images with an AI model"
            active={selected === 'folder'}
            onClick={() => onSelect('folder')}
          />
          <Card
            icon={<Layers size={20} />}
            title="Another study"
            subtitle="Merge data from a study already in this app"
            active={selected === 'merge'}
            onClick={() => onSelect('merge')}
          />
        </div>

        <footer className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onNext} disabled={!selected}>
            Next →
          </Button>
        </footer>
      </div>
    </div>
  )
}

function Card({ icon, title, subtitle, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-md border text-left transition-colors ${
        active
          ? 'border-primary bg-primary/10'
          : 'border-border bg-card hover:bg-accent dark:hover:bg-accent'
      }`}
    >
      <span className="text-muted-foreground flex-shrink-0">{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground mt-0.5">{subtitle}</span>
      </span>
    </button>
  )
}
