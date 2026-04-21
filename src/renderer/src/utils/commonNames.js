import { useQuery } from '@tanstack/react-query'
import { resolveCommonName, pickEnglishCommonName } from '../../../shared/commonNames/index.js'

// Module-level in-memory cache (survives component unmounts, dies on reload).
const gbifCache = new Map()

/**
 * Fetch a scored English common name for `scientificName` from GBIF.
 * Results (including null) are memoized in a module-level Map to prevent
 * duplicate network calls within a session.
 *
 * Pure enough to unit-test: mock `global.fetch` and call it directly.
 *
 * @param {string} scientificName
 * @returns {Promise<string | null>}
 */
export async function fetchGbifCommonName(scientificName) {
  if (gbifCache.has(scientificName)) return gbifCache.get(scientificName)

  const matchRes = await fetch(
    `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`
  )
  const matchData = await matchRes.json()
  if (!matchData.usageKey) {
    gbifCache.set(scientificName, null)
    return null
  }

  const vernRes = await fetch(
    `https://api.gbif.org/v1/species/${matchData.usageKey}/vernacularNames`
  )
  const vernData = await vernRes.json()
  const picked = pickEnglishCommonName(vernData?.results ?? null)
  gbifCache.set(scientificName, picked)
  return picked
}

/** Test-only: reset the in-memory cache between test cases. */
export function _clearGbifCache() {
  gbifCache.clear()
}

/**
 * Resolve a display common name via the four-tier cascade:
 *   1. storedCommonName (authoritative from DB).
 *   2. Shipped dictionary (synchronous).
 *   3. GBIF fallback via TanStack Query (in-memory cached, scored).
 *   4. Scientific name (ultimate fallback — returned from the caller, not here).
 *
 * Returns the resolved name, or null if scientificName is null/empty.
 * While the GBIF call is pending, returns the dictionary hit (null) — the
 * caller should display `scientificName` as the during-fetch placeholder.
 *
 * @param {string | null | undefined} scientificName
 * @param {{ storedCommonName?: string | null }} options
 * @returns {string | null}
 */
export function useCommonName(scientificName, { storedCommonName } = {}) {
  const stored =
    typeof storedCommonName === 'string' && storedCommonName.trim() !== ''
      ? storedCommonName
      : null

  const dictHit = stored ? null : resolveCommonName(scientificName)

  const { data: gbifResult } = useQuery({
    queryKey: ['gbifCommonName', scientificName],
    queryFn: () => fetchGbifCommonName(scientificName),
    enabled: !!scientificName && !stored && !dictHit,
    staleTime: Infinity,
    retry: 1
  })

  if (stored) return stored
  if (dictHit) return dictHit
  if (gbifResult) return gbifResult
  return null
}
