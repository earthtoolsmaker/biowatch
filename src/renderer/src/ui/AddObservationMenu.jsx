import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'

const BBOX_ICON = (
  <span
    className="w-4 h-4 rounded-sm border-[1.5px] border-[#2563eb]"
    style={{ background: 'rgba(37,99,235,0.08)' }}
    aria-hidden="true"
  />
)

const WHOLE_ICON = (
  <span
    className="w-4 h-4 rounded-sm border-[1.5px] border-dashed border-gray-400 bg-gray-100"
    aria-hidden="true"
  />
)

/**
 * Bottom-of-rail "+ Add observation" affordance with a 2-item menu.
 *
 * Props:
 *  - mode: 'empty' | 'bbox' | 'whole-image' | 'mixed'
 *  - onDrawRectangle: () → void
 *  - onWholeImage:    () → void
 *  - variant: 'bottom-row' (default) | 'centered-button' (empty-state)
 *
 * Hidden entirely when mode === 'whole-image' or 'mixed'.
 */
export default function AddObservationMenu({
  mode,
  onDrawRectangle,
  onWholeImage,
  variant = 'bottom-row'
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)

  const close = useCallback(() => setIsOpen(false), [])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) close()
    }
    const handleEsc = (e) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [isOpen, close])

  if (mode === 'whole-image' || mode === 'mixed') return null

  const showWhole = mode === 'empty'

  const trigger =
    variant === 'centered-button' ? (
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#2563eb] text-white text-sm font-medium hover:bg-[#1d4ed8]"
      >
        <Plus size={14} />
        Add observation
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 border-t border-gray-100"
      >
        <Plus size={14} />
        Add observation
      </button>
    )

  return (
    <div className="relative" ref={containerRef}>
      {trigger}

      {isOpen && (
        <div
          className={`absolute z-30 ${
            variant === 'centered-button'
              ? 'top-full mt-1 left-1/2 -translate-x-1/2'
              : 'bottom-full mb-1 left-3'
          } w-56 bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden`}
        >
          <button
            type="button"
            onClick={() => {
              close()
              onDrawRectangle()
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#030213] hover:bg-[#f8f9fb] text-left"
          >
            {BBOX_ICON}
            <span className="flex flex-col">
              <span>Draw rectangle</span>
              <span className="text-xs text-gray-400">Click and drag on the image</span>
            </span>
          </button>
          {showWhole && (
            <button
              type="button"
              onClick={() => {
                close()
                onWholeImage()
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#030213] hover:bg-[#f8f9fb] text-left border-t border-gray-100"
            >
              {WHOLE_ICON}
              <span className="flex flex-col">
                <span>Whole image</span>
                <span className="text-xs text-gray-400">No rectangle, image-level</span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
