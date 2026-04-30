import { useCommonName } from '../utils/commonNames'

// Each name gets its own component instance because useCommonName is a hook
// and can't be called in a loop over a dynamic array from the parent.
function SpeciesName({ scientificName }) {
  const resolved = useCommonName(scientificName) || scientificName
  return <>{resolved}</>
}

/**
 * Comma-separated species label. Each scientific name resolves to a common
 * name via the four-tier cascade (stored → dictionary → GBIF → scientific
 * fallback). Empty input renders "Blank" — matching the convention used in
 * BboxLabel for unidentified observations.
 *
 * @param {{ names: string[] }} props
 */
export default function SpeciesLabel({ names }) {
  if (!names || names.length === 0) return <>Blank</>

  return (
    <>
      {names.map((name, i) => (
        <span key={name}>
          {i > 0 && ', '}
          <SpeciesName scientificName={name} />
        </span>
      ))}
    </>
  )
}

function SpeciesNameWithCount({ scientificName, count }) {
  const resolved = useCommonName(scientificName) || scientificName
  return (
    <>
      {resolved}
      {count > 1 && <span className="text-gray-500 font-normal"> ×{count}</span>}
    </>
  )
}

/**
 * Species summary with per-species occurrence counts ("Red Deer ×2 · European
 * Hare"). Single-occurrence species drop the count suffix.
 *
 * @param {{ entries: Array<{ scientificName: string, count: number }> }} props
 */
export function SpeciesCountLabel({ entries }) {
  if (!entries || entries.length === 0) return <>Blank</>

  return (
    <>
      {entries.map((entry, i) => (
        <span key={entry.scientificName}>
          {i > 0 && ' · '}
          <SpeciesNameWithCount scientificName={entry.scientificName} count={entry.count} />
        </span>
      ))}
    </>
  )
}
