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

// GBIF returns IUCN status as the verbose form (e.g. "VULNERABLE"). The UI
// palette and IUCN convention use 2-letter codes.
const IUCN_VERBOSE_TO_CODE = {
  LEAST_CONCERN: 'LC',
  NEAR_THREATENED: 'NT',
  VULNERABLE: 'VU',
  ENDANGERED: 'EN',
  CRITICALLY_ENDANGERED: 'CR',
  EXTINCT_IN_THE_WILD: 'EW',
  EXTINCT: 'EX',
  DATA_DEFICIENT: 'DD',
  NOT_EVALUATED: 'NE',
  NOT_APPLICABLE: 'NE'
}

const VALID_IUCN_CODES = new Set(Object.values(IUCN_VERBOSE_TO_CODE))

/**
 * Pull IUCN category from the GBIF iucnRedListCategory response and normalize
 * it to a 2-letter code.
 * @returns {string|null} IUCN code (LC/NT/VU/EN/CR/EW/EX/DD/NE) or null.
 */
export function parseGbifIucn(response) {
  if (!response || typeof response.category !== 'string') return null
  const raw = response.category
  // Already a code: only accept it if it's a known IUCN category.
  if (raw.length <= 3) return VALID_IUCN_CODES.has(raw) ? raw : null
  return IUCN_VERBOSE_TO_CODE[raw] ?? null
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
