/**
 * Classifies a media's observations into one of four modes.
 *
 * - 'empty'        — no observations
 * - 'bbox'         — 1+ bbox observations, 0 whole-image
 * - 'whole-image'  — exactly 1 whole-image observation, 0 bbox
 * - 'mixed'        — both kinds present (data inconsistency from imports)
 *
 * An observation is "bbox" if any of bboxX/bboxY/bboxWidth/bboxHeight is
 * non-null; otherwise it is "whole-image".
 */
export function getMediaMode(observations) {
  if (!observations || observations.length === 0) return 'empty'

  let hasBbox = false
  let hasWhole = false

  for (const obs of observations) {
    const isBbox =
      obs.bboxX != null || obs.bboxY != null || obs.bboxWidth != null || obs.bboxHeight != null
    if (isBbox) hasBbox = true
    else hasWhole = true
  }

  if (hasBbox && hasWhole) return 'mixed'
  if (hasBbox) return 'bbox'
  return 'whole-image'
}
