export default async function ({ page, shoot }) {
  const demoLink = page.locator('a', { hasText: 'Demo - Kruger National Park' }).first()
  await demoLink.click()
  await page.waitForTimeout(2000)
  const base = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/explore`)
  await page.waitForTimeout(6000)

  // Turn on the filter charts (activity clock + timeline) via the toolbar toggle
  const toggle = page.locator('[aria-label="Show filter charts"]')
  if (await toggle.count()) {
    await toggle.click()
    await page.waitForTimeout(2000)
  }
  // Move the mouse off the toggle so its hovercard closes before capture
  await page.mouse.move(400, 500)
  await page.waitForTimeout(3500)
  await shoot('26-explore-activity-charts')
}
