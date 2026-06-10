export default async function ({ page }) {
  const demo = page.locator('a', { hasText: 'Demo - Kruger National Park' }).first()
  await demo.click()
  await page.waitForTimeout(2000)
  const base = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/settings`)
  await page.waitForTimeout(2500)
  const range = page.locator('input[type="range"]').first()
  await range.focus()
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(100)
  }
  await page.waitForTimeout(800)
  console.log(
    'state:',
    await page.evaluate(() => document.body.innerText.match(/Sequence grouping[\s\S]{0,30}/)?.[0])
  )
}
