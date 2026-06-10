/**
 * Import a GBIF dataset by name match.
 * Set GBIF_DATASET to a regex matching the catalog entry, SHOT_PREFIX for output names.
 */
export default async function ({ page, shoot }) {
  const pattern = new RegExp(process.env.GBIF_DATASET)
  const prefix = process.env.SHOT_PREFIX || 'gbif'

  await page.evaluate(() => {
    window.location.hash = '#/import'
  })
  await page.waitForTimeout(1500)

  const combos = page.locator('[role="combobox"]')
  await combos.nth(1).click()
  await page.waitForTimeout(600)
  await page.getByRole('option', { name: pattern }).click()
  await page.waitForTimeout(400)

  await page
    .locator('div')
    .filter({ hasText: /^GBIF/ })
    .getByRole('button', { name: 'Select' })
    .first()
    .click()
  await page.waitForTimeout(3000)

  for (let i = 0; i < 120; i++) {
    if (page.url().includes('/study/')) break
    await page.waitForTimeout(5000)
  }
  console.log('done:', page.url())
  await page.waitForTimeout(3000)
  await shoot(`${prefix}-overview`)
}
