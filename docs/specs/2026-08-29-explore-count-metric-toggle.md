# Explore count metric toggle: N ind. / N obs.

**Date:** 2026-08-29  
**Status:** Draft design  
**Area:** Explore renderer + sequence-aware analytics (`src/renderer/src/explore.jsx`, `src/main/services/sequences/`, `src/main/database/queries/species.js`)

## Summary

Add a count-metric toggle to Explore so users can switch the species distribution,
map, and activity charts between the two metrics used by the reference scientist:

- **N ind.** — the current sequence-adjusted individual-detection metric. Within each
  sequence, a species contributes the largest same-species detection count found in one
  media item. Those per-sequence maxima are summed.
- **N obs.** — independent species observations. A species contributes exactly `1` for
  each sequence in which it is present, regardless of how many individuals or media
  items occur in that sequence.

The sequence definition does not change. The existing sequence-gap setting, imported
`eventID` behavior, null-timestamp handling, date/time filters, and area filter continue
to determine which media belong to each aggregation.

## Terminology and formulas

For a species `s`, media item `m`, and sequence `q`:

```text
currentFrameCount(s, m) = number of observation rows for s on m

N ind.(s, q) = MAX(currentFrameCount(s, m)) for media m in q
N obs.(s, q) = 1 if s occurs anywhere in q, otherwise 0

Displayed total = SUM(metric(s, q)) across qualifying sequences q
```

Example:

```text
Sequence 1, deer counts by frame: 2, 5, 3
Sequence 2, deer counts by frame: 4, 2

N ind. = MAX(2, 5, 3) + MAX(4, 2) = 5 + 4 = 9
N obs. = 1 + 1 = 2
```

When a sequence contains multiple species, each species is evaluated independently. A
sequence containing deer and fox contributes one observation to deer and one observation
to fox in **N obs.** mode.

In user-facing explanatory text, call N obs. **independent observations** to distinguish
it from database observation rows and individual media files.

## Goals

- Let Explore users switch between individual-detection magnitude and independent
  species-observation frequency.
- Apply the selected metric consistently to the species rail, map, timeline, and daily
  activity charts.
- Preserve the current **N ind.** output as the default, including its existing edge
  cases and data-source behavior.
- Keep species selection, date/time filters, area filters, map viewport, and map encoding
  unchanged when the metric changes.
- Keep SQL fast paths and worker-thread execution so large studies remain usable.
- Make it impossible for cached N ind. values to be presented as N obs., or vice versa,
  while a replacement query is loading.

## Non-goals

- Do not estimate unique animals or population size.
- Do not change how sequences are formed.
- Do not change the sequence-gap slider or imported-event behavior.
- Do not fix the existing handling of Camtrap DP's `observations.count` field as part of
  this feature (see Caveats).
- Do not change Gallery membership or pagination; the toggle changes analytical counts,
  not which media match the current species/date/time/area filters.
- Do not add the toggle to Overview or Media in v1.
- Do not add a database column or migration for the selected metric.
- Do not add effort normalization, occupancy, relative abundance indices, or confidence
  intervals.

## Behaviour decisions

| Decision | Choice |
| --- | --- |
| Default mode | **N ind.**, preserving current Explore behavior. |
| N obs. unit | One species-positive sequence, not one media item and not one database observation row. |
| Scope | Species rail, map, timeline, daily activity charts, and Explore species hovercard activity charts. |
| Sequence boundaries | Reuse the existing sequence/event grouping exactly. |
| Filters | Apply filters with the same ordering and boundaries as the existing queries. |
| Species selection | Preserve selected scientific names when switching modes; do not reselect the top species. |
| Persistence | Store per study in localStorage; this is a display/analysis preference, not study metadata. |
| Other tabs | Existing callers continue to use N ind.; no toggle is added outside Explore in v1. |
| Loading | Never label previous-mode placeholder data as the newly selected mode. Show the relevant loading state until mode-matching data is available. |
| Map encodings | Composition, abundance, density, and hex grid all use the selected metric. |
| Normalized charts | Keep current per-species peak normalization; the selected metric changes the input series, not the normalization behavior. |

## User experience

### Toggle

Add a compact two-option segmented control near the sequence-gap control in Explore's top
**Data + filters** group:

```text
N ind. | N obs.
```

Use accessible full labels and tooltips:

- **N ind. — Individuals**: “Maximum detections of the species in one frame per
  sequence, summed across sequences.”
