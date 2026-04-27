# Species Tooltip Descriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the species hover tooltip to show an IUCN status badge, a short Wikipedia blurb, and a fallback image, all sourced from a static JSON pre-baked by a build script.

**Architecture:** A Node script (`scripts/build-species-info.js`) reads keys from the existing `dictionary.json`, filters non-species, queries GBIF + Wikipedia, and writes `src/shared/speciesInfo/data.json`. At runtime, a pure synchronous resolver looks the data up and `SpeciesTooltipContent.jsx` renders it.

**Tech Stack:** Node.js (`node --test`), Electron + React + Tailwind, Vite for renderer bundling. JSON imported via `import ... with { type: 'json' }` for automatic bundling. Network: GBIF API + Wikipedia REST API (build-time only).

**Spec:** `docs/specs/2026-04-27-species-tooltip-descriptions-design.md`

---

## File Structure

**Create:**
- `src/shared/speciesInfo/data.json` — generated species reference data (lowercased binomial keys → `{ iucn, blurb, imageUrl, wikipediaUrl }`)
- `src/shared/speciesInfo/resolver.js` — pure synchronous lookup
- `src/shared/speciesInfo/index.js` — barrel export (mirrors `commonNames/index.js`)
- `scripts/build-species-info.js` — CLI to generate `data.json`
- `scripts/build-species-info.lib.js` — pure helpers used by the CLI (pre-filter, GBIF/Wikipedia parsers) so they're unit-testable without mocking the CLI
- `test/shared/speciesInfo/resolver.test.js` — resolver unit tests
- `test/scripts/build-species-info.test.js` — pure-helper unit tests

**Modify:**
- `src/renderer/src/ui/SpeciesTooltipContent.jsx` — add badge / blurb / Wikipedia link / fallback image
- `package.json` — add `species-info:build` npm script
- `docs/architecture.md` — note the new shared module
- `docs/data-formats.md` — describe the `data.json` shape
- `docs/development.md` — document running the build script

---

## Task 1: Pre-filter helper (pure, TDD)

**Files:**
- Create: `scripts/build-species-info.lib.js`
- Test: `test/scripts/build-species-info.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/scripts/build-species-info.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { isSpeciesCandidate } from '../../scripts/build-species-info.lib.js'

describe('isSpeciesCandidate', () => {
  test('accepts plain binomial scientific names', () => {
    assert.equal(isSpeciesCandidate('panthera leo'), true)
    assert.equal(isSpeciesCandidate('acinonyx jubatus'), true)
  })

  test('accepts trinomial (subspecies) names', () => {
    assert.equal(isSpeciesCandidate('felis silvestris lybica'), true)
  })

  test('rejects single-token entries (orders, classes, genera-only)', () => {
    assert.equal(isSpeciesCandidate('accipitriformes'), false)
    assert.equal(isSpeciesCandidate('madoqua'), false)
    assert.equal(isSpeciesCandidate('aves'), false)
  })

  test('rejects entries with rank keywords', () => {
    assert.equal(isSpeciesCandidate('aburria species'), false)
    assert.equal(isSpeciesCandidate('acanthizidae family'), false)
    assert.equal(isSpeciesCandidate('accipitriformes order'), false)
    assert.equal(isSpeciesCandidate('felidae class'), false)
    assert.equal(isSpeciesCandidate('panthera genus'), false)
    assert.equal(isSpeciesCandidate('caprinae subfamily'), false)
  })

  test('handles null / empty / non-string input', () => {
    assert.equal(isSpeciesCandidate(null), false)
    assert.equal(isSpeciesCandidate(''), false)
    assert.equal(isSpeciesCandidate('   '), false)
    assert.equal(isSpeciesCandidate(undefined), false)
    assert.equal(isSpeciesCandidate(42), false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scripts/build-species-info.test.js`
Expected: FAIL with module-not-found for `build-species-info.lib.js`.

