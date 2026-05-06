import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

export default function LicenseModal({ isOpen, onClose }) {
  const [text, setText] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!isOpen || text) return
    let cancelled = false
    setIsLoading(true)
    window.api
      .getLicenseText()
      .then((value) => {
        if (!cancelled) setText(value || '')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, text])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h2 className="text-base font-medium text-foreground">License</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-muted-foreground transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-4 overflow-y-auto">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : text ? (
            <pre className="text-xs text-foreground whitespace-pre-wrap font-mono">{text}</pre>
          ) : (
            <div className="text-sm text-muted-foreground">License text not available.</div>
          )}
        </div>
      </div>
    </div>
  )
}
