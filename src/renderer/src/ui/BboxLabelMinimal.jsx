import { forwardRef } from 'react'
import { computeBboxLabelPosition } from '../utils/positioning'
import { resolveCommonName } from '../../../shared/commonNames/index.js'
import { formatScientificName } from '../utils/scientificName'

/**
 * Species-only label pill anchored above a bbox on the image.
 * Click selects the matching observation in the rail.
 *
 * Color encodes validation:
 *   - Selected: filled near-black
 *   - Validated (human): filled #2563eb
 *   - Predicted (model): filled #60a5fa
 */
const BboxLabelMinimal = forwardRef(function BboxLabelMinimal(
  { bbox, isSelected, isValidated, onClick },
  ref
) {
  // Match the fallback chain in ObservationRow: prefer the dictionary's
  // curated common name (so LILA's "yellow_baboon" renders as "yellow baboon"
  // even when the raw DB row keeps the snake_case category in commonName),
  // then fall back to the DB value, then to the scientific name. "Blank" only
  // for confirmed-blank observationType; bbox without classification reads as
  // "—".
  const dictCommon = resolveCommonName(bbox.scientificName)
  const resolvedCommon = dictCommon || bbox.commonName
  const showSci = !resolvedCommon && bbox.scientificName
  const displayName =
    resolvedCommon ||
    formatScientificName(bbox.scientificName) ||
    (bbox.observationType === 'blank' ? 'Blank' : '—')
  const { left: leftPos, top: topPos, transform: transformVal } = computeBboxLabelPosition(bbox)

  const bg = isSelected
    ? 'bg-foreground text-background'
    : isValidated
      ? 'bg-blue-600 dark:bg-blue-500 text-white'
      : 'bg-blue-400 dark:bg-blue-500 text-white'

  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`absolute pointer-events-auto h-5 px-2 text-xs font-medium whitespace-nowrap max-w-full truncate flex items-center transition-colors hover:brightness-110 ${
        showSci ? 'italic' : 'capitalize'
      } ${bg} ${isSelected ? 'ring-2 ring-white/60' : ''}`}
      style={{
        left: leftPos,
        top: topPos,
        transform: transformVal
      }}
      title={
        bbox.scientificName && !showSci
          ? `${displayName} (${formatScientificName(bbox.scientificName)})`
          : displayName
      }
    >
      {displayName}
    </button>
  )
})

export default BboxLabelMinimal
