# Explore analysis metrics: N ind. / N obs. / RAI ind. / RAI obs.

**Date:** 2026-08-29
**Status:** Draft design
**Area:** Explore renderer + sequence-aware analytics (`src/renderer/src/explore.jsx`, `src/main/services/sequences/`, `src/main/database/queries/species.js`)
**Extends:** `docs/specs/2026-08-29-explore-count-metric-toggle.md`

## Summary

Extend Explore's existing N ind. / N obs. selector to expose four analysis metrics:

- **N ind.** — sequence-adjusted individual detections.
- **N obs.** — independent species observations (species-positive sequences).
- **RAI ind.** — N ind. per 100 effective camera-days.
- **RAI obs.** — N obs. per 100 effective camera-days.

The four choices are the product of two independent dimensions:

```js
{
  counting: 'individuals' | 'observations',
  normalization: 'none' | 'RAI100'
}
```

The complete metric object is the canonical value. The renderer stores the object as JSON
in localStorage, includes its primitive properties in query keys, and passes the object
through preload, IPC, worker, and query options. Process and persistence boundaries validate
the complete object before use.

RAI is an effort-normalized encounter index. Neither RAI mode estimates unique animals,
population size, or density.

## Existing behavior

Explore currently has two count metrics defined in `src/shared/countMetric.js`:

```text
individuals  → N ind.
observations → N obs.
```

The renderer stores a string preference in `exploreCountMetric:<studyId>` and threads it
through four sequence-aware APIs:

- species distribution,
- weekly timeseries,
- map/heatmap aggregation,
- daily activity.

The sequence-aware SQL and JavaScript paths switch their per-sequence contribution using
that string. Other pages that call the species-distribution API omit the metric and receive
N ind.

This design replaces that one-dimensional count setting with a two-dimensional analysis
metric. Sequence formation and individual/observation counting remain the responsibility
of the existing N ind. / N obs. paths. Effort normalization is an additional stage.

## Terminology and formulas

For species `s`, media item `m`, sequence `q`, and effective camera effort `E`:

```text
frameCount(s, m) = number of observation rows for s on m

N ind.(s, q) = MAX(frameCount(s, m)) for qualifying media m in q
N obs.(s, q) = 1 if s occurs in any qualifying media in q, otherwise 0

N ind.(s) = SUM(N ind.(s, q))
N obs.(s) = SUM(N obs.(s, q))

RAI ind.(s) = 100 × N ind.(s) / E
RAI obs.(s) = 100 × N obs.(s) / E
```

`E` is measured in effective camera-days, where one camera-day is 24 hours of qualifying
camera operation. Partial days remain fractional; no rounding occurs before division.

Example:

```text
Two deer sequences:
  Sequence 1 frame counts: 2, 5, 3
  Sequence 2 frame counts: 4, 2

N ind. = 5 + 4 = 9
N obs. = 1 + 1 = 2

Effective camera effort = 40 camera-days
RAI ind. = 100 × 9 / 40 = 22.5
RAI obs. = 100 × 2 / 40 = 5.0
```

User-facing expanded names:

| Short label | Expanded label                       | Unit                                         |
| ----------- | ------------------------------------ | -------------------------------------------- |
| N ind.      | Individuals                          | sequence-adjusted individual detections      |
| N obs.      | Independent observations             | species-positive sequences                   |
| RAI ind.    | Individual relative abundance index  | individual detections per 100 camera-days    |
| RAI obs.    | Observation relative abundance index | independent observations per 100 camera-days |

RAI obs. is the more conventional camera-trap encounter-rate index. RAI ind. weights an
encounter by the largest group size visible in a frame and is therefore more sensitive to
social/group-living species. Both labels must remain explicit about the counting basis.

## Goals

- Provide all four combinations of individual/observation counting and raw/effort-normalized
  output.
- Keep the metric represented as a self-describing object throughout the application.
- Apply the selected metric consistently to the Explore species rail, map encodings,
  timeline, daily activity, and Explore species hovercards.
