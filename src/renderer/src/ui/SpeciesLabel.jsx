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
 * fallback). Empty input renders "No species".
 *
 * @param {{ names: string[] }} props
 */
export default function SpeciesLabel({ names }) {
  if (!names || names.length === 0) return <>No species</>

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