- [ ] **Step 3: Implement the helper**

Create `scripts/build-species-info.lib.js`:

```js
const RANK_KEYWORD = /\b(species|family|order|class|genus|subfamily|suborder|superfamily)\b/i

/**
 * True if the dictionary key looks like a species or subspecies binomial.
 * Cheap pre-filter that runs before any network call. GBIF rank is the
 * authoritative filter — this just reduces wasted requests.
 */
export function isSpeciesCandidate(name) {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  if (!trimmed) return false
  if (RANK_KEYWORD.test(trimmed)) return false
  const tokens = trimmed.split(/\s+/)
  return tokens.length >= 2
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scripts/build-species-info.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-species-info.lib.js test/scripts/build-species-info.test.js
git commit -m "feat(species-info): add species-candidate pre-filter helper"
```

---

## Task 2: GBIF response parsers (pure, TDD)

**Files:**
- Modify: `scripts/build-species-info.lib.js`
- Test: `test/scripts/build-species-info.test.js`

- [ ] **Step 1: Add failing tests**

In `test/scripts/build-species-info.test.js`, **replace** the existing import line with:

```js
import {
  isSpeciesCandidate,
  parseGbifMatch,
  parseGbifIucn,
  parseWikipediaSummary
} from '../../scripts/build-species-info.lib.js'
```

Then **append** these `describe` blocks to the bottom of the file:

```js
describe('parseGbifMatch', () => {
  test('returns usageKey for SPECIES rank', () => {
    const r = parseGbifMatch({ usageKey: 5219404, rank: 'SPECIES', matchType: 'EXACT' })
    assert.deepEqual(r, { usageKey: 5219404, accept: true, reason: null })
  })

  test('accepts SUBSPECIES', () => {
    const r = parseGbifMatch({ usageKey: 1, rank: 'SUBSPECIES', matchType: 'EXACT' })
    assert.equal(r.accept, true)
  })

  test('rejects GENUS / FAMILY / ORDER', () => {
    assert.equal(parseGbifMatch({ usageKey: 1, rank: 'GENUS', matchType: 'EXACT' }).accept, false)
    assert.equal(parseGbifMatch({ usageKey: 1, rank: 'FAMILY', matchType: 'EXACT' }).accept, false)
    assert.equal(parseGbifMatch({ usageKey: 1, rank: 'ORDER', matchType: 'EXACT' }).accept, false)
  })

  test('rejects matchType NONE', () => {
    const r = parseGbifMatch({ matchType: 'NONE' })
    assert.equal(r.accept, false)
    assert.match(r.reason, /no match/i)
  })

  test('rejects missing usageKey', () => {
    assert.equal(parseGbifMatch({ rank: 'SPECIES', matchType: 'EXACT' }).accept, false)
  })
})

describe('parseGbifIucn', () => {
  test('returns category code from threats response', () => {
    assert.equal(parseGbifIucn({ category: 'VU' }), 'VU')
    assert.equal(parseGbifIucn({ category: 'LC' }), 'LC')
  })

  test('returns null when missing', () => {
    assert.equal(parseGbifIucn({}), null)
    assert.equal(parseGbifIucn(null), null)
    assert.equal(parseGbifIucn(undefined), null)
  })
})

describe('parseWikipediaSummary', () => {
  test('extracts blurb, image, and page URL from full summary response', () => {
    const r = parseWikipediaSummary({
      extract: 'The lion (Panthera leo) is a large cat...',
      thumbnail: { source: 'https://upload.wikimedia.org/.../320px-Lion.jpg' },
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Lion' } }
    })
    assert.equal(r.blurb, 'The lion (Panthera leo) is a large cat...')
    assert.equal(r.imageUrl, 'https://upload.wikimedia.org/.../320px-Lion.jpg')
    assert.equal(r.wikipediaUrl, 'https://en.wikipedia.org/wiki/Lion')
  })

  test('returns null fields when summary is partial', () => {
    const r = parseWikipediaSummary({ extract: 'A short blurb.' })
    assert.equal(r.blurb, 'A short blurb.')
    assert.equal(r.imageUrl, null)
    assert.equal(r.wikipediaUrl, null)
  })

  test('returns all-null on empty / null input', () => {
    assert.deepEqual(parseWikipediaSummary(null), {
      blurb: null,
      imageUrl: null,
      wikipediaUrl: null
    })
  })

  test('skips disambiguation pages', () => {
    const r = parseWikipediaSummary({
      type: 'disambiguation',
      extract: 'Lion may refer to:'
    })
    assert.equal(r.blurb, null)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/scripts/build-species-info.test.js`
