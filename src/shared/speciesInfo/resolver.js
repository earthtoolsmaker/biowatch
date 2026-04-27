import data from './data.json' with { type: 'json' }
import { normalizeScientificName } from '../commonNames/normalize.js'

/**
 * Build a resolver bound to a specific data map. Useful for testing.
 * Production code should use the default `resolveSpeciesInfo` export.
 */
export function makeResolver(map) {
  return function resolveSpeciesInfo(scientificName) {
    const key = normalizeScientificName(scientificName)
    if (!key) return null
    return map[key] ?? null
  }
}

/**
 * Resolve a scientific name to its bundled species reference data.
 * Pure, synchronous, no network. Returns `null` on miss or invalid input.
 *
 * @param {string|null|undefined} scientificName
 * @returns {{ iucn?: string, blurb?: string, imageUrl?: string, wikipediaUrl?: string } | null}
 */
export const resolveSpeciesInfo = makeResolver(data)
