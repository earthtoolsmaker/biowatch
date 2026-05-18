import speciesnetSource from '../../src/shared/commonNames/sources/speciesnet.json' with { type: 'json' }
import deepfauneSource from '../../src/shared/commonNames/sources/deepfaune.json' with { type: 'json' }
import manasSource from '../../src/shared/commonNames/sources/manas.json' with { type: 'json' }
import megadetectorSource from '../../src/shared/commonNames/sources/megadetector.json' with { type: 'json' }
import extras from '../../src/shared/commonNames/extras.json' with { type: 'json' }
import { normalizeScientificName } from '../../src/shared/commonNames/normalize.js'

/**
 * Build a label → scientificName alias map from every source that emits both
 * fields. Some models (DeepFaune, Manas, plus our own extras) ship a snake_case
 * label alongside the canonical binomial — this map lets a build step keyed
 * by binomial also enrich the snake_case dictionary key.
 *
 * @returns {Map<string, string>}
 */
export function buildAliasMap() {
  const aliases = new Map()
  const sources = [speciesnetSource, deepfauneSource, manasSource, megadetectorSource, extras]
  for (const src of sources) {
    for (const entry of src.entries || []) {
      if (!entry.scientificName || !entry.label) continue
      const sci = normalizeScientificName(entry.scientificName)
      const label = normalizeScientificName(entry.label)
      if (!sci || !label || sci === label) continue
      aliases.set(label, sci)
    }
  }
  return aliases
}
