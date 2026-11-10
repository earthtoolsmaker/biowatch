# Per-study database readiness and migration errors

Related: [camera-local time](2026-11-09-camera-local-time.md) and issue
[#656](https://github.com/earthtoolsmaker/biowatch/issues/656).

## Problem

Startup previously logged study migration failures and continued normally. The
study list could hide an unreadable database, and the running app could query a
schema it did not understand. Both migration entry points also treated errors
containing `already exists` or `CREATE TABLE` as success without proving that the
expected migration had completed.

Stopping the entire application would protect data access, but unnecessarily
prevent use of healthy studies, settings and new imports.

## Decisions

### Isolate failures by study

Startup still migrates study databases sequentially. Each successful study must
have the latest migration timestamp and SQL hash from the bundled Drizzle journal.
A database with an unknown migration timestamp or mismatched latest SQL hash is
incompatible; a timestamp beyond the bundled latest migration is newer than the
app. Neither is automatically rewritten or downgraded.

This is a migration-history/version check, not an exhaustive database integrity
or schema audit. A successful version check cannot prove that every row or table
is intact; metadata-read failures also make the study unavailable.

### Fail closed for normal access, not for the whole app

Failures are recorded by database path for the current process. Both readonly
and writable database-manager access, including cached connections, reject a
blocked study. Opening a readonly connection also checks its version. Writable
connections use the same migrate-and-verify implementation as startup, without
any catch-and-ignore schema fallback. Failed initialization closes its handle.

Analytics and merge worker entry points check readiness before normal queries;
the main process also guards worker spawning so its recorded failure cannot be
bypassed by a fresh worker with a separate module cache. Existing-study worker
imports check readiness before spawning. New-study imports may create their own
current-schema database normally.

The renderer gates study routes before mounting any study-data hooks, including
import-status polling. Unavailable studies do not request sidebar hover stats
and are excluded from merge-source selection. Rename is disabled for them.

### Keep failed studies discoverable

`studies:list` includes a `database` readiness object for every returned study.
For unavailable studies, it reads only existing label columns from `metadata`
using a temporary readonly connection, without attaching the current ORM schema.
If that fails, the directory's study ID is the label. No media or observation
queries are needed to display the error screen. Directories without a database
are not listed as studies.

The sidebar shows a warning but remains navigable. Selecting that study shows
its error screen instead of tabs or an empty/broken graph. Other studies,
settings, and adding a study remain accessible.

### Make recovery and support explicit

The error screen offers:

- **Retry update** for migration failures and outdated studies. Concurrent retries
  of one study share one operation; other studies are independent. The study
  remains blocked while its cached handles are closed and migrations run. Only
  successful migration and version verification clear the block, after which the
  study list refreshes and normal routes can mount.
- **Copy diagnostic details** with app version, study ID, current/expected
  migration versions, status and the underlying error. Prefer the underlying
  SQLite error over Drizzle's full SQL query/parameters. Details are visible for
  review; error messages may still contain local file paths.
- **Contact support**, linking to EarthToolsMaker's existing contact page. No
  automatic uploads or prefilled public issue containing private diagnostics.

Newer databases ask the user to update Biowatch and do not offer retry/downgrade.
Incompatible migration histories direct the user to support rather than guessing
how to reconcile schemas. Missing migration assets fail explicitly rather than
pretending Drizzle will create tables from the model definitions.

### Preserve transactional upgrade semantics

Drizzle's synchronous SQLite migrator wraps all pending migrations for one study
in one transaction, including migration-history inserts. If two migrations are
pending and the latter fails, both roll back. If an earlier migration was already
committed on a previous run, only the later pending work rolls back. No applied
history is deleted to force a rerun.

Camera-time SQLite functions are registered on the temporary startup migration
connection too, before any migration can invoke the camera-time triggers.

App-level filesystem migrations (Umzug) retain their existing application-level
failure handling; this change concerns individual study SQLite databases.

## Small, testable deliverables

1. **An unavailable study cannot be queried.** Share migration/version checks,
   stop swallowing SQL failures, and cover healthy, old, newer, mismatched,
   missing and corrupt databases, cached access, and transactional rollback.
2. **A failed study stays visible without breaking healthy studies.** Return safe
   labels/readiness through IPC and mount an error screen instead of study hooks.
3. **Recovery works end to end.** Retry one study, retain the error after a failed
   retry, restore normal access after repair, and provide reviewable diagnostics
   and a support link.

## Validation

Node regression tests exercise version checks, fail-closed database/worker
access, per-study independence, safe labels, missing migration assets, recovery,
and rollback with 0017 either pending or previously applied. Query and filesystem
migration fixtures use real migrations/history rather than untracked mock schemas.

An Electron test starts against a temporary profile containing a healthy study,
a deliberate migration conflict, a newer database, a corrupt database and a legacy
study awaiting the 0018 timestamp backfill. It covers sidebar/error routing,
guarded IPC, diagnostics, failed retry, healthy study/settings/import navigation,
and successful retry after removing the fixture conflict. The legacy study also
recovers its chart control and populated daily activity after startup backfill.
The test does not touch the real profile or replace the system clipboard.

Version-readiness checks do not themselves populate timestamps. Migration 0018
provides that backfill through the same guarded startup/retry machinery.
