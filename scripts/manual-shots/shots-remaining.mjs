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
  // --- AI models list scrolled to show all four cards ---
  await page.evaluate(() => {
    window.location.hash = '#/settings'
  })
  await page.waitForTimeout(3000)
  await page.evaluate(() => {
    const main = document.querySelector('main') || document.scrollingElement
    const scroller =
      [...document.querySelectorAll('*')].find(
        (el) => el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 400
      ) || main
    scroller.scrollTop = 520
  })
  await page.waitForTimeout(1500)
  await imagesSettled(page)
  await shoot('24-settings-models-list')

  // --- CamtrapDP export modal from the demo study ---
  const demoLink = page.locator('a', { hasText: 'Demo - Kruger National Park' }).first()
  await demoLink.click()
  await page.waitForTimeout(2000)
  const base = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/settings`)
  await page.waitForTimeout(2500)
  const exportBtns = page.getByRole('button', { name: 'Export' })
  await exportBtns.nth(1).click() // second row: Camtrap DP
  await page.waitForTimeout(1500)
  await shoot('25-camtrapdp-export-modal')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)

  // --- Explore scrolled to the activity charts row ---
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/explore`)
  await page.waitForTimeout(6000)
  await page.evaluate(() => {
    const scroller =
      [...document.querySelectorAll('*')].find(
        (el) => el.scrollHeight > el.clientHeight + 300 && el.clientHeight > 400
      ) || document.scrollingElement
    scroller.scrollTop = scroller.scrollHeight
  })
  await page.waitForTimeout(4000)
  await shoot('26-explore-activity-charts')

  // --- MICA overview, images fully settled ---
  const mica = page.locator('a', { hasText: 'MICA' }).first()
  await mica.click()
  await page.waitForTimeout(5000)
  await imagesSettled(page, 25000)
  await page.waitForTimeout(1000)
  await shoot('27-mica-overview')
}
