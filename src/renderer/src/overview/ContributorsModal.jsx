import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Check, X, Plus } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.jsx'

const CONTRIBUTOR_ROLES = [
  { value: 'contact', label: 'Contact' },
  { value: 'principalInvestigator', label: 'Principal Investigator' },
  { value: 'rightsHolder', label: 'Rights Holder' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'contributor', label: 'Contributor' }
]

const EMPTY_CONTRIBUTOR = { title: '', role: '', organization: '', email: '' }

/**
 * Modal owning all contributor CRUD state. Replaces the inline strip of cards.
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.studyId
 * @param {Object} props.studyData - The full study data object.
 */
export default function ContributorsModal({ open, onClose, studyId, studyData }) {
  const queryClient = useQueryClient()
  const [editingIndex, setEditingIndex] = useState(null)
  const [editedContrib, setEditedContrib] = useState(null)
  const [adding, setAdding] = useState(false)
  const [newContrib, setNewContrib] = useState(EMPTY_CONTRIBUTOR)
  const [deletingIndex, setDeletingIndex] = useState(null)
  const dialogRef = useRef(null)
  const titleId = 'contributors-modal-title'

  const contributors = studyData?.contributors || []

  // Reset internal state when the modal closes.
  useEffect(() => {
    if (!open) {
      setEditingIndex(null)
      setEditedContrib(null)
      setAdding(false)
      setNewContrib(EMPTY_CONTRIBUTOR)
      setDeletingIndex(null)
    }
  }, [open])

  // Close on Escape (only when no nested confirmation is open).
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape' && deletingIndex === null) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, deletingIndex])

  // Focus management: move focus into the dialog on open, restore to the
  // previously-focused element on close. Trap Tab inside the dialog.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement
    // Defer to next tick so children have mounted.
    requestAnimationFrame(() => {
      const root = dialogRef.current
      if (!root) return
      const focusable = root.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      focusable?.focus()
    })
    const onKey = (e) => {
      if (e.key !== 'Tab' || !dialogRef.current) return
      const root = dialogRef.current
      const focusables = root.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [open])

  if (!open) return null

  const startEdit = (i) => {
    setEditingIndex(i)
    setEditedContrib({ ...contributors[i] })
    setAdding(false)
  }

  const cancelEdit = () => {
    setEditingIndex(null)
    setEditedContrib(null)
  }

  const saveEdit = async (i) => {
    if (!editedContrib?.title?.trim()) return
    const updated = [...contributors]
    updated[i] = {
      ...editedContrib,
      title: editedContrib.title.trim(),
      organization: editedContrib.organization?.trim() || undefined,
      email: editedContrib.email?.trim() || undefined
    }
    await window.api.updateStudy(studyId, { data: { ...studyData, contributors: updated } })
    queryClient.invalidateQueries({ queryKey: ['study'] })
    cancelEdit()
  }

  const remove = async (i) => {
    const updated = contributors.filter((_, idx) => idx !== i)
    await window.api.updateStudy(studyId, { data: { ...studyData, contributors: updated } })
    queryClient.invalidateQueries({ queryKey: ['study'] })
    setDeletingIndex(null)
  }

  const addNew = async () => {
    if (!newContrib?.title?.trim()) return
    const toAdd = {
      title: newContrib.title.trim(),
      role: newContrib.role || undefined,
      organization: newContrib.organization?.trim() || undefined,
      email: newContrib.email?.trim() || undefined
    }
    const updated = [...contributors, toAdd]
    await window.api.updateStudy(studyId, { data: { ...studyData, contributors: updated } })
    queryClient.invalidateQueries({ queryKey: ['study'] })
    setAdding(false)
    setNewContrib(EMPTY_CONTRIBUTOR)
  }

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        // Only close on clicks inside the overlay itself (the backdrop), not
        // on portalled descendants like the role-picker dropdown.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-card rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6"
      >
        <h3 id={titleId} className="text-lg font-medium mb-1">
          Manage contributors
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Researchers and organizations associated with this study.
        </p>

        <div className="flex flex-col gap-2">
          {contributors.map((c, i) =>
            editingIndex === i ? (
              <ContributorEditForm
                key={i}
                value={editedContrib}
                onChange={setEditedContrib}
                onSave={() => saveEdit(i)}
                onCancel={cancelEdit}
              />
            ) : (
              <div
                key={i}
                className="border border-border rounded-md px-3 py-2 flex items-start justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-foreground truncate">
                    {c.title || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unnamed'}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[friendlyRole(c.role), c.organization, c.email].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(i)}
                    className="p-1 hover:bg-accent rounded text-muted-foreground"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingIndex(i)}
                    className="p-1 hover:bg-red-50 rounded text-red-600 dark:text-red-400"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          )}

          {adding ? (
            <ContributorEditForm
              value={newContrib}
              onChange={setNewContrib}
              onSave={addNew}
              onCancel={() => {
                setAdding(false)
                setNewContrib(EMPTY_CONTRIBUTOR)
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setAdding(true)
                cancelEdit()
              }}
              className="border border-dashed border-border text-muted-foreground rounded-md px-3 py-2 hover:border-border hover:bg-accent transition-colors flex items-center justify-center gap-1.5 text-sm"
            >
              <Plus size={14} />
              Add contributor
            </button>
          )}
        </div>

        <div className="flex justify-end mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded"
          >
            Done
          </button>
        </div>
      </div>

      {deletingIndex !== null && (
        <div
          className="fixed inset-0 z-[1100] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setDeletingIndex(null)}
        >
          <div
            className="bg-card rounded-lg shadow-xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium mb-2">Delete contributor</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Are you sure you want to delete this contributor?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingIndex(null)}
                className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => remove(deletingIndex)}
                className="px-3 py-1.5 text-sm bg-red-600 text-white dark:bg-red-500 dark:text-white hover:bg-red-700 rounded"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ContributorEditForm({ value, onChange, onSave, onCancel }) {
  return (
    <div
      className="border border-border rounded-md px-3 py-2 flex flex-col gap-2 bg-muted"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onSave()
        } else if (e.key === 'Escape') {
          onCancel()
        }
      }}
    >
      <input
        type="text"
        value={value.title || ''}
        onChange={(e) => onChange({ ...value, title: e.target.value })}
        className="border border-border rounded-md px-2 py-1.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        placeholder="Name *"
        autoFocus
      />
      <Select value={value.role || ''} onValueChange={(v) => onChange({ ...value, role: v })}>
        <SelectTrigger className="w-full bg-card border-border px-2 py-1.5 h-auto data-[placeholder]:text-muted-foreground">
          <SelectValue placeholder="Select role…" />
        </SelectTrigger>
        <SelectContent className="z-[1001] bg-card">
          {CONTRIBUTOR_ROLES.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input
        type="text"
        value={value.organization || ''}
        onChange={(e) => onChange({ ...value, organization: e.target.value })}
        className="border border-border rounded-md px-2 py-1.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        placeholder="Organization"
      />
      <input
        type="email"
        value={value.email || ''}
        onChange={(e) => onChange({ ...value, email: e.target.value })}
        className="border border-border rounded-md px-2 py-1.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        placeholder="Email"
      />
      <div className="flex justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="p-1 hover:bg-accent rounded text-muted-foreground"
          title="Cancel"
        >
          <X size={16} />
        </button>
        <button
          type="button"
          onClick={onSave}
          className="p-1 hover:bg-blue-50 rounded text-blue-600 dark:hover:bg-blue-500/15 dark:text-blue-400"
          title="Save"
        >
          <Check size={16} />
        </button>
      </div>
    </div>
  )
}

function friendlyRole(role) {
  if (!role) return null
  const known = CONTRIBUTOR_ROLES.find((r) => r.value === role)
  if (known) return known.label
  return role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())
}