- Calculate effort at the same spatial and temporal scope as each raw count.
- Preserve current N ind. and N obs. results exactly when normalization is `none`.
- Preserve sequence-gap, imported `eventID`, null-timestamp, bucket, and filter semantics
  except where RAI requires an event to be attributable to valid camera effort.
- Keep raw count and effort available separately wherever results may be aggregated again.
- Keep heavy aggregation in the existing worker and SQL fast paths.
- Prevent stale data from one metric object being displayed under another metric label.

## Non-goals

- Do not estimate unique animals, population abundance, density, occupancy, or detection
  probability.
- Do not add confidence intervals or statistical significance testing.
- Do not infer camera downtime from gaps between media files.
- Do not add an internal downtime/operational-period table in this version.
- Do not change sequence formation or the sequence-gap slider.
- Do not change Gallery membership or pagination.
- Do not add these metrics to Overview, Media, or Deployments in this version.
- Do not silently change Deployment-page sparklines from raw observation counts.
- Do not fix the existing Camtrap DP aggregate `observations.count` caveat as part of this
  feature.
- Do not add a database migration for the metric preference.

## Behavior decisions

| Decision                           | Choice                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Default metric                     | `{ counting: 'individuals', normalization: 'none' }` (N ind.).                                                                           |
| RAI multiplier                     | 100 camera-days.                                                                                                                         |
| Camera-day                         | 24 hours of effective operation; partial days are fractional.                                                                            |
| Sampling unit                      | Each valid deployment interval represents one operating camera. Simultaneous co-located deployments contribute separately.               |
| Downtime                           | Deployment start→end is assumed continuously active; known downtime must be represented by separate deployment intervals in source data. |
| Valid interval                     | Both deployment dates parse, and `deploymentEnd > deploymentStart`.                                                                      |
| Numerator eligibility in RAI modes | Media must have a valid timestamp attributable to a valid deployment and fall inside the effective deployment/filter interval.           |
| Missing effort                     | RAI is unavailable (`null`), never zero or infinity.                                                                                     |
| Spatial filters                    | Both raw count and effort use the same qualifying deployments/bounds.                                                                    |
| Date filters/buckets               | Deployment intervals are clipped to the selected date range or bucket.                                                                   |
| Time-of-day filters                | Effective effort is the operational duration intersecting the selected recurring hour ranges.                                            |
| Persistence                        | Store the complete metric object per study in localStorage.                                                                              |
| Other pages                        | Continue to request N ind.; no page-global metric preference.                                                                            |
| Sorting                            | Sort by displayed value; unavailable values sort after available values, with raw count order as a stable fallback.                      |
| Formatting                         | Raw metrics use integers; RAI uses one decimal by default.                                                                               |
| Loading                            | Never reuse data produced for a different counting mode or normalization.                                                                |

## Metric object

### Shape

Add a shared metric module, replacing the current one-dimensional count-metric constants:

```js
export const COUNTING_INDIVIDUALS = 'individuals'
export const COUNTING_OBSERVATIONS = 'observations'

export const NORMALIZATION_NONE = 'none'
export const NORMALIZATION_RAI_100 = 'RAI100'

export const DEFAULT_ANALYSIS_METRIC = Object.freeze({
  counting: COUNTING_INDIVIDUALS,
  normalization: NORMALIZATION_NONE
})
```

A metric is valid only when:

```text
counting ∈ { individuals, observations }
normalization ∈ { none, RAI100 }
```

The validator returns an exact normalized object containing only those two properties.
Explicit malformed values are rejected. Missing values at generic API boundaries resolve
to the default so callers outside Explore retain N ind.; Explore always sends its selected
object explicitly.

Do not attach display labels, formatting functions, filter state, or effort values to the
metric object. It describes calculation semantics only.

### Equality and React identity

Metric equality is structural:

```js
left.counting === right.counting && left.normalization === right.normalization
```

Renderer state should keep one stable object reference until the user chooses another
option. Code must not mutate a metric object in place.

React Query keys use primitive fields explicitly rather than object identity:

```js
;[
  'sequenceAwareHeatmap',
  studyId,
  // existing filters...
  metric.counting,
  metric.normalization
]
```