- **N obs. — Independent observations**: “Number of sequences in which the species was
  observed. Each sequence contributes once.”

The short labels come from the scientist's terminology, but the tooltip must explain that
N ind. is not a unique-animal count and N obs. is sequence-based.

The control should expose `aria-label="Count metric"` and each option should expose its
expanded name. Keyboard interaction should follow the project's existing segmented-control
pattern.

### Persistence

Add a small renderer hook, for example `useExploreCountMetric(studyId)`, with:

```text
localStorage key: exploreCountMetric:<studyId>
values: "individuals" | "observations"
default: "individuals"
```

Unknown or stale stored values resolve to `"individuals"`.

### Loading and transitions

Switching the metric changes several expensive query keys. Existing queries use
`placeholderData: (prev) => prev`; reusing that data across metric changes would briefly
show N ind. values under an active N obs. label. Placeholder reuse must therefore be
metric-aware:

- Previous data may be retained for changes that do not change the metric if desired.
- Previous data from another metric must not be rendered as current.
- The species rail and map should use their existing loading/skeleton treatment until
  results for the selected metric arrive.
- Selected species remain selected by `scientificName`, even while count data reloads.

A response does not need to carry the metric if React Query keys and stale-result guards
make the association unambiguous, but including `countMetric` in a structured response is
acceptable if it simplifies guarding.

## Data semantics by surface

### Species distribution

Aggregate the selected metric by species across all sequences that pass the current area
filter. Sort by the resulting count, as today.

- N ind.: sum the current per-sequence maxima.
- N obs.: count distinct qualifying sequences containing the species.

### Timeline

Aggregate by the existing weekly bucket and species.

- N ind.: current sequence-adjusted count in each week.
- N obs.: number of species-positive sequences in each week.

Keep the current per-species peak normalization before rendering. Consequently, the line
height is relative in both modes; it is not a visible raw y-axis count. The metric still
changes the temporal shape because a sequence with many detections has weight greater than
one only in N ind. mode.

### Daily activity

Although the original request names distribution, timeseries, and map, daily activity is
also driven by the same sequence-aware count pipeline. It must follow the toggle to avoid
showing two count definitions simultaneously in Explore.

Aggregate N obs. in the same hour bucket currently used by N ind. Preserve existing
handling of sequences that touch bucket boundaries rather than redefining attribution in
this feature.

### Map

Aggregate the selected metric by species and location after applying the existing species,
date, and time-of-day filters.

- Composition slices and hovercard percentages use the selected metric.
- Raw map hovercard counts use the selected metric.
- Composition and abundance marker sizes use the selected metric total.
- The dominant species in abundance mode is selected using the chosen metric.
- Density and hex-grid intensity use the chosen metric total.
- Cluster counts are sums of the already aggregated child-location values, as today.

Map labels/tooltips should avoid a fixed “individuals” or “observations” noun unless they
receive the active mode. Where a noun is shown, use the expanded active label.

### Explore species hovercards

The activity queries started by `SpeciesTooltipContent` must receive the Explore metric so
the hovercard timeline and daily activity charts agree with the main Explore charts. The
same component used outside Explore defaults to N ind. unless its caller explicitly passes
a metric.

## Architecture

### Shared metric value

Use one canonical enum-like value throughout the renderer, preload, IPC, worker, query,
and JS aggregation paths:

```js
'individuals' | 'observations'
```

Call the field `countMetric` consistently. Keep display abbreviations (`N ind.`, `N obs.`)
out of backend code.

Validate the value at the IPC or worker boundary. Missing values resolve to
`"individuals"` so existing Overview and Media callers retain current behavior. Invalid
explicit values should return an error rather than silently selecting a different metric.

### Renderer and cache keys

In `src/renderer/src/explore.jsx`:

- Read `countMetric` from the per-study hook.
- Include it in every affected React Query key:
  - `sequenceAwareSpeciesDistribution`
  - `sequenceAwareTimeseries`
  - `sequenceAwareHeatmap`
  - `sequenceAwareDailyActivity`
- Pass it through each corresponding preload call.
- Include it in any map remount/data identity key such as `geoKey` where needed to prevent
  old marker aggregation from surviving a mode switch.
- Pass it through `SpeciesDistribution` to Explore hovercard activity queries.
- Preserve selection by scientific name; a metric-driven reorder must not reset selection.

### Preload, IPC, and worker

