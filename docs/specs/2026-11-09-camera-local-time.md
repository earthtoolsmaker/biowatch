# Camera-local clock time for activity analysis

Related issue: [#656](https://github.com/earthtoolsmaker/biowatch/issues/656).

## Problem and motivation

SQLite converts offset-bearing timestamps to UTC before evaluating
`strftime('%H', timestamp)`. A camera detection recorded at
`2024-05-01T22:30:00+02:00` therefore appeared at hour 20, and a 22–23 h filter
could not find it. Fixed daylight scoring and hourly camera effort used that
same UTC convention. Weekly activity used the date written in the stored value,
which was only camera-local when an importer had preserved the original offset.

Simply replacing `strftime` with `substr(timestamp, ...)` is insufficient:
Camtrap DP and COCO importers normalized timestamps to UTC, discarding the local
representation. Other importers assigned the importing computer's timezone to
naive camera timestamps. Identical source data could consequently mean different
instants on different computers.

The correction distinguishes **the real instant** from **the camera clock**.
This is a correctness fix, not the proposed clock/solar-time feature.

## Decisions

### 1. Clock time means the camera's clock, not the viewer's timezone

A camera may follow civil time, including daylight saving, or keep one fixed
offset throughout a deployment. Both are legitimate:

- `Europe/Paris`: use the civil timezone's historical offset rules.
- `UTC+02:00`: fixed +02:00 all year, including winter.
- `UTC`: a camera clock that uses UTC.

Coordinates alone cannot establish how a camera was configured. We deliberately
do not guess its clock setting from geography or from the computer's timezone.

### 2. Retain the input, derive UTC and local wall time

| Stored value                            | Meaning                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `media.sourceTimestamp`                 | Validated source clock representation, including its explicit offset when supplied      |
| `media.timestamp`                       | Canonical ISO UTC instant, with milliseconds; null if the instant cannot be established |
| `media.localTimestamp`                  | ISO camera-local wall time without an offset                                            |
| `deployments.sourceDeploymentStart/End` | Source representations of deployment bounds                                             |
| `deployments.deploymentStart/End`       | Canonical UTC deployment bounds                                                         |
| `deployments.cameraTimeZone`            | Optional, explicit civil/fixed clock setting                                            |
| `observations.sourceEventStart/End`     | Source event representations                                                            |
| `observations.eventStart/End`           | Canonical UTC event bounds                                                              |

For example:

```text
sourceTimestamp = 2024-05-01T22:30:00+02:00
 timestamp      = 2024-05-01T20:30:00.000Z
 localTimestamp = 2024-05-01T22:30:00.000
```

The source fields retain input needed for reinterpretation; they are not an
immutable edit history. An explicit timestamp edit replaces the corresponding
source value and recomputes its derived values.

A supplied offset is authoritative for that record and is never overwritten by
a deployment setting. An offset-free timestamp remains floating until the user
supplies a camera setting. It may have a known wall time but no known instant.

Naive civil times in a skipped spring-forward hour or an ambiguous fall-back
hour do not receive an invented instant. An explicit source offset is required
to disambiguate them. Invalid timestamps remain invalid rather than inheriting
the runtime's current date or timezone.

### 3. Keep UTC for temporal mechanics

UTC remains the basis for:

- indexed timestamp ordering, cursors and absolute date-range comparisons;
- elapsed-time sequence gaps, including gaps across daylight-saving changes;
- actual deployment duration and clipping;
- event-to-media matching when instants are available;
- a future sunrise/sunset calculation using an instant and coordinates.

Calendar week labels and hour-of-day values instead come from camera-local wall
time. The absolute timeline, solar activity and effort-normalized analysis keep
UTC date bounds and elapsed-time sequence gaps. The timeline retains its existing
Monday–Sunday grouping and Sunday label convention.

**Raw daily activity in clock mode is the exception:** it uses `localTimestamp`
for eligibility, date filtering, ordering and sequence-gap grouping, so a camera
with no known offset can still show its recorded hours. Bounds are interpreted
as their written camera-calendar components, without shifting them through the
viewer's timezone. These gaps measure camera-clock differences, not guaranteed
elapsed real time across DST changes. Raw activity does not manufacture UTC
instants or resolve ambiguous camera clocks. Solar and effort-normalized modes
retain their stricter requirements; their empty states explain the camera
settings, deployment intervals and coordinates they need. The daily chart remains
reachable even when there is no absolute timeline.

### 4. Apply camera-local hours consistently

The following use `localTimestamp`, not the hour of the canonical UTC string:

- daily activity, in all counting and sequence-gap modes;
- the shared gallery hour-range predicate;
- both SQL and JavaScript-backed heatmap filtering paths;
- best-media and per-species best-image daylight scoring;
- calendar week grouping for activity series.

Media captions, table rows, viewer readouts and best-media previews use one
shared display policy, never the viewer's computer timezone. When a known UTC
instant and an explicit deployment `cameraTimeZone` are available, display that
instant in the confirmed camera timezone. This presentation-only conversion also
applies to UTC-normalized sources: `04:58Z` can display as `06:58 UTC+02:00` without
changing `sourceTimestamp`, `timestamp`, or stored `localTimestamp`. It does not
change source-clock analytics, hour filters, effort eligibility or export policy.
Users must confirm the camera clock setting; geography alone is not evidence.

Without a confirmed setting, display the stored source-derived wall time, falling
back to the UTC instant. Labels use 24-hour time and explicitly include `UTC` or
`UTC±HH:MM` when the offset is known. Floating clocks without a resolved instant
or source offset are labelled `timezone unknown`. The media viewer footer and
gallery caption tooltips expose the unchanged source timestamp for comparison.
This does not automatically recover an original camera offset lost by an older import.

Timestamp editors operate on the displayed wall-clock components. For known
instants displayed in a confirmed deployment timezone, resolve edits in that same
timezone; otherwise use the source offset or the explicit deployment clock setting,
never the host timezone. Missing settings and ambiguous/nonexistent civil times
are reported rather than resolved using the computer's clock. The write boundary
retains the source offset when serializing an edited instant. After a save, the
renderer refreshes UTC, source and local fields together, retaining the display
setting.

The daylight score remains a fixed-hour heuristic. Correcting its timezone does
not turn 06:00–18:00 into an astronomical sunrise/sunset calculation.

Counts, species selection, chart shapes, hour presets, and per-species peak
scaling retain their existing definitions. Solar normalization is out of scope.

### 5. Effort must use the same clock as detections

Camera effort is elapsed real duration assigned to camera-local hours and weeks,
not a fixed 24-hour allocation for every civil date. A skipped DST hour has zero
exposure; a repeated hour can have two hours of exposure. Half-hour offset
changes are handled too. A camera-day remains 86,400 seconds of real duration.

Use the explicit deployment clock setting when supplied. Without one, equal
explicit offsets at both source deployment bounds are treated as a fixed-offset
clock. This is a fixed-clock interpretation, not evidence of a civil timezone:
users should configure a named setting for cameras following daylight saving,
including deployments whose endpoints happen to share an offset.

Different endpoint offsets cannot establish the intervening offset schedule.
Such deployments need a named setting before effort-normalized analysis. A
setting that contradicts explicit endpoint offsets is also ineligible. Both the
SQL detection numerator and worker-side effort denominator apply the same
eligibility rule; dropping only the denominator would inflate RAI.

Existing RAI availability/excluded-deployment reporting remains in use. Clock
settings and source offsets must accurately describe the camera; this change
cannot diagnose every inconsistency in a curated dataset or correct camera
clock drift.

### 6. Make unknown settings actionable

The Deployments tab shows a count of media with a source timestamp but no known
instant. Selecting a deployment exposes the warning and its settings control.

The settings popover is portalled outside the clipped deployment pane, stays
within the viewport and scrolls when its content exceeds the available height.
It accepts a named timezone, `UTC`, or `UTC±HH:MM`. Saving
reinterprets offset-free source values atomically and refreshes study queries.
For known instants, the same setting also selects the media display timezone;
explicit source offsets remain authoritative for storage and source-clock analysis.
Clearing the setting returns offset-free values to floating time and known-instant
labels to their source clock. Supplied offsets remain unchanged. Invalid/ambiguous values still unresolved after a save
are reported, rather than silently coerced.

Timezone reassignment can touch many rows, so it runs in the background worker,
not on Electron's main event loop. Media remain available in unfiltered gallery
views when their instant is unknown; date-based analyses cannot place them on an
absolute timeline. The daily activity card identifies its basis as camera-local
clock time.

### 7. Normalize at the database write boundary

Import paths include Drizzle inserts, streaming prepared SQL, prediction metadata
updates and study merges. Central SQLite triggers maintain the representations
on insert, source edits, timestamp edits, deployment reassignment and clock-setting
changes. This prevents a writer from updating UTC while leaving local hours
stale, or from silently dropping source offsets.

`cameraTime.js` provides the pure parsing policy and the SQLite functions.
Functions are registered on database-manager connections, the temporary startup
migration connection, and the raw merge writer. Derived physical columns keep analytics free of per-detection timezone
conversion. The hand-authored triggers in migration 0017 must be retained when
changing the schema; the Drizzle snapshot describes columns, not triggers.

Source timestamps are preserved by Camtrap DP, COCO/LILA, Wildlife Insights and
Deepfaune importers. EXIF wall times are read as strings, including separate EXIF
offset tags, rather than revived as host-local JavaScript Dates. Filename-derived
video times likewise remain floating; actual UTC video/container timestamps
retain their explicit instant.

Camtrap event observations lacking offsets can still be associated with media by
wall time **within the same deployment**, without claiming an absolute instant.
Their source event bounds survive expansion for later timezone confirmation.

### 8. Preserve context through export and merge

Merges copy source fields and clock settings, not just normalized UTC values.
Camtrap DP exports serialize known instants with the camera/source offset, so a
reimport does not turn a 22:30 detection into a camera-clock 20:30 detection.

The exported deployments resource includes the optional Biowatch extension
`cameraTimeZone`, declared as a string in the resource schema. The importer reads
it back. This retains the civil/fixed clock distinction, especially for effort
across DST transitions. It is not presented as a standard Camtrap DP field.
Unknown-instant media follow the existing null-timestamp export exclusion and
warning behaviour; exports do not manufacture a `Z` offset for floating values.

## Existing-study transition

Migration 0017 only adds schema and triggers. Migration
`0018_backfill_camera_local_time` completes the existing-study transition through
the normal startup migration framework, including studies that already applied 0017. Do not edit or rerun 0017, delete migration history, or require reimport.

The backfill copies retained media timestamps, deployment bounds and observation
event bounds into missing source fields. The existing normalization triggers derive
canonical UTC and camera-local values from that representation. Missing local
values whose source is already present are also filled without replacing that
source or its existing UTC value. Completed new-import rows and explicit camera
settings are left alone; IDs, favourites, annotations and file references survive.

- Stored `20:30Z` becomes source `20:30Z`, canonical `20:30:00.000Z` and local
  `20:30:00.000`. `Z` is an explicit zero offset, preserving the familiar UTC-hour
  activity of old UTC-only studies without claiming to recover the original camera
  clock. Selecting a different camera setting later does not override that stored
  offset, but known-instant media labels can display the instant in the confirmed
  camera timezone.
- A retained `22:30+02:00` becomes local `22:30` and canonical UTC `20:30`, fixing
  the earlier SQLite UTC-hour extraction while preserving the real instant.
- Offset-free values retain their wall time without inventing a UTC instant. They
  still need a confirmed camera setting for instant-based date filtering and
  elapsed-time analysis. Invalid inputs survive in source fields, not as invented
  valid timestamps; absent values remain absent.

All pending SQL/history changes for one study are transactional. The startup
connection registers camera-time functions before running the migration. A failed
0018 rolls back its work; if 0017 was also pending, that rolls back too. Reopening
an already-upgraded study does not repeat the backfill.

[Per-study database readiness](2026-11-09-per-study-database-readiness.md) defines
the implemented failure isolation and retry/support screen. A failed migration
must block only the affected study's normal queries, not hide the study or block
the rest of the application. It is not a reason to delete or reimport a study.
The readiness check and 0018 have separate responsibilities: one blocks access to
an incompatible database; the other populates the new time representation. No
legacy chart mode or per-query old-field fallback is added.

A synthetic temporary study with 100,000 media and 100,000 observations upgraded
from already-applied 0017 in approximately **1.6 seconds** locally (Electron's Node
22.21.1 runtime), with no missing media source/local fields afterward. Startup
therefore retains the existing sequential execution model; larger studies can take
longer. This is a local reference measurement, not a cross-platform guarantee.

The independently identified daily-chart range issue (using weekly labels as the
actual recording bounds) is not corrected by this data migration.

## Small, testable deliverables

1. **One offset-bearing detection works end to end.** Preserve 22:30+02:00 as
   camera 22:30 and UTC 20:30; align daily bins, gallery filtering and effort.
2. **Every activity path agrees.** Cover both counting metrics, all sequence-gap
   branches, camera-local weeks, heatmap filters and daylight scoring.
3. **Unknown camera time can be resolved explicitly.** Confirm a civil or fixed
   setting, reject invalid settings and DST ambiguity, and refresh the renderer.
4. **Context survives subsequent operations.** Test timestamp edits, original
   event bounds, exports/reimports and merge field preservation.
5. **Existing studies upgrade without reimport.** Cover pre-0017 and already-0017
   databases, UTC-only query equivalence, retained offsets, floating/invalid inputs,
   mixed old/new rows, retry/idempotence, and transactional failure rollback.

## Validation

Regression coverage includes positive and negative offsets, UTC/local midnight
and week boundaries, floating SQL/ISO/EXIF values, explicit EXIF offset tags,
source-offset precedence, timezone clearing, contradictory effort settings,
spring/fall DST and half-hour DST, sequence counting and camera-offset-preserving
edits. Backfill tests also exercise daily and weekly counting/gap modes, gallery
hour filtering and effort, without altering valid UTC instants, favourites or
annotations. An isolated Electron profile verifies that a legacy study upgrades
at startup, exposes its chart toggle and returns populated daily activity.
Run camera-time/backfill tests under multiple `TZ` environments to ensure that the
host timezone does not influence interpretation.

A temporary SQLite backup of an older 10,604-media demo was also upgraded locally:
local timestamp coverage increased from zero to 10,604 in approximately 0.25 seconds,
while media instants, observation IDs, favourites and full-study daily bins were
preserved. The original was opened read-only and its counts/migration history were
verified unchanged; the temporary backup was removed afterward.

Run the full Node test suite, production build, formatting and lint checks. No
remote database updates or deployments are required.