The same two fields must be added to any derived identity such as `geoKey` and Explore
species-hovercard query keys.

## Persistence

Replace `useExploreCountMetric` with `useExploreMetric` (or rename it equivalently).

```text
localStorage key: exploreAnalysisMetric:<studyId>
value: JSON.stringify({ counting, normalization })
default: { "counting": "individuals", "normalization": "none" }
```

Read behavior:

1. Read the per-study key.
2. Parse inside `try/catch`.
3. Validate both properties and reject unknown properties.
4. Use the default object when the key is absent, malformed, or invalid.

Write behavior:

1. Validate the requested object.
2. Serialize only `counting` and `normalization`.
3. Replace renderer state with the validated object.

The old string-valued `exploreCountMetric:<studyId>` preference is not migrated. Existing
users return to N ind. once when this feature ships; the old key is no longer read.

## Effective camera effort

### Base interval

A deployment contributes effort only when both `deploymentStart` and `deploymentEnd` are
valid and the end is later than the start.

```text
deployment effort = deploymentEnd - deploymentStart
```

Intervals use half-open `[start, end)` semantics so adjacent intervals and buckets do not
double-count a boundary instant.

Do not use `getOverviewStats().cameraDays` for RAI. That field is rounded for display and
has no area, date, location, week, or hour scope.

### Clipping

For an analysis interval `[filterStart, filterEnd)`:

```text
clippedStart = MAX(deploymentStart, filterStart)
clippedEnd   = MIN(deploymentEnd, filterEnd)
activeSeconds = MAX(0, clippedEnd - clippedStart)
effortDays = activeSeconds / 86400
```

When no date filter exists, use the full deployment interval. For weekly/hourly outputs,
repeat the overlap calculation for each output bucket.

### Spatial scope

- An area filter includes effort only from deployments whose coordinates pass the existing
  bounding-box rule.
- Map effort is grouped by the same `(latitude, longitude)` identity as map raw counts.
- Multiple deployments at the same coordinates have their clipped effort summed.
- A deployment without usable coordinates may contribute to unfiltered species/timeline
  effort, but cannot contribute to a map location or a bounding-box-filtered result.
- Preserve the existing antimeridian behavior of `buildBboxClause`; this feature does not
  introduce a different geographic interpretation.

### Recurring time-of-day scope

When a map or activity request contains selected hour ranges, intersect each clipped
operational interval with those recurring ranges before converting seconds to camera-days.
Multiple hour ranges are treated as their union; overlap must not be counted twice.

Example:

```text
One camera active for 10 complete days
Selected time window: 18:00–06:00 (12 hours/day)
Effective effort: 120 hours = 5 camera-days
```

The effort calculator must use the same timezone/hour interpretation as the existing
`strftime('%H', media.timestamp)` raw-count filters. Raw count and effort must not assign
the same timestamp to different hours.

### RAI count eligibility

Raw N ind. and N obs. retain their existing handling of null/invalid media timestamps.
RAI needs an event to be attributable to measured effort, so before sequence aggregation:

- exclude media with null or invalid timestamps,
- exclude media without a valid deployment interval,
- exclude media outside that deployment's effective clipped interval,
- apply the same area/date/time filters used for effort.

Sequence/event grouping then runs over the qualifying media using the existing rules. This
means an RAI raw count is not always equal to the corresponding raw N metric calculated
over all records and divided afterward; records with no defensible effort attribution are
intentionally excluded.

### Availability metadata

RAI results should expose enough information to explain unavailable values:

```js
{
  effortDays: number,
  validDeploymentCount: number,
  excludedDeploymentCount: number
}
```

`effortDays === 0` produces `value: null`. The renderer shows an em dash and a tooltip such
as “RAI unavailable: no valid camera effort for the current filters.” It must not display
`0`, `Infinity`, or `NaN`.

## User experience

### Four-option selector

Replace the current two-option control with:

```text
N ind. | N obs. | RAI ind. | RAI obs.
```

Rename component/accessibility terminology from “Count metric” to “Analysis metric”:

