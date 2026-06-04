import { getSpeciesCountsFromSequence } from '../utils/speciesFromBboxes.js'
import { resolveCommonName } from '../../../shared/commonNames/index.js'
import { formatScientificName } from '../utils/scientificName.js'
import { toTitleCase } from '../utils/textCase.js'

// Display label for a species: common name in Title Case, else the formatted
// scientific name (left as-is). null (no species) → null.
export function speciesDisplay(name) {
  if (!name) return null
  const common = resolveCommonName(name)
  if (common) return toTitleCase(common)
  return formatScientificName(name) || name
}

// Comparator over derived rows ({ seq, row }) for a sortable column. Missing
// values sort to the start in ascending order.
function compareDerived(a, b, col) {
  if (col === 'when') {
    const av = a.row.when ? new Date(a.row.when).getTime() : -Infinity
    const bv = b.row.when ? new Date(b.row.when).getTime() : -Infinity
    return av - bv
  }
  if (col === 'type') {
    // Group by media type (photos/sequences before videos), then by sequence
    // length so single frames sort ahead of longer bursts.
    const av = a.row.isVideo ? 1 : 0
    const bv = b.row.isVideo ? 1 : 0
    if (av !== bv) return av - bv
    return a.seq.items.length - b.seq.items.length
  }
  const av = (col === 'species' ? speciesDisplay(a.row.species) : a.row.deployment) || ''
  const bv = (col === 'species' ? speciesDisplay(b.row.species) : b.row.deployment) || ''
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
}

// Sort sequences into the Table view's display order. Returns the input
// unchanged when no column is active. Shared by the table (rendering) and the
// gallery (so the media modal navigates in the same order the user sees).
export function sortSequences(sequences, bboxesByMedia, isVideoMedia, sortCol, sortDir) {
  if (!sortCol) return sequences
  const dir = sortDir === 'asc' ? 1 : -1
  const decorated = sequences.map((seq) => ({
    seq,
    row: deriveTableRow(seq, bboxesByMedia, isVideoMedia)
  }))
  decorated.sort((a, b) => dir * compareDerived(a, b, sortCol))
  return decorated.map((d) => d.seq)
}

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

  // Per-species sequence counts (max per frame — same as the grid card), sorted
  // by count descending. `speciesCounts` feeds the table's SpeciesCountLabel so
  // the species column shows "Red Deer ×2 · European Hare" like the grid.
  const speciesCounts = [...counts]
    .filter((c) => c.scientificName)
    .sort((a, b) => b.count - a.count)
  const speciesNames = speciesCounts.map((c) => c.scientificName)
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
    speciesCounts,
    extraSpeciesCount,
    confidence,
    when: rep.timestamp ?? null,
    deployment: rep.locationName || rep.deploymentID || null,
    isVideo: isVideoMedia ? isVideoMedia(rep) : false
  }
}
