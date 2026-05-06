const { test, expect } = require('./fixtures')

test.describe('Theme toggle', () => {
  test.beforeEach(async ({ window }) => {
    await expect(window.getByTestId('studies-sidebar')).toBeVisible({ timeout: 30000 })
    // Reset to a known state — system source — between tests so they don't
    // bleed into each other when the worker-scoped app stays open.
    await window.evaluate(() => window.api.setThemeSource('system'))
  })

  test('selecting Dark adds dark class to html', async ({ window }) => {
    await window.locator('a[href="#/settings/ml_zoo"]').click()
    await window.locator('a[href="#/settings/appearance"]').click()
    await window.getByTestId('theme-segment-dark').click()
    await expect(window.locator('html')).toHaveClass(/dark/)
  })

  test('selecting Light removes dark class', async ({ window }) => {
    await window.locator('a[href="#/settings/appearance"]').click()
    await window.getByTestId('theme-segment-light').click()
    await expect(window.locator('html')).not.toHaveClass(/dark/)
  })

  test('selecting System shows resolved helper text', async ({ window }) => {
    await window.locator('a[href="#/settings/appearance"]').click()
    await window.getByTestId('theme-segment-system').click()
    const helperText = window.getByText(/Following system preference \(currently (Light|Dark)\)/)
    await expect(helperText).toBeVisible()
  })
})
