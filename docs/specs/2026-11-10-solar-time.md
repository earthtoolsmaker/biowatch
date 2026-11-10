# Solar-time activity and hour filtering (#602)

Branch: `feat/602-solar-time`, stacked on `fix/656-camera-local-time` (base
`4c899a9a`), not main. This adds no migration and does not reinterpret timestamps.
See [camera-local time](2026-11-09-camera-local-time.md) and
[database readiness](2026-11-09-per-study-database-readiness.md).

## Conversion contract

Clock Time retains camera-local hours from `media.localTimestamp`. Solar Time
uses only the canonical UTC instant in `media.timestamp` and the deployment's
latitude/longitude. SunCalc 1.9 supplies dated sunrise/sunset events.

For sunrise R, sunset S, following sunrise N and UTC instant t:

- Daylight `[R,S)`: `6 + 12 * (t-R)/(S-R)`.
- Night `[S,N)`: `(18 + 12 * (t-S)/(N-S)) % 24`.
- Before sunrise, use the previous sunset and this sunrise.

06:00 is sunrise, 18:00 sunset. Solar 12:00 and 00:00 are the daylight/night
midpoints, **not** independently calculated astronomical noon/midnight. Retain
fractional precision until hourly aggregation (`floor`, 0–23). Filters compare
that same continuous value with half-open ranges. Multiple ranges are unioned;
`start > end` wraps midnight. Empty ranges mean no hour filter.

Events retain their complete UTC dates, including daylight crossing UTC midnight.
SunCalc cycles are sampled near mean-solar noon, keyed by coordinates and
mean-solar date; surrounding consecutive cycles provide the event pair. Never
reuse today's sunrise time-of-day as tomorrow's sunrise. Never bridge missing
polar events. No UTC instant, invalid/missing coordinates, or a missing required
event makes the value unavailable, not clock time. Unavailable detections stay
in unfiltered galleries but are excluded from solar charts and active hour
filters (including the null-timestamp pagination phase). The UI explains this.

## Range prerequisite

Weekly labels are display buckets, **not** recording bounds. Explore's All time
map/daily queries and species hovercard daily queries omit date bounds. The daily
query accepts absent bounds and includes the entire recording period; a single
week does not become an empty `[label,label]` interval, and the final week is not
lost. Explicit absolute date filters retain their existing UTC API semantics.

## Time-filter controls

Explore's mode toggle sits above the chart alongside the chart-shape toggle.
Solar appears first and is the default when no per-study preference is saved.
Clock Time keeps numeric hour labels and drag selection. Solar Time replaces the
circle's hour labels with clickable, keyboard-accessible period icons:
Night at 00:00 (top), Dawn at sunrise 06:00 (right), Day at 12:00 (bottom), and
Dusk at sunset 18:00 (left). The line view uses the same icons along its axis,
with Night repeated at 24:00. Both modes reserve the same circle padding and
label/icon positions. The Media panel shares these controls and their selection
with Explore.

Solar periods partition the day without overlap: Dawn `[05:00,07:00)`, Day
`[07:00,17:00)`, Dusk `[17:00,19:00)`, and Night `[19:00,05:00)`. Dawn and Dusk
are one-solar-hour windows either side of their event anchors. Hit areas,
highlighting, tooltips, and query ranges use the same definitions. A plain click
isolates a period or clears it when already the sole selection; Shift toggles
individual periods. The circle's center resets to all hours. Switching modes
clears hours atomically. The clock-mode preset definitions are unchanged.

## Shared selection

Explore and Media use one per-study React Query value and one localStorage item
`timeFilter:<studyId>` containing the mode and hour selection together. The
selection stores either preset keys or explicit ranges; ranges are derived for
queries, not duplicated React state. Switching in either direction resets hours
to unfiltered in the same transition, without touching other filters. Query keys
include the time basis. Media session/URL restoration cannot replay stale hours
after switching modes elsewhere; hours now have the shared persisted source of
truth rather than the Media URL's `time` parameter.

## RAI and exposure

For every deployment and valid adjacent solar-event interval, inverse-map each
solar-bin boundary to its real UTC instant. Intersect the resulting real interval
with deployment bounds and absolute date filters. Sum **actual elapsed duration**
per bin and deployment. A 16-hour day contributes 80 real minutes per daylight
solar bin, not 60. Fractional, overlapping, and wraparound selections intersect
and union those real intervals without double-counting.

`RAI_bin = 100 * summed_count_bin / (summed_milliseconds_bin / 86,400,000)`.
Never average per-camera rates. Numerators require valid deployment bounds and
detections inside them, plus the same available solar conversion as exposure.
Solar exposure does not require a camera timezone: UTC bounds and coordinates
are sufficient. Clock effort still requires the parent's known-clock policy.
Polar/unavailable segments contribute neither counts nor exposure. If eligible
data/coverage match, summing the bin counts and exposure preserves overall RAI;
changing how duration is distributed across bins must not change total effort.
Raw-count charts remain counts. UTC sequence gaps, absolute filters, camera-local
weeks, and clock-based best-media scoring remain unchanged.

## Execution and validation

Use existing analytics/pagination workers and SQL aggregation. Register the same
pure conversion as a SQLite scalar function, avoiding observation dumps. Astronomy
is cached in a bounded 2,048-entry LRU keyed by coordinates/solar date. No cache
is keyed by media/observation IDs; a worker's cache dies with the worker.

Fixtures use temporary databases/profiles only. Coverage includes equinoxes and
solstices, both hemispheres, longitudes near ±180°, UTC-date-crossing daylight,
exact sunrise/sunset, before/after sunrise, actual next-day sunrise, invalid inputs,
polar seasons, cache reuse/bounds, exact exposure and clipping, all counting and
sequence modes, SQL/fallback heatmaps, gallery null cursors, multiple ranges, and
the one-week/final-week prerequisite. Run under UTC, America/Los_Angeles and
Pacific/Auckland; DST never changes the solar mapping of an instant.

The hovercard uses the shared time basis too, while retaining all-time/full-study
scope. An Electron regression seeds ten detections across two weeks: incorrectly
clipping the final week would leave five and hide the hovercard's activity charts.
The same test exercises real preload/IPC/worker bin/filter agreement, mode changes
in both directions, other-filter preservation, shared selection and reload.

### Local validation measurements

The temporary 100,000-media/100,000-observation benchmark
(`node test/benchmark/solar-time.js`) returned 24 daily RAI rows in about **379 ms
clock / 688 ms solar**, including worker startup. Both modes counted 100,000 and
assigned exactly 366 real camera-days. These are local Node 22 measurements, not
cross-platform performance guarantees; no installed study was opened.

Node coverage also checks multi-deployment exposure summation before division,
solar heatmap RAI with overlapping fractional ranges, and solar eligibility when
a deployment's camera clock is unsuitable for clock-based effort. The focused
conversion/effort/query suites run under UTC, America/Los_Angeles and
Pacific/Auckland, including civil DST transition dates in both hemispheres.

No changes to migrations 0017/0018, remote databases, timestamp reinterpretation,
solar best-media scoring, or recovering discarded offsets.
