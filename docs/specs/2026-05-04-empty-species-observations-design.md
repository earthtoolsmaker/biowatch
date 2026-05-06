# Empty-species observations: redefining "Blank" and surfacing "Vehicle"

Date: 2026-05-04
Status: Draft, awaiting review
Trigger study: GMU8 Leuven, Belgium

## Problem

Camtrap DP exporters typically attach an observation row with empty
`scientificName` to media that has no detected species, using
`observationType` to indicate why the species is empty. The Camtrap DP
spec defines six values: `animal`, `human`, `vehicle`, `blank`,
`unknown`, `unclassified`.

Today the codebase treats "blank" as _"media with zero observation rows"_
(`getBlankMediaCount`, `species.js:71-100`). Studies whose exporter
attaches a `blank`/`unclassified`/`unknown` row instead are silently
mishandled:

- The annotation rail (`ObservationRow.jsx:63`) shows an em-dash for any
  empty-species row whose `observationType` is not literally `blank` —
  including `unclassified`, `unknown`, and `vehicle`.
- The Library tab "Blank" filter and the Deployments tab species filter
  show no Blank entry, even when most of the study's media is visually
  empty.
- The Vehicle category is invisible across the entire UI.

GMU8 Leuven baseline (~2.5M observations):

| observationType  | scientificName | rows      |
| ---------------- | -------------- | --------- |
| animal           | has species    | 2,162,411 |
| human            | has species    | 39,973    |
| unclassified     | empty          | 281,376   |
| blank            | empty          | 192,941   |
| unknown          | empty          | 28,832    |
| vehicle          | empty          | 6,579     |
| (zero-obs media) | —              | 0         |

`human` always carries a species name (`Homo sapiens`) and needs no
special handling. Empty-species rows currently rendered as "—" total
~310K (`unclassified` + `unknown`).

## Cross-study validation

Spec assumptions checked against all 15 studies currently imported in
the local Biowatch (5 of which are GMU8-style and broken today).

| Study                    | Obs / Media   | Pattern                        | Blank today | Blank (new) | Vehicle |
| ------------------------ | ------------- | ------------------------------ | ----------- | ----------- | ------- |
| GMU8 Leuven (`64294958`) | 2.71M / large | GMU8-style                     | **0** ❌    | ~470K ✓     | 6,579   |
| `2e034359`               | 738K / large  | GMU8-style (dup of `54b660f0`) | **0** ❌    | non-zero ✓  | 860     |
| `54b660f0`               | 738K / large  | GMU8-style (dup of `2e034359`) | **0** ❌    | non-zero ✓  | 860     |
| `2269a895`               | 163K / 163K   | GMU8-style, no vehicle         | **0** ❌    | 54,802 ✓    | 0       |
| `b49cb045`               | 31K / 30K     | Mixed Camtrap-DP               | **0** ❌    | 17,596 ✓    | 0       |
| `e5a77c17`               | 469K / 1.54M  | Image-only + animal            | 1,082,823 ✓ | 1,082,823 ✓ | 0       |
| `ca9faf6c`               | 39K / 37K     | All-animal + sparse zero-obs   | 630 ✓       | 630 ✓       | 0       |
| `403232c9`               | 6.5K / 38K    | Sparse annotations             | 31,792 ✓    | 31,792 ✓    | 0       |
| `1378cb43`               | 0 / 2.4M      | Image-only                     | 2,400,000 ✓ | 2,400,000 ✓ | 0       |
| `99cd9e64`               | 0 / 304K      | Image-only                     | 304,000 ✓   | 304,000 ✓   | 0       |
| `931c0685`               | 210K / —      | Mixed                          | works ✓     | works ✓     | 0       |
| `bd24b0f1`               | 7.3K / —      | Mixed, NULL observationType    | works ✓     | works ✓     | 0       |
| `e1b6a9fe`               | 7.3K / —      | Mixed, NULL observationType    | works ✓     | works ✓     | 0       |
| `6febe0a8`               | 11.9K         | All-animal, no blanks          | n/a         | n/a         | 0       |
| `ccf0fbdc`               | 11.6K         | All-animal, no blanks          | n/a         | n/a         | 0       |

Validation outcomes:

1. **`vehicle` is always empty-species** across the entire corpus
   (~7,439 vehicle rows, all with empty scientificName).
2. **`human` always has a populated scientificName** (~260K rows).
   Confirms no special handling is needed for `human`.
