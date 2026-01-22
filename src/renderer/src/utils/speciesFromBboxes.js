/**
 * Extract unique species names from bounding boxes.
 * Pure functions for aggregating species from detection bboxes.
 */

/**
 * Get unique species names from a single media's bboxes.
 * @param {Array<{scientificName?: string}>} bboxes - Array of bounding box objects
 * @param {string|null} fallbackScientificName - Fallback species name from media object
 * @returns {string} Comma-separated species names or 'No species'
 */
export function getSpeciesFromBboxes(bboxes, fallbackScientificName = null) {
  const speciesFromBboxes = [...new Set(bboxes.map((b) => b.scientificName).filter(Boolean))]

  if (speciesFromBboxes.length > 0) {
    return speciesFromBboxes.join(', ')
  }

  return fallbackScientificName || 'No species'
}

/**
 * Get unique species names from all items in a sequence.
 * Aggregates species from all bboxes across all sequence items.
 * @param {Array<{mediaID: string, scientificName?: string}>} items - Array of media items in the sequence
 * @param {Object<string, Array<{scientificName?: string}>>} bboxesByMedia - Map of mediaID to bboxes array
 * @returns {string} Comma-separated species names or 'No species'
 */
export function getSpeciesFromSequence(items, bboxesByMedia) {
  // Collect species from all bboxes across all sequence items
  const allSpecies = items.flatMap((item) => {
    const itemBboxes = bboxesByMedia[item.mediaID] || []
    return itemBboxes.map((b) => b.scientificName).filter(Boolean)
  })

  const uniqueSpecies = [...new Set(allSpecies)]
  if (uniqueSpecies.length > 0) {
    return uniqueSpecies.join(', ')
  }

  // Fallback to collecting scientificName from all items
  const itemSpecies = [...new Set(items.map((i) => i.scientificName).filter(Boolean))]
  return itemSpecies.join(', ') || 'No species'
}