```text
role="radiogroup"
aria-label="Analysis metric"
```

Expanded accessible names and tooltips:

- **N ind. — Individuals:** “Maximum detections of the species in one frame per sequence,
  summed across sequences.”
- **N obs. — Independent observations:** “Number of sequences in which the species was
  observed. Each sequence contributes once.”
- **RAI ind. — Individual relative abundance index:** “Sequence-adjusted individual
  detections per 100 effective camera-days.”
- **RAI obs. — Observation relative abundance index:** “Independent observations per 100
  effective camera-days.”

Both RAI tooltips add: “Encounter-rate index; not an estimate of population size or
density.”

The four-option control must remain usable beside the compact sequence-gap slider. Widen
or allow the Data + filters control group to wrap rather than shrinking labels below a
readable/clickable size. Keyboard arrows move through all four options in display order.

### Formatting

Use a shared formatter based on `metric.normalization`:

```text
normalization = none                 → integer (for example, 1,234)
normalization = RAI100     → one decimal (for example, 12.4)
```

Hovercards show the denominator context for RAI:

```text
12.4 per 100 camera-days
31 independent observations / 250.0 camera-days
```

RAI values should not be labelled simply “individuals” or “observations” without the rate
unit.

### Loading and unavailable states

A metric switch invalidates every affected Explore query. Previous-metric placeholder data
must not render under the newly selected metric.

When the study has no valid deployment intervals, both RAI choices may remain selectable
so their definitions are discoverable, but the affected surfaces show a consistent
unavailable state. A future effort-preflight query may disable them, but it is not required
for this version.

## Data semantics by surface

### Species distribution rail

Scope:

- current area filter,
- all study dates (the rail is not currently controlled by the timeline date range),
- all valid deployment intervals for RAI.

For raw metrics, preserve the current result exactly. For RAI, calculate the selected
raw count over effort-eligible media and divide by total effective effort from all
qualifying deployments, including deployments with zero detections of the species.

All species share the same denominator in this surface. Therefore:

- RAI ind. has the same ordering as its eligible N ind. raw count,
- RAI obs. has the same ordering as its eligible N obs. raw count.

The rate still provides a meaningful standardized unit even when it does not change rank.

A distribution row must retain the raw count separately from the displayed value:

```js
{
  scientificName,
  count: 12.4,       // displayed metric value; null when unavailable
  rawCount: 31,
  effortDays: 250
}
```

For `normalization: 'none'`, `count === rawCount` and `effortDays` may be omitted/null.
Use `rawCount`, not the RAI value, for activity-sufficiency gating in species hovercards.

### Weekly timeline

For each existing weekly bucket:

1. calculate the selected sequence-aware raw count inside that bucket,
2. calculate deployment overlap with the same week, area filter, and effective date scope,
3. calculate `100 × raw count / effortDays` in RAI modes.

RAI mode includes weeks with valid effort but zero selected-species detections. These rows
are necessary to distinguish “surveyed with no detections” from “not surveyed.” The RAI
timeline extent may therefore follow deployment effort rather than only the first/last
detection.

The current per-species peak normalization remains. Effort normalization changes the input
series; peak normalization remains a presentation step after it.

Timeseries rows retain bucket effort for diagnostics and tooltips:

```js
{
  date: '2026-08-23',
  effortDays: 42.5,
  'Vulpes vulpes': 7.1
}
```

Raw-count fields may be returned in a parallel `rawCounts` object if needed by future
hover labels; do not encode metadata into dynamic species-name keys.

### Daily activity

For each hour bucket:

1. attribute sequences using the existing hourly semantics,
2. calculate active camera duration intersecting that hour across the selected date and
   area scope,
3. convert active duration to camera-days,
4. normalize the selected raw count in RAI modes.

The chart is subsequently peak-normalized per species as today. With uniform 24-hour
coverage, RAI may have the same shape as its corresponding N metric; partial deployment
boundaries or hour-specific coverage can change it.

Explore species hovercards receive the complete active metric object so their all-time
activity charts use the same raw count and normalization. Callers outside Explore pass the
default N ind. metric.

