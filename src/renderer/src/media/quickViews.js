import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../../../shared/constants.js'

// Display metadata for the quick-view pill row. `tone` drives the amber
// "attention" styling vs the neutral pill. Counts are filled in by the caller.
export const QUICK_VIEWS = [
  { key: 'needs-review', label: 'Needs review', tone: 'warn' },
  { key: 'reviewed', label: 'Reviewed', tone: 'neutral' },
  { key: 'favorites', label: 'Favorites', tone: 'neutral' },
  { key: 'blank', label: 'Blank', tone: 'warn' },
  { key: 'no-timestamp', label: 'No timestamp', tone: 'warn' },
  { key: 'low-confidence', label: 'Low confidence', tone: 'warn' },
  { key: 'vehicle', label: 'Vehicle', tone: 'neutral' }
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
