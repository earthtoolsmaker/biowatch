export default async function ({ page, shoot }) {
  await page.evaluate(() => {
    window.location.hash = '#/import'
  })
  await page.waitForTimeout(1500)

  // Select the MICA dataset in the GBIF combobox
  const combos = page.locator('[role="combobox"]')
  await combos.nth(1).click()
  await page.waitForTimeout(600)
  await page.getByRole('option', { name: /MICA Muskrat/ }).click()
  await page.waitForTimeout(400)

  // Click the Select button in the GBIF row (button right after the combobox)
  await page
    .locator('div')
    .filter({ hasText: /^GBIF/ })
    .getByRole('button', { name: 'Select' })
    .first()
    .click()
  await page.waitForTimeout(4000)
  await shoot('06-gbif-import-progress')

  // Wait for the import to finish (study route)
  for (let i = 0; i < 120; i++) {
    if (page.url().includes('/study/')) break
    await page.waitForTimeout(5000)
  }
  console.log('done:', page.url())
  await page.waitForTimeout(3000)
  await shoot('07-gbif-study-overview')
}
