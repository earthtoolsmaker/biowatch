const { test, expect, _electron: electron } = require('@playwright/test')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '../..')
const electronPath = require('electron')

// Use Electron's native SQLite ABI for fixture setup, without opening an app or
// touching an installed/development profile. No downloads or external media.
function sqliteScript(script) {
  return execFileSync(electronPath, ['-e', script], {
    cwd: projectRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8'
  })
}

let profile
let electronApp
let window

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(tmpdir(), 'biowatch-readiness-e2e-'))
  sqliteScript(`
    ;(async () => {
    const { registerCameraTimeFunctions } = await import('./src/main/services/cameraTime.js')
    const fs = require('node:fs')
    const path = require('node:path')
    const Database = require('better-sqlite3')
    const { readMigrationFiles } = require('drizzle-orm/migrator')
    const migrations = readMigrationFiles({ migrationsFolder: 'src/main/database/migrations' })
    const root = path.join(${JSON.stringify(profile)}, 'biowatch-data', 'studies')
    for (const [id, title] of [['broken', 'Forest cameras'], ['healthy', 'Healthy cameras'], ['future', 'Newer cameras'], ['legacy', 'Legacy demo']]) {
      fs.mkdirSync(path.join(root, id), { recursive: true })
      const db = new Database(path.join(root, id, 'study.db'))
      registerCameraTimeFunctions(db)
      db.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at INTEGER)')
      for (const migration of migrations.slice(0, ['broken', 'legacy'].includes(id) ? 17 : undefined)) {
        db.transaction(() => {
          for (const statement of migration.sql) db.exec(statement)
          db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(migration.hash, migration.folderMillis)
        })()
      }
      db.prepare('INSERT INTO metadata (id, name, title, created, importerName) VALUES (?, ?, ?, ?, ?)')
        .run(id, title, title, '2026-01-01T00:00:00Z', 'camtrap/datapackage')
      if (id === 'legacy') {
        db.exec(\`INSERT INTO deployments (deploymentID) VALUES ('d');
          INSERT INTO media (mediaID, deploymentID, timestamp) VALUES
            ('a', 'd', '2024-05-01T20:30:00Z'), ('b', 'd', '2024-05-15T21:30:00Z');
          INSERT INTO observations (observationID, mediaID, deploymentID, scientificName)
            VALUES ('oa', 'a', 'd', 'Vulpes vulpes'), ('ob', 'b', 'd', 'Vulpes vulpes');\`)
        const migration = migrations[17]
        for (const statement of migration.sql) db.exec(statement)
        db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(migration.hash, migration.folderMillis)
      }
      if (id === 'broken') db.exec('ALTER TABLE media ADD COLUMN sourceTimestamp TEXT')
      if (id === 'future') db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run('future', migrations.at(-1).folderMillis + 1)
      db.close()
    }
    fs.mkdirSync(path.join(root, 'corrupt'), { recursive: true })
    fs.writeFileSync(path.join(root, 'corrupt', 'study.db'), 'not a database')
    })().catch((error) => { console.error(error); process.exitCode = 1 })
  `)
  electronApp = await electron.launch({
    args: [
      path.join(projectRoot, 'out/main/index.js'),
      `--user-data-dir=${profile}`,
      ...(process.env.CI ? ['--no-sandbox'] : [])
    ],
    env: { ...process.env, NODE_ENV: 'test' }
  })
  window = await electronApp.firstWindow()
  await expect(window.getByTestId('studies-sidebar')).toBeVisible({ timeout: 30000 })
})

test.afterAll(async () => {
  await electronApp?.close()
  if (profile) rmSync(profile, { recursive: true, force: true })
})

