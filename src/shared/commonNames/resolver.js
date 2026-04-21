import dictionary from './dictionary.json' with { type: 'json' }
import { normalizeScientificName } from './normalize.js'

/**
 * Resolve a scientific name (or raw model label) to an English common name
 * via the shipped dictionary. Pure, synchronous, no network.
 *
 * @param {string | null | undefined} scientificName
 * @returns {string | null} The English common name, or null on miss.
 */
export function resolveCommonName(scientificName) {
  const key = normalizeScientificName(scientificName)
  if (!key) return null
  return dictionary[key] ?? null
}
