# IUCN Status Boost in Best Captures — Design

## Goal

Lift IUCN-threatened species (CR, EN, VU) higher in the Overview "Best Captures" panel without filtering out healthy populations. A stunning Least Concern shot can still surface; a comparable Endangered shot now beats it. The same signal also breaks ties when a user has more favorited captures than the panel can display.

## Why a new signal

The existing scorer in `src/main/database/queries/best-media.js` already includes a 15% **rarity boost** based on per-study species count (rarer-in-this-dataset → higher). Rarity-in-dataset and IUCN status are correlated but not equivalent: in the African savanna study `0889d172`, _Loxodonta africana_ and _Lycaon pictus_ are common locally but globally Endangered. The current scorer ranks them roughly equal to greater kudu and porcupine; users want them surfaced.

## Scoring change

Add an IUCN component **on top of** the existing composite score (which sums to ≤1.0). With the boost, the maximum possible score becomes 1.25, but only for the most-threatened species — LC/unknown species still cap at 1.0 and remain rankable on quality alone.

| IUCN tier                  | Boost added | Notes                                         |
| -------------------------- | ----------- | --------------------------------------------- |
| CR (Critically Endangered) | **+0.25**   |                                               |
| EW (Extinct in the Wild)   | **+0.25**   | Treated as CR-equivalent                      |
| EX (Extinct)               | **+0.25**   | Same; for consistency, very rare in real data |
| EN (Endangered)            | **+0.18**   |                                               |
| VU (Vulnerable)            | **+0.10**   |                                               |
| NT (Near Threatened)       | **+0.03**   |                                               |
| LC / DD / unknown          | 0           | No boost                                      |

Weights are heavy intentionally: validation showed +5 threatened captures across 21 study DBs at these values, with the African case displacing 3 LC species to make room for elephant, wild dog, and Cape buffalo. Lighter weights (e.g. CR=+0.10) would only consolidate existing rarity-driven picks, not introduce new behavior.

The values are tunable. They live in a single named constant so the user can iterate based on visual feedback in the Overview tab.

### Constant location

```js
// src/main/database/queries/best-media.js (top of file)
const IUCN_BOOST = Object.freeze({
  CR: 0.25,
  EW: 0.25,
  EX: 0.25,
  EN: 0.18,
  VU: 0.1,
  NT: 0.03
})
```

Only `getBestMedia` consumes the constant (the favorites and auto-scored paths both reference the same map). `getBestImagePerSpecies` does not — see _What does not change_ below for the reasoning. No env var, no settings UI in v1 — change the constant, rebuild.

## Implementation — inline CASE injection

The IUCN dictionary lives in JS (`src/shared/speciesInfo/data.json`, ~2.8k species). The fastest way to incorporate it into the existing query is to inject a `CASE WHEN scientificName IN (...) THEN <boost> ... END` term into the existing `species_counts` CTE, scoped to species actually present in the study.

### Steps inside `getBestMedia`

1. **Collect distinct species** in the study (cheap, uses the existing `idx_observations_scientificName` index):
   ```sql
   SELECT DISTINCT scientificName FROM observations
   WHERE scientificName IS NOT NULL AND scientificName != ''
   ```
2. **In JS**, normalize each name via `normalizeScientificName` (already in `src/shared/commonNames/normalize.js`), look up its IUCN tier via `resolveSpeciesInfo`, and group by tier:
   ```js
   const byTier = { CR: [], EN: [], VU: [], NT: [], EW: [], EX: [] }
   for (const { scientificName } of distinctSpecies) {
     const info = resolveSpeciesInfo(scientificName)
     if (info?.iucn && byTier[info.iucn]) byTier[info.iucn].push(scientificName)
   }
   ```
3. **Build the IUCN CASE expression** as a string from the grouped lists, with each species name passed as a bound parameter (no string interpolation of names — SQL injection safety):
   ```js
   function buildIucnCase(byTier) {
     const branches = []
     const params = []
     for (const tier of ['CR', 'EW', 'EX', 'EN', 'VU', 'NT']) {
       const names = byTier[tier]
       if (names.length === 0) continue
       const placeholders = names.map(() => '?').join(',')
       branches.push(`WHEN o.scientificName IN (${placeholders}) THEN ${IUCN_BOOST[tier]}`)
       params.push(...names)
     }
     if (branches.length === 0) return { expr: '0', params: [] }
     return { expr: `CASE ${branches.join(' ')} ELSE 0 END`, params }
   }
   ```
