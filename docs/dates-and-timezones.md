# Dates and Timezones

How Biowatch stores, filters, and displays capture timestamps.

## Principle: store deployment-local time

Camera-trap analysis is about the **camera's local clock** — "dawn", "day",
"dusk", and "night" only make sense in the timezone where the camera sits. So
Biowatch stores each capture timestamp in its **deployment-local time**,
keeping the source UTC offset:

```
2020-12-16T10:28:18.000+01:00     ← Belgian deployment, local clock 10:28
2017-04-10T06:06:24.000+02:00     ← South African deployment, local clock 06:06
```

The literal wall-clock portion (`10:28`, `06:06`) is the camera's local time.
Everything downstream — filtering, the activity histogram, and the gallery
display — reads that local wall clock.

## Import: preserve the wall clock, never convert to UTC

Importers must keep the source offset (or, for offset-less sources, the literal
wall clock) and must **not** call `.toUTC()`:

| Parser           | Source format                 | How local time is preserved                                                                |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| CamtrapDP / GBIF | ISO 8601, usually with offset | `DateTime.fromISO(x, { setZone: true }).toISO()` (`parsers/camtrapDP.js`)                  |
| LILA (COCO)      | ISO or `yyyy-MM-dd HH:mm:ss`  | `fromISO(x, { setZone: true })` / `fromFormat(...)` (`parsers/lila-helpers.js`)            |
| Deepfaune        | `yyyy:MM:dd HH:mm:ss` (naive) | `fromFormat(...).toISO()` — naive wall clock kept                                          |
| WildlifeInsights | SQL datetime (naive)          | `fromSQL(...).toISO()` — naive wall clock kept                                             |
| Image directory  | EXIF + GPS                    | `geo-tz` resolves the deployment zone; stored local-with-offset (`services/prediction.js`) |

`{ setZone: true }` is the key: for an offset-bearing input it keeps that
offset; for a naive input it keeps the wall-clock numbers (labelling them with
the runtime zone). Either way the **hour you read off the string is the
camera's local hour**.

> Historical note: CamtrapDP and LILA previously did `.toUTC()`, which discarded
> the offset. Studies imported before the fix are stored as UTC (`…Z`) and
> behave as if the deployment timezone were UTC. **Re-import** such a study to
> get correct deployment-local behavior; there is no in-place backfill.

## Filter: read the local hour off the string

The day-period filter (`timeRange`) and the activity histogram extract the hour
directly from the stored string, with no timezone conversion:

```sql
CAST(substr(timestamp, 12, 2) AS INTEGER)   -- the HH of YYYY-MM-DD?HH:MM:...
```

See `localHourExpr` / `localHourExprRaw` in
`src/main/database/queries/sequences.js`, used by the filter
(`sequences.js`, `species.js`) and the daily-activity query (`species.js`).

We deliberately avoid `strftime('%H', ts)` (reads UTC for tz-aware strings) and
`strftime('%H', ts, 'localtime')` (converts to the **viewer's machine** zone).
`substr` is timezone-independent, so filtering is deterministic regardless of
where the app runs, and matches the displayed time.

The presets live in `src/renderer/src/utils/dayPeriods.js` and are half-open
`[start, end)` hour ranges in 24h local clock time (Night wraps midnight).

## Display: render the stored offset, not the machine zone

`src/renderer/src/utils/formatTimestamp.js` renders capture times in the stored
offset via Luxon `DateTime.fromISO(ts, { setZone: true })` — **not** the
viewer's machine timezone. This keeps the displayed time equal to the filter
hour for every viewer:

- `formatGridTimestamp` — grid cell + detail overlay (and the best-media carousel).
- `formatEditableTimestamp` — the editable timestamp field (includes seconds).
- `parseEditedTimestampToISO` — parses an edited wall clock back into an ISO
  string in the **original** timestamp's offset, so saving keeps the timestamp
  deployment-local (round-trips through `updateMediaTimestamp`, which parses with
  `{ setZone: true }`).

## Gotchas

- **String date-range comparisons.** Date-range filters compare ISO strings
  directly. Within a single deployment the offset is consistent, so ordering is
  correct; mixing very different offsets in one query can reorder around
  boundaries. This predates deployment-local storage (image-directory studies
  already carried offsets).
- **Null / unparseable timestamps** are excluded by the hour filter (`substr`
  of `NULL` is `NULL`); they're handled separately via the
  `includeNullTimestamps` paths.
- **Sequence grouping** uses `new Date(ts).getTime()` (absolute instant), which
  is offset-aware and unaffected by the local-hour reading.
