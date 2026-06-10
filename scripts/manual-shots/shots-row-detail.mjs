async function imagesSettled(page, timeout = 15000) {
  try {
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, {
      timeout
    })
  } catch {
    /* capture anyway */
  }
}

export default async function ({ page, shoot }) {
  await page.keyboard.press('Escape')
  const wld = page.locator('a', { hasText: 'Waterleidingduinen' }).first()
  await wld.click()
  await page.waitForTimeout(2500)
  const wldBase = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${wldBase}/deployments`)
  await page.waitForTimeout(5000)

  // Click the sparkline area of the Zilkerpad row (name cell is a rename editor)
  const name = page.locator('text=AWD Zilkerpad').first()
  const box = await name.boundingBox()
  console.log('row bbox:', JSON.stringify(box))
  await page.mouse.click(700, box.y + box.height / 2)
  await page.waitForTimeout(4000)
  await imagesSettled(page)
  await shoot('34-deployments-row-detail')
}
