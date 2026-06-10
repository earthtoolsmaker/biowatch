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
  const seattle = page.locator('a', { hasText: 'Seattle' }).first()
  await seattle.click()
  await page.waitForTimeout(2500)
  const base = page.url().split('#')[1].replace(/\/$/, '')

  // --- Media tab, grid view, videos only ---
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/media`)
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Grid' }).first().click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Videos' }).first().click()
  await page.waitForTimeout(2000)
  // Filter to a charismatic species for the shot (heron / bobcat / bear)
  for (const sp of ['Heron', 'Bobcat', 'Bear']) {
    const row = page.locator(`text=${sp}`).first()
    if (await row.count()) {
      await row.click()
      console.log('species filter:', sp)
      break
    }
  }
  await page.waitForTimeout(3500)
  await imagesSettled(page)
  await shoot('37-media-videos')

  // --- Open a video in the gallery viewer ---
  await page.locator('img:visible').nth(1).click({ force: true })
  await page.waitForTimeout(2000)
  try {
    await page.waitForSelector('video', { timeout: 20000 })
  } catch {
    /* shoot whatever is there */
  }
  // Give the video time to load/transcode and start
  await page.waitForTimeout(8000)
  await shoot('38-gallery-video')

  // --- Favorite it (heart) ---
  const fav = page.locator('[aria-label="Add to favorites"]')
  if (await fav.count()) {
    await fav.click()
    await page.waitForTimeout(800)
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1500)

  // --- Quick views menu (the Detections dropdown in the toolbar) ---
  await page
    .getByRole('button', { name: /Detections/ })
    .first()
    .click()
  await page.waitForTimeout(1200)
  await shoot('39-media-quickviews')
  const options = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menu"] *, [role="listbox"] *, [role="option"]')]
      .map((e) => e.textContent.trim())
      .filter((t, i, a) => t && t.length < 30 && a.indexOf(t) === i)
  )
  console.log('quick views:', JSON.stringify(options.slice(0, 12)))

  // --- Switch to Favorites quick view ---
  await page.locator('text=Favorites').first().click()
  await page.waitForTimeout(2500)
  await imagesSettled(page)
  await shoot('40-media-favorites')
}
