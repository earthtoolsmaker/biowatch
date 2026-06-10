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
  // --- Waterleidingduinen: deployments timeline ---
  const wld = page.locator('a', { hasText: 'Waterleidingduinen' }).first()
  await wld.click()
  await page.waitForTimeout(3000)
  const wldBase = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${wldBase}/deployments`)
  await page.waitForTimeout(5000)
  await imagesSettled(page)
  await shoot('28-waterleidingduinen-deployments')

  // --- Alpine Tundra: overview + explore map ---
  const alpine = page.locator('a', { hasText: 'Alpine Tundra' }).first()
  await alpine.click()
  await page.waitForTimeout(4000)
  await imagesSettled(page, 20000)
  await page.waitForTimeout(1000)
  await shoot('29-alpine-tundra-overview')

  const alpBase = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${alpBase}/explore`)
  await page.waitForTimeout(7000)
  await imagesSettled(page)
  await shoot('30-alpine-tundra-explore')
}
