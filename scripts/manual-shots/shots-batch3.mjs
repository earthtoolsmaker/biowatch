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
  // --- Waterleidingduinen deployments: open a deployment row ---
  const wld = page.locator('a', { hasText: 'Waterleidingduinen' }).first()
  await wld.click()
  await page.waitForTimeout(2500)
  const wldBase = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${wldBase}/deployments`)
  await page.waitForTimeout(5000)
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('main *')]
      .filter((el) => el.children.length === 0 && el.textContent.trim().startsWith('AWD'))
      .map((el) => el.textContent.trim())
  )
  console.log('rows:', JSON.stringify(rows.slice(0, 6)))
  await page.locator('text=Wolfsveld').first().click()
  await page.waitForTimeout(3500)
  await imagesSettled(page)
  await shoot('34-deployments-row-detail')

  // --- Demo overview: Waterbuck best-capture hovercard ---
  const demo = page.locator('a', { hasText: 'Demo - Kruger National Park' }).first()
  await demo.click()
  await page.waitForTimeout(3000)
  await imagesSettled(page)
  const waterbuck = page.locator('text=Waterbuck').first()
  await waterbuck.hover()
  await page.waitForTimeout(2500)
  await imagesSettled(page, 8000)
  await shoot('35-overview-bestcapture-hovercard')
}
