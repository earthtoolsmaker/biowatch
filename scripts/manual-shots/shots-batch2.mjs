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
  // --- 1. Alpine Tundra map encodings: abundance + density ---
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

  // --- 2. Demo study: media rail deployment hovercard ---
  const demo = page.locator('a', { hasText: 'Demo - Kruger National Park' }).first()
  await demo.click()
  await page.waitForTimeout(2500)
  const demoBase = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${demoBase}/media`)
  await page.waitForTimeout(4000)
  await imagesSettled(page)
  const deploymentRow = page.locator('text=Crocodile Bridge West').first()
  await deploymentRow.hover()
  await page.waitForTimeout(2500)
  await imagesSettled(page, 8000)
  await shoot('32-media-deployment-hovercard')

  // --- 3. Waterleidingduinen deployments: line + heatmap + row click ---
  const wld = page.locator('a', { hasText: 'Waterleidingduinen' }).first()
  await wld.click()
  await page.waitForTimeout(2500)
  const wldBase = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${wldBase}/deployments`)
  await page.waitForTimeout(5000)
  for (const mode of ['Line', 'Heatmap']) {
    await page.locator(`[aria-label="Sparkline: ${mode}"]`).click()
    await page.waitForTimeout(2500)
    await page.mouse.move(700, 450)
    await page.waitForTimeout(800)
    await shoot(`33-deployments-${mode.toLowerCase()}`)
  }
  // Back to bars, then open a deployment row
  await page.locator('[aria-label="Sparkline: Bars"]').click()
  await page.waitForTimeout(1000)
  await page.locator('text=AWD Wolfveld').first().click()
  await page.waitForTimeout(3500)
  await imagesSettled(page)
  await shoot('34-deployments-row-detail')

  // --- 4. Demo overview: Waterbuck best-capture hovercard ---
  await demo.click()
  await page.waitForTimeout(3000)
  await imagesSettled(page)
  const waterbuck = page.locator('text=Waterbuck').first()
  await waterbuck.hover()
  await page.waitForTimeout(2500)
  await imagesSettled(page, 8000)
  await shoot('35-overview-bestcapture-hovercard')
}
