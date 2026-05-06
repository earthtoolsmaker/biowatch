import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { behaviorCategories } from '../../../shared/constants.js'

/**
 * Grouped multi-select dropdown for the `behavior` field.
 * Local state holds in-flight checkbox edits; commits to onChange when the
 * dropdown closes (preserves today's behavior).
 */
export default function BehaviorSelector({ value = [], onChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const [localBehaviors, setLocalBehaviors] = useState(value || [])
  const dropdownRef = useRef(null)
  const hasChangesRef = useRef(false)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    // Sync local state with the parent's value either when the dropdown is
    // closed (mirror external updates like undo/redo) or on the closed→open
    // transition (snapshot for in-flight editing). Once the dropdown is open
    // and stays open, keep the local edits intact until commit-on-close.
    if (!isOpen || !wasOpenRef.current) {
      setLocalBehaviors(value || [])
      hasChangesRef.current = false
    }
    wasOpenRef.current = isOpen
  }, [isOpen, value])

  const handleClose = useCallback(() => {
    if (hasChangesRef.current) {
      onChange(localBehaviors.length > 0 ? localBehaviors : null)
      hasChangesRef.current = false
    }
    setIsOpen(false)
  }, [localBehaviors, onChange])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        handleClose()
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, handleClose])

  const selectedCount = localBehaviors.length

  const handleToggle = (behavior) => {
    hasChangesRef.current = true
    setLocalBehaviors((prev) =>
      prev.includes(behavior) ? prev.filter((b) => b !== behavior) : [...prev, behavior]
    )
  }

  const handleClearAll = (e) => {
    e.stopPropagation()
    hasChangesRef.current = true
    setLocalBehaviors([])
  }

  const handleButtonClick = () => {
    if (isOpen) handleClose()
    else setIsOpen(true)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={handleButtonClick}
        className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md border text-sm transition-colors ${
          selectedCount > 0
            ? 'bg-card border-border text-[#030213]'
            : 'bg-card border-border text-muted-foreground hover:border-border'
        }`}
      >
        <span>
          {selectedCount > 0 ? `${selectedCount} behavior${selectedCount > 1 ? 's' : ''}` : 'None'}
        </span>
        <div className="flex items-center gap-1">
          {selectedCount > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClearAll}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleClearAll(e)
                }
              }}
              className="p-0.5 rounded hover:bg-accent transition-colors cursor-pointer"
              title="Clear all"
            >
              <X size={14} />
            </span>
          )}
          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-30 bottom-full mb-1 w-full bg-card border border-border rounded-md shadow-lg max-h-64 overflow-y-auto">
          {Object.entries(behaviorCategories).map(([category, behaviors]) => (
            <div key={category}>
              <div className="px-3 py-1.5 bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
                {category}
              </div>
              {behaviors.map((behavior) => {
                const isChecked = localBehaviors.includes(behavior)
                return (
                  <label
                    key={behavior}
                    onClick={(e) => e.stopPropagation()}
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent transition-colors ${
                      isChecked ? 'bg-muted' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        e.stopPropagation()
                        handleToggle(behavior)
                      }}
                      className="w-4 h-4 rounded border-border text-[#030213] focus:ring-gray-400 focus:ring-offset-0"
                    />
                    <span className="text-sm text-foreground">{behavior}</span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
