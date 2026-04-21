import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeScientificName } from './normalize.js'

// Read dictionary.json at module load time. Use fs instead of JSON import
// assertions so the resolver works across Node versions and bundlers.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dictionary = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'dictionary.json'), 'utf8')
)

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
