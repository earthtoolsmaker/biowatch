/**
 * Map internal observationType + scientificName to Camtrap DP vocabulary.
 *
 * Valid output values: `animal`, `human`, `vehicle`, `blank`, `unknown`, `unclassified`.
 *
 * MegaDetector's three pseudo-species labels (`animal`, `homo sapiens`,
 * `vehicle`) map directly to Camtrap DP's vocabulary. We special-case
 * `homo sapiens` → `human` and `vehicle` → `vehicle` BEFORE the generic
 * "any scientificName → animal" fallback, otherwise the fallback would
 * shadow them. The string matches also catch the same values coming from
 * any other source (e.g. a SpeciesNet "homo sapiens" classification),
 * which is semantically correct.
 *
 * Extracted from `exporter.js` into a pure module so it can be unit-tested
 * without transitively loading the rest of the export pipeline (which pulls
 * in `download.ts` and friends).
 *
 * @param {string|null} dbType - The `observationType` column value (`'machine'`,
 *   `'animal'`, `'human'`, `'vehicle'`, `'blank'`, `'unclassified'`, or null).
 * @param {string|null} scientificName - The observation's scientific name.
 * @returns {'animal'|'human'|'vehicle'|'blank'|'unknown'|'unclassified'}
 */
export function mapObservationType(dbType, scientificName) {
  if (scientificName === 'homo sapiens') return 'human'
  if (scientificName === 'vehicle') return 'vehicle'
  // Any other scientificName (binomials, MD's literal "animal", ...) → animal.
  if (scientificName) return 'animal'
  if (!dbType || dbType === 'blank') return 'blank'
  if (dbType === 'machine') return 'animal'
  if (dbType === 'animal') return 'animal'
  if (dbType === 'human') return 'human'
  if (dbType === 'vehicle') return 'vehicle'
  if (dbType === 'unclassified') return 'unclassified'
  return 'unknown'
}