Thread `countMetric` through the four sequence-aware APIs as an optional trailing argument
(or migrate those calls to an options object if done consistently):

- species distribution
- timeseries
- heatmap
- daily activity

`src/main/ipc/sequences.js` passes the validated value to `runInWorker`. The worker passes
it to both the SQL fast path and any JS fallback. Logging should include the metric so
performance and parity failures can be diagnosed, for example:

```text
[seq-worker:heatmap] start gap=60 metric=observations ...
```

### JavaScript aggregation path

Extend the shared sequence aggregation helper rather than creating a separate grouping
implementation. Sequence formation should run once; only the per-sequence contribution
changes:

```text
individuals:
  for each species in sequence, add max per-media species count

observations:
  for each distinct species present in sequence, add 1
```

Null/invalid-timestamp media retain current treatment as single-media sequences. In N obs.
mode, each such media contributes at most one per species.

`calculateSequenceAwareTimeseries` and `calculateSequenceAwareHeatmap` pass the metric to
the shared helper so their fallback behavior stays aligned with distribution.

### SQL aggregation paths

Keep dedicated SQL paths for the current sequence modes instead of forcing N obs. through
the raw-row JS fallback:

- **Positive time gap:** after sequence IDs are assigned, N obs. counts distinct
  `(species, sequence)` groups in the current outer bucket/location.
- **Imported eventID path:** N obs. counts distinct species/event keys. Media without a
  usable event ID retain their existing single-media event key.
- **Per-media path:** N obs. counts distinct species/media pairs.

For each query, retain its current dimensions:

| Query | N obs. grouping dimensions |
| --- | --- |
| Distribution | species + sequence/event/media key |
| Timeseries | species + week + sequence/event/media key |
| Daily activity | species + hour + sequence/event/media key |
| Map | species + latitude/longitude + sequence/event/media key |

Then count those groups in the outer aggregation. Do not use SQL
`COUNT(DISTINCT concatenated_string)` where structured `GROUP BY` CTEs can avoid separator
collisions and make null behavior explicit.

SQL and JS paths must remain semantically equivalent for every supported sequence-gap
path. Existing known ordering tolerances in the positive-gap heatmap SQL path are not
expanded by this feature.

## Existing caveats retained intentionally

### Camtrap DP aggregate `count` is not currently honored

The observations table has an `observations.count` field, but the current sequence-aware
queries derive a per-media species count with `COUNT(observationID)`. Therefore:

- Multiple object-detection rows for one species/media act as a proxy for the number of
  individuals in that frame.
- One imported Camtrap DP row with `count = 5` currently contributes `1`, not `5`, to
  N ind.

This feature deliberately defines N ind. as **the current implementation** and does not
change that behavior. Supporting both representations correctly would require a separately
reviewed change such as per-media/species `SUM(COALESCE(observations.count, 1))`, together
with checks for duplicate or competing annotation sets. Record this limitation in code
comments and user-facing help where appropriate, but do not fold that data-model change
into this toggle.

N obs. is not affected by the magnitude of `observations.count`: one qualifying sequence
still contributes one observation for that species.

### N ind. is not unique individuals

N ind. sums sequence-level maxima. The same physical animal can contribute again in a
later sequence, at another camera, or after a filter boundary. The metric must not be
called population, unique animals, or absolute abundance.

### N obs. does not mean observation rows

N obs. counts species-positive sequences. It does not count:

- rows in the `observations` table,
- bounding boxes,
- media files when multiple media are grouped into one sequence, or
- unique animals.

### Existing bucket/filter semantics remain

Timeseries and daily-activity queries currently perform sequence aggregation within their
existing temporal buckets, and map aggregation applies its current date/time filtering
before or as part of sequence aggregation. This design preserves those semantics. Any
future decision about assigning a cross-boundary sequence to one canonical timestamp is a
separate feature.

## Performance

- Keep all heavy work in the existing sequence worker.
- Keep SQL aggregation for N obs.; do not load all per-media rows merely because a new
  metric was selected.
- Add `countMetric` to query keys so each mode has a separate cache entry. Switching back
  can reuse the completed result for that exact study/species/filter/gap/mode tuple.
- Do not run both metrics eagerly. Fetch only the selected mode.
- Profile distribution, timeseries, heatmap, and daily activity on a large study for both
  metrics. N obs. should generally return the same result shape and similar or lower IPC
  volume than N ind.