### Map locations

For each qualifying camera location, return:

- the selected raw count per selected species,
- effective camera-days at that location,
- the displayed value per species,
- coordinates and location name.

RAI map data must include effort-only locations with zero selected-species detections.
Otherwise regional aggregation would omit surveyed zero-detection cameras and inflate the
rate. Zero-value locations may use a neutral/zero marker treatment, but they must remain in
the aggregation model.

A location-oriented shape is preferred over repeating effort once per species:

```js
{
  locations: [
    {
      lat,
      lng,
      locationName,
      effortDays,
      rawCounts: {
        'Vulpes vulpes': 3,
        'Capreolus capreolus': 0
      },
      values: {
        'Vulpes vulpes': 6.0,
        'Capreolus capreolus': 0
      }
    }
  ]
}
```

For raw metrics, `values` equal `rawCounts`; `effortDays` may be null.

### Map composition and magnitude

At one location, all selected species share the same effort denominator. Composition
shares can therefore use either the RAI values or their raw counts and produce the same
proportions. Marker magnitude and displayed totals use the selected metric values.

### Clusters, density, and hex bins

Rates are not additive. Never sum or average child RAI values directly.

For every aggregate region `g`:

```text
aggregateRawCount(s, g) = SUM(location raw count for s)
aggregateEffort(g) = SUM(location effort once per location)
aggregateRAI(s, g) = 100 × aggregateRawCount(s, g) / aggregateEffort(g)
```

Example demonstrating the failure mode:

```text
Site A: 10 observations / 100 days = RAI 10
Site B: 10 observations / 10 days  = RAI 100

Correct combined RAI = 100 × 20 / 110 = 18.2
Incorrect sum = 110
Incorrect unweighted average = 55
```

Consequences:

- Leaflet markers carry `rawCounts` and `effortDays`, not only displayed counts.
- Cluster hovercards and icons sum raw count + effort and then recompute values.
- Density and hex-grid bins aggregate raw count + effort before deriving intensity.
- Effort-only zero-detection locations participate in cluster/bin denominators.
- The existing `aggregateClusterCounts` helper becomes a metric-aware aggregate helper.

## API and process architecture

### Structured options objects

Migrate the four preload APIs from positional arguments to structured request objects. The
metric object is nested unchanged:

```js
window.api.getSequenceAwareHeatmap({
  studyId,
  speciesNames,
  startDate,
  endDate,
  timeRange,
  includeNullTimestamps,
  gapSeconds,
  metric: {
    counting: 'observations',
    normalization: 'RAI100'
  }
})
```

Apply the same pattern to distribution, timeseries, and daily activity. Update every
caller in the same change; do not retain parallel positional signatures.

### IPC validation

Each IPC handler:

1. validates the request object,
2. validates and normalizes `request.metric`,
3. resolves the study database,
4. passes the exact validated metric object to `runInWorker`.

Logs include both fields:

```text
[seq-worker:heatmap] start gap=60 counting=observations normalization=RAI100 ...
```

The worker must not accept arbitrary normalization strings or interpolate metric values
into SQL. Branch only on validated enum values.

### Worker pipeline

The worker derives:

```js
const needsEffort = metric.normalization === 'RAI100'
```

For raw metrics, route to the current SQL/JS path using `metric.counting`. For RAI:

1. load or query qualifying deployment intervals,
2. restrict raw count input to effort-eligible media,
3. calculate the existing individual/observation raw count,
4. calculate effort at the output dimensions,
5. return raw count, effort, and derived value.

Do not add RAI branches to `calculateSequenceAwareSpeciesCounts` itself. That helper has no
deployment-effort context and should continue to answer only the raw count question.

Positive-gap RAI ind. retains the current positive-gap N ind. JavaScript fallback unless a
separate SQL raw count implementation is delivered. Effort calculation still runs in the
worker, not the main Electron process.

### Query and helper organization

Add a focused effort module rather than duplicating overlap formulas in all four species
queries, for example:

```text
src/main/services/sequences/effort.js
```

