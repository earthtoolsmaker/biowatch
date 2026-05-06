import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, ChevronDown, X } from 'lucide-react'
import ContributorByline from './ContributorByline'
import ContributorsModal from './ContributorsModal'

/**
 * Editorial header — title + description + contributor byline (left column)
 * and a `mapSlot` (right column).
 *
 * Editing affordances are hidden until hover, surfaced via a single `group`
 * class on the left column.
 *
 * @param {Object} props
 * @param {string} props.studyId
 * @param {string} props.studyName
 * @param {Object} props.studyData - Full study `data` object (description, contributors, taxonomic, …).
 * @param {React.ReactNode} props.mapSlot - The right-column content (typically <DeploymentMap />).
 */
export default function EditorialHeader({ studyId, studyName, studyData, mapSlot }) {
  const queryClient = useQueryClient()

  // Title editing
  const [editingTitle, setEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const titleEditRef = useRef(null)

  // Description editing
  const [editingDescription, setEditingDescription] = useState(false)
  const [editedDescription, setEditedDescription] = useState('')
  const descRef = useRef(null)
  const descEditRef = useRef(null)
  const descTextareaRef = useRef(null)
  const [descTruncated, setDescTruncated] = useState(false)
  const [descModalOpen, setDescModalOpen] = useState(false)

  // Resize the description textarea to fit its content. Capped at 60vh so
  // a runaway-long description doesn't push everything else off screen.
  const autoGrowDescription = (el) => {
    if (!el) return
    el.style.height = 'auto'
    const cap = Math.round(window.innerHeight * 0.6)
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`
  }

  // Contributors modal
  const [contributorsOpen, setContributorsOpen] = useState(false)

  const description = studyData?.description || ''

  const startTitleEdit = () => {
    setEditedTitle(studyName)
    setEditingTitle(true)
  }
  const cancelTitle = () => {
    setEditingTitle(false)
    setEditedTitle('')
  }
  const saveTitle = async () => {
    if (editedTitle.trim() && editedTitle !== studyName) {
      await window.api.updateStudy(studyId, { name: editedTitle.trim() })
      queryClient.invalidateQueries({ queryKey: ['study'] })
      queryClient.invalidateQueries({ queryKey: ['studies'] })
    }
    cancelTitle()
  }

  const startDescriptionEdit = () => {
    setEditedDescription(description)
    setEditingDescription(true)
  }
  const cancelDescription = () => {
    setEditingDescription(false)
    setEditedDescription('')
  }
  const saveDescription = async () => {
    try {
      await window.api.updateStudy(studyId, {
        data: { ...studyData, description: editedDescription.trim() }
      })
      queryClient.invalidateQueries({ queryKey: ['study'] })
    } finally {
      cancelDescription()
    }
  }

  // Click-outside to save title
  useEffect(() => {
    if (!editingTitle) return
    const onMouseDown = (e) => {
      if (titleEditRef.current && !titleEditRef.current.contains(e.target)) saveTitle()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTitle, editedTitle, studyName])

  // Click-outside / Escape for description
  useEffect(() => {
    if (!editingDescription) return
    const onMouseDown = (e) => {
      if (descEditRef.current && !descEditRef.current.contains(e.target)) saveDescription()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') cancelDescription()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingDescription, editedDescription])

  // Size the textarea to its content the moment editing opens.
  useEffect(() => {
    if (editingDescription) autoGrowDescription(descTextareaRef.current)
  }, [editingDescription])

  // Detect whether the in-place description is truncated (content taller than
  // the column's allocated space). Drives the "Show more" button. Uses a
  // ResizeObserver so panel-handle drags trigger re-checks (no window resize
  // event in that case).
  useEffect(() => {
    if (!descRef.current || editingDescription) {
      setDescTruncated(false)
      return
    }
    const el = descRef.current
    const check = () => {
      setDescTruncated(el.scrollHeight > el.clientHeight + 1)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    window.addEventListener('resize', check)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [description, editingDescription])

  return (
    <header className="grid grid-cols-[minmax(20rem,_50%)_1fr] @7xl:grid-cols-[minmax(20rem,_42%)_1fr] gap-6 h-full min-h-0 overflow-hidden">
      <div className="group flex flex-col min-h-0">
        {/* Title */}
        <div className="flex items-baseline gap-2">
          {editingTitle ? (
            <div ref={titleEditRef} className="flex-1">
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle()
                  else if (e.key === 'Escape') cancelTitle()
                }}
                className="text-2xl font-semibold text-foreground bg-transparent border-b-2 border-blue-500 focus:outline-none w-full"
                autoFocus
              />
            </div>
          ) : (
            <>
              <a
                target="_blank"
                rel="noopener noreferrer"
                href={studyData?.homepage}
                className="text-2xl font-semibold text-foreground capitalize"
              >
                {studyName}
              </a>
              <button
                type="button"
                onClick={startTitleEdit}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 hover:bg-accent rounded text-muted-foreground transition-opacity"
                title="Edit title"
                aria-label="Edit title"
              >
                <Pencil size={12} />
              </button>
            </>
          )}
        </div>

        {/* Description */}
        <div className="relative mt-2 flex-1 min-h-0 flex flex-col">
          {editingDescription ? (
            <div ref={descEditRef}>
              <textarea
                ref={descTextareaRef}
                value={editedDescription}
                onChange={(e) => {
                  setEditedDescription(e.target.value)
                  autoGrowDescription(e.target)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    saveDescription()
                  } else if (e.key === 'Escape') {
                    cancelDescription()
                  }
                }}
                className="w-full text-sm text-foreground leading-relaxed border-2 border-blue-500 rounded p-2 focus:outline-none resize-none overflow-hidden min-h-[160px] max-w-prose"
                autoFocus
                placeholder="Camera trap dataset containing deployment information, media files metadata, and species observations collected during wildlife monitoring."
              />
              <div className="text-[0.7rem] text-muted-foreground mt-1 max-w-prose">
                Press{' '}
                <kbd className="px-1 py-0.5 bg-muted rounded border border-border font-mono text-[0.65rem]">
                  ⌘ Enter
                </kbd>{' '}
                to save,{' '}
                <kbd className="px-1 py-0.5 bg-muted rounded border border-border font-mono text-[0.65rem]">
                  Esc
                </kbd>{' '}
                to cancel
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={startDescriptionEdit}
              className="text-left w-full block max-w-prose px-2 py-1 -mx-2 rounded transition-colors group-hover:outline group-hover:outline-1 group-hover:outline-dashed group-hover:outline-blue-200 flex-1 min-h-0 flex flex-col"
              title="Edit description"
            >
              <div
                ref={descRef}
                className="text-sm text-foreground leading-relaxed flex-1 min-h-0 overflow-hidden"
              >
                {description || (
                  <span className="text-muted-foreground italic">
                    Camera trap dataset containing deployment information, media files metadata, and
                    species observations collected during wildlife monitoring.
                  </span>
                )}
              </div>
            </button>
          )}
          {!editingDescription && description && descTruncated && (
            <button
              type="button"
              onClick={() => setDescModalOpen(true)}
              className="text-muted-foreground text-xs flex items-center hover:text-blue-700 dark:hover:text-blue-400 transition-colors mt-1 flex-shrink-0"
            >
              Show more
              <ChevronDown size={14} className="ml-1" />
            </button>
          )}
        </div>

        {/* Byline */}
        <ContributorByline
          contributors={studyData?.contributors}
          onManageClick={() => setContributorsOpen(true)}
        />
      </div>

      <div className="h-full">{mapSlot}</div>

      <ContributorsModal
        open={contributorsOpen}
        onClose={() => setContributorsOpen(false)}
        studyId={studyId}
        studyData={studyData}
      />

      <DescriptionModal
        open={descModalOpen}
        onClose={() => setDescModalOpen(false)}
        title={studyName}
        description={description}
        onSave={async (text) => {
          await window.api.updateStudy(studyId, {
            data: { ...studyData, description: text.trim() }
          })
          queryClient.invalidateQueries({ queryKey: ['study'] })
          setDescModalOpen(false)
        }}
      />
    </header>
  )
}

/**
 * Modal showing the full study description. Read-only by default; Edit
 * switches the body to a textarea and adds Save / Cancel buttons.
 */
function DescriptionModal({ open, onClose, onSave, title, description }) {
  const dialogRef = useRef(null)
  const textareaRef = useRef(null)
  const titleId = 'description-modal-title'

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  // Reset edit state on close.
  useEffect(() => {
    if (!open) {
      setEditing(false)
      setDraft('')
    }
  }, [open])

  // Esc cancels edit when editing, otherwise closes the modal.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (editing) {
        setEditing(false)
        setDraft('')
      } else {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, editing, onClose])

  // Auto-grow textarea on mount and on change.
  const autoGrow = (el) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useEffect(() => {
    if (editing) autoGrow(textareaRef.current)
  }, [editing])

  const startEdit = () => {
    setDraft(description || '')
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft('')
  }

  const handleSave = async () => {
    await onSave?.(draft)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (dialogRef.current && !dialogRef.current.contains(e.target)) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-card rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-border">
          <h3 id={titleId} className="text-base font-semibold text-foreground capitalize truncate">
            {title}
          </h3>
          <div className="flex items-center gap-1 flex-shrink-0">
            {!editing && onSave && (
              <button
                type="button"
                onClick={startEdit}
                className="px-2 py-1 text-xs text-muted-foreground hover:bg-accent rounded inline-flex items-center gap-1"
                title="Edit description"
              >
                <Pencil size={12} />
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 -mr-1 hover:bg-accent rounded text-muted-foreground"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {editing ? (
          <>
            <div className="px-5 py-4 overflow-y-auto flex-1">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  autoGrow(e.target)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    handleSave()
                  }
                }}
                className="w-full text-sm text-foreground leading-relaxed border border-border rounded p-2 focus:outline-none focus:border-blue-500 resize-none overflow-hidden min-h-[160px]"
                autoFocus
                placeholder="Camera trap dataset containing deployment information, media files metadata, and species observations collected during wildlife monitoring."
              />
            </div>
            <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border bg-muted">
              <span className="text-[0.7rem] text-muted-foreground">
                <kbd className="px-1 py-0.5 bg-card rounded border border-border font-mono text-[0.65rem]">
                  ⌘ Enter
                </kbd>{' '}
                to save,{' '}
                <kbd className="px-1 py-0.5 bg-card rounded border border-border font-mono text-[0.65rem]">
                  Esc
                </kbd>{' '}
                to cancel
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white dark:bg-blue-500 dark:text-white hover:bg-blue-700 rounded dark:hover:bg-blue-600"
                >
                  Save
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="px-5 py-4 overflow-y-auto text-sm text-foreground leading-relaxed whitespace-pre-line">
            {description}
          </div>
        )}
      </div>
    </div>
  )
}
