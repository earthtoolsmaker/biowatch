import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../../../shared/constants.js'

// Display metadata for the quick-view dropdown. Counts are filled in by the
// caller. `hidden` entries keep their query-patch + URL deep-link working but
// are not rendered for now (per product decision); flip the flag to restore.
export const QUICK_VIEWS = [
  {
    key: 'blank',
    label: 'Blank',
    description: 'No animal detected in the frame.',
    tone: 'neutral'
  },
  {
    key: 'detections',
    label: 'Detections',
    description: 'Only sequences with an animal, person, or vehicle — hides blanks.',
    tone: 'neutral'
  },
  {
    key: 'no-timestamp',
    label: 'No timestamp',
    description: 'Media missing a capture date and time.',
    tone: 'neutral'
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
// building the Gallery query. Keys here (species/favorite/onlyNullTimestamps)
// are consumed by the grid's query builder.
export function quickViewToQueryPatch(key) {
  switch (key) {
    case 'blank':
      return { species: [BLANK_SENTINEL] }
    case 'detections':
      return { hideBlank: true }
    case 'vehicle':
      return { species: [VEHICLE_SENTINEL] }
    case 'no-timestamp':
      return { onlyNullTimestamps: true }
    case 'favorites':
      return { favorite: true }
    default:
      return {}
  }
}
