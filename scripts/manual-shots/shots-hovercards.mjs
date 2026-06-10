export default async function ({ page, shoot }) {
  const demoLink = page.locator('a', { hasText: 'Demo - Kruger National Park' }).first()
  await demoLink.click()
  await page.waitForTimeout(2000)
  const base = page.url().split('#')[1].replace(/\/$/, '')

  // --- Species hovercard in Explore's species rail ---
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/explore`)
  await page.waitForTimeout(6000)

  const giraffe = page.locator('text=Giraffe').first()
  await giraffe.hover()
  await page.waitForTimeout(2500)
  await shoot('16-explore-species-hovercard')

  // --- Deployment marker hovercard on the Explore map ---
  // Move mouse away first to dismiss the species card
  await page.mouse.move(600, 60)
  await page.waitForTimeout(1500)
  const markers = page.locator('.leaflet-marker-icon, .leaflet-interactive')
  const count = await markers.count()
  console.log('markers:', count)
  if (count > 0) {
    await markers.nth(Math.min(2, count - 1)).hover()
    await page.waitForTimeout(2500)
    await shoot('17-explore-marker-hovercard')
  }
}
