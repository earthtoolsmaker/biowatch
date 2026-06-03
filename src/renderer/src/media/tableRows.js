import { getSpeciesCountsFromSequence } from '../utils/speciesFromBboxes.js'

// Derive a single Table-view row from a sequence and the batch-fetched bbox map.
// `speciesNames` lists every species in the sequence ordered by per-sequence
// count (max per frame), so the table can show all of them; `species` is the
// dominant one (first) and `extraSpeciesCount` the remainder. Confidence is the
// max machine probability seen for the dominant species across the sequence's
// frames (null when human-classified / unavailable).
export function deriveTableRow(sequence, bboxesByMedia, isVideoMedia) {
  const items = sequence.items
  const rep = items[0]
  const counts = getSpeciesCountsFromSequence(items, bboxesByMedia)

  const speciesNames = [...counts]
    .sort((a, b) => b.count - a.count)
    .map((c) => c.scientificName)
    .filter(Boolean)
  const species = speciesNames[0] ?? null
  const extraSpeciesCount = Math.max(0, speciesNames.length - 1)

  let confidence = null
  if (species) {
    for (const item of items) {
      for (const b of bboxesByMedia[item.mediaID] || []) {
        if (b.scientificName === species && typeof b.classificationProbability === 'number') {
          confidence =
            confidence == null
              ? b.classificationProbability
              : Math.max(confidence, b.classificationProbability)
        }
      }
    }
  }

  return {
    id: sequence.id,
    mediaID: rep.mediaID,
    thumbnailMedia: rep,
    species,
    speciesNames,
    extraSpeciesCount,
    confidence,
    when: rep.timestamp ?? null,
    deployment: rep.locationName || rep.deploymentID || null,
    reviewed: sequence.reviewed === true,
    isVideo: isVideoMedia ? isVideoMedia(rep) : false
  }
}
