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
time. This PR does not redefine the existing date-range API: its start/end
values still specify absolute instants, not a separate local-midnight interval
for every deployment. The timeline retains its existing Monday–Sunday grouping
and Sunday label convention.

### 4. Apply camera-local hours consistently

The following use `localTimestamp`, not the hour of the canonical UTC string:

- daily activity, in all counting and sequence-gap modes;
- the shared gallery hour-range predicate;
- both SQL and JavaScript-backed heatmap filtering paths;
- best-media and per-species best-image daylight scoring;
- calendar week grouping for activity series.

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

The settings popover accepts a named timezone, `UTC`, or `UTC±HH:MM`. Saving
reinterprets offset-free source values atomically and refreshes study queries.
Clearing the setting returns those values to floating time. Supplied offsets
remain authoritative. Invalid/ambiguous values still unresolved after a save
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
Functions are registered on database-manager connections and on the raw merge
writer. Derived physical columns keep analytics free of per-detection timezone
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

## Explicit exclusion: existing-study recovery

Per the requested scope, migration 0017 only adds schema and triggers. It does
not backfill source/local fields, reconstruct discarded offsets, detect legacy
import formats, or add compatibility fallbacks in queries. Existing records are
not rewritten merely by opening a study.

**Existing studies need reimporting to receive this time model.** Old UTC values
alone cannot recover the original camera clock. Existing-study repair and
migration UX are deliberately not part of this PR.

## Small, testable deliverables

1. **One offset-bearing detection works end to end.** Preserve 22:30+02:00 as
   camera 22:30 and UTC 20:30; align daily bins, gallery filtering and effort.
2. **Every activity path agrees.** Cover both counting metrics, all sequence-gap
   branches, camera-local weeks, heatmap filters and daylight scoring.
3. **Unknown camera time can be resolved explicitly.** Confirm a civil or fixed
   setting, reject invalid settings and DST ambiguity, and refresh the renderer.
4. **Context survives subsequent operations.** Test timestamp edits, original
   event bounds, exports/reimports and merge field preservation.

## Validation

Regression coverage includes positive and negative offsets, UTC/local midnight
and week boundaries, floating SQL/ISO/EXIF values, explicit EXIF offset tags,
source-offset precedence, timezone clearing, contradictory effort settings,
spring/fall DST and half-hour DST, sequence counting and camera-offset-preserving
edits. Run camera-time tests under multiple `TZ` environments to ensure that the
host timezone does not influence interpretation.

Run the full Node test suite, production build, formatting and lint checks. No
remote database updates or deployments are required.
