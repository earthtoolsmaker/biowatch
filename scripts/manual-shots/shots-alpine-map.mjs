export default async function ({ page, shoot }) {
  const alpine = page.locator('a', { hasText: 'Alpine Tundra' }).first()
  await alpine.click()
  await page.waitForTimeout(3000)
  const base = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/explore`)
  await page.waitForTimeout(6000)

  // Map-only view (no gallery strip — media thumbnails are unavailable remotely)
  await page.getByRole('button', { name: 'Map', exact: true }).first().click()
  await page.waitForTimeout(4000)
  await page.mouse.move(400, 500)
  await page.waitForTimeout(1500)
  await shoot('30-alpine-tundra-explore')
}
