import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Custom hook for managing zoom and pan state for an image container.
 * Handles mouse wheel zoom (centered on cursor), drag to pan, and keyboard shortcuts.
 *
 * @param {Object} options - Configuration options
 * @param {number} options.minScale - Minimum zoom level (default: 1)
 * @param {number} options.maxScale - Maximum zoom level (default: 5)
 * @param {number} options.zoomStep - Zoom increment per wheel tick (default: 0.25)
 * @returns {Object} Zoom/pan state and handlers
 */
export function useZoomPan({ minScale = 1, maxScale = 5, zoomStep = 0.25 } = {}) {
  // Transform state: scale and translate
  const [transform, setTransform] = useState({
    scale: 1,
    translateX: 0,
    translateY: 0
  })

  // Refs for panning
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0 })
  const initialTranslateRef = useRef({ x: 0, y: 0 })

  // Container ref for bounds calculation
  const containerRef = useRef(null)

  // Check if zoomed (scale > 1)
  const isZoomed = transform.scale > 1

  /**
   * Calculate pan bounds to prevent image from leaving viewport
   */
  const calculatePanBounds = useCallback(
    (scale) => {
      if (!containerRef.current || scale <= 1) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
      }

      const container = containerRef.current
      const rect = container.getBoundingClientRect()

      // When zoomed, the image can move by (scale-1) * dimension / 2 in either direction
      // This keeps the image edges within the container
      const maxOffsetX = ((scale - 1) * rect.width) / 2 / scale
      const maxOffsetY = ((scale - 1) * rect.height) / 2 / scale

      return {
        minX: -maxOffsetX,
        maxX: maxOffsetX,
        minY: -maxOffsetY,
        maxY: maxOffsetY
      }
    },
    [containerRef]
  )

  /**
   * Clamp translation to stay within bounds
   */
  const clampTranslation = useCallback(
    (tx, ty, scale) => {
      const bounds = calculatePanBounds(scale)
      return {
        x: Math.max(bounds.minX, Math.min(bounds.maxX, tx)),
        y: Math.max(bounds.minY, Math.min(bounds.maxY, ty))
      }
    },
    [calculatePanBounds]
  )

  /**
   * Handle mouse wheel zoom - zoom centered on cursor position
   */
  const handleWheel = useCallback(
    (e) => {
      e.preventDefault()

      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()

      // Mouse position relative to container center (in container coordinates)
      const mouseX = e.clientX - rect.left - rect.width / 2
      const mouseY = e.clientY - rect.top - rect.height / 2

      setTransform((prev) => {
        // Determine zoom direction
        const direction = e.deltaY < 0 ? 1 : -1
        const newScale = Math.max(minScale, Math.min(maxScale, prev.scale + direction * zoomStep))

        // If no change in scale, return previous state
        if (newScale === prev.scale) return prev

        // Calculate new translation to zoom toward cursor
        const scaleFactor = newScale / prev.scale

        // Adjust translation to keep the point under cursor stationary
        let newTranslateX = mouseX - scaleFactor * (mouseX - prev.translateX * prev.scale)
        let newTranslateY = mouseY - scaleFactor * (mouseY - prev.translateY * prev.scale)

        // Convert back to pre-scaled coordinates
        newTranslateX /= newScale
        newTranslateY /= newScale

        // If zooming out to 1x, reset translation
        if (newScale <= 1) {
          return { scale: 1, translateX: 0, translateY: 0 }
        }

        // Clamp translation
        const clamped = clampTranslation(newTranslateX, newTranslateY, newScale)

        return {
          scale: newScale,
          translateX: clamped.x,
          translateY: clamped.y
        }
      })
    },
    [minScale, maxScale, zoomStep, clampTranslation]
  )

  /**
   * Start panning on mouse down (only when zoomed)
   */
  const handlePanStart = useCallback(
    (e) => {
      if (!isZoomed) return

      isPanningRef.current = true
      panStartRef.current = { x: e.clientX, y: e.clientY }
      initialTranslateRef.current = { x: transform.translateX, y: transform.translateY }

      // Prevent text selection while panning
      e.preventDefault()
    },
    [isZoomed, transform.translateX, transform.translateY]
  )

  /**
   * Handle mouse move during pan
   */
  const handlePanMove = useCallback(
    (e) => {
      if (!isPanningRef.current) return

      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y

      // Convert pixel delta to translation delta (accounting for scale)
      const newTranslateX = initialTranslateRef.current.x + dx / transform.scale
      const newTranslateY = initialTranslateRef.current.y + dy / transform.scale

      const clamped = clampTranslation(newTranslateX, newTranslateY, transform.scale)

      setTransform((prev) => ({
        ...prev,
        translateX: clamped.x,
        translateY: clamped.y
      }))
    },
    [transform.scale, clampTranslation]
  )

  /**
   * End panning on mouse up
   */
  const handlePanEnd = useCallback(() => {
    isPanningRef.current = false
  }, [])

  /**
   * Zoom in by one step
   */
  const zoomIn = useCallback(() => {
    setTransform((prev) => {
      const newScale = Math.min(maxScale, prev.scale + zoomStep)
      if (newScale === prev.scale) return prev

      // Clamp existing translation for new scale
      const clamped = clampTranslation(prev.translateX, prev.translateY, newScale)

      return {
        scale: newScale,
        translateX: clamped.x,
        translateY: clamped.y
      }
    })
  }, [maxScale, zoomStep, clampTranslation])

  /**
   * Zoom out by one step
   */
  const zoomOut = useCallback(() => {
    setTransform((prev) => {
      const newScale = Math.max(minScale, prev.scale - zoomStep)

      if (newScale <= 1) {
        return { scale: 1, translateX: 0, translateY: 0 }
      }

      const clamped = clampTranslation(prev.translateX, prev.translateY, newScale)

      return {
        scale: newScale,
        translateX: clamped.x,
        translateY: clamped.y
      }
    })
  }, [minScale, zoomStep, clampTranslation])

  /**
   * Reset zoom to 1x
   */
  const resetZoom = useCallback(() => {
    setTransform({ scale: 1, translateX: 0, translateY: 0 })
  }, [])

  /**
   * Get CSS transform string
   */
  const getTransformStyle = useCallback(() => {
    const { scale, translateX, translateY } = transform
    if (scale === 1 && translateX === 0 && translateY === 0) {
      return undefined
    }
    return `scale(${scale}) translate(${translateX}px, ${translateY}px)`
  }, [transform])

  // Set up global mouse move/up listeners for panning
  useEffect(() => {
    const handleGlobalMouseMove = (e) => {
      if (isPanningRef.current) {
        handlePanMove(e)
      }
    }

    const handleGlobalMouseUp = () => {
      handlePanEnd()
    }

    document.addEventListener('mousemove', handleGlobalMouseMove)
    document.addEventListener('mouseup', handleGlobalMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove)
      document.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [handlePanMove, handlePanEnd])

  return {
    // State
    transform,
    isZoomed,

    // Refs (for direct access when needed)
    containerRef,

    // Event handlers
    handleWheel,
    handlePanStart,
    handlePanMove,
    handlePanEnd,

    // Controls
    zoomIn,
    zoomOut,
    resetZoom,

    // Utilities
    getTransformStyle,
    setTransform
  }
}
