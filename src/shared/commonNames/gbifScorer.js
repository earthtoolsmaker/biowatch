/**
 * Pick an English common name from a GBIF /vernacularNames response's
 * `results` array.
 *
 * GBIF's `language` field is unreliable — some sources mis-tag non-English
 * entries (e.g. Spanish, French) as `language: "eng"`. We route around that
 * by preferring entries from a curated list of authoritative sources; in the
 * design-time audit (235 species), every species had at least one trusted
 * entry, so fallback-to-first-eng is a safety net rather than a hot path.
 *
 * Returns null if no eng-tagged entry exists.
 */

// Ranked by how reliably their entries are actually English, per the audit.
// The list is checked in order; first hit wins.
const TRUSTED_SOURCES = [
  /Integrated Taxonomic Information System/i,
  /\bITIS\b/,
  /Mammal Species of the World/i,
  /IUCN Red List/i,
  /IOC World Bird List/i,
  /Clements Checklist/i,
  /Catalogue of Life/i
]

function isEnglish(entry) {
  return entry?.language === 'eng' || entry?.language === 'en'
}

export function pickEnglishCommonName(results) {
  if (!Array.isArray(results) || results.length === 0) return null

  const engs = results.filter(isEnglish)
  if (engs.length === 0) return null

  for (const re of TRUSTED_SOURCES) {
    const hit = engs.find((e) => re.test(e.source || ''))
    if (hit && hit.vernacularName) return hit.vernacularName.trim()
  }

  // No trusted source matched; fall back to the first eng-tagged entry.
  const first = engs.find((e) => typeof e.vernacularName === 'string' && e.vernacularName.trim())
  return first ? first.vernacularName.trim() : null
}