It should expose pure/testable operations for:

- validating deployment intervals,
- clipping intervals,
- summing total effort,
- grouping effort by week,
- grouping effort by hour,
- grouping effort by location,
- intersecting recurring time-of-day ranges.

Database query code supplies deployment rows and raw count rows; the effort module owns
calendar/interval semantics. If performance requires moving an operation into SQL, its
result must retain parity tests against the pure helper.

## Data integrity and caveats

### RAI is an encounter index

Neither RAI mode controls for species detectability, animal movement, camera placement,
habitat, camera settings, bait/lure, or detection-zone geometry. Do not describe either as
population abundance or density. Documentation should recommend standardized within-study
comparisons and transparent reporting of sequence and effort rules.

### Deployment intervals approximate active operation

The schema records one start/end pair per deployment and no internal downtime. RAI assumes
continuous operation between those values. Battery failure, theft, malfunction, or planned
off periods can only be represented accurately if imports split them into separate
intervals/deployments.

### Co-located cameras

This version counts each deployment as one camera. Two simultaneous deployments at the
same location double effort. Studies that treat paired cameras as one station need a
future station-effort policy; this version does not merge overlaps by `locationID`.

### Existing N ind. aggregate-count caveat

N ind. currently derives frame magnitude with `COUNT(observationID)`, not
`SUM(observations.count)`. Therefore RAI ind. inherits the same behavior: one imported
Camtrap DP row with `count = 5` contributes one, not five, to its raw count. RAI obs. is not
affected by magnitude because species presence contributes one per sequence.

### Filter-before-group semantics

Preserve each surface's existing bucket/filter-before-sequence behavior. A sequence that
crosses a week, hour, date, or area boundary may be split/attributed according to the
current query path. Redefining sequences around one canonical event timestamp is separate
work.

## Performance

- Keep heavy queries and interval calculations in the sequence worker.
- Fetch only the selected metric; do not eagerly calculate all four.
- Include both metric properties in every cache key so completed results can be reused
  when switching back.
- Keep the existing SQL fast paths for both counting modes.
- Do not ship per-observation rows merely to calculate effort; effort depends on
  deployments and output buckets, not observation-row volume.
- Load deployment intervals once per worker request and reuse them across bucket/location
  calculations.
- Map RAI payload size is bounded by deployment locations × selected species, not all
  observations.
- Profile all four metrics on a large study for distribution, timeseries, map, and daily
  activity.

## Testing

### Metric object tests

- All four property combinations validate.
- Missing metric defaults to N ind. at generic API boundaries.
- Invalid counting, invalid normalization, arrays, null, and extra properties are
  rejected or defaulted according to boundary policy.
- LocalStorage round-trips the complete object.
- Malformed JSON and stale object shapes resolve to the default.
- Study preferences remain independent.
- Query keys differ for each of the four combinations.

### Effort unit tests

- One exact 24-hour interval contributes `1` camera-day.
- Partial first/last days remain fractional.
- Date filters clip both sides correctly.
- Adjacent half-open buckets do not double-count boundaries.
- Missing, invalid, zero-length, and reversed deployment intervals are excluded.
- Multiple deployments sum effort, including co-located deployments.
- Bounding boxes include exactly the same deployments as raw count queries.
- Week grouping conserves total effort across buckets.
- Hour grouping conserves total effort across 24 hours.
- Multiple and midnight-wrapping time ranges produce the correct union.
- Timezone/hour interpretation matches the existing media timestamp filter.

### Counting and RAI tests

Using two deer sequences with per-frame counts `2,5,3` and `4,2`, plus 40 camera-days:

```text
N ind.   = 9
N obs.   = 2
RAI ind. = 22.5
RAI obs. = 5.0
```

Also verify:

- RAI excludes media without valid timestamp/effort attribution.
- Zero detections with positive effort produces RAI `0`.
- Positive raw count with zero effort produces unavailable/null, not infinity.
- N ind. and N obs. regression outputs remain unchanged.
- Per-media, imported-eventID, and positive-gap paths produce correct raw counts for both
  RAI modes.
