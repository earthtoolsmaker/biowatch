const { test, expect, _electron: electron } = require('@playwright/test')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '../..')
let profile, app, window

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(tmpdir(), 'biowatch-solar-e2e-'))
  execFileSync(
    require('electron'),
    [
      '-e',
      `
    ;(async () => {
      const { registerCameraTimeFunctions } = await import('./src/main/services/cameraTime.js')
      const { readMigrationFiles } = require('drizzle-orm/migrator')
      const Database = require('better-sqlite3')
      const fs = require('node:fs'), path = require('node:path')
      const dir = path.join(${JSON.stringify(profile)}, 'biowatch-data', 'studies', 'solar')
      fs.mkdirSync(dir, { recursive: true })
      const db = new Database(path.join(dir, 'study.db'))
      registerCameraTimeFunctions(db)
      db.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at INTEGER)')
      for (const migration of readMigrationFiles({ migrationsFolder: 'src/main/database/migrations' })) {
        db.transaction(() => {
          for (const statement of migration.sql) db.exec(statement)
          db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(migration.hash, migration.folderMillis)
        })()
      }
      db.exec(\
        \`INSERT INTO metadata (id, name, title, created, importerName, sequenceGap) VALUES ('solar', 'Solar fixture', 'Solar fixture', '2024-01-01T00:00:00Z', 'camtrap/datapackage', 0);
        INSERT INTO deployments (deploymentID, latitude, longitude, deploymentStart, deploymentEnd) VALUES ('d', 48, 2, '2024-06-17T00:00:00Z', '2024-07-01T00:00:00Z');
        INSERT INTO media (mediaID, deploymentID, sourceTimestamp, filePath) VALUES ('one', 'd', '2024-06-21T22:30:00+02:00', '/synthetic-one.jpg'), ('last', 'd', '2024-06-30T22:30:00+02:00', '/synthetic-last.jpg');
        INSERT INTO observations (observationID, mediaID, deploymentID, scientificName, observationType) VALUES ('o1', 'one', 'd', 'Vulpes vulpes', 'animal'), ('o2', 'last', 'd', 'Vulpes vulpes', 'animal');\`)
      const extra = db.prepare("INSERT INTO observations (observationID, mediaID, deploymentID, scientificName, observationType) VALUES (?, ?, 'd', 'Vulpes vulpes', 'animal')")
      for (let i = 0; i < 8; i++) extra.run('extra-' + i, i < 4 ? 'one' : 'last')
      db.close()
    })().catch((error) => { console.error(error); process.exitCode = 1 })
  `
    ],
    { cwd: projectRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }
  )
  app = await electron.launch({
    args: [
      path.join(projectRoot, 'out/main/index.js'),
      `--user-data-dir=${profile}`,
      ...(process.env.CI ? ['--no-sandbox'] : [])
    ],
    env: { ...process.env, NODE_ENV: 'test' }
  })
  window = await app.firstWindow()
  // Resize the native window as well as the viewport so pointer hit testing
  // reaches the docked species rail on runners with smaller default screens.
  const browserWindow = await app.browserWindow(window)
  await browserWindow.evaluate((win) => {
    win.setContentSize(1024, 768)
    win.setPosition(0, 0)
    win.show()
    win.focus()
  })
  await browserWindow.dispose()
  await window.setViewportSize({ width: 1024, height: 768 })
  await window.bringToFront()
  await expect.poll(() => window.evaluate(() => document.hasFocus())).toBe(true)
  window.on('pageerror', (error) => console.error('Solar fixture renderer error:', error.message))
  await expect(window.getByTestId('study-item-solar')).toBeVisible({ timeout: 30000 })
  await window.getByTestId('study-item-solar').click()
})

test.afterAll(async () => {
  await app?.close()
  if (profile) rmSync(profile, { recursive: true, force: true })
})

