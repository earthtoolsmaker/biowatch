const RANK_KEYWORD = /\b(species|family|order|class|genus|subfamily|suborder|superfamily)\b/i

/**
 * True if the dictionary key looks like a species or subspecies binomial.
 * Cheap pre-filter that runs before any network call. GBIF rank is the
 * authoritative filter — this just reduces wasted requests.
 */
export function isSpeciesCandidate(name) {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  if (!trimmed) return false
  if (RANK_KEYWORD.test(trimmed)) return false
  const tokens = trimmed.split(/\s+/)
  return tokens.length >= 2
}
