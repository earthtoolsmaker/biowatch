const { test, expect } = require('./fixtures')

test.describe('Demo Dataset Import', () => {
  test('can import demo dataset and navigate to study', async ({ window }) => {
    // Wait for the app to be ready
    await expect(window.getByTestId('studies-sidebar')).toBeVisible({ timeout: 30000 })

    // Navigate to import page
    await window.getByTestId('add-study-btn').click()

    // Wait for import page to load
    await expect(window.getByRole('heading', { name: 'Demo Dataset' })).toBeVisible()

    // Click demo import button
    await window.getByTestId('import-demo-btn').click()

    // Wait for the progress modal to appear
    await expect(window.getByTestId('demo-progress-modal')).toBeVisible({ timeout: 10000 })

    // Wait for import to complete - the modal will close and navigate to study page
    // (up to 3 minutes for download + import)
    await window.waitForURL(/#\/study\//, { timeout: 180000 })

    // Verify the progress modal is closed
    await expect(window.getByTestId('demo-progress-modal')).not.toBeVisible({ timeout: 5000 })

    // Verify study appears in sidebar
    await expect(window.getByTestId('studies-list')).toContainText('Demo', { timeout: 5000 })
  })
})
