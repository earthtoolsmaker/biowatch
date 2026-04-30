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
