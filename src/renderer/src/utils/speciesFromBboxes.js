/**
 * Extract unique scientific names from detection bounding boxes.
 * Returns lists (not display strings) so renderers can resolve each name to
 * a common name per-species via a hook — hooks can't be called inside a
 * string-returning pure helper.
 */

/**
 * @param {Array<{scientificName?: string}>} bboxes
 * @param {string|null} fallbackScientificName - used when no bbox has a species
 * @returns {string[]} Unique scientific names; empty array when nothing resolves.
 */
export function getSpeciesListFromBboxes(bboxes, fallbackScientificName = null) {
  const names = [...new Set(bboxes.map((b) => b.scientificName).filter(Boolean))]
  if (names.length > 0) return names
  return fallbackScientificName ? [fallbackScientificName] : []
}

/**
 * Like getSpeciesListFromBboxes but preserves per-species occurrence counts so
 * the renderer can show "Red Deer ×2 · European Hare" for multi-detection
 * frames. The fallback species, when used, is treated as a single occurrence.
 *
 * @param {Array<{scientificName?: string}>} bboxes
 * @param {string|null} fallbackScientificName
 * @returns {Array<{scientificName: string, count: number}>}
 */
export function getSpeciesCountsFromBboxes(bboxes, fallbackScientificName = null) {
  const counts = new Map()
  for (const b of bboxes) {
    const name = b.scientificName
    if (!name) continue
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  if (counts.size > 0) {
    return Array.from(counts, ([scientificName, count]) => ({ scientificName, count }))
  }
  return fallbackScientificName ? [{ scientificName: fallbackScientificName, count: 1 }] : []
}

/**
 * @param {Array<{mediaID: string, scientificName?: string}>} items
 * @param {Object<string, Array<{scientificName?: string}>>} bboxesByMedia
 * @returns {string[]} Unique scientific names; empty array when nothing resolves.
 */
export function getSpeciesListFromSequence(items, bboxesByMedia) {
  const fromBboxes = items.flatMap((item) => {
    const itemBboxes = bboxesByMedia[item.mediaID] || []
    return itemBboxes.map((b) => b.scientificName).filter(Boolean)
  })
  const uniqueBbox = [...new Set(fromBboxes)]
  if (uniqueBbox.length > 0) return uniqueBbox

  return [...new Set(items.map((i) => i.scientificName).filter(Boolean))]
}
