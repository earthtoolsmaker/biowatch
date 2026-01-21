/**
 * Utility functions for species sorting and filtering.
 * These functions help move humans and vehicles to the bottom of species lists,
 * and blanks (media without observations) to the very end.
 */

import { BLANK_SENTINEL } from '../../../shared/constants.js'

// Re-export for convenience
export { BLANK_SENTINEL }

/**
 * Check if a species entry represents blank media (no observations)
 * @param {string} scientificName - The scientific name to check
 * @returns {boolean} - True if this is the blank sentinel value
 */
export const isBlank = (scientificName) => scientificName === BLANK_SENTINEL

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
 * Sort species data with humans/vehicles near the bottom and blanks at the very end.
 * Order: regular species (by count) > humans/vehicles (by count) > blank
 * @param {Array} data - Array of species objects with scientificName and count properties
 * @returns {Array} - Sorted array (does not mutate original)
 */
export const sortSpeciesHumansLast = (data) => {
  if (!data || !Array.isArray(data)) return []
  return [...data].sort((a, b) => {
    // Blanks always at the very end
    const aIsBlank = isBlank(a.scientificName)
    const bIsBlank = isBlank(b.scientificName)
    if (aIsBlank !== bIsBlank) return aIsBlank ? 1 : -1

    // Then humans/vehicles
    const aIsHumanVehicle = isHumanOrVehicle(a.scientificName)
    const bIsHumanVehicle = isHumanOrVehicle(b.scientificName)
    if (aIsHumanVehicle !== bIsHumanVehicle) return aIsHumanVehicle ? 1 : -1

    // Within groups, sort by count descending
    return b.count - a.count
  })
}

/**
 * Get the top N non-human/vehicle/blank species, sorted by count descending.
 * Used for default species selection in Activity and Media tabs.
 * @param {Array} data - Array of species objects with scientificName and count properties
 * @param {number} n - Number of species to return (default: 2)
 * @returns {Array} - Top N non-human/vehicle/blank species
 */
export const getTopNonHumanSpecies = (data, n = 2) => {
  if (!data || !Array.isArray(data)) return []
  return sortSpeciesHumansLast(data)
    .filter((s) => !isHumanOrVehicle(s.scientificName) && !isBlank(s.scientificName))
    .slice(0, n)
}
