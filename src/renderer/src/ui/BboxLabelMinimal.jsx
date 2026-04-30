import { forwardRef } from 'react'
import { computeBboxLabelPosition } from '../utils/positioning'

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
  // Match the fallback chain in ObservationRow: "Blank" only for confirmed-blank
  // observationType; bbox without classification reads as "—".
  const displayName =
    bbox.commonName ||
    bbox.scientificName ||
    (bbox.observationType === 'blank' ? 'Blank' : '—')
  const { left: leftPos, top: topPos, transform: transformVal } = computeBboxLabelPosition(bbox)

  const bg = isSelected ? 'bg-[#030213]' : isValidated ? 'bg-[#2563eb]' : 'bg-[#60a5fa]'

  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`absolute pointer-events-auto h-5 px-2 text-white text-xs font-medium whitespace-nowrap max-w-full truncate flex items-center transition-colors hover:brightness-110 ${bg} ${
        isSelected ? 'ring-2 ring-white/60' : ''
      }`}
      style={{
        left: leftPos,
        top: topPos,
        transform: transformVal
      }}
      title={
        bbox.commonName
          ? `${bbox.commonName} (${bbox.scientificName})`
          : bbox.scientificName || displayName
      }
    >
      {displayName}
    </button>
  )
})

export default BboxLabelMinimal
