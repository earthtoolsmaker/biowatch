export default async function ({ page, shoot }) {
  await page.evaluate(() => {
    window.location.hash = '#/import'
  })
  await page.waitForTimeout(1500)

  // LILA combobox already defaults to Biome Health Maasai Mara 2018.
  // Click the Select button in the LILA row.
  await page
    .locator('div')
    .filter({ hasText: /^LILA/ })
    .getByRole('button', { name: 'Select' })
    .first()
    .click()
  await page.waitForTimeout(4000)
  await shoot('08-lila-import-progress')

  for (let i = 0; i < 180; i++) {
    if (page.url().includes('/study/')) break
    await page.waitForTimeout(5000)
  }
  console.log('done:', page.url())
  await page.waitForTimeout(3000)
  await shoot('09-lila-study-overview')
}
