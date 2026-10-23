const path = require('path')
const { test, expect } = require('./fixtures')

// Exercise the real Leaflet layer and controls with deterministic observations,
// without downloading a dataset, making SQL calls, or requesting basemap tiles.
test.describe('Comparative map', () => {
  let server
  let fixtureUrl
  let appUrl

  test.beforeAll(async ({ window }) => {
    const [{ createServer }, { default: react }, { default: tailwindcss }] = await Promise.all([
      import('vite'),
      import('@vitejs/plugin-react'),
      import('@tailwindcss/vite')
    ])
    server = await createServer({
      configFile: false,
      root: path.resolve(__dirname, '../..'),
      plugins: [react(), tailwindcss()],
      server: { host: '127.0.0.1', port: 0 },
      optimizeDeps: {
        include: [
          'react',
          'react-dom/client',
          'react-leaflet',
          'leaflet',
          '@radix-ui/react-tooltip',
          'lucide-react'
        ]
      }
    })
    await server.listen()
    fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/test/e2e/fixtures/comparative-map.html`
    appUrl = window.url()
  })

  test.beforeEach(async ({ window }) => {
    await window.goto(fixtureUrl)
    await expect(window.getByRole('button', { name: 'Comparative', exact: true })).toBeVisible()
  })

  test.afterAll(async ({ window }) => {
    if (appUrl) await window.goto(appUrl)
    await server?.close()
  })

  test('enforces tag constraints, tooltips, and safe fallback as selections change', async ({
    window
  }) => {
    const comparative = window.getByRole('button', { name: 'Comparative', exact: true })
    await expect(comparative).toBeDisabled()
    await comparative.hover()
    await expect(window.getByRole('tooltip')).toContainText(
      'Select multiple taxonomies to compare distributions'
    )
    await window.getByRole('button', { name: 'Select 2 taxonomies' }).click()
    await comparative.click()
    await expect(window.getByRole('button', { name: 'Overlap', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(window.getByRole('status')).toHaveText('0.500')
    await window.getByRole('button', { name: 'Difference', exact: true }).click()
    await expect(window.getByLabel('Comparative density legend')).toContainText('Imbalance ratio')
    await expect(window.getByRole('status')).toHaveText('0.500')
    await window.getByRole('button', { name: 'Select 3 taxonomies' }).click()
    const difference = window.getByRole('button', { name: 'Difference', exact: true })
    await expect(difference).toBeDisabled()
    await expect
      .poll(async () => Number(await window.getByRole('status').innerText()))
      .toBeLessThan(0.5)
    expect(Number(await window.getByRole('status').innerText())).toBeGreaterThan(1 / 3)
    await expect(window.getByRole('button', { name: 'Overlap', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await difference.hover()
    await expect(window.getByRole('tooltip')).toContainText(
      'Difference requires exactly two selected taxonomies'
    )
    await window.getByRole('button', { name: 'Select 1 taxonomies' }).click()
    await expect(comparative).toBeDisabled()
    await expect(window.getByRole('button', { name: 'Abundance', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(window.locator('canvas[data-comparative-raster]')).toHaveCount(0)
    await window.getByRole('button', { name: 'Select 2 taxonomies' }).click()
    await expect(comparative).toHaveAttribute('aria-pressed', 'true')
    await expect(window.locator('canvas[data-comparative-raster]')).toHaveCount(1)
  })

  test('includes both sides of the antimeridian, including wrapped world copies', async ({
    window
  }) => {
    await window.getByRole('button', { name: 'Use antimeridian observations' }).click()
    await window.getByRole('button', { name: 'Select 2 taxonomies' }).click()
    await window.evaluate(() => window.comparativeTestMap.setView([0, 180], 6, { animate: false }))
    await window.getByRole('button', { name: 'Comparative', exact: true }).click()
    await expect(window.getByRole('status')).toHaveText(/^0\.\d{3}$/)
    const score = Number(await window.getByRole('status').innerText())
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
    await expect(window.getByLabel('Comparative density legend')).not.toContainText(
      'No visible data'
    )
    await window.evaluate(() => window.comparativeTestMap.setView([0, 540], 6, { animate: false }))
    await expect(window.getByRole('status')).toHaveText(score.toFixed(3))
  })

  test('renders signed colors and updates the surface and live score after pan, zoom, and resize', async ({
    window
  }) => {
    const errors = []
    const onError = (error) => errors.push(error.message)
    window.on('pageerror', onError)
    try {
      await window.getByRole('button', { name: 'Select 2 taxonomies' }).click()
      await window.getByRole('button', { name: 'Comparative', exact: true }).click()
      const raster = window.locator('canvas[data-comparative-raster]')
      const originalWidth = await raster.evaluate((canvas) => canvas.width)
      await window.getByRole('button', { name: 'Difference', exact: true }).click()
      const rendered = await raster.evaluate((canvas) => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        let positive = false
        let negative = false
        let transparent = false
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] === 0) transparent = true
          if (pixels[i + 3] > 150 && pixels[i + 1] > pixels[i]) positive = true
          if (pixels[i + 3] > 150 && pixels[i] > pixels[i + 2]) negative = true
        }
        return { positive, negative, transparent }
      })
      expect(rendered).toEqual({ positive: true, negative: true, transparent: true })
      await window.evaluate(() => window.comparativeTestMap.setZoom(7, { animate: false }))
      await window.evaluate(() => {
        window.comparativeLiveUpdated = false
        const status = document.querySelector('[role="status"]')
        const observer = new MutationObserver(() => {
          if (Number(status.textContent) > 0.51) window.comparativeLiveUpdated = true
        })
        observer.observe(status, { subtree: true, characterData: true, childList: true })
        window.comparativeTestMap.once('moveend', () => observer.disconnect())
        window.comparativeTestMap.panTo([0, -5], { animate: true, duration: 1.5 })
      })
      await expect.poll(() => window.evaluate(() => window.comparativeLiveUpdated)).toBe(true)
      await expect(window.getByRole('status')).toHaveText('1.000')
      await expect(window.getByLabel('Comparative density legend')).toContainText(
        'No visible data for: Taxonomy B'
      )
      await window.evaluate(() =>
        window.comparativeTestMap.setView([50, 50], 7, { animate: false })
      )
      await expect(window.getByRole('status')).toHaveText('No visible data')
      await expect
        .poll(() =>
          raster.evaluate((canvas) => {
            const pixels = canvas
              .getContext('2d')
              .getImageData(0, 0, canvas.width, canvas.height).data
            return pixels.every((value) => value === 0)
          })
        )
        .toBe(true)
      await window.evaluate(() => window.comparativeTestMap.setView([0, 0], 6, { animate: false }))
      await expect(window.getByRole('status')).toHaveText('0.500')
      await window.getByRole('button', { name: 'Resize map' }).click()
      await expect.poll(() => raster.evaluate((canvas) => canvas.width)).toBeLessThan(originalWidth)
      await window.getByRole('button', { name: 'Density', exact: true }).click()
      await expect(raster).toHaveCount(0)
      await expect(window.getByLabel('Comparative density legend')).toHaveCount(0)
      expect(errors).toEqual([])
    } finally {
      window.off('pageerror', onError)
    }
  })
})
