import { useCommonName } from '../utils/commonNames'
import { formatScientificName } from '../utils/scientificName'
import { isBlank, isVehicle } from '../utils/speciesUtils'

// Render a single species name. Pseudo-species sentinels (Blank, Vehicle)
// short-circuit the common-name lookup with their fixed labels.
function pseudoLabelFor(scientificName) {
  if (isBlank(scientificName)) return 'Blank'
  if (isVehicle(scientificName)) return 'Vehicle'
  return null
}

// Each name gets its own component instance because useCommonName is a hook
// and can't be called in a loop over a dynamic array from the parent.
function SpeciesName({ scientificName }) {
  const pseudo = pseudoLabelFor(scientificName)
  // Hook must be called unconditionally; pass null for pseudo-species.
  const resolved = useCommonName(pseudo ? null : scientificName)
  if (pseudo) return <>{pseudo}</>
  if (resolved) return <>{resolved}</>
  return <span className="italic">{formatScientificName(scientificName)}</span>
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
  const pseudo = pseudoLabelFor(scientificName)
  const resolved = useCommonName(pseudo ? null : scientificName)
  const showSci = !pseudo && !resolved
  const label = pseudo || resolved || formatScientificName(scientificName)
  return (
    <>
      {showSci ? <span className="italic">{label}</span> : label}
      {count > 1 && <span className="text-muted-foreground font-normal"> ×{count}</span>}
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
