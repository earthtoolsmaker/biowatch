/**
 * Video classification utilities for aggregating frame-by-frame predictions
 * into a single observation per video using majority voting.
 */

/**
 * Select winner species from aggregated frame data.
 *
 * Two modes, controlled by the `weightedVote` option:
 *
 *   Default (frame-count primary) — for true classifiers (SpeciesNet,
 *   DeepFaune, Manas) where every frame is an independent classification of
 *   the same scene. The species detected in the most frames wins; ties are
 *   broken by average confidence.
 *
 *   `weightedVote: true` (mean-confidence primary) — for detection-only
 *   models (MegaDetector). MD's labels are coarse (animal/person/vehicle)
 *   and a video can legitimately contain multiple labels in different
 *   frames, so a noisy stream of low-confidence "animal" detections must
 *   not drown out a few high-confidence "person" detections. The label
 *   with the highest *mean* confidence wins; frame count is the tiebreaker.
 *
 * @param {Map<string, {frames: number[], scores: number[], firstFrame: number, lastFrame: number}>} speciesMap
 *   Map of species names to their frame data:
 *   - frames: Array of frame numbers where the species was detected
 *   - scores: Array of confidence scores for each detection
 *   - firstFrame: First frame number where species appeared
 *   - lastFrame: Last frame number where species appeared
 *
 * @param {Object} [options]
 * @param {boolean} [options.weightedVote=false] Use mean-confidence as the
 *   primary criterion (with frame count as tiebreaker) instead of the default
 *   frame-count-primary logic.
 *
 * @returns {{ winner: string|null, winnerData: object|null }}
 *   - winner: The winning species name, or null if no species detected
 *   - winnerData: The winning species data with avgConfidence added, or null
 */
export function selectVideoClassificationWinner(speciesMap, options = {}) {
  if (!speciesMap || speciesMap.size === 0) {
    return { winner: null, winnerData: null }
  }

  const { weightedVote = false } = options

  let winner = null
  let winnerData = null
  let bestPrimary = -Infinity
  let bestSecondary = -Infinity

  for (const [species, data] of speciesMap) {
    const frameCount = data.frames.length
    const avgConfidence = data.scores.reduce((sum, s) => sum + s, 0) / data.scores.length

    const primary = weightedVote ? avgConfidence : frameCount
    const secondary = weightedVote ? frameCount : avgConfidence

    if (primary > bestPrimary || (primary === bestPrimary && secondary > bestSecondary)) {
      bestPrimary = primary
      bestSecondary = secondary
      winner = species
      winnerData = { ...data, avgConfidence }
    }
  }

  return { winner, winnerData }
}