- Preserve the current query gating so a mode switch does not cause duplicate requests
  with unsettled species or sequence-gap inputs.

## Testing

### Aggregation unit tests

Using the same fixture for both modes, verify:

1. Frames `2, 5, 3` in one sequence and `4, 2` in another produce N ind. `9` and N obs.
   `2`.
2. Multiple species in one sequence each contribute one N obs.
3. Repeated media for one species in one sequence do not increase N obs.
4. Separate deployments/time-gap sequences increase N obs. separately.
5. Imported `eventID` grouping counts one per species/event.
6. Media without event IDs follow the existing single-media fallback.
7. Null/invalid-timestamp media each act as their own sequence.
8. N ind. results are unchanged from existing snapshots/tests.

### SQL/JS parity tests

For distribution, timeseries, and map, compare SQL results with the JS pipeline for both
metrics across:

- no grouping/per-media,
- imported eventID grouping,
- positive time-gap grouping where both paths exist,
- multiple species per media,
- null timestamps,
- area/date/time filters.

Add direct daily-activity SQL assertions for both metrics and all existing gap paths.

### Renderer tests

- Default is N ind. when no preference exists.
- The selected metric persists per study and does not leak to another study.
- Every affected query key and API call receives `countMetric`.
- Switching metrics preserves selected species and active filters.
- Previous-mode placeholder data is not rendered under the new mode.
- Switching back can reuse the correct cached result.
- Explore species hovercard activity queries use the active mode.
- Accessible names expose “Individuals” and “Independent observations,” not only
  abbreviations.

### Manual acceptance scenario

With a fixture containing two deer sequences (`2,5,3` and `4,2`):

- N ind. shows `9` in the species rail and relevant map aggregation.
- N obs. shows `2`.
- The map's hovercard, marker magnitude/composition, density encodings, timeline, and
  daily activity all change consistently.
- Species selection, date/time filters, area filter, map viewport, and encoding remain
  unchanged during the switch.
- Rapidly toggling does not show values under the wrong active label and does not crash or
  leave stale markers.

## Implementation steps

Each step is a small testable deliverable rather than a frontend/backend layer split.

1. **Define and test the metric semantics in the shared JS aggregator.** Add the metric
   argument and unit tests for N ind. regression and N obs. sequence-presence behavior.
2. **Deliver distribution end to end.** Add SQL support, worker/IPC/preload threading,
   the persisted toggle, metric-aware caching/loading, and species-rail tests. At this
   point the rail alone can be manually verified with the `9` vs `2` fixture.
3. **Add the timeline and daily-activity surfaces.** Thread the metric through both query
   paths, preserve normalization, update Explore hovercards, and add parity/integration
   tests.
4. **Add all map encodings.** Apply the metric to location aggregation, marker and cluster
   hovercards, composition/abundance sizing, and density/hex intensity; verify stale map
   data cannot survive a mode switch.
5. **Polish terminology and documentation.** Add accessible tooltips/help text, document
   the retained Camtrap DP `count` caveat, and profile both modes on a large study.

## Anticipated affected files

- `src/renderer/src/explore.jsx` — metric state, toggle placement, query keys/API calls,
  map identity, and hovercard propagation.
- `src/renderer/src/hooks/useExploreCountMetric.js` — per-study localStorage preference.
- `src/renderer/src/ui/CountMetricToggle.jsx` — accessible segmented control and help text.
- `src/renderer/src/ui/speciesDistribution.jsx` — pass the active mode to Explore species
  hovercards.
- `src/renderer/src/ui/SpeciesTooltipContent.jsx` — mode-aware activity query keys/calls.
- `src/preload/index.js` — sequence-aware API signatures.
- `src/main/ipc/sequences.js` — validation and worker payloads.
- `src/main/services/sequences/worker.js` — route the metric through SQL and JS paths.
- `src/main/services/sequences/speciesCounts.js` — shared N ind./N obs. aggregation.
- `src/main/database/queries/species.js` — SQL implementations for distribution,
  timeseries, heatmap, and daily activity.
- `test/main/services/sequences/speciesCounts.test.js` — metric semantics.
- `test/main/database/queries/sequenceAwareSpeciesCountsSQL.test.js` and relevant query
  integration tests — SQL parity and filter behavior.
- Renderer tests for the new hook/toggle and Explore query wiring.
- `website/docs/guides/exploring-data.md` — user-facing metric definitions and caveat.
