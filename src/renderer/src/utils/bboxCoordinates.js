/**
 * Coordinate transformation utilities for bounding box editing.
 * Handles object-contain image scaling and letterboxing.
 */

/**
 * Calculate the actual rendered image bounds within a container using object-contain.
 * When an image uses object-contain, it may have letterboxing (black bars) on
 * top/bottom or left/right. This function calculates the actual image position.
 *
 * @param {HTMLImageElement} imgElement - The image element
 * @param {HTMLElement} containerElement - The container element
 * @returns {Object|null} - { offsetX, offsetY, renderedWidth, renderedHeight, containerRect } or null if invalid
 */
export function getImageBounds(imgElement, containerElement) {
  if (!imgElement || !containerElement) return null

  const containerRect = containerElement.getBoundingClientRect()
  const imgNaturalWidth = imgElement.naturalWidth
  const imgNaturalHeight = imgElement.naturalHeight

  if (!imgNaturalWidth || !imgNaturalHeight) return null

  const containerAspect = containerRect.width / containerRect.height
  const imageAspect = imgNaturalWidth / imgNaturalHeight

  let renderedWidth, renderedHeight, offsetX, offsetY

  if (imageAspect > containerAspect) {
    // Image is wider than container - letterbox on top/bottom
    renderedWidth = containerRect.width
    renderedHeight = containerRect.width / imageAspect
    offsetX = 0
    offsetY = (containerRect.height - renderedHeight) / 2
  } else {
    // Image is taller than container - letterbox on left/right
    renderedHeight = containerRect.height
    renderedWidth = containerRect.height * imageAspect
    offsetX = (containerRect.width - renderedWidth) / 2
    offsetY = 0
  }

  return { offsetX, offsetY, renderedWidth, renderedHeight, containerRect }
}

/**
 * Convert screen coordinates (clientX/clientY) to normalized (0-1) coordinates
 * relative to the actual image bounds.
 *
 * @param {number} clientX - Mouse clientX
 * @param {number} clientY - Mouse clientY
 * @param {Object} imageBounds - Result from getImageBounds()
 * @returns {Object|null} - { x, y } in normalized 0-1 coordinates, or null if invalid
 */
export function screenToNormalized(clientX, clientY, imageBounds) {
  if (!imageBounds) return null

  const { offsetX, offsetY, renderedWidth, renderedHeight, containerRect } = imageBounds

  const relativeX = clientX - containerRect.left - offsetX
  const relativeY = clientY - containerRect.top - offsetY

  return {
    x: relativeX / renderedWidth,
    y: relativeY / renderedHeight
  }
}

/**
 * Convert normalized (0-1) coordinates to screen pixels.
 *
 * @param {number} normX - Normalized x coordinate (0-1)
 * @param {number} normY - Normalized y coordinate (0-1)
 * @param {Object} imageBounds - Result from getImageBounds()
 * @returns {Object|null} - { x, y } in screen pixels, or null if invalid
 */
export function normalizedToScreen(normX, normY, imageBounds) {
  if (!imageBounds) return null

  const { offsetX, offsetY, renderedWidth, renderedHeight, containerRect } = imageBounds

  return {
    x: containerRect.left + offsetX + normX * renderedWidth,
    y: containerRect.top + offsetY + normY * renderedHeight
  }
}

/**
 * Clamp bbox to stay within image bounds (0-1) and meet minimum size requirements.
 *
 * @param {Object} bbox - { bboxX, bboxY, bboxWidth, bboxHeight }
 * @param {number} minSize - Minimum size as fraction of image (default 0.05 = 5%)
 * @returns {Object} - Clamped { bboxX, bboxY, bboxWidth, bboxHeight }
 */
export function clampBbox(bbox, minSize = 0.05) {
  let { bboxX, bboxY, bboxWidth, bboxHeight } = bbox

  // Ensure minimum size
  bboxWidth = Math.max(bboxWidth, minSize)
  bboxHeight = Math.max(bboxHeight, minSize)

  // Clamp to image bounds (0-1)
  bboxX = Math.max(0, Math.min(bboxX, 1 - bboxWidth))
  bboxY = Math.max(0, Math.min(bboxY, 1 - bboxHeight))

  // Ensure width and height don't exceed bounds
  bboxWidth = Math.min(bboxWidth, 1 - bboxX)
  bboxHeight = Math.min(bboxHeight, 1 - bboxY)

  return { bboxX, bboxY, bboxWidth, bboxHeight }
}

/**
 * Determine which resize handle (corner or edge) is under the cursor.
 *
 * @param {number} normalizedX - Cursor x in normalized coordinates
 * @param {number} normalizedY - Cursor y in normalized coordinates
 * @param {Object} bbox - { bboxX, bboxY, bboxWidth, bboxHeight }
 * @param {number} handleSize - Handle hit area size in normalized coordinates (default 0.02)
 * @returns {string|null} - 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | null
 */
