/**
 * Normalize a scientific name for dictionary lookup.
 * Returns null for null/empty/whitespace input.
 * Steps: NFC normalize → trim → lowercase → collapse whitespace.
 */
export function normalizeScientificName(input) {
  if (input == null) return null
  if (typeof input !== 'string') return null

  const s = input
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

  return s || null
}
