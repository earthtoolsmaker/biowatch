export default async function ({ page, shoot }) {
  // --- 1. Re-run the demo import to catch the progress modal ---
  await page.evaluate(() => {
    window.location.hash = '#/import'
  })
  await page.waitForTimeout(1500)
  await page.getByTestId('import-demo-btn').click()
  await page.waitForTimeout(1200)
  await shoot('01-demo-import-progress')

  // Wait for the duplicate study to finish importing
  for (let i = 0; i < 60; i++) {
    if (page.url().includes('/study/')) break
    await page.waitForTimeout(3000)
  }
  const dupBase = page.url().split('#')[1].replace(/\/$/, '')
  console.log('duplicate study:', dupBase)
  await page.waitForTimeout(2000)

  // --- 2. Delete the duplicate via the study's Danger Zone ---
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${dupBase}/settings`)
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Delete' }).first().click()
  await page.waitForTimeout(1000)
  await page.getByTestId('delete-confirm-input').fill('delete this study')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
  await page.waitForTimeout(2500)
  console.log('after delete:', page.url())

  // --- 3. Explore map encodings on Alpine Tundra: abundance + density ---
  const alpine = page.locator('a', { hasText: 'Alpine Tundra' }).first()
  await alpine.click()
  await page.waitForTimeout(3000)
  const alpBase = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${alpBase}/explore`)
  await page.waitForTimeout(6000)
  await page.getByRole('button', { name: 'Map', exact: true }).first().click()
  await page.waitForTimeout(3000)

  for (const mode of ['Abundance', 'Density']) {
    await page.locator(`text=${mode}`).first().click()
    await page.waitForTimeout(4000)
    await page.mouse.move(700, 60)
    await page.waitForTimeout(1000)
    await shoot(`31-alpine-map-${mode.toLowerCase()}`)
  }
}
