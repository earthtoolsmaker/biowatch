import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../../../shared/constants.js'

// Display metadata for the quick-view pill row. `tone` drives the amber
// "attention" styling vs the neutral pill. Counts are filled in by the caller.
// `hidden` entries keep their query-patch + URL deep-link working but are not
// rendered as pills for now (per product decision); flip the flag to restore.
export const QUICK_VIEWS = [
  {
    key: 'needs-review',
    label: 'Needs review',
    description: 'Not yet verified by a human.',
    tone: 'neutral',
    hidden: true
  },
  {
    key: 'reviewed',
    label: 'Reviewed',
    description: 'Already verified by a human.',
    tone: 'neutral',
    hidden: true
  },
  {
    key: 'blank',
    label: 'Blank',
    description: 'No animal detected in the frame.',
    tone: 'neutral'
  },
  {
    key: 'no-timestamp',
    label: 'No timestamp',
    description: 'Media missing a capture date and time.',
    tone: 'neutral'
  },
  {
    key: 'low-confidence',
    label: 'Low confidence',
    description: 'Uncertain AI predictions to double-check.',
    tone: 'neutral',
    hidden: true
  },
  {
    key: 'vehicle',
    label: 'Vehicle',
    description: 'A vehicle was detected instead of wildlife.',
    tone: 'neutral',
    hidden: true
  },
  {
    key: 'favorites',
    label: 'Favorites',
    description: "Sequences you've starred.",
    tone: 'neutral'
  }
]

// Translate a quick view into a patch applied on top of the active filters when
// building the Gallery query. Keys here (reviewed/favorite/lowConfidence/
// onlyNullTimestamps) are consumed by the grid's query builder.
export function quickViewToQueryPatch(key) {
  switch (key) {
    case 'blank':
      return { species: [BLANK_SENTINEL] }
    case 'vehicle':
      return { species: [VEHICLE_SENTINEL] }
    case 'no-timestamp':
      return { onlyNullTimestamps: true }
    case 'reviewed':
      return { reviewed: true }
    case 'needs-review':
      return { reviewed: false }
    case 'favorites':
      return { favorite: true }
    case 'low-confidence':
      return { lowConfidence: true }
    default:
      return {}
  }
}
