const { test, expect } = require('./fixtures')

test.describe('Study Management', () => {
  // This test suite requires that at least one study exists.
  // Run demo-import.spec.js first, or ensure studies exist in userData.

  test.beforeEach(async ({ window }) => {
    // Wait for the app to be ready
    await expect(window.getByTestId('studies-sidebar')).toBeVisible({ timeout: 30000 })

    // Wait for studies to load and verify at least one exists
    const studiesList = window.getByTestId('studies-list')
    await expect(studiesList.locator('a').first()).toBeVisible({ timeout: 10000 })
  })

  test('can search for studies', async ({ window }) => {
    // Type in the search box
    const searchInput = window.getByTestId('search-studies')
    await searchInput.fill('Demo')

    // Wait for search results to filter
    await window.waitForTimeout(300)

    // Verify the search filters the list (Demo should still be visible)
    const studiesList = window.getByTestId('studies-list')
    await expect(studiesList).toContainText('Demo')

    // Clear search for subsequent tests
    await searchInput.clear()
    await window.waitForTimeout(300)
  })

  test('can rename a study via context menu', async ({ window }) => {
    // Ensure search is cleared (in case previous test left it filled)
    const searchInput = window.getByTestId('search-studies')
    await searchInput.clear()
    await window.waitForTimeout(300)

    // Find a study item and right-click to open context menu
    const studiesList = window.getByTestId('studies-list')
    const firstStudy = studiesList.locator('> div').first()

    // Right-click to open context menu
    await firstStudy.click({ button: 'right' })

    // Wait for context menu to appear
    await expect(window.getByTestId('study-context-menu')).toBeVisible()

    // Click rename
    await window.getByTestId('context-menu-rename').click()

    // Wait for context menu to close
    await expect(window.getByTestId('study-context-menu')).not.toBeVisible()

    // The input should be focused for renaming
    const renameInput = studiesList.locator('input[type="text"]')
    await expect(renameInput).toBeVisible()

    // Clear and type a new name
    await renameInput.clear()
    await renameInput.fill('Renamed Study E2E')
    await renameInput.press('Enter')

    // Wait for UI to settle after rename
    await window.waitForTimeout(500)

    // Verify the name changed in the sidebar
    await expect(studiesList).toContainText('Renamed Study E2E', { timeout: 5000 })

    // Rename it back for consistency in other tests
    await firstStudy.click({ button: 'right' })
    await window.getByTestId('context-menu-rename').click()
    const renameInputAgain = studiesList.locator('input[type="text"]')
    await renameInputAgain.clear()
    await renameInputAgain.fill('Demo')
    await renameInputAgain.press('Enter')

    // Wait for UI to settle
    await window.waitForTimeout(500)

    await expect(studiesList).toContainText('Demo', { timeout: 5000 })
  })

  test('can open delete modal and cancel', async ({ window }) => {
    // Find a study item and right-click to open context menu
    const studiesList = window.getByTestId('studies-list')
    const firstStudy = studiesList.locator('> div').first()

    // Right-click to open context menu
    await firstStudy.click({ button: 'right' })

    // Wait for context menu to appear
    await expect(window.getByTestId('study-context-menu')).toBeVisible()

    // Click delete
    await window.getByTestId('context-menu-delete').click()

    // Wait for delete modal to appear
    await expect(window.getByTestId('delete-modal')).toBeVisible()

    // Verify the modal requires typing the confirmation phrase
    const confirmBtn = window.getByTestId('delete-confirm-btn')
    await expect(confirmBtn).toBeDisabled()

    // Type partial confirmation (should remain disabled)
    await window.getByTestId('delete-confirm-input').fill('delete')
    await expect(confirmBtn).toBeDisabled()

    // Press Escape to cancel
    await window.keyboard.press('Escape')

    // Modal should close
    await expect(window.getByTestId('delete-modal')).not.toBeVisible()
  })

  test('can navigate study tabs', async ({ window }) => {
    // Click on a study to navigate to it
    const studiesList = window.getByTestId('studies-list')
    const firstStudyLink = studiesList.locator('a').first()
    await firstStudyLink.click()

    // Wait for study page to load
    await window.waitForURL(/#\/study\//)

    // Check that tabs are visible by looking for tab links
    await expect(window.getByRole('link', { name: 'Overview' })).toBeVisible()
    await expect(window.getByRole('link', { name: 'Activity' })).toBeVisible()
    await expect(window.getByRole('link', { name: 'Media' })).toBeVisible()
    await expect(window.getByRole('link', { name: 'Deployments' })).toBeVisible()

    // Navigate to Activity tab
    await window.getByRole('link', { name: 'Activity' }).click()
    await window.waitForURL(/#\/study\/.*\/activity/)

    // Navigate to Media tab
    await window.getByRole('link', { name: 'Media' }).click()
    await window.waitForURL(/#\/study\/.*\/media/)

    // Navigate back to Overview
    await window.getByRole('link', { name: 'Overview' }).click()
    await window.waitForURL(/#\/study\/[^/]+$/)
  })
})
