import { getSpeciesCountsFromSequence } from '../utils/speciesFromBboxes.js'

// Derive a single Table-view row from a sequence and the batch-fetched bbox map.
// The dominant species is the one with the highest per-sequence count (max per
// frame); the rest collapse into extraSpeciesCount ("+N"). Confidence is the max
// machine probability seen for the dominant species across the sequence's frames
// (null when human-classified / unavailable).
export function deriveTableRow(sequence, bboxesByMedia, isVideoMedia) {
  const items = sequence.items
  const rep = items[0]
  const counts = getSpeciesCountsFromSequence(items, bboxesByMedia)

  let dominant = null
  for (const c of counts) {
    if (!dominant || c.count > dominant.count) dominant = c
  }
  const species = dominant ? dominant.scientificName : null
  const extraSpeciesCount = Math.max(0, counts.length - 1)

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
    extraSpeciesCount,
    confidence,
    when: rep.timestamp ?? null,
    deployment: rep.locationName || rep.deploymentID || null,
    reviewed: sequence.reviewed === true,
    isVideo: isVideoMedia ? isVideoMedia(rep) : false
  }
}