3. **`blank`/`unclassified`/`unknown` always have empty scientificName**
   — the convention claimed at `camtrapDP.js:532-537` holds empirically.
4. **NULL `observationType` exists in real data** (`bd24b0f1`,
   `e1b6a9fe` — 7,269 rows) but always with a populated scientificName,
   so the AND in the blank-observation rule correctly classifies these
   as not-blank.
5. **`b49cb045` exposes a subtle counting trap:** 16,982 blank +
   15 unclassified + 611 unknown = 17,608 empty-species observations,
   but only 17,596 media qualify as blank — meaning ~12 media have
   _both_ a blank-typed observation and an animal observation. The
   media-level `NOT EXISTS (… real species OR vehicle)` query correctly
   excludes those. Implementation must not derive blank-media counts by
   naively counting empty-species observation rows; always group/exist
   at the media level.
6. **No regressions:** every study that today reports a sensible blank
   count (image-only, sparse-annotation, all-animal) reports the same
   count under the new definition.

## Goals

1. The annotation rail labels every observation meaningfully — no "—".
2. "Blank" filters in the Library and Deployments tabs return non-zero
   counts when the underlying media is visually empty, regardless of
   whether the exporter wrote a `blank` row or left the media
   observation-less.
3. Vehicle observations are surfaced as a distinct, filterable category.
4. Existing studies that _do_ leave blank media observation-less (e.g.
   the test fixture, MICA, NACTI) continue to work.

## Non-goals

- Reclassifying or rewriting historical data on import.
- Changing how `human` is handled (it already has a species name).
- A general taxonomy/category system. We are formalising two pseudo-
  species ("Blank", "Vehicle") only.

## Design

### New semantic definitions

**Empty-species observation:** an observation row where `scientificName`
is null or empty.

**Blank observation:** an empty-species observation whose
`observationType` is `blank`, `unclassified`, `unknown`, or null.

**Vehicle observation:** an observation whose `observationType` is
`vehicle`. (Always empty-species in practice.)

**Blank media:** media that has either (a) zero observation rows, or (b)
no observation row that is an animal/human/vehicle observation. In SQL
terms: `NOT EXISTS (SELECT 1 FROM observations o WHERE o.mediaID = m.mediaID
AND (o.scientificName IS NOT NULL AND o.scientificName != '' OR
o.observationType = 'vehicle'))`.

**Vehicle media:** media with at least one vehicle observation. Vehicle
media is _not_ blank media.

A media with both a vehicle observation and a `Sus scrofa` observation
matches both the Vehicle filter and the Sus scrofa filter, and is not
blank.

### Sentinels

Add `VEHICLE_SENTINEL` to `src/shared/constants.js`, mirroring the
existing `BLANK_SENTINEL`. Both are opaque strings used in place of a
real `scientificName` when the renderer asks queries to filter on these
pseudo-species.

### Annotation rail label (`ObservationRow.jsx`)

Replace the current `(observation.observationType === 'blank' ? 'Blank'
: '—')` fallback with:

```js
const fallbackLabel = observation.observationType === 'vehicle' ? 'Vehicle' : 'Blank'
```

Vehicle rows render with the same italic-gray treatment used for blank
rows today (the visual styling already keys on `observationType ===
'blank'`; extend that condition to also match `vehicle`, or factor a
small `isPseudoSpecies` helper).

### `getBlankMediaCount` (`species.js:71-100`)

Replace the current `notExists(any-observation)` query with:

```sql
SELECT COUNT(*) FROM media m
WHERE NOT EXISTS (
  SELECT 1 FROM observations o
  WHERE o.mediaID = m.mediaID
    AND ((o.scientificName IS NOT NULL AND o.scientificName != '')
         OR o.observationType = 'vehicle')
)
```

Add a covering index check: `observations(mediaID, scientificName,
observationType)` should exist or be added if this query becomes slow on
large studies.

### `getSpeciesForDeployment` (`deployments.js:125-150`)

Today it filters out empty `scientificName` and returns nothing for the
blank/vehicle cases. New behavior:

1. Existing query unchanged for real species.
2. Add a second query: count of vehicle media at this deployment, and
   count of blank media at this deployment (using the new "blank media"
   definition above).
3. Append entries for `BLANK_SENTINEL` and `VEHICLE_SENTINEL` to the
   returned array if their counts are > 0.