- Area/date/time filters affect raw count and effort consistently.

### Aggregate-rate tests

- Combining `10/100` and `10/10` produces `18.2`, not `110` or `55`.
- Cluster aggregation counts each location's effort once even with multiple selected
  species.
- A surveyed location with zero detections participates in the denominator.
- Hex and density aggregation match direct `SUM(rawCount) / SUM(effort)` fixtures.

### Renderer tests

- The four options have full accessible names and keyboard navigation.
- Raw values format as integers and RAI as rates.
- Switching metrics preserves species selection, filters, viewport, and map encoding.
- No previous-metric placeholder values appear under a new label.
- Species hovercard sufficiency uses raw count rather than displayed RAI.
- Missing effort renders an unavailable state.
- Metric persistence stores and restores the complete object.
- Other pages continue to display N ind. and do not inherit the Explore preference.

### Manual acceptance

With the `9 / 2 / 40 days` fixture:

- The species rail displays `9`, `2`, `22.5`, and `5.0` across the four options.
- Map marker and hovercard values match the rail for a single-location fixture.
- A two-location cluster recomputes the rate from combined raw count and effort.
- Weekly periods with active cameras and no deer show zero rather than disappearing.
- Invalid deployment dates make RAI unavailable without affecting N ind. or N obs.
- Rapid switching never displays a value under the wrong metric label.

## Implementation steps

Each step is a small end-to-end deliverable rather than a frontend/backend layer split.

1. **Introduce and persist the metric object without changing results.** Replace the shared
   count string with `{ counting, normalization }`, migrate the four APIs to options
   objects, update query keys, and expose the four-option selector. Temporarily gate the
   two RAI options behind an unavailable placeholder while tests prove all existing N ind.
   and N obs. paths are unchanged.
2. **Deliver effort calculation and RAI in the species rail.** Add interval helpers,
   deployment eligibility, distribution raw count/effort payloads, formatting, and
   unavailable states. Verify the `9 / 2 / 40` fixture end to end.
3. **Deliver weekly and hourly RAI.** Add effort by week/hour, zero-detection effort
   buckets, Explore and hovercard propagation, and normalized-chart tests.
4. **Deliver location RAI and rate-safe map aggregation.** Return location-oriented
   raw count/effort data, include zero-detection sampled locations, and update markers,
   clusters, density, and hex bins to recompute ratios.
5. **Polish and validate.** Add terminology/help documentation, missing-effort diagnostics,
   retained caveat documentation, large-study profiling, and the complete manual acceptance
   pass.

## Anticipated affected files

- `src/shared/countMetric.js` → replace/rename with shared analysis-metric object validation.
- `src/renderer/src/hooks/useExploreCountMetric.js` → replace/rename and persist JSON object.
- `src/renderer/src/ui/CountMetricToggle.jsx` → four-option Analysis metric control.
- `src/renderer/src/explore.jsx` → query keys, options-object calls, formatting, map identity,
  and metric-aware payload handling.
- `src/renderer/src/ui/speciesDistribution.jsx` → rate formatting and raw-count
  propagation.
- `src/renderer/src/ui/SpeciesTooltipContent.jsx` → complete metric object in activity
  queries.
- `src/renderer/src/ui/MarkerHoverCard.jsx` → RAI units, raw count, and effort details.
- `src/preload/index.js` → structured request objects for sequence-aware APIs.
- `src/main/ipc/sequences.js` → request/metric validation and worker payloads.
- `src/main/services/sequences/worker.js` → raw count + effort orchestration.
- `src/main/services/sequences/effort.js` → new interval/effort helpers.
- `src/main/services/sequences/speciesCounts.js` → pivot/result-shape support; raw count
  aggregation remains individual/observation only.
- `src/main/database/queries/species.js` → effort-eligible raw count filters and structured
  rows for distribution, timeseries, map, and daily activity.
- Existing count-metric, sequence SQL, bbox, and renderer tests.
- New effort and aggregate-rate tests.
- `website/docs/guides/exploring-data.md` → formulas, effort assumptions, interpretation,
  and caveats.
