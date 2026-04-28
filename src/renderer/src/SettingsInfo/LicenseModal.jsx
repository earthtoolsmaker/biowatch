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
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-base font-medium text-gray-900">License</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-4 overflow-y-auto">
          {isLoading ? (
            <div className="text-sm text-gray-400">Loading…</div>
          ) : text ? (
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">{text}</pre>
          ) : (
            <div className="text-sm text-gray-400">License text not available.</div>
          )}
        </div>
      </div>
    </div>
  )
}