Expected: FAIL — three new functions undefined.

- [ ] **Step 3: Implement parsers**

Append to `scripts/build-species-info.lib.js`:

```js
const ACCEPTED_RANKS = new Set(['SPECIES', 'SUBSPECIES'])

/**
 * Decide whether a GBIF /species/match response yields a usable usageKey.
 * @returns {{ usageKey: number|null, accept: boolean, reason: string|null }}
 */
export function parseGbifMatch(response) {
  if (!response || response.matchType === 'NONE') {
    return { usageKey: null, accept: false, reason: 'GBIF returned no match' }
  }
  if (!response.usageKey) {
    return { usageKey: null, accept: false, reason: 'GBIF response missing usageKey' }
  }
  if (!ACCEPTED_RANKS.has(response.rank)) {
    return {
      usageKey: response.usageKey,
      accept: false,
      reason: `GBIF rank=${response.rank} (only SPECIES/SUBSPECIES accepted)`
    }
  }
  return { usageKey: response.usageKey, accept: true, reason: null }
}

/**
 * Pull IUCN category from the GBIF iucnRedListCategory response.
 * @returns {string|null} IUCN code (LC/NT/VU/EN/CR/EX/DD/NE) or null.
 */
export function parseGbifIucn(response) {
  if (!response || typeof response.category !== 'string') return null
  return response.category
}

/**
 * Pull blurb, image URL, and page URL from a Wikipedia REST summary response.
 * Disambiguation pages are recognized and yield no blurb.
 */
export function parseWikipediaSummary(response) {
  if (!response) return { blurb: null, imageUrl: null, wikipediaUrl: null }
  const isDisambig = response.type === 'disambiguation'
  return {
    blurb: !isDisambig && typeof response.extract === 'string' ? response.extract : null,
    imageUrl: response.thumbnail?.source ?? null,
    wikipediaUrl: response.content_urls?.desktop?.page ?? null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/scripts/build-species-info.test.js`
Expected: PASS — all tests across both `describe` blocks succeed.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-species-info.lib.js test/scripts/build-species-info.test.js
git commit -m "feat(species-info): add GBIF and Wikipedia response parsers"
```

---

## Task 3: Resolver (pure, TDD)

**Files:**
- Create: `src/shared/speciesInfo/data.json`
- Create: `src/shared/speciesInfo/resolver.js`
- Create: `src/shared/speciesInfo/index.js`
- Test: `test/shared/speciesInfo/resolver.test.js`

- [ ] **Step 1: Seed an empty data file**

Create `src/shared/speciesInfo/data.json`:

```json
{}
```

- [ ] **Step 2: Write the failing test**

Create `test/shared/speciesInfo/resolver.test.js`:

```js
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// node:test has no clean ESM module mocker, so we use a factory function
// (`makeResolver`) that takes the data map directly. The default export
// `resolveSpeciesInfo` is created from the real data.json — exercised by
// the manual smoke test in Task 9.

import { makeResolver } from '../../src/shared/speciesInfo/resolver.js'

