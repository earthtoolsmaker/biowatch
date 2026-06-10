/**
 * Import a LILA dataset by name match.
 * Set LILA_DATASET to a regex matching the catalog entry, SHOT_PREFIX for output names.
 */
export default async function ({ page, shoot }) {
  const pattern = new RegExp(process.env.LILA_DATASET)
  const prefix = process.env.SHOT_PREFIX || 'lila'

  await page.evaluate(() => {
    window.location.hash = '#/import'
  })
  await page.waitForTimeout(1500)

  const combos = page.locator('[role="combobox"]')
  await combos.nth(2).click()
  await page.waitForTimeout(600)
  await page.getByRole('option', { name: pattern }).click()
  await page.waitForTimeout(400)

  await page
    .locator('div')
    .filter({ hasText: /^LILA/ })
    .getByRole('button', { name: 'Select' })
    .first()
    .click()
  await page.waitForTimeout(3000)

  for (let i = 0; i < 180; i++) {
    if (page.url().includes('/study/')) break
    await page.waitForTimeout(5000)
  }
  console.log('done:', page.url())
  await page.waitForTimeout(3000)
  await shoot(`${prefix}-overview`)
}
