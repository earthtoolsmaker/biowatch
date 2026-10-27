const path = require('path')
const { test: base, expect } = require('./fixtures')

// An isolated renderer window without the app's frozen contextBridge API lets
// the fixture supply deterministic IPC responses without touching real data.
const test = base.extend({
  window: [
    async ({ electronApp }, use) => {
      const ready = electronApp.waitForEvent('window')
      await electronApp.evaluate(({ BrowserWindow }) => {
        // Real pointer events and the hover/map ResizeObserver callbacks need
        // a visible renderer; hidden windows throttle requestAnimationFrame.
        const window = new BrowserWindow({
          width: 1440,
          height: 900,
          useContentSize: true,
          show: true
        })
        window.loadURL('about:blank')
      })
      const window = await ready
      await window.setViewportSize({ width: 1440, height: 900 })
      await window.route('**/World_Imagery/**', (route) => route.abort())
      await window.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort())
      await use(window)
      await window.close()
    },
    { scope: 'worker' }
  ]
})

const areaKey = 'areaFilter:location-click-test'
const readArea = (window) =>
  window.evaluate((key) => JSON.parse(localStorage.getItem(key)), areaKey)
const readView = (window) =>
  window.evaluate(() => {
    const map = window.exploreLocationMap
    const bounds = map.getBounds()
    return {
      zoom: map.getZoom(),
      center: { lat: map.getCenter().lat, lng: map.getCenter().lng },
      bounds: {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      }
    }
  })

// Chart queries can briefly collapse/re-expand the chart row. Wait for the
// actual layout transitions (not a fixed sleep) before navigating the map or
// comparing a frozen area snapshot with its viewport.
async function settleMapLayout(window) {
  await expect(window.getByRole('button', { name: 'Expand timeline' })).toBeVisible()
  await window.evaluate(async () => {
    await new Promise(requestAnimationFrame)
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => {}))
    )
    await new Promise(requestAnimationFrame)
    window.exploreLocationMap.invalidateSize({ animate: false })
  })
}

// Exercise actual Explore markers, area-filter persistence, and chart queries
// without downloading observations or querying a database.
test.describe('Explore location click', () => {
  let server
  let fixtureUrl

  test.beforeAll(async () => {
    const [{ createServer }, { default: react }, { default: tailwindcss }] = await Promise.all([
      import('vite'),
      import('@vitejs/plugin-react'),
      import('@tailwindcss/vite')
    ])
    server = await createServer({
      configFile: false,
      root: path.resolve(__dirname, '../..'),
      plugins: [react(), tailwindcss()],
      server: { host: '127.0.0.1', port: 0 }
    })
    await server.listen()
    fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/test/e2e/fixtures/explore-location.html`
  })

  test.beforeEach(async ({ window }) => {
    await window.goto(fixtureUrl)
    await expect(window.locator('img.leaflet-marker-icon')).toHaveCount(2)
    await expect
      .poll(() =>
        window.evaluate(() => window.exploreLocationCalls.some((c) => c.method === 'dailyActivity'))
      )
      .toBe(true)
    await settleMapLayout(window)
  })

  test.afterAll(async () => {
    await server?.close()
  })

  for (const encoding of ['Abundance', 'Composition']) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 640 }
    ]) {
      test(`${encoding} (${viewport.width}px): single click zooms and filters every chart without a modal`, async ({
        window
      }) => {
        const errors = []
        const onError = (error) => errors.push(error.message)
        window.on('pageerror', onError)
        try {
          await window.setViewportSize(viewport)
          await window.getByRole('button', { name: encoding, exact: true }).click()
          await settleMapLayout(window)
          // Initial fitBounds runs before the chart row finishes sizing. Its
          // edge markers can end up clipped/under controls on smaller CI screens.
          // Navigate to a known site, just as a user can, before testing pointers.
          await window.evaluate(() => {
            const map = window.exploreLocationMap
            map.invalidateSize({ animate: false })
            map.setView([50, 4], 12, { animate: false })
          })
          const marker = window.getByTestId('location-50-4')
          await marker.hover()
          await expect(window.locator('.species-hovercard--visible')).toBeVisible()
          expect(await readArea(window)).toBeNull()
          const before = await readView(window)
          await marker.click()
          const after = await readView(window)
          expect(after.zoom).toBeGreaterThan(before.zoom)
          expect(after.zoom).toBe(16)
          expect(after.center).toEqual({ lat: 50, lng: 4 })
          const area = await readArea(window)
          expect(area).toEqual(after.bounds)
          await expect(
            window.getByRole('button', { name: 'Filter to this area', exact: true })
          ).toHaveAttribute('aria-pressed', 'true')
          await expect(window.getByRole('dialog')).toHaveCount(0)
          for (const method of ['distribution', 'timeseries', 'dailyActivity']) {
            await expect
              .poll(() =>
                window.evaluate(
                  ({ method, area }) =>
                    window.exploreLocationCalls.some(
                      (call) =>
                        call.method === method && JSON.stringify(call.bbox) === JSON.stringify(area)
                    ),
                  { method, area }
                )
              )
              .toBe(true)
          }
          // As with the manual pill, the filter is a snapshot, not a live viewport.
          await window.evaluate(() =>
            window.exploreLocationMap.panTo([50.1, 4.1], { animate: false })
          )
          expect(await readArea(window)).toEqual(area)
          await window.getByRole('button', { name: 'Clear area filter', exact: true }).click()
          expect(await readArea(window)).toBeNull()
          await expect(
            window.getByRole('button', { name: 'Filter to this area', exact: true })
          ).toHaveAttribute('aria-pressed', 'false')
          expect(errors).toEqual([])
        } finally {
          window.off('pageerror', onError)
        }
      })
    }
  }

  test('replaces an existing filter, supports keyboard activation, and never zooms out', async ({
    window
  }) => {
    await window.getByRole('button', { name: 'Filter to this area', exact: true }).click()
    const oldArea = await readArea(window)
    await settleMapLayout(window)
    await window.evaluate(() => window.exploreLocationMap.setView([50, 4], 18, { animate: false }))
    const marker = window.getByTestId('location-50-4')
    await marker.focus()
    await marker.press('Enter')
    const view = await readView(window)
    expect(view.zoom).toBe(18)
    expect(await readArea(window)).toEqual(view.bounds)
    expect(await readArea(window)).not.toEqual(oldArea)
  })

  test('cluster clicks still expand locations without applying an area filter', async ({
    window
  }) => {
    await window.evaluate(() =>
      window.exploreLocationMap.setView([50.05, 4.05], 6, { animate: false })
    )
    const cluster = window.locator('.leaflet-marker-icon').first()
    await cluster.click()
    await expect.poll(async () => (await readView(window)).zoom).toBeGreaterThan(6)
    expect(await readArea(window)).toBeNull()
  })
})
