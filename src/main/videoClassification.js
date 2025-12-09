/**
 * Video classification utilities for aggregating frame-by-frame predictions
 * into a single observation per video using majority voting.
 */

/**
 * Select winner species from aggregated frame data using majority voting.
 *
 * Algorithm:
 * 1. Primary criteria: Species with the highest frame count wins
 * 2. Tiebreaker: If multiple species have the same frame count, the one with
 *    the highest average confidence wins
 *
 * @param {Map<string, {frames: number[], scores: number[], firstFrame: number, lastFrame: number}>} speciesMap
 *   Map of species names to their frame data:
 *   - frames: Array of frame numbers where the species was detected
 *   - scores: Array of confidence scores for each detection
 *   - firstFrame: First frame number where species appeared
 *   - lastFrame: Last frame number where species appeared
 *
 * @returns {{ winner: string|null, winnerData: object|null }}
 *   - winner: The winning species name, or null if no species detected
 *   - winnerData: The winning species data with avgConfidence added, or null
 */
export function selectVideoClassificationWinner(speciesMap) {
  if (!speciesMap || speciesMap.size === 0) {
    return { winner: null, winnerData: null }
  }

  let winner = null
  let winnerData = null
  let maxFrameCount = 0
  let maxAvgConfidence = 0

  for (const [species, data] of speciesMap) {
    const frameCount = data.frames.length
    const avgConfidence = data.scores.reduce((sum, s) => sum + s, 0) / data.scores.length

    // Primary: highest frame count; Tiebreaker: highest average confidence
    if (
      frameCount > maxFrameCount ||
      (frameCount === maxFrameCount && avgConfidence > maxAvgConfidence)
    ) {
      maxFrameCount = frameCount
      maxAvgConfidence = avgConfidence
      winner = species
      winnerData = { ...data, avgConfidence }
    }
  }

  return { winner, winnerData }
}
