/**
 * Pure positioning utility functions for the media annotation UI.
 * Extracted for testability and reusability.
 */

/**
 * Compute label position for a bounding box.
 * The label is positioned to avoid overflowing outside the image viewport.
 *
 * @param {Object} bbox - Bounding box with normalized coordinates (0-1)
 * @param {number} bbox.bboxX - Left edge as fraction of image width
 * @param {number} bbox.bboxY - Top edge as fraction of image height
 * @param {number} bbox.bboxWidth - Width as fraction of image width
 * @param {number} bbox.bboxHeight - Height as fraction of image height
 * @returns {Object} CSS position values { left, top, transform }
 */
export function computeBboxLabelPosition(bbox) {
  // Label-size-aware thresholds (as fraction of image dimensions)
  const LABEL_WIDTH_ESTIMATE = 0.15 // ~150px max-width as % of typical image
  const LABEL_HEIGHT_ESTIMATE = 0.03 // ~24px label height as %

  const isNearTop = bbox.bboxY < LABEL_HEIGHT_ESTIMATE
  const isNearRight = bbox.bboxX + bbox.bboxWidth > 1 - LABEL_WIDTH_ESTIMATE

  // VERTICAL: prefer above bbox, fallback to below when near top
  let top, verticalTransform
  if (isNearTop) {
    // Place below bbox with gap
    top = `${(bbox.bboxY + bbox.bboxHeight) * 100}%`
    verticalTransform = 'translateY(4px)'
  } else {
    // Place above bbox with gap (default)
    top = `${bbox.bboxY * 100}%`
    verticalTransform = 'translateY(calc(-100% - 2px))'
  }

  // HORIZONTAL: prefer left-aligned, fallback to right-aligned when near right edge
  let left, horizontalTransform
  if (isNearRight) {
    // Right-align: anchor at bbox right edge, shift left by label width
    left = `${(bbox.bboxX + bbox.bboxWidth) * 100}%`
    horizontalTransform = 'translateX(-100%)'
  } else {
    // Left-align (default)
    left = `${bbox.bboxX * 100}%`
    horizontalTransform = ''
  }

  // Combine transforms (both horizontal and vertical are independent)
  const transform = [horizontalTransform, verticalTransform].filter(Boolean).join(' ')

  return { left, top, transform }
}

/**
 * Compute optimal position for the species selector relative to a label element.
 * Tries to position below the label first, then above if no room.
 * Always constrained to stay within the container bounds.
 *
 * @param {Object} labelRect - Label element's bounding rectangle (from getBoundingClientRect)
 * @param {number} labelRect.top - Top edge in viewport pixels
 * @param {number} labelRect.bottom - Bottom edge in viewport pixels
 * @param {number} labelRect.left - Left edge in viewport pixels
 * @param {Object} containerRect - Container element's bounding rectangle
 * @param {number} containerRect.top - Top edge in viewport pixels
 * @param {number} containerRect.bottom - Bottom edge in viewport pixels
 * @param {number} containerRect.left - Left edge in viewport pixels
 * @param {number} containerRect.right - Right edge in viewport pixels
 * @param {number} containerRect.height - Container height in pixels
 * @param {Object} [selectorSize] - Size of the selector dropdown
 * @param {number} [selectorSize.width=288] - Width in pixels
 * @param {number} [selectorSize.height=320] - Height in pixels
 * @returns {Object} Position values { x, y, transform }
 */
export function computeSelectorPosition(
  labelRect,
  containerRect,
  selectorSize = { width: 288, height: 320 }
) {
  const MARGIN = 8
  const PADDING = 16

  // Try position below the label first (preferred)
  let x = labelRect.left
  let y = labelRect.bottom + MARGIN
  let transform = 'none'

  // Check if fits below within container
  if (y + selectorSize.height > containerRect.bottom - PADDING) {
    // Try above the label
    y = labelRect.top - MARGIN
    transform = 'translateY(-100%)'

    // Check if fits above within container
    if (y - selectorSize.height < containerRect.top + PADDING) {
      // Fallback: position at container center vertically
      y = containerRect.top + (containerRect.height - selectorSize.height) / 2
      transform = 'none'
    }
  }

  // Clamp horizontal to container bounds
  if (x + selectorSize.width > containerRect.right - PADDING) {
    x = containerRect.right - PADDING - selectorSize.width
  }
  if (x < containerRect.left + PADDING) {
    x = containerRect.left + PADDING
  }

  return { x, y, transform }
}

/**
 * Compute dropdown position for a footer-triggered species selector.
 *
 * The dropdown's bottom edge is pinned just above the footer (at the media
 * area's bottom edge) and it grows upward. The caller applies the returned
 * `maxHeight` to the dropdown so it never extends past the top of the
 * viewport; content inside the dropdown scrolls when it exceeds that height.
 *
 * @param {Object} mediaAreaRect - Rect of the media-only container (excludes the footer)
 * @param {number} mediaAreaRect.top
 * @param {number} mediaAreaRect.bottom
 * @param {number} mediaAreaRect.left
 * @param {number} mediaAreaRect.right
 * @param {number} mediaAreaRect.height
 * @param {number} mediaAreaRect.width
 * @param {Object} [selectorSize]
 * @param {number} [selectorSize.width=288]
 * @param {Object} [viewport] - Viewport size (defaults to window)
 * @param {number} [viewport.width]
 * @param {number} [viewport.height]
 * @returns {Object} Position values { x, y, transform, maxHeight }
 */
export function computeFooterTriggeredSelectorPosition(
  mediaAreaRect,
  selectorSize = { width: 288 },
  viewport = {
    width: typeof window !== 'undefined' ? window.innerWidth : 1920,
    height: typeof window !== 'undefined' ? window.innerHeight : 1080
  }
) {
  const PADDING = 16
  const MARGIN = 8

  // Bottom edge: pinned just above the footer. Also keep it inside the viewport
  // bottom so a partially-off-screen media area can't push the anchor offscreen.
  const bottomY = Math.min(mediaAreaRect.bottom - MARGIN, viewport.height - PADDING)

  // Available height: from the bottom anchor upward to the viewport top
  // (minus padding). Kept non-negative to stay safe for style consumers.
  const maxHeight = Math.max(0, bottomY - PADDING)

  // Horizontal: left-align inside the media area, clamped to viewport.
  let x = mediaAreaRect.left + PADDING
  if (x + selectorSize.width > mediaAreaRect.right - PADDING) {
    x = mediaAreaRect.right - PADDING - selectorSize.width
  }
  if (x < mediaAreaRect.left + PADDING) {
    x = mediaAreaRect.left + PADDING
  }
  if (x + selectorSize.width > viewport.width - PADDING) {
    x = viewport.width - PADDING - selectorSize.width
  }
  if (x < PADDING) {
    x = PADDING
  }

  return {
    x,
    y: bottomY,
    transform: 'translateY(-100%)',
    maxHeight
  }
}
