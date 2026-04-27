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

const ACCEPTED_RANKS = new Set(['SPECIES', 'SUBSPECIES'])

/**
 * Decide whether a GBIF /species/match response yields a usable usageKey.
 * @returns {{ usageKey: number|null, accept: boolean, reason: string|null }}
 */
export function parseGbifMatch(response) {
  if (!response || response.matchType === 'NONE') {
    return { usageKey: null, accept: false, reason: 'GBIF returned no match' }
  }
  if (!response.usageKey) {
    return { usageKey: null, accept: false, reason: 'GBIF response missing usageKey' }
  }
  if (!ACCEPTED_RANKS.has(response.rank)) {
    return {
      usageKey: response.usageKey,
      accept: false,
      reason: `GBIF rank=${response.rank} (only SPECIES/SUBSPECIES accepted)`
    }
  }
  return { usageKey: response.usageKey, accept: true, reason: null }
}

/**
 * Pull IUCN category from the GBIF iucnRedListCategory response.
 * @returns {string|null} IUCN code (LC/NT/VU/EN/CR/EX/DD/NE) or null.
 */
export function parseGbifIucn(response) {
  if (!response || typeof response.category !== 'string') return null
  return response.category
}

/**
 * Pull blurb, image URL, and page URL from a Wikipedia REST summary response.
 * Disambiguation pages are recognized and yield no blurb.
 */
export function parseWikipediaSummary(response) {
  if (!response) return { blurb: null, imageUrl: null, wikipediaUrl: null }
  const isDisambig = response.type === 'disambiguation'
  return {
    blurb: !isDisambig && typeof response.extract === 'string' ? response.extract : null,
    imageUrl: response.thumbnail?.source ?? null,
    wikipediaUrl: response.content_urls?.desktop?.page ?? null
  }
}
