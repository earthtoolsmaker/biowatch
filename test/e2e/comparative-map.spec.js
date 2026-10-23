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
    expect(Number(await window.getByRole('status').innerText())).toBeGreaterThanOrEqual(0.333)
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
    await expect(window.locator('[data-comparative-raster]')).toHaveCount(0)
    await window.getByRole('button', { name: 'Select 2 taxonomies' }).click()
    await expect(comparative).toHaveAttribute('aria-pressed', 'true')
    await expect(window.locator('[data-comparative-raster]')).toHaveCount(1)
  })

  test('includes both sides of the antimeridian, including wrapped world copies', async ({
    window
  }) => {
    await window.getByRole('button', { name: 'Use antimeridian observations' }).click()
    await window.getByRole('button', { name: 'Select 2 taxonomies' }).click()
    await window.evaluate(() => window.comparativeTestMap.setView([0, 180], 6, { animate: false }))
    await window.getByRole('button', { name: 'Filter to this area', exact: true }).click()
    await window.getByRole('button', { name: 'Comparative', exact: true }).click()
    await expect(window.getByRole('status')).toHaveText(/^0\.\d{3}$/)
    const score = Number(await window.getByRole('status').innerText())
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
    await expect(window.getByLabel('Comparative density legend')).not.toContainText(
      'No data in comparison area'
    )
    await window.evaluate(() => window.comparativeTestMap.setView([0, 540], 6, { animate: false }))
    await expect(window.getByRole('status')).toHaveText(score.toFixed(3))
    await expect(window.locator('[data-comparative-raster]')).toBeInViewport()
    await window.getByRole('button', { name: 'Filter to this area', exact: true }).click()
    await expect(window.getByRole('status')).toHaveText(score.toFixed(3))
  })

  test('keeps scores stable during navigation and updates them using the existing area filter', async ({
    window
  }) => {
    const errors = []
    const onError = (error) => errors.push(error.message)
    window.on('pageerror', onError)
    try {
      await window.getByRole('button', { name: 'Select 2 taxonomies' }).click()
      await window.getByRole('button', { name: 'Comparative', exact: true }).click()
      const raster = window.locator('[data-comparative-raster]')
      await window.getByRole('button', { name: 'Difference', exact: true }).click()
      await raster.evaluate((image) => image.decode())
      const rendered = await raster.evaluate((image) => {
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
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
      const studyRaster = await raster.getAttribute('src')
      await expect(window.getByRole('status')).toHaveText('0.500')
      await window.evaluate(() => window.comparativeTestMap.setZoom(7, { animate: false }))
      await window.evaluate(
        () =>
          new Promise((resolve) => {
            window.comparativeTestMap.once('moveend', () => resolve())
            window.comparativeTestMap.panTo([0, -5], { animate: true, duration: 0.3 })
          })
      )
      await expect(window.getByRole('status')).toHaveText('0.500')
      await expect(raster).toHaveAttribute('src', studyRaster)
      await expect(window.getByLabel('Comparative density legend')).toContainText(
        'all study locations'
      )
      await window.getByRole('button', { name: 'Filter to this area', exact: true }).click()
      await expect(window.getByRole('status')).toHaveText('1.000')
      await expect(window.getByLabel('Comparative density legend')).toContainText(
        'No data in comparison area for: Taxonomy B'
      )
      await expect(window.getByLabel('Comparative density legend')).toContainText(
        'the filtered area'
      )
      await window.getByRole('button', { name: 'Overlap', exact: true }).click()
      await expect(window.getByRole('status')).toHaveText('0.000')
      await window.getByRole('button', { name: 'Difference', exact: true }).click()
      await expect(window.getByRole('status')).toHaveText('1.000')
      const filteredRaster = await raster.getAttribute('src')
      await window.evaluate(() =>
        window.comparativeTestMap.setView([50, 50], 7, { animate: false })
      )
      await expect(window.getByRole('status')).toHaveText('1.000')
      await expect(raster).toHaveAttribute('src', filteredRaster)
      // Applying again replaces the old snapshot with the new empty area.
      await window.getByRole('button', { name: 'Filter to this area', exact: true }).click()
      await expect(window.getByRole('status')).toHaveText('No data in comparison area')
      await window.evaluate(() => window.comparativeTestMap.setView([0, 0], 6, { animate: false }))
      await expect(window.getByRole('status')).toHaveText('No data in comparison area')
      await window.getByRole('button', { name: 'Filter to this area', exact: true }).click()
      await expect(window.getByRole('status')).toHaveText('0.500')
      const reappliedRaster = await raster.getAttribute('src')
      await window.getByRole('button', { name: 'Resize map' }).click()
      await expect
        .poll(() => window.evaluate(() => window.comparativeTestMap.getSize().x))
        .toBe(400)
      await expect(window.getByRole('status')).toHaveText('0.500')
      await expect(raster).toHaveAttribute('src', reappliedRaster)
      await window.getByRole('button', { name: 'Clear area filter', exact: true }).click()
      await expect(window.getByRole('status')).toHaveText('0.500')
      await expect(raster).toHaveAttribute('src', studyRaster)
      await expect(window.getByLabel('Comparative density legend')).toContainText(
        'all study locations'
      )
      await window.getByRole('button', { name: 'Density', exact: true }).click()
      await expect(raster).toHaveCount(0)
      await expect(window.getByLabel('Comparative density legend')).toHaveCount(0)
      expect(errors).toEqual([])
    } finally {
      window.off('pageerror', onError)
    }
  })
})
