import { Pencil } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'

/**
 * Inline-editable location name. Click the text or pencil icon to enter
 * edit mode; Enter/blur saves, Esc cancels. Empty or unchanged values
 * are silently dropped on save.
 *
 * Used in:
 *   - deployments.jsx — list rows + group headers
 *   - deployments/DeploymentDetailPane.jsx — bottom-pane title
 */
const EditableLocationName = memo(function EditableLocationName({
  locationID,
  locationName,
  isSelected,
  onRename
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef(null)

  const displayName = locationName || locationID || 'Unnamed Location'

  const startEditing = useCallback(
    (e) => {
      e.stopPropagation()
      setEditValue(displayName)
      setIsEditing(true)
    },
    [displayName]
  )

  const cancelEditing = useCallback(() => {
    setIsEditing(false)
    setEditValue('')
  }, [])

  const saveEdit = useCallback(async () => {
    const trimmed = editValue.trim()
    // Cancel if empty or unchanged
    if (!trimmed || trimmed === displayName) {
      cancelEditing()
      return
    }

    setIsSaving(true)
    try {
      await onRename(locationID, trimmed)
      setIsEditing(false)
    } catch (error) {
      console.error('Error renaming location:', error)
      // Keep edit mode open for retry
    } finally {
      setIsSaving(false)
    }
  }, [editValue, displayName, locationID, onRename, cancelEditing])

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        saveEdit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelEditing()
      }
    },
    [saveEdit, cancelEditing]
  )

  const handleBlur = useCallback(() => {
    if (!isSaving) {
      saveEdit()
    }
  }, [isSaving, saveEdit])

  // Focus and select input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  if (isEditing) {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          maxLength={100}
          disabled={isSaving}
          title="Enter saves, Esc cancels"
          className="text-sm text-foreground bg-transparent border-b-2 border-blue-500 focus:outline-none w-full max-w-[180px] py-0.5"
        />
      </div>
    )
  }

  return (
    <div className="group flex items-center gap-1 min-w-0">
      <span
        onClick={startEditing}
        className={`cursor-pointer text-sm truncate min-w-0 ${
          isSelected ? 'font-semibold text-blue-700 dark:text-blue-400' : 'text-foreground'
        }`}
        title={`${displayName} (click to rename)`}
      >
        {displayName}
      </span>
      <button
        onClick={startEditing}
        className="p-0.5 opacity-0 group-hover:opacity-100 hover:bg-accent rounded text-muted-foreground transition-opacity flex-shrink-0"
        title="Rename"
      >
        <Pencil size={12} />
      </button>
    </div>
  )
})

export default EditableLocationName
