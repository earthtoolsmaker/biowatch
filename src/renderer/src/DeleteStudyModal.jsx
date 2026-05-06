import { useState, useEffect } from 'react'
import { X, AlertTriangle } from 'lucide-react'

function DeleteStudyModal({ isOpen, onConfirm, onCancel, studyName }) {
  const [confirmText, setConfirmText] = useState('')

  const confirmPhrase = 'delete this study'
  const canDelete = confirmText.toLowerCase().trim() === confirmPhrase

  // Reset input when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setConfirmText('')
    }
  }, [isOpen])

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onCancel])

  const handleConfirm = () => {
    if (canDelete) {
      onConfirm()
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && canDelete) {
      handleConfirm()
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]"
      onClick={onCancel}
    >
      <div
        data-testid="delete-modal"
        className="bg-card rounded-lg shadow-xl max-w-md w-full mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex justify-between items-start">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-100 rounded-full dark:bg-red-500/20">
              <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Delete Study</h2>
              <p className="text-sm text-muted-foreground mt-1">This action cannot be undone</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4">
          <p className="text-sm text-foreground mb-4">
            You are about to permanently delete the study{' '}
            <span className="font-semibold text-foreground">&ldquo;{studyName}&rdquo;</span>. This
            will remove all associated data, deployments, and media references.
          </p>

          <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-md p-3 mb-4 dark:bg-red-500/15">
            <p className="text-sm text-red-800 dark:text-red-300">
              This action is <strong>irreversible</strong>. All data will be permanently lost.
            </p>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-foreground">
              Type <span className="font-mono bg-muted px-1 rounded">{confirmPhrase}</span> to
              confirm
            </span>
            <input
              type="text"
              data-testid="delete-confirm-input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={confirmPhrase}
              className="mt-2 block w-full px-3 py-2 border border-border rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
              autoFocus
            />
          </label>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-accent rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            data-testid="delete-confirm-btn"
            onClick={handleConfirm}
            disabled={!canDelete}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
              canDelete
                ? 'cursor-pointer bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600'
                : 'bg-red-300 cursor-not-allowed dark:bg-red-500/40'
            }`}
          >
            Delete Study
          </button>
        </div>
      </div>
    </div>
  )
}

export default DeleteStudyModal
