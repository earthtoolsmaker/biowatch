export default async function ({ page }) {
  // Close any viewer modal left open by a previous run
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1000)
  const demo = page.locator('a', { hasText: 'Demo - Kruger National Park' }).first()
  await demo.click()
  await page.waitForTimeout(2000)
  const base = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/settings`)
  await page.waitForTimeout(2500)
  const section = page.locator('section', { hasText: 'Sequence Grouping' }).first()
  await section.screenshot({
    path: 'scripts/manual-shots/raw/41-sequence-grouping-slider.png'
  })
  console.log('slider section captured')
}