4. **Inject** the expression into the existing `scored_observations` CTE as a new column `iucnBoost`, and add `+ iucnBoost` to the composite-score formula in `scored_with_formula`. The IUCN params are bound _before_ the existing query params (`favoriteMediaIDs`, `candidatesPerSpecies`).

### Why not a JOIN against a temp table or `json_each`

Both work, but a `CASE ... IN (?, ?, ?)` over tens-to-low-hundreds of names compiles to a hash lookup in SQLite and is essentially free. The CASE form keeps the new logic visible inline next to `rarityScore` and `daytimeScore`, which is where a future maintainer will look for it.

### Performance budget

Validation across 21 studies with bbox data:

- Distinct-species probe: <5 ms in all studies (one indexed scan, ~50 species typical).
- Main scoring SQL: 1–215 ms, dominated by the existing four-CTE chain. The added IUCN CASE adds no measurable cost — the extra CASE evaluates per-row alongside the rarity, daytime, and visibility CASEs.
- JS post-processing (lookup + tier grouping): <1 ms.

The user's "keep the query fast" constraint is satisfied: total added cost is under 5 ms, dominated by the distinct-species probe.

### Scaling considerations

The CASE expression embeds one bound parameter per IUCN-tagged species in the study. SQLite (3.53.0 in the bundled `better-sqlite3`) caps bound parameters at **32,766 per query**.

Empirical worst case across all 56 local study DBs (measured on 2026-05-02):

- Max IUCN-tagged species in a single study: **20** (study `016c3718`, 119 total species).
- Average across studies: 3 tagged.
- The largest study by species count (`d2e07fd2`, 256 species) has only 6 tagged.

Headroom is ~1,600× the worst real-world case. Even a hypothetical future study importing every threatened mammal/bird in the dictionary (~1,000 species) would sit at ~30× headroom. No defensive `json_each` fallback is added — it would trade complexity for a scenario the data shows does not occur.

## Favorites — over-limit ordering

Today, user-marked favorites in Best Captures are returned `ORDER BY f.timestamp DESC LIMIT ?`. When a user has more favorites than the panel can display, the older threatened-species favorites get pushed off in favor of recent LC ones.

**Change:** when _and only when_ the user has more favorited captures than the panel's `limit`, the favorites query orders by IUCN tier first, then timestamp DESC within tier. The IUCN CASE expression is built the same way as in the auto-scored path (positional `?` bound parameters per name), then injected into both the projection (so the score is observable for debugging) and the ORDER BY:

```sql
-- pseudo-form; actual query reuses the existing favorites CTE structure
SELECT ..., <iucn_case_expr> AS iucnBoost
FROM ...
ORDER BY iucnBoost DESC, f.timestamp DESC
LIMIT ?
```

When `COUNT(favorite=1) ≤ limit`, the existing `ORDER BY f.timestamp DESC` query is used unchanged — every favorite displays, in chronological order. The user's curated set is never reordered when it fits.

The decision is made with a bounded probe rather than a `COUNT(*)`, which would require a full scan of `media` (no index on `favorite`):

```sql
SELECT 1 FROM media WHERE favorite = 1 LIMIT ?  -- bind: limit + 1
```

If the result has ≤ limit rows, take the original timestamp-DESC path. If it has limit + 1 rows, the user is over-limit — take the IUCN-aware path. The probe stops scanning as soon as it finds limit + 1 favorite rows, so it's bounded regardless of `media` table size.

The same `IUCN_BOOST` constant drives both this and the auto-scored path. One knob, two consumers.

### Why not "boost + recency" as an additive score for selection

A weighted combination (e.g. `iucnBoost + recencyScore * w`) is hard to tune: small `w` collapses to tier-first; large `w` lets recent LC favorites push out older threatened ones (the exact failure mode this is fixing). Strict tier-first with timestamp as tie-breaker is simpler, deterministic, and matches the design intent of "threatened favorites aren't lost in over-limit studies."

## What does _not_ change