### `SpeciesFilterButton` (`DeploymentDetailPane.jsx:66`)

The component already iterates the species list. With Blank and Vehicle
entries appended by the query, the rendering loop needs:

- A `SpeciesFilterRow` variant that detects the sentinels and labels
  them "Blank" / "Vehicle" (italic gray, no species tooltip).
- The filter pill behavior is unchanged — selecting a sentinel adds it
  to `selectedSpecies` and the gallery query handles it via the
  existing sequences.js `BLANK_SENTINEL` branch (a parallel
  `VEHICLE_SENTINEL` branch must be added there).

### Sequences/queries that currently filter `observationType != 'blank'`

Audited sites: `best-media.js`, `overview.js`, `species.js`,
`exporter.js`, `sequences.js`. Each currently uses
`(observationType IS NULL OR observationType != 'blank')` as a proxy for
"only real species rows".

Replace with the more precise filter:
`(scientificName IS NOT NULL AND scientificName != '')`.

This is functionally equivalent on data that obeys the existing
convention ("blank-typed rows must have null/empty scientificName" —
see the comment at `camtrapDP.js:532-537`) but no longer relies on
that convention. It also correctly excludes `unclassified` and
`unknown` rows, which today slip through and pollute species
distributions if the exporter ever sets `observationType` to anything
other than `blank` for an empty-species row.

The Vehicle case stays excluded from species distributions (vehicle is
never a "species") — but it IS counted in the new blank/vehicle media
queries. The species DISTINCT in `overview.js` already groups by
scientificName, so empty-string vehicle rows will not create a phantom
species after the new filter is applied.

### `sequences.js` `BLANK_SENTINEL` handling

The existing `requestingBlanks` branch (`sequences.js:64-65`) needs to:

1. Update its blank-detection subquery to use the new "blank media"
   definition (no animal/human/vehicle observation), not just "no
   observation".
2. Add a parallel `requestingVehicle` branch that selects media with at
   least one vehicle observation.
3. Support the mixed cases (species + blank, species + vehicle,
   species + blank + vehicle).

### Library tab `media.jsx`

Today it fetches `blankMediaCount` and adds a `BLANK_SENTINEL` entry to
the species distribution. Add a parallel `vehicleMediaCount` fetch and
append `VEHICLE_SENTINEL` when > 0. The `speciesDistribution.jsx`
component needs the same sentinel-detection / labeling treatment as the
Deployments filter.

### IPC additions

- `species:get-vehicle-count` (mirrors `species:get-blank-count`).
- `deployments:get-species` already returns an array; the new sentinel
  rows are appended inside the existing handler. No new IPC needed for
  the deployment case.

## Migration / data compatibility

No data migration. The change is purely in query semantics and
rendering. Studies that previously rendered "—" rows will now render
"Blank" or "Vehicle" labels and the Blank/Vehicle filter counts will
become non-zero. Studies that already had zero-observation media
(MICA-style) keep working because the new blank-media query still
matches them.

## Testing

E2E test additions:

1. A fixture study where every media has a `blank`-typed observation row
   (no zero-obs media). Assert: blank count > 0, blank filter selects
   those media, no "—" appears in the rail.
2. A fixture study where some media has `unclassified` or `unknown`
   typed rows. Same assertions.
3. A fixture study with vehicle observations. Assert: a Vehicle entry
   appears in both the Library and the Deployments species filters,
   selecting it filters to those media, the rail shows "Vehicle".
4. Regression: a fixture study with mixed species + blank media (true
   zero-obs blanks). Assert: counts and filtering behave as before.

Unit tests for the new "blank media" SQL — verify it correctly excludes
media that has any animal/human/vehicle observation and includes media
that has only blank/unclassified/unknown observations or no observations
at all.

## Documentation updates

- `docs/database-schema.md` — note the new semantic distinctions
  (blank-media, vehicle-media) without changing the schema itself.
- `docs/data-formats.md` — describe how empty-species observation rows
  are interpreted on import and surfaced in the UI.
- `docs/ipc-api.md` — document the new `species:get-vehicle-count` IPC.

## Out-of-scope follow-ups

- An "Other" / human-disturbance category aggregating Vehicle + Human if
  product wants that treatment later.
- Per-study config to choose how to map `unclassified` (some users may
  want it kept distinct from `blank`).
- Surfacing `unclassified`/`unknown` separately from `blank` (current
  decision: collapse all three into "Blank").