const FIXTURE = {
  'panthera leo': {
    iucn: 'VU',
    blurb: 'The lion is a large cat...',
    imageUrl: 'https://example.test/lion.jpg',
    wikipediaUrl: 'https://en.wikipedia.org/wiki/Lion'
  }
}

describe('resolveSpeciesInfo', () => {
  const resolve = makeResolver(FIXTURE)

  test('returns full record on exact lowercase hit', () => {
    assert.deepEqual(resolve('panthera leo'), FIXTURE['panthera leo'])
  })

  test('is case-insensitive', () => {
    assert.deepEqual(resolve('Panthera Leo'), FIXTURE['panthera leo'])
    assert.deepEqual(resolve('PANTHERA LEO'), FIXTURE['panthera leo'])
  })

  test('trims whitespace', () => {
    assert.deepEqual(resolve('  panthera leo  '), FIXTURE['panthera leo'])
  })

  test('returns null on miss', () => {
    assert.equal(resolve('canis lupus'), null)
  })

  test('returns null for null/empty/undefined', () => {
    assert.equal(resolve(null), null)
    assert.equal(resolve(undefined), null)
    assert.equal(resolve(''), null)
    assert.equal(resolve('   '), null)
  })

  test('returns null for non-string input', () => {
    assert.equal(resolve(42), null)
    assert.equal(resolve({}), null)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/shared/speciesInfo/resolver.test.js`
Expected: FAIL — resolver module does not export `makeResolver`.

- [ ] **Step 4: Implement the resolver**

Create `src/shared/speciesInfo/resolver.js`:

```js
import data from './data.json' with { type: 'json' }
import { normalizeScientificName } from '../commonNames/normalize.js'

/**
 * Build a resolver bound to a specific data map. Useful for testing.
 * Production code should use the default `resolveSpeciesInfo` export.
 */
export function makeResolver(map) {
  return function resolveSpeciesInfo(scientificName) {
    const key = normalizeScientificName(scientificName)
    if (!key) return null
    return map[key] ?? null
  }
}

/**
 * Resolve a scientific name to its bundled species reference data.
 * Pure, synchronous, no network. Returns `null` on miss or invalid input.
 *
 * @param {string|null|undefined} scientificName
 * @returns {{ iucn?: string, blurb?: string, imageUrl?: string, wikipediaUrl?: string } | null}
 */
export const resolveSpeciesInfo = makeResolver(data)
```

Create `src/shared/speciesInfo/index.js`:

```js
export { resolveSpeciesInfo, makeResolver } from './resolver.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/shared/speciesInfo/resolver.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/shared/speciesInfo test/shared/speciesInfo
git commit -m "feat(species-info): add pure synchronous resolver"
```

---

## Task 4: Build script CLI

**Files:**
- Create: `scripts/build-species-info.js`
- Modify: `package.json` (add npm script)

- [ ] **Step 1: Implement the script**

Create `scripts/build-species-info.js`:

```js
#!/usr/bin/env node
/**
 * Build src/shared/speciesInfo/data.json by enriching the common-name
 * dictionary with GBIF (IUCN status) and Wikipedia (blurb + image).
 *
 * Usage:
 *   node scripts/build-species-info.js                  # full run
 *   node scripts/build-species-info.js --resume         # skip already-fetched
 *   node scripts/build-species-info.js --force          # refetch everything
 *   node scripts/build-species-info.js --limit 25       # cap candidates
 *   node scripts/build-species-info.js --dry-run        # don't write file
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

import {
  isSpeciesCandidate,
  parseGbifMatch,
  parseGbifIucn,
  parseWikipediaSummary
} from './build-species-info.lib.js'
import dictionary from '../src/shared/commonNames/dictionary.json' with { type: 'json' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUTPUT_PATH = path.join(ROOT, 'src/shared/speciesInfo/data.json')

const POLITE_DELAY_MS = 200
const RETRIES = 3
const RETRY_BASE_MS = 500

function parseArgs(argv) {
  const out = { resume: false, force: false, dryRun: false, limit: Infinity }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--resume') out.resume = true
    else if (a === '--force') out.force = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--limit') out.limit = Number(argv[++i])
    else throw new Error(`unknown flag: ${a}`)
  }
  return out
}

async function fetchJson(url) {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'biowatch-species-info-builder' } })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      if (attempt === RETRIES) throw err
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1))
    }
  }
}

async function fetchSpecies(name) {
  const match = await fetchJson(
    `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}`
  )
  const verdict = parseGbifMatch(match)
  if (!verdict.accept) return { skip: verdict.reason }

  const [iucnRes, wikiRes] = await Promise.all([
    fetchJson(`https://api.gbif.org/v1/species/${verdict.usageKey}/iucnRedListCategory`),
    fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`)
  ])

  const iucn = parseGbifIucn(iucnRes)
  const wiki = parseWikipediaSummary(wikiRes)

  const entry = {}
  if (iucn) entry.iucn = iucn
  if (wiki.blurb) entry.blurb = wiki.blurb
  if (wiki.imageUrl) entry.imageUrl = wiki.imageUrl
  if (wiki.wikipediaUrl) entry.wikipediaUrl = wiki.wikipediaUrl
  return Object.keys(entry).length ? { entry } : { skip: 'no usable fields' }
}

function loadExisting() {
  try {
    const text = fs.readFileSync(OUTPUT_PATH, 'utf8')
    return JSON.parse(text) || {}
  } catch {
    return {}
  }
}

function writeOutput(map) {
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
}

function diffSummary(prev, next) {
  const added = []
  const removed = []
  const changed = []
  for (const k of Object.keys(next)) {
    if (!(k in prev)) added.push(k)
    else if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) changed.push(k)
  }
  for (const k of Object.keys(prev)) {
    if (!(k in next)) removed.push(k)
  }
  return { added, removed, changed }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const existing = loadExisting()
  const out = { ...existing }

  const allKeys = Object.keys(dictionary)
  const candidates = allKeys.filter(isSpeciesCandidate)
  const skippedFilter = allKeys.length - candidates.length

  console.log(`dictionary: ${allKeys.length}, species candidates: ${candidates.length}`)
  console.log(`pre-filter skipped: ${skippedFilter}`)

  let processed = 0
  let kept = 0
  const skipReasons = new Map()
  const queue = candidates.slice(0, args.limit)

  // Install SIGINT handler so we flush partial work before exit.
  let interrupted = false
  process.on('SIGINT', () => {
    interrupted = true
    console.log('\n[SIGINT] flushing progress and exiting...')
  })

  for (const name of queue) {
    if (interrupted) break
    if (args.resume && !args.force && out[name]) continue
    processed++
    try {
      const result = await fetchSpecies(name)
      if (result.entry) {
        out[name] = result.entry
        kept++
        console.log(`[ok]   ${name}`)
      } else {
        skipReasons.set(result.skip, (skipReasons.get(result.skip) ?? 0) + 1)
        console.log(`[skip] ${name} — ${result.skip}`)
      }
    } catch (err) {
      console.warn(`[err]  ${name} — ${err.message}`)
    }
    await sleep(POLITE_DELAY_MS)
  }

  const { added, removed, changed } = diffSummary(existing, out)
  console.log('\n=== summary ===')
  console.log(`processed: ${processed}, kept: ${kept}`)
  for (const [r, n] of skipReasons) console.log(`skip "${r}": ${n}`)
  console.log(`diff vs previous: +${added.length} / -${removed.length} / ~${changed.length}`)

  if (args.dryRun) {
    console.log('--dry-run: not writing file')
    return
  }
  writeOutput(out)
  console.log(`wrote ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Add npm script**

Modify `package.json`. Find the `"dict:build"` line and add a new script directly after it:

```json
"dict:build": "node scripts/build-common-names-dict.js",
"species-info:build": "node scripts/build-species-info.js",
```

- [ ] **Step 3: Smoke-test with --dry-run --limit 3**

Run: `node scripts/build-species-info.js --dry-run --limit 3`
Expected: hits GBIF + Wikipedia for ~3 species, prints `[ok]` lines, then "summary" + "--dry-run: not writing file". `data.json` is unchanged (still `{}` from Task 3).

If you have no internet at this step, skip it and rely on Task 5's full run.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-species-info.js package.json
git commit -m "feat(species-info): add build script CLI"
```

---

## Task 5: Generate `data.json` for real

**Files:**
- Modify: `src/shared/speciesInfo/data.json`

- [ ] **Step 1: Run the full script**

Run: `npm run species-info:build`
Expected: Long-running (~10–20 min for ~2,000 species at 200ms/req + Wikipedia rate). Watch `[ok]` / `[skip]` lines scroll.

If interrupted, resume with: `npm run species-info:build -- --resume`

- [ ] **Step 2: Spot-check the output**

Run: `node -e "const d = require('./src/shared/speciesInfo/data.json'); console.log(Object.keys(d).length, 'entries'); console.log(d['panthera leo'])"`
Expected: prints a count (likely 1500–2200) and a real entry for Panthera leo with `iucn: "VU"`, a blurb, an imageUrl, and a wikipediaUrl.

- [ ] **Step 3: Quick demo-dataset coverage check**

Run:
```bash
node -e "
const d = require('./src/shared/speciesInfo/data.json');
const demo = ['panthera leo','acinonyx jubatus','loxodonta africana','crocuta crocuta','homo sapiens','aepyceros melampus'];
for (const s of demo) console.log(s.padEnd(28), d[s] ? 'ok' : 'MISSING');
"
```
Expected: all six print `ok`. If any are MISSING, hand-edit `data.json` (the file is hand-editable per the spec) — paste the relevant fields from a manual Wikipedia summary lookup.

- [ ] **Step 4: Commit the generated data**

```bash
git add src/shared/speciesInfo/data.json
git commit -m "chore(species-info): generate initial data.json"
```

---

## Task 6: Build verification

**Files:** None modified — verification step only.

- [ ] **Step 1: Run a production build**

Run: `npm run build`
Expected: `electron-vite build` completes without errors.

- [ ] **Step 2: Confirm the data made it into the renderer bundle**

Run:
```bash
node -e "
const d = require('./src/shared/speciesInfo/data.json');
const lion = d['panthera leo']?.blurb ?? '';
const fragment = lion.split(' ').slice(0, 5).join(' ');
console.log('searching for fragment:', JSON.stringify(fragment));
" && \
grep -rl "Panthera leo\|panthera leo" /mnt/data/ssd_1/earthtoolsmaker/projects/biowatch/out/renderer 2>/dev/null | head -3
```
Expected: the grep finds at least one file in `out/renderer/` containing the species name. If grep returns no matches, the JSON did not make it into the bundle — debug the import in `src/shared/speciesInfo/resolver.js`.

- [ ] **Step 3: No commit (verification only)**

Skip commit; this step adds nothing to the tree.

---

## Task 7: Tooltip UI — IUCN badge component

**Files:**
- Modify: `src/renderer/src/ui/SpeciesTooltipContent.jsx`

- [ ] **Step 1: Add the IUCN palette + small badge component**

Edit `src/renderer/src/ui/SpeciesTooltipContent.jsx`. Add this block right after the existing helper functions (`isRemoteUrl`), before the `SpeciesTooltipContent` component:

```jsx
const IUCN_COLORS = {
  LC: 'bg-green-100 text-green-800',
  NT: 'bg-yellow-100 text-yellow-800',
  VU: 'bg-orange-100 text-orange-800',
  EN: 'bg-red-100 text-red-800',
  CR: 'bg-red-200 text-red-900',
  EX: 'bg-gray-800 text-white',
  EW: 'bg-gray-700 text-white',
  DD: 'bg-gray-100 text-gray-700',
  NE: 'bg-gray-100 text-gray-700'
}

function IucnBadge({ category }) {
  if (!category) return null
  const cls = IUCN_COLORS[category] ?? 'bg-gray-100 text-gray-700'
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${cls}`}
      title={`IUCN Red List: ${category}`}
    >
      {category}
    </span>
  )
}
```

No rendering yet — that's the next task.

- [ ] **Step 2: Verify the file still compiles**

Run: `npm run lint -- src/renderer/src/ui/SpeciesTooltipContent.jsx`
Expected: lint passes (or only existing warnings; no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/SpeciesTooltipContent.jsx
git commit -m "feat(species-tooltip): add IUCN badge component"
```

---

## Task 8: Tooltip UI — wire in description, badge, link, and fallback image

**Files:**
- Modify: `src/renderer/src/ui/SpeciesTooltipContent.jsx`

- [ ] **Step 1: Replace the component body**

Edit `src/renderer/src/ui/SpeciesTooltipContent.jsx`. Replace the entire `SpeciesTooltipContent` function (currently spanning roughly the export through the closing brace) with:

```jsx
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/index.js'

export default function SpeciesTooltipContent({ imageData, studyId }) {
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const sciName = imageData?.scientificName
  const common = useCommonName(sciName)
  const info = resolveSpeciesInfo(sciName)

  // Reset state when imageData changes
  useEffect(() => {
    setImageError(false)
    setImageLoaded(false)
  }, [imageData?.mediaID, sciName])

  // Image source priority: study photo > Wikipedia thumbnail > placeholder.
  const imageSource = imageData?.filePath
    ? constructImageUrl(imageData.filePath, studyId)
    : info?.imageUrl
      ? constructImageUrl(info.imageUrl, studyId)
      : null

  if (!imageSource && !info?.blurb && !info?.iucn && !sciName) {
    return null
  }

  const hasCommon = common && common !== sciName

  return (
    <div className="w-[320px] bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden">
      {/* Image */}
      <div className="relative w-full h-[180px] bg-gray-100">
        {!imageSource || imageError ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <CameraOff size={32} className="text-gray-300" />
          </div>
        ) : (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                {isRemoteUrl(imageSource) ? (
                  <Loader2 size={24} className="text-gray-400 animate-spin" />
                ) : (
                  <div className="animate-pulse bg-gray-200 w-full h-full" />
                )}
              </div>
            )}
            <img
              src={imageSource}
              alt={sciName ?? ''}
              className={`w-full h-full object-cover transition-opacity duration-150 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          </>
        )}
      </div>

      {/* Footer: name + badge + blurb + Wikipedia link */}
      <div className="px-2.5 py-2 bg-gray-50 border-t border-gray-100 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs text-gray-600 truncate">
            {hasCommon ? (
              <>
                {toTitleCase(common)}{' '}
                <span className="italic text-gray-500">({capitalizeGenus(sciName)})</span>
              </>
            ) : (
              <span className="italic">{capitalizeGenus(sciName)}</span>
            )}
          </p>
          <IucnBadge category={info?.iucn} />
        </div>

        {info?.blurb && (
          <p className="text-[11px] text-gray-700 leading-snug line-clamp-3">{info.blurb}</p>
        )}

        {info?.wikipediaUrl && (
          <a
            href={info.wikipediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-blue-600 hover:underline"
          >
            Read more on Wikipedia
          </a>
        )}
      </div>
    </div>
  )
}
```

Note the import for `resolveSpeciesInfo` goes at the top of the file (with the other imports) — move it there from the snippet above.

- [ ] **Step 2: Verify lint**

Run: `npm run lint -- src/renderer/src/ui/SpeciesTooltipContent.jsx`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/SpeciesTooltipContent.jsx
git commit -m "feat(species-tooltip): show blurb, IUCN badge, fallback image, Wikipedia link"
```

---

## Task 9: Manual smoke test in dev

**Files:** None modified.

- [ ] **Step 1: Start the app**

Run: `npm run dev`
Expected: Electron app boots; landing screen visible.

- [ ] **Step 2: Import the demo dataset**

In the app: trigger the "Demo - Kruger National Park" import. Wait for completion.

- [ ] **Step 3: Verify the tooltip in the overview tab**

Navigate to the overview tab for the demo study. Hover over **Lion (Panthera leo)** in the species list.

Expected:
- Tooltip appears with image, common+scientific name (existing behavior).
- A **VU** orange badge appears next to the name.
- A **3-line blurb** describing lions appears below.
- A **"Read more on Wikipedia"** link appears at the bottom and opens externally on click.

Hover over a few more species (Cheetah, Elephant, Spotted Hyena) to confirm consistent rendering.

- [ ] **Step 4: Verify fallback-image behavior**

Find a species in the list whose study has no best-media image (if any in the demo dataset; if none, this step is a visual no-op). Hover and confirm a Wikipedia thumbnail renders in the image slot instead of nothing.

- [ ] **Step 5: No commit (manual verification only)**

---

## Task 10: Documentation updates

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/data-formats.md`
- Modify: `docs/development.md`

- [ ] **Step 1: Update `docs/architecture.md`**

Read the file's existing structure. Add a brief subsection (under wherever shared modules are described) describing `src/shared/speciesInfo/`:

> ### `src/shared/speciesInfo/`
>
> Bundles a static JSON of per-species reference data (IUCN status, short blurb, Wikipedia thumbnail URL, Wikipedia page URL) used by the overview tooltip. The data is generated by `scripts/build-species-info.js` from GBIF + Wikipedia and committed to the repo. Runtime resolution is pure and synchronous via `resolveSpeciesInfo(scientificName)`.

- [ ] **Step 2: Update `docs/data-formats.md`**

Add a section describing the `data.json` shape (lowercase scientific name keys, optional `iucn`/`blurb`/`imageUrl`/`wikipediaUrl` fields). One paragraph + a short JSON example.

- [ ] **Step 3: Update `docs/development.md`**

Find the section on build-time scripts (alongside `dict:build`). Add a paragraph documenting `species-info:build`:

> Refresh the species info bundle:
>
> ```
> npm run species-info:build              # incremental run, fetches missing entries
> npm run species-info:build -- --resume  # skip already-fetched entries
> npm run species-info:build -- --force   # refetch every species
> ```
>
> Run periodically (every ~6 months, or after the common-name dictionary is regenerated) to refresh IUCN statuses and Wikipedia summaries. The script is idempotent and resumable.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md docs/data-formats.md docs/development.md
git commit -m "docs: document species info module and build script"
```

---

## Self-review notes (already applied)

- **Spec coverage:** All four spec sections (script, data.json shape, resolver, tooltip changes) are covered by Tasks 1–8. Build verification (spec §"Build verification") is Task 6. Documentation updates (spec §"Documentation updates") are Task 10. Manual smoke test (spec §"Tests") is Task 9.
- **Open questions in the spec:** intentionally not addressed by this plan — they're deferred decisions, not gaps. The plan picks pragmatic defaults (default IUCN palette in Tailwind tones; no `imageAttribution` field shipped; `--force` refetches everything regardless of age).
- **Type/method consistency:** `resolveSpeciesInfo` is the public function name throughout. The data shape `{ iucn, blurb, imageUrl, wikipediaUrl }` is consistent across the script, resolver, tests, and tooltip.
- **TDD discipline:** Tasks 1–3 (the pure logic) are TDD. Tasks 4–8 are integration / UI work where TDD has poor leverage; verified by smoke test (Task 9) and build verification (Task 6).