export function getHandleAtPoint(normalizedX, normalizedY, bbox, handleSize = 0.02) {
  const { bboxX, bboxY, bboxWidth, bboxHeight } = bbox

  // Define handle positions
  const handles = {
    // Corners
    nw: { x: bboxX, y: bboxY },
    ne: { x: bboxX + bboxWidth, y: bboxY },
    sw: { x: bboxX, y: bboxY + bboxHeight },
    se: { x: bboxX + bboxWidth, y: bboxY + bboxHeight },
    // Edge midpoints
    n: { x: bboxX + bboxWidth / 2, y: bboxY },
    s: { x: bboxX + bboxWidth / 2, y: bboxY + bboxHeight },
    w: { x: bboxX, y: bboxY + bboxHeight / 2 },
    e: { x: bboxX + bboxWidth, y: bboxY + bboxHeight / 2 }
  }

  // Check corners first (higher priority)
  for (const name of ['nw', 'ne', 'sw', 'se']) {
    const handle = handles[name]
    if (
      Math.abs(normalizedX - handle.x) < handleSize &&
      Math.abs(normalizedY - handle.y) < handleSize
    ) {
      return name
    }
  }

  // Then check edge midpoints
  for (const name of ['n', 's', 'w', 'e']) {
    const handle = handles[name]
    if (
      Math.abs(normalizedX - handle.x) < handleSize &&
      Math.abs(normalizedY - handle.y) < handleSize
    ) {
      return name
    }
  }

  return null
}

/**
 * Check if a point is inside the bbox (for move operation).
 *
 * @param {number} normalizedX - Point x in normalized coordinates
 * @param {number} normalizedY - Point y in normalized coordinates
 * @param {Object} bbox - { bboxX, bboxY, bboxWidth, bboxHeight }
 * @returns {boolean} - True if point is inside bbox
 */
export function isInsideBbox(normalizedX, normalizedY, bbox) {
  const { bboxX, bboxY, bboxWidth, bboxHeight } = bbox
  return (
    normalizedX >= bboxX &&
    normalizedX <= bboxX + bboxWidth &&
    normalizedY >= bboxY &&
    normalizedY <= bboxY + bboxHeight
  )
}

/**
 * Get the appropriate cursor for a handle or move operation.
 *
 * @param {string|null} handle - Handle name or null for move
 * @returns {string} - CSS cursor value
 */
export function getCursorForHandle(handle) {
  const cursorMap = {
    nw: 'nwse-resize',
    se: 'nwse-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize'
  }
  return cursorMap[handle] || 'move'
}

/**
 * Calculate new bbox dimensions based on handle being dragged and delta movement.
 *
 * @param {Object} initialBbox - Original bbox before drag started
 * @param {string} handle - Which handle is being dragged
 * @param {number} deltaX - Change in x (normalized coordinates)
 * @param {number} deltaY - Change in y (normalized coordinates)
 * @returns {Object} - New { bboxX, bboxY, bboxWidth, bboxHeight }
 */
export function resizeBboxFromHandle(initialBbox, handle, deltaX, deltaY) {
  const { bboxX, bboxY, bboxWidth, bboxHeight } = initialBbox
  let newBbox = { bboxX, bboxY, bboxWidth, bboxHeight }

  switch (handle) {
    case 'nw':
      newBbox.bboxX = bboxX + deltaX
      newBbox.bboxY = bboxY + deltaY
      newBbox.bboxWidth = bboxWidth - deltaX
      newBbox.bboxHeight = bboxHeight - deltaY
      break
    case 'ne':
      newBbox.bboxY = bboxY + deltaY
      newBbox.bboxWidth = bboxWidth + deltaX
      newBbox.bboxHeight = bboxHeight - deltaY
      break
    case 'sw':
      newBbox.bboxX = bboxX + deltaX
      newBbox.bboxWidth = bboxWidth - deltaX
      newBbox.bboxHeight = bboxHeight + deltaY
      break
    case 'se':
      newBbox.bboxWidth = bboxWidth + deltaX
      newBbox.bboxHeight = bboxHeight + deltaY
      break
    case 'n':
      newBbox.bboxY = bboxY + deltaY
      newBbox.bboxHeight = bboxHeight - deltaY
      break
    case 's':
      newBbox.bboxHeight = bboxHeight + deltaY
      break
    case 'w':
      newBbox.bboxX = bboxX + deltaX
      newBbox.bboxWidth = bboxWidth - deltaX
      break
    case 'e':
      newBbox.bboxWidth = bboxWidth + deltaX
      break
  }

  return newBbox
}

/**
 * Move bbox by delta, keeping size constant.
 *
 * @param {Object} initialBbox - Original bbox before drag started
 * @param {number} deltaX - Change in x (normalized coordinates)
 * @param {number} deltaY - Change in y (normalized coordinates)
 * @returns {Object} - New { bboxX, bboxY, bboxWidth, bboxHeight }
 */
export function moveBbox(initialBbox, deltaX, deltaY) {
  return {
    bboxX: initialBbox.bboxX + deltaX,
    bboxY: initialBbox.bboxY + deltaY,
    bboxWidth: initialBbox.bboxWidth,
    bboxHeight: initialBbox.bboxHeight
  }
}

/**
 * Convert a pixel nudge to normalized coordinates.
 *
 * @param {number} pixelDelta - Pixels to nudge
 * @param {Object} imageBounds - Result from getImageBounds()
 * @param {string} direction - 'x' or 'y'
 * @returns {number} - Normalized delta
 */
export function pixelToNormalizedDelta(pixelDelta, imageBounds, direction) {
  if (!imageBounds) return 0

  if (direction === 'x') {
    return pixelDelta / imageBounds.renderedWidth
  } else {
    return pixelDelta / imageBounds.renderedHeight
  }
}
