import Fuse from 'fuse.js'
import dictionary from '../../../shared/commonNames/dictionary.json' with { type: 'json' }

// Filter out entries where commonName === scientificName. These are higher
// taxa ("accipitridae family", "aburria species") and generic one-word names
// ("badger", "bat") that we don't want to surface in a species picker. Users
// can still enter these via the "Add custom species" form.
const dictionaryEntries = Object.entries(dictionary)
  .filter(([sci, common]) => sci !== common)
  .map(([scientificName, commonName]) => ({ scientificName, commonName }))

const fuseOptions = {
  keys: ['scientificName', 'commonName'],
  includeScore: true,
  threshold: 0.4,
  ignoreLocation: true
}

const dictionaryFuse = new Fuse(dictionaryEntries, fuseOptions)

export function searchSpecies(query, studySpeciesList) {
  if (!query || query.length < 3) {
    return studySpeciesList
  }

  const studyFuse = new Fuse(studySpeciesList, fuseOptions)
  const studyHits = studyFuse.search(query)
  const dictHits = dictionaryFuse.search(query)

  const merged = new Map()
  for (const { item, score } of studyHits) {
    merged.set(item.scientificName, { ...item, score: score * 0.7, inStudy: true })
  }
  for (const { item, score } of dictHits) {
    if (!merged.has(item.scientificName)) {
      merged.set(item.scientificName, { ...item, score, inStudy: false })
    }
  }

  return [...merged.values()].sort((a, b) => a.score - b.score).slice(0, 50)
}

// Exported for tests only.
export const _dictionaryEntries = dictionaryEntries
