/**
 * Utility functions for species sorting and filtering.
 * These functions help move humans and vehicles to the bottom of species lists.
 */

/**
 * Check if a species is human or vehicle (should be sorted to bottom of lists)
 * @param {string} scientificName - The scientific name to check
 * @returns {boolean} - True if the species is human or vehicle related
 */
export const isHumanOrVehicle = (scientificName) => {
  if (!scientificName) return false
  const name = scientificName.toLowerCase()
  const exactMatches = [
    'homo sapiens',
    'human',
    'person',
    'people',
    'vehicle',
    'car',
    'truck',
    'motorcycle',
    'bike',
    'bicycle'
  ]
  if (exactMatches.includes(name)) return true
  if (name.includes('human') || name.includes('person') || name.includes('vehicle')) return true
  return false
}

/**
 * Sort species data with humans/vehicles at the bottom.
 * Within each group (regular species and humans/vehicles), sorts by count descending.
 * @param {Array} data - Array of species objects with scientificName and count properties
 * @returns {Array} - Sorted array (does not mutate original)
 */
export const sortSpeciesHumansLast = (data) => {
  if (!data || !Array.isArray(data)) return []
  return [...data].sort((a, b) => {
    const aIsBottom = isHumanOrVehicle(a.scientificName)
    const bIsBottom = isHumanOrVehicle(b.scientificName)
    if (aIsBottom !== bIsBottom) return aIsBottom ? 1 : -1
    return b.count - a.count
  })
}

/**
 * Get the top N non-human/vehicle species, sorted by count descending.
 * Used for default species selection in Activity and Media tabs.
 * @param {Array} data - Array of species objects with scientificName and count properties
 * @param {number} n - Number of species to return (default: 2)
 * @returns {Array} - Top N non-human/vehicle species
 */
export const getTopNonHumanSpecies = (data, n = 2) => {
  if (!data || !Array.isArray(data)) return []
  return sortSpeciesHumansLast(data)
    .filter((s) => !isHumanOrVehicle(s.scientificName))
    .slice(0, n)
}