- **Diversity selection** (`selectDiverseMedia`): unchanged. Still max 2 per species, 3 per deployment, 4 per weekly bucket, 1 per sequence. A study with three CR species can still only contribute 6 of those 12 slots — the rest go to LC/NT/etc. for variety.
- **Favorites-first behavior**: unchanged. Favorites still come before any auto-scored capture in the final result list. Their composite score (`999.0`) is unchanged. Only the _intra-favorites_ ordering changes when over-limit.
- **Filtering**: no species is ever filtered _out_ by IUCN. The boost is additive and bounded, so an LC capture with a perfect score (1.0) still beats a poor-quality EN capture (~0.50 + 0.18 = 0.68).
- **`getBestImagePerSpecies`**: this function returns the best image _per species_, used for hover tooltips. The IUCN boost would not change the per-species winner (the boost is constant within a species), so this function does **not** need the change. It stays untouched.

## Validation summary (informational, not part of the spec contract)

Run on 56 study DBs from the local Biowatch install on 2026-05-02:

| Metric                                                | Value                                     |
| ----------------------------------------------------- | ----------------------------------------- |
| Studies with usable bbox data                         | 21 / 56                                   |
| Total threatened-species captures in top-12 (orig)    | 25                                        |
| Total threatened-species captures in top-12 (boosted) | 30                                        |
| Net Δ across all studies                              | **+5**                                    |
| Studies where any slot changed                        | 4                                         |
| Max slots changed in a single study                   | 3                                         |
| Slowest scoring SQL                                   | 215 ms (`69b7c525`, 64 k obs, 48 species) |

Examples of swaps observed:

- `0889d172` (Africa, 45 spp.): drops kudu, porcupine, spotted hyena (LC); adds African elephant, African wild dog (EN), Cape buffalo (NT).
- `930d4ecb` (9 spp.): drops a generic family-level "rabbit and hare" entry (no IUCN match); adds _Oryctolagus cuniculus_ (EN). Side effect: prefers species-level over family-level annotations when both exist.
- `69b7c525` (birds, 48 spp.): only NT (Nicobar pigeon) surfaces, because the IUCN dictionary has thinner bird coverage. Not a design issue — flagged as a data-coverage observation.

## Tests

- **Boost magnitude** in `test/best-media.test.js` (or sibling): given a fixed candidate set with mixed IUCN tiers, verify each tier's boost is applied with the documented magnitude and that ordering shifts as expected.
- **`buildIucnCase` shape — non-empty**: given `byTier = { CR: 5_names, EN: 10_names, VU: 20_names, NT: 5_names, EW: [], EX: [] }`, assert `params.length === 40`, `(expr.match(/WHEN/g) || []).length === 4`, and that `expr` contains `ELSE 0 END`.
- **`buildIucnCase` shape — empty**: given all-empty `byTier`, assert `expr === '0'` and `params.length === 0` (no CASE machinery emitted, no zero-arg `IN ()` syntax error).
- **Synthetic large-N scaling**: synthesize an in-memory DB with 1,000 distinct species, all marked threatened via a stubbed IUCN map. Run `getBestMedia`. Assert it does not throw "too many SQL variables", returns ≤ limit results, and completes in <500 ms. Cap at 1,000 not 32k — the goal is "an order of magnitude beyond any realistic case," not the absolute SQLite limit.
- **Property — boost cap holds**: a top-12 result set under the IUCN boost should never exclude a species that was in the orig top-12 _and_ has a higher original quality score than the threatened replacement minus its boost.
- **Regression**: existing `getBestMedia` tests must still pass with `IUCN_BOOST` set to all-zero values (boost off → identical output to today).
- **Favorites over-limit**: synthesize a DB with `limit + 5` favorited media spanning multiple IUCN tiers and timestamps. Assert that the returned favorites are tier-first then timestamp-DESC. With `limit` favorites or fewer, assert ordering is timestamp-DESC unchanged.

## Out of scope

- A user-facing settings panel to tune weights.
- Hard quotas (e.g. "always include ≥2 threatened species").
- IUCN signals on the Deployments tab, Media tab, or Activity tab.
- Filling IUCN dictionary gaps (especially birds) — handled separately by the species-info build pipeline.

## Future hook

The user has signaled that weights may be tweaked after seeing the result in the running app. The single `IUCN_BOOST` constant is the only knob. If at some point we want per-study tuning (e.g. heavier boost for studies dominated by LC species), that goes through a separate spec.
