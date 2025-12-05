import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getImageBounds,
  screenToNormalized,
  clampBbox,
  getCursorForHandle,
  resizeBboxFromHandle,
  moveBbox,
  pixelToNormalizedDelta
} from '../utils/bboxCoordinates'

const CORNER_HANDLE_SIZE = 8 // pixels
const EDGE_HANDLE_SIZE = 6 // pixels
const MIN_BBOX_SIZE = 0.05 // 5% of image dimension
const NUDGE_PIXELS = 1 // pixels to move with arrow keys

/**
 * Editable bounding box with move and resize capabilities.
 * Supports 8 handles (4 corners + 4 edge midpoints).
 */
export default function EditableBbox({
  bbox,
  isSelected,
  onSelect,
  onUpdate,
  imageRef,
  containerRef,
  color = '#84cc16'
}) {
  const [localBbox, setLocalBbox] = useState(null)
  const localBboxRef = useRef(null) // Mirror of localBbox for closure-safe access

  // Refs for drag state (no re-renders during drag, and avoids closure issues)
  const isDraggingRef = useRef(false)
  const isResizingRef = useRef(null) // null or handle name
  const dragStartRef = useRef(null) // { x, y } normalized
  const initialBboxRef = useRef(null)
  const rafRef = useRef(null)
  const imageBoundsRef = useRef(null) // Store bounds in ref to avoid closure issues

  // Helper function to get current image bounds
  const getCurrentBounds = useCallback(() => {
    if (imageRef?.current && containerRef?.current) {
      return getImageBounds(imageRef.current, containerRef.current)
    }
    return null
  }, [imageRef, containerRef])

  // Update bounds ref on mount, resize, and image load
  useEffect(() => {
    const updateBounds = () => {
      imageBoundsRef.current = getCurrentBounds()
    }

    updateBounds()
    window.addEventListener('resize', updateBounds)

    // Also update when image loads
    const img = imageRef?.current
    if (img) {
      img.addEventListener('load', updateBounds)
      // If image is already loaded, update bounds
      if (img.complete && img.naturalWidth > 0) {
        updateBounds()
      }
    }

    return () => {
      window.removeEventListener('resize', updateBounds)
      if (img) {
        img.removeEventListener('load', updateBounds)
      }
    }
  }, [imageRef, containerRef, getCurrentBounds])

  // Cleanup function for removing event listeners
  const cleanupDrag = useCallback(() => {
    isDraggingRef.current = false
    isResizingRef.current = null
    dragStartRef.current = null
    initialBboxRef.current = null
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  // Handle mouse move during drag - uses refs to avoid closure issues
  const handleMouseMove = useCallback((e) => {
    if (!isDraggingRef.current && !isResizingRef.current) return

    const bounds = imageBoundsRef.current
    if (!bounds || !dragStartRef.current || !initialBboxRef.current) return

    // Use RAF for performance
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      const current = screenToNormalized(e.clientX, e.clientY, bounds)
      if (!current) {
        rafRef.current = null
        return
      }

      const deltaX = current.x - dragStartRef.current.x
      const deltaY = current.y - dragStartRef.current.y
      const initial = initialBboxRef.current

      let newBbox

      if (isDraggingRef.current) {
        // Move entire bbox
        newBbox = moveBbox(initial, deltaX, deltaY)
      } else if (isResizingRef.current) {
        // Resize from handle
        newBbox = resizeBboxFromHandle(initial, isResizingRef.current, deltaX, deltaY)
      }

      if (newBbox) {
        const clamped = clampBbox(newBbox, MIN_BBOX_SIZE)
        localBboxRef.current = clamped
        setLocalBbox(clamped)
      }

      rafRef.current = null
    })
  }, [])

  // Handle mouse up - commit changes
  const handleMouseUp = useCallback(() => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    // Commit changes if bbox moved - use ref to get current value
    const currentLocalBbox = localBboxRef.current
    if (currentLocalBbox && onUpdate && initialBboxRef.current) {
      const initial = initialBboxRef.current
      const hasChanged =
        Math.abs(currentLocalBbox.bboxX - initial.bboxX) > 0.001 ||
        Math.abs(currentLocalBbox.bboxY - initial.bboxY) > 0.001 ||
        Math.abs(currentLocalBbox.bboxWidth - initial.bboxWidth) > 0.001 ||
        Math.abs(currentLocalBbox.bboxHeight - initial.bboxHeight) > 0.001

      if (hasChanged) {
        onUpdate(currentLocalBbox)
      }
    }

    cleanupDrag()
    localBboxRef.current = null
    setLocalBbox(null)
  }, [onUpdate, cleanupDrag, handleMouseMove])

  // Handle keyboard events for nudge and escape
  useEffect(() => {
    if (!isSelected) return

    const handleKeyDown = (e) => {
      // Escape to cancel drag
      if (e.key === 'Escape') {
        if (isDraggingRef.current || isResizingRef.current) {
          // Cancel drag and restore initial bbox
          document.removeEventListener('mousemove', handleMouseMove)
          document.removeEventListener('mouseup', handleMouseUp)
          cleanupDrag()
          localBboxRef.current = null
          setLocalBbox(null)
        }
        return
      }

      // Arrow keys to nudge
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        const bounds = imageBoundsRef.current || getCurrentBounds()
        if (!bounds || !onUpdate) return

        let deltaX = 0
        let deltaY = 0

        switch (e.key) {
          case 'ArrowUp':
            deltaY = -pixelToNormalizedDelta(NUDGE_PIXELS, bounds, 'y')
            break
          case 'ArrowDown':
            deltaY = pixelToNormalizedDelta(NUDGE_PIXELS, bounds, 'y')
            break
          case 'ArrowLeft':
            deltaX = -pixelToNormalizedDelta(NUDGE_PIXELS, bounds, 'x')
            break
          case 'ArrowRight':
            deltaX = pixelToNormalizedDelta(NUDGE_PIXELS, bounds, 'x')
            break
        }

        const newBbox = moveBbox(bbox, deltaX, deltaY)
        const clamped = clampBbox(newBbox, MIN_BBOX_SIZE)
        onUpdate(clamped)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSelected, bbox, onUpdate, getCurrentBounds, handleMouseMove, handleMouseUp, cleanupDrag])

  const handleMouseDown = useCallback(
    (e, handle = null) => {
      e.stopPropagation()

      // If not selected, just select it
      if (!isSelected) {
        onSelect()
        return
      }

      e.preventDefault()

      // Calculate bounds and store in ref
      const bounds = getCurrentBounds()
      if (!bounds) return

      imageBoundsRef.current = bounds

      const normalized = screenToNormalized(e.clientX, e.clientY, bounds)
      if (!normalized) return

      dragStartRef.current = normalized
      initialBboxRef.current = { ...bbox }

      if (handle) {
        isResizingRef.current = handle
      } else {
        isDraggingRef.current = true
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [isSelected, bbox, onSelect, getCurrentBounds, handleMouseMove, handleMouseUp]
  )

  // Determine which bbox to render (local during drag, actual otherwise)
  const displayBbox = localBbox || bbox
  const { bboxX, bboxY, bboxWidth, bboxHeight } = displayBbox

  // Convert to percentage strings for SVG
  const x = `${bboxX * 100}%`
  const y = `${bboxY * 100}%`
  const width = `${bboxWidth * 100}%`
  const height = `${bboxHeight * 100}%`

  const selectedColor = '#22c55e'
  const strokeColor = isSelected ? selectedColor : color
  const strokeWidth = isSelected ? 4 : 3

  // Handle definitions with normalized positions
  const handles = [
    // Corners
    { name: 'nw', normX: bboxX, normY: bboxY, size: CORNER_HANDLE_SIZE },
    { name: 'ne', normX: bboxX + bboxWidth, normY: bboxY, size: CORNER_HANDLE_SIZE },
    { name: 'sw', normX: bboxX, normY: bboxY + bboxHeight, size: CORNER_HANDLE_SIZE },
    { name: 'se', normX: bboxX + bboxWidth, normY: bboxY + bboxHeight, size: CORNER_HANDLE_SIZE },
    // Edges
    { name: 'n', normX: bboxX + bboxWidth / 2, normY: bboxY, size: EDGE_HANDLE_SIZE },
    { name: 's', normX: bboxX + bboxWidth / 2, normY: bboxY + bboxHeight, size: EDGE_HANDLE_SIZE },
    { name: 'w', normX: bboxX, normY: bboxY + bboxHeight / 2, size: EDGE_HANDLE_SIZE },
    { name: 'e', normX: bboxX + bboxWidth, normY: bboxY + bboxHeight / 2, size: EDGE_HANDLE_SIZE }
  ]

  return (
    <g>
      {/* Main bbox rectangle - clickable for selection and move */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        fill={isSelected ? 'rgba(34, 197, 94, 0.1)' : 'transparent'}
        style={{
          pointerEvents: 'all',
          cursor: isSelected ? 'move' : 'pointer'
        }}
        onMouseDown={(e) => handleMouseDown(e)}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Resize handles - only show when selected */}
      {isSelected &&
        handles.map((handle) => (
          <rect
            key={handle.name}
            x={`${handle.normX * 100}%`}
            y={`${handle.normY * 100}%`}
            width={handle.size}
            height={handle.size}
            fill={selectedColor}
            stroke="white"
            strokeWidth={1}
            style={{
              cursor: getCursorForHandle(handle.name),
              pointerEvents: 'all'
            }}
            transform={`translate(-${handle.size / 2}, -${handle.size / 2})`}
            onMouseDown={(e) => handleMouseDown(e, handle.name)}
            onClick={(e) => e.stopPropagation()}
          />
        ))}
    </g>
  )
}
