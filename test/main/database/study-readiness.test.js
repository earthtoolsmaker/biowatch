import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { getMigrationsPath } from '../../../src/main/database/migrations-utils.js'
import {
  migrateStudyDatabase,
  migrateStudyConnection
} from '../../../src/main/database/migrate-study.js'
import {
  assertStudyDatabaseReady,
  getMigrationManifest,
  getStudyDatabaseStatus,
  inspectDatabaseVersion,
  setStudyDatabaseStatus
} from '../../../src/main/database/study-readiness.js'
import { readUnavailableStudySummary } from '../../../src/main/database/study-summary.js'
import {
  closeAllDatabases,
  getStudyDatabase,
  StudyDatabaseManager
} from '../../../src/main/database/manager.js'
import { runInWorker } from '../../../src/main/services/sequences/runInWorker.js'

const roots = []
const migrationsPath = getMigrationsPath('test')
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'study-readiness-'))
  roots.push(root)
  return { root, dbPath: join(root, 'study.db') }
}
afterEach(async () => {
  await closeAllDatabases()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('empty, current and older databases have explicit versions', () => {
  const db = new Database(':memory:')
  try {
    assert.equal(inspectDatabaseVersion(db).status, 'outdated')
    const ready = migrateStudyConnection(db)
    assert.equal(ready.status, 'ready')
    assert.equal(ready.currentVersion, ready.expectedVersion)
    db.exec(
      'DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)'
    )
    const older = inspectDatabaseVersion(db)
    assert.equal(older.status, 'outdated')
    assert.match(older.currentVersion, /^0017_/)
  } finally {
    db.close()
  }
})

test('a failed study stays discoverable, does not block a healthy study, and can recover', async () => {
  const broken = fixture()
  const healthy = fixture()
  const db = new Database(broken.dbPath)
  db.exec(
    "CREATE TABLE deployments (deploymentID TEXT); CREATE TABLE metadata (title TEXT); INSERT INTO metadata VALUES ('Forest cameras')"
  )
  db.close()
  const result = await migrateStudyDatabase('broken', broken.dbPath, migrationsPath)
  assert.equal(result.success, false, 'already-existing-table errors must not be swallowed')
  assert.equal(result.database.status, 'migration-failed')
  assert.match(result.database.message, /already exists/)
  assert.throws(() => assertStudyDatabaseReady(broken.dbPath), /already exists/)
  await assert.rejects(getStudyDatabase('broken', broken.dbPath), /already exists/)
  // Guard worker spawning in the main process, before resolving the worker file.
  await assert.rejects(
    runInWorker({ type: 'overview-stats', dbPath: broken.dbPath }),
    /already exists/
  )
  const listed = readUnavailableStudySummary('broken', broken.dbPath, result.database)
  assert.equal(listed.name, 'Forest cameras')
  assert.equal(listed.data, null)
  assert.equal(listed.database.status, 'migration-failed')

  new Database(healthy.dbPath).close()
  assert.equal(
    (await migrateStudyDatabase('healthy', healthy.dbPath, migrationsPath)).success,
    true
  )
  assert.doesNotThrow(() => assertStudyDatabaseReady(healthy.dbPath))
  assert.ok(await getStudyDatabase('healthy', healthy.dbPath, { readonly: true }))

  // Repair the injected conflict; retrying migrations clears the access block.
  const repair = new Database(broken.dbPath)
  repair.exec('DROP TABLE deployments; DROP TABLE metadata')
  repair.close()
  assert.equal((await migrateStudyDatabase('broken', broken.dbPath, migrationsPath)).success, true)
  assert.doesNotThrow(() => assertStudyDatabaseReady(broken.dbPath))
  assert.ok(await getStudyDatabase('broken', broken.dbPath, { readonly: true }))
})

test('newer databases are not migrated or downgraded', async () => {
  const { dbPath } = fixture()
  const db = new Database(dbPath)
  const ready = migrateStudyConnection(db)
  const future = getMigrationManifest().entries.at(-1).when + 1
  db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
    'future-version',
    future
  )
  db.close()
  assert.equal(getStudyDatabaseStatus(dbPath).status, 'newer')
  const result = await migrateStudyDatabase('future', dbPath, migrationsPath)
  assert.equal(result.success, false)
  assert.equal(result.database.status, 'newer')
  assert.equal(result.database.expectedVersion, ready.expectedVersion)
  await assert.rejects(getStudyDatabase('future', dbPath), /newer version/)
  const after = new Database(dbPath, { readonly: true })
  assert.equal(
    after.prepare('SELECT MAX(created_at) AS version FROM __drizzle_migrations').get().version,
    future
  )
  after.close()
})

test('an unexpected migration hash is incompatible, not silently accepted as current', async () => {
  const { dbPath } = fixture()
  const db = new Database(dbPath)
  migrateStudyConnection(db)
  db.exec(
    "UPDATE __drizzle_migrations SET hash = 'different-sql' WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)"
  )
  db.close()
  const result = await migrateStudyDatabase('mismatch', dbPath, migrationsPath)
  assert.equal(result.success, false)
  assert.equal(result.database.status, 'incompatible')
})

test('readonly connections reject old schemas and close their failed handles', async () => {
  const { dbPath } = fixture()
  new Database(dbPath).close()
  const manager = new StudyDatabaseManager('old', dbPath, { readonly: true })
  await assert.rejects(manager.initialize(), /needs a database update/)
  assert.equal(manager.sqlite, null)
})

test('marking a cached study unavailable blocks its cached connections too', async () => {
  const { dbPath } = fixture()
  const manager = await getStudyDatabase('cached', dbPath)
  setStudyDatabaseStatus(dbPath, {
    ...inspectDatabaseVersion(manager.sqlite),
    status: 'updating',
    message: 'Update in progress'
  })
  await assert.rejects(getStudyDatabase('cached', dbPath), /Update in progress/)
})

test('missing and corrupt databases keep a fallback label without being created or queried normally', () => {
  const { root } = fixture()
  for (const name of ['missing.db', 'corrupt.db']) {
    const dbPath = join(root, name)
    if (name === 'corrupt.db') writeFileSync(dbPath, 'not a SQLite database')
    const database = getStudyDatabaseStatus(dbPath)
    assert.notEqual(database.status, 'ready')
    assert.equal(readUnavailableStudySummary('camera-study', dbPath, database).name, 'camera-study')
  }
})

test('missing migration assets are an error, not a successful upgrade', async () => {
  const { root, dbPath } = fixture()
  new Database(dbPath).close()
  const result = await migrateStudyDatabase(
    'missing-assets',
    dbPath,
    join(root, 'absent-migrations')
  )
  assert.equal(result.success, false)
  assert.equal(result.database.status, 'migration-failed')
})

for (const alreadyAt17 of [false, true]) {
  test(`a later migration failure rolls back pending SQL and history (0017 ${alreadyAt17 ? 'already applied' : 'also pending'})`, async () => {
    const { root, dbPath } = fixture()
    const copied = join(root, 'migrations')
    cpSync(migrationsPath, copied, { recursive: true })
    const entries = getMigrationManifest().entries
    const journal = {
      version: '7',
      dialect: 'sqlite',
      entries: entries.slice(0, alreadyAt17 ? 18 : 17)
    }
    const journalPath = join(copied, 'meta', '_journal.json')
    writeFileSync(journalPath, JSON.stringify(journal))
    const db = new Database(dbPath)
    migrate(drizzle(db), { migrationsFolder: copied })
    const initialHistory = db.prepare('SELECT * FROM __drizzle_migrations').all()
    journal.entries = [
      ...entries,
      {
        idx: 19,
        version: '6',
        when: entries.at(-1).when + 1,
        tag: '0019_test_failure',
        breakpoints: true
      }
    ]
    writeFileSync(journalPath, JSON.stringify(journal))
    writeFileSync(
      join(copied, '0019_test_failure.sql'),
      'CREATE TABLE rollback_probe (id TEXT);\n--> statement-breakpoint\nSELECT deliberately_missing_function();'
    )
    db.close()
    const result = await migrateStudyDatabase('rollback', dbPath, copied)
    assert.equal(result.success, false)
    const after = new Database(dbPath, { readonly: true })
    assert.deepEqual(after.prepare('SELECT * FROM __drizzle_migrations').all(), initialHistory)
    assert.equal(
      after.prepare("SELECT name FROM sqlite_master WHERE name = 'rollback_probe'").get(),
      undefined
    )
    assert.equal(
      after.pragma('table_info(media)').some((column) => column.name === 'sourceTimestamp'),
      alreadyAt17
    )
    after.close()
  })
}