test('startup isolates failures and a per-study retry restores access', async () => {
  const studies = await window.evaluate(() => window.api.getStudies())
  expect(Object.fromEntries(studies.map((study) => [study.id, study.database.status]))).toEqual({
    broken: 'migration-failed',
    healthy: 'ready',
    future: 'newer',
    corrupt: 'migration-failed',
    legacy: 'ready'
  })
  await window.getByTestId('study-item-legacy').click()
  await window.getByRole('link', { name: 'Explore', exact: true }).click()
  await expect(
    window.getByRole('button', { name: 'Show filter charts', exact: true })
  ).toBeVisible()
  await window.getByRole('button', { name: 'Show filter charts', exact: true }).click()
  await expect(window.locator('[title="Daily activity — camera-local clock time"]')).toBeVisible()
  const legacyActivity = await window.evaluate(() =>
    window.api.getSequenceAwareDailyActivity({
      studyId: 'legacy',
      speciesNames: ['Vulpes vulpes'],
      startDate: '2024-05-01T00:00:00.000Z',
      endDate: '2024-05-16T00:00:00.000Z'
    })
  )
  expect(legacyActivity.error).toBeUndefined()
  expect(legacyActivity.data.find((row) => row.hour === 20)['Vulpes vulpes']).toBe(1)
  expect(legacyActivity.data.find((row) => row.hour === 21)['Vulpes vulpes']).toBe(1)
  await window.getByTestId('study-item-broken').click()
  await expect(window.getByRole('heading', { name: 'This study couldn’t be opened' })).toBeVisible()
  await expect(window.getByRole('navigation', { name: 'Tabs' })).toHaveCount(0)
  await expect(
    window.getByTestId('study-item-broken').getByLabel('Study unavailable')
  ).toBeVisible()
  await expect(window.getByRole('link', { name: 'Contact support' })).toHaveAttribute(
    'href',
    'https://www.earthtoolsmaker.org/contact/'
  )

  // Stub only clipboard writes to avoid replacing the user's system clipboard.
  await window.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.copiedDiagnostics = text
        }
      }
    })
  )
  await window.getByRole('button', { name: 'Copy diagnostic details' }).click()
  const diagnostics = JSON.parse(await window.evaluate(() => window.copiedDiagnostics))
  expect(diagnostics.studyId).toBe('broken')
  expect(diagnostics.expectedVersion).toMatch(/^0018_/)
  expect(diagnostics.currentVersion).toMatch(/^0016_/)
  expect(diagnostics.error).toContain('duplicate column name')

  // Normal IPC and worker entry points must be blocked, not merely the tabs.
  const blocked = await window.evaluate(async () => ({
    overview: await window.api.getOverviewStats('broken'),
    merge: await window.api.mergePreflight('healthy', 'broken'),
    metadata: await window.api
      .getStudyMetadata('broken')
      .catch((error) => ({ error: error.message }))
  }))
  for (const result of Object.values(blocked))
    expect(result.error).toContain('duplicate column name')

  await window.getByRole('button', { name: 'Retry update', exact: true }).click()
  await expect(window.getByRole('button', { name: 'Retry update', exact: true })).toBeEnabled()
  await expect(window.getByRole('heading', { name: 'This study couldn’t be opened' })).toBeVisible()

  await window.getByTestId('study-item-healthy').click()
  await expect(window.getByRole('navigation', { name: 'Tabs' })).toBeVisible()
  await window.getByTestId('study-item-future').click()
  await expect(
    window.getByRole('heading', { name: 'This study needs a newer Biowatch version' })
  ).toBeVisible()
  await expect(window.getByRole('button', { name: 'Retry update', exact: true })).toHaveCount(0)
  expect((await window.evaluate(() => window.api.retryStudyDatabaseUpdate('future'))).status).toBe(
    'newer'
  )

  await window.getByTestId('study-item-corrupt').click()
  await expect(window.getByRole('heading', { name: 'This study couldn’t be opened' })).toBeVisible()
  await window.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(window.getByRole('heading', { name: 'This study couldn’t be opened' })).toHaveCount(
    0
  )
  await window.getByTestId('add-study-btn').click()
  await expect(window.getByRole('heading', { name: 'This study couldn’t be opened' })).toHaveCount(
    0
  )

  // Remove the deliberate schema conflict, then exercise the real retry IPC.
  sqliteScript(`
    const Database = require('better-sqlite3')
    const db = new Database(${JSON.stringify(path.join(profile, 'biowatch-data/studies/broken/study.db'))})
    db.exec('ALTER TABLE media DROP COLUMN sourceTimestamp')
    db.close()
  `)
  await window.getByTestId('study-item-broken').click()
  await window.getByRole('button', { name: 'Retry update', exact: true }).click()
  await expect(window.getByRole('navigation', { name: 'Tabs' })).toBeVisible()
  await expect(window.getByTestId('study-item-broken').getByLabel('Study unavailable')).toHaveCount(
    0
  )
  const recovered = await window.evaluate(async () => ({
    study: (await window.api.getStudies()).find((study) => study.id === 'broken'),
    overview: await window.api.getOverviewStats('broken')
  }))
  expect(recovered.study.database.status).toBe('ready')
  expect(recovered.overview.error).toBeUndefined()
})