test('real IPC agrees on solar bins and filtering; shared mode/selection survives navigation and reload', async () => {
  const result = await window.evaluate(async () => {
    const clock = await window.api.getSequenceAwareDailyActivity({
      studyId: 'solar',
      speciesNames: ['Vulpes vulpes']
    })
    const solar = await window.api.getSequenceAwareDailyActivity({
      studyId: 'solar',
      speciesNames: ['Vulpes vulpes'],
      timeMode: 'solar'
    })
    const hour = solar.data.find((row) => row['Vulpes vulpes'] > 0).hour
    const filtered = await window.api.getSequences('solar', {
      gapSeconds: 0,
      limit: 20,
      filters: { timeRange: { mode: 'solar', ranges: [{ start: hour, end: hour + 1 }] } }
    })
    return { clock, solar, filtered }
  })
  expect(result.clock.error).toBeUndefined()
  expect(result.clock.data[22]['Vulpes vulpes']).toBe(10)
  expect(result.solar.error).toBeUndefined()
  expect(result.solar.data.reduce((n, row) => n + row['Vulpes vulpes'], 0)).toBe(10)
  expect(result.filtered.error).toBeUndefined()
  expect(result.filtered.data.sequences.flatMap((s) => s.items).length).toBeGreaterThan(0)

  await window.getByRole('link', { name: 'Explore', exact: true }).click()
  const show = window.getByRole('button', { name: 'Show filter charts', exact: true })
  await expect(show).toBeVisible()
  // This gate requires all 10 detections. Weekly-label bounds would lose the
  // final week, leave only 5, and incorrectly hide the hovercard activity.
  await window.locator('.group[data-state]').filter({ hasText: 'Vulpes vulpes' }).first().hover()
  await expect(window.getByText('Activity patterns · Solar Time', { exact: true })).toBeVisible()
  await show.click()
  await expect(window.getByRole('button', { name: 'Solar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(window.getByText('Solar hours: sunrise', { exact: false })).toHaveCount(0)
  const saved = () => window.evaluate(() => JSON.parse(localStorage.getItem('timeFilter:solar')))
  expect(await saved()).toBeNull()
  const panel = window.locator('[title="Daily activity — normalized solar hours"]')
  const circle = panel.getByTestId('time-filter-circle')
  await expect(circle).toHaveAttribute(
    'data-selected-ranges',
    JSON.stringify([{ start: 0, end: 24 }])
  )
  for (const name of ['Dawn', 'Day', 'Dusk', 'Night']) {
    const icon = panel.getByRole('button', { name, exact: true })
    await expect(icon).toHaveAttribute('aria-pressed', 'false')
    await icon.click()
    expect((await saved()).selection.keys).toEqual([name.toLowerCase()])
    await icon.click()
    expect((await saved()).selection.keys).toEqual([])
  }
  await panel.getByRole('button', { name: 'Show all hours', exact: true }).click()
  expect((await saved()).selection.keys).toEqual([])
  await expect(circle).toHaveAttribute(
    'data-selected-ranges',
    JSON.stringify([{ start: 0, end: 24 }])
  )
  // Probe actual SVG hit testing across the circle, not overlapping path bounds.
  const hits = await circle.evaluate((svg) => {
    const box = svg.getBoundingClientRect()
    const cx = box.x + box.width / 2,
      cy = box.y + box.height / 2
    const failures = []
    for (const radius of [24, 40]) {
      for (let hour = 0.25; hour < 24; hour += 0.5) {
        const angle = (hour / 24) * 2 * Math.PI - Math.PI / 2
        const target = document.elementFromPoint(
          cx + radius * Math.cos(angle),
          cy + radius * Math.sin(angle)
        )
        const expected =
          hour >= 5 && hour < 7
            ? 'dawn'
            : hour >= 17 && hour < 19
              ? 'dusk'
              : hour >= 7 && hour < 17
                ? 'day'
                : 'night'
        if (target?.dataset.solarPeriod !== expected)
          failures.push({ hour, radius, target: target?.outerHTML })
      }
    }
    return failures
  })
  expect(hits).toEqual([])
  for (const name of ['Dawn', 'Day', 'Dusk', 'Night']) {
    const area = panel.getByRole('button', { name: `${name} area`, exact: true })
    // Aim inside each wedge rather than its overlapping rectangular bounds.
    const hour = { Dawn: 6, Day: 12, Dusk: 18, Night: 0 }[name]
    const box = await circle.boundingBox()
    const angle = (hour / 24) * 2 * Math.PI - Math.PI / 2
    const position = {
      x: box.width / 2 + 30 * Math.cos(angle),
      y: box.height / 2 + 30 * Math.sin(angle)
    }
    const idleFill = await area.evaluate((node) => getComputedStyle(node).fill)
    // Locator actions wait for layout changes after filtering to settle.
    await circle.hover({ position })
    await expect(area).not.toHaveCSS('fill', idleFill)
    await circle.click({ position })
    expect((await saved()).selection.keys).toEqual([name.toLowerCase()])
    await circle.click({ position })
    expect((await saved()).selection.keys).toEqual([])
  }
  await panel.getByRole('button', { name: 'Day area', exact: true }).focus()
  await window.keyboard.press('Enter')
  expect((await saved()).selection.keys).toEqual(['day'])
  await expect(circle).toHaveAttribute(
    'data-selected-ranges',
    JSON.stringify([{ start: 7, end: 17 }])
  )
  await expect(circle.locator('text')).toHaveCount(0)
  const box = await circle.boundingBox()
  const positions = await Promise.all(
    ['Night', 'Dawn', 'Day', 'Dusk'].map((name) =>
      panel.getByRole('button', { name, exact: true }).boundingBox()
    )
  )
  expect(positions[0].y).toBeLessThan(box.y + box.height / 2)
  expect(positions[1].x).toBeGreaterThan(box.x + box.width / 2)
  expect(positions[2].y).toBeGreaterThan(box.y + box.height / 2)
  expect(positions[3].x).toBeLessThan(box.x + box.width / 2)
  expect(
    (await panel.getByRole('button', { name: 'Solar', exact: true }).boundingBox()).y
  ).toBeLessThan(box.y)
  const screenshot = test.info().outputPath('solar-period-controls.png')
  await window.screenshot({ path: screenshot })
  await test.info().attach('solar-period-controls', { path: screenshot, contentType: 'image/png' })
  await panel.getByRole('radio', { name: 'X–Y line', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  for (const name of ['Dawn', 'Day', 'Dusk', 'Night']) {
    const area = panel.getByRole('button', { name: `${name} area`, exact: true }).first()
    await area.click()
    expect((await saved()).selection.keys).toEqual([name.toLowerCase()])
    await area.click()
    expect((await saved()).selection.keys).toEqual([])
  }
  expect((await saved()).selection.keys).toEqual([])
  await panel.getByRole('button', { name: 'Day', exact: true }).click()
  await panel.getByRole('radio', { name: 'Polar', exact: true }).click()
  await expect(circle).toHaveAttribute(
    'data-selected-ranges',
    JSON.stringify([{ start: 7, end: 17 }])
  )

  await window.getByRole('link', { name: 'Media', exact: true }).click()
  await expect(window.getByRole('button', { name: 'Solar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(window.getByRole('button', { name: 'Dawn', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  await window.evaluate(() => {
    window.location.hash =
      '#/study/solar/media?species=Vulpes+vulpes&deployment=d&sort=oldest&from=2024-06-17T00%3A00%3A00Z&to=2024-07-01T00%3A00%3A00Z'
  })
  const otherFilters = await window.evaluate(() => window.location.hash)
  await window.getByRole('button', { name: 'Clock', exact: true }).click()
  expect(await window.evaluate(() => window.location.hash)).toBe(otherFilters)
  expect((await saved()).mode).toBe('clock')
  expect((await saved()).selection.keys).toEqual([])
  await window.getByRole('link', { name: 'Explore', exact: true }).click()
  await expect(window.getByRole('button', { name: 'Clock', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await window.reload()
  await expect(window.getByRole('button', { name: 'Clock', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(window.getByRole('button', { name: 'Dawn', exact: true })).toHaveCount(0)
  const clockCircle = window.getByTestId('time-filter-circle')
  await expect(clockCircle.locator('text')).toHaveText(['0h', '6h', '12h', '18h'])
  // Without the old bottom presets, clock selection must remain draggable.
  // Locator hover waits for the filter row's opening animation to settle.
  await clockCircle.locator('circle[cursor="pointer"]').last().hover()
  const clockBox = await clockCircle.boundingBox()
  const cx = clockBox.x + clockBox.width / 2,
    cy = clockBox.y + clockBox.height / 2
  await window.mouse.down()
  await window.mouse.move(cx + 46, cy, { steps: 8 })
  await window.mouse.up()
  await expect.poll(async () => (await saved()).selection.kind).toBe('ranges')
  const selected = (await saved()).selection.ranges[0]
  expect(selected.start).toBe(0)
  expect(selected.end).toBeGreaterThan(5.9)
  expect(selected.end).toBeLessThan(6.1)
})
