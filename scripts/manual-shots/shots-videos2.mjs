async function imagesSettled(page, timeout = 15000) {
  try {
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, {
      timeout
    })
  } catch {
    /* capture anyway */
  }
}

// Click the element with exact text in the right-hand filter rail (x > 1100)
async function clickInRail(page, text) {
  const pos = await page.evaluate((t) => {
    const els = [...document.querySelectorAll('*')].filter(
      (el) => el.children.length === 0 && el.textContent.trim() === t
    )
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (r.x > 1100 && r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    return null
  }, text)
  if (!pos) throw new Error(`rail item not found: ${text}`)
  await page.mouse.click(pos.x, pos.y)
}

export default async function ({ page, shoot }) {
  const seattle = page.locator('a', { hasText: 'Seattle' }).first()
  await seattle.click()
  await page.waitForTimeout(2500)
  const base = page.url().split('#')[1].replace(/\/$/, '')

  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/media`)
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Grid' }).first().click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Videos' }).first().click()
  await page.waitForTimeout(2500)

  // Filter to Heron via the species rail (search box first to surface it)
  const railSearch = page.locator('input[placeholder*="earch"]').last()
  if (await railSearch.count()) {
    await railSearch.fill('heron')
    await page.waitForTimeout(1500)
  }
  await clickInRail(page, 'Heron')
  await page.waitForTimeout(3000)
  await imagesSettled(page)
  await shoot('37-media-videos')

  // Open the first heron video card
  await page.locator('img:visible').nth(1).click({ force: true })
  await page.waitForTimeout(2000)
  await page.waitForSelector('video', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(8000)
  await shoot('38-gallery-video')

  // Favorite the heron video
  const fav = page.locator('[aria-label="Add to favorites"]')
  if (await fav.count()) {
    await fav.click()
    await page.waitForTimeout(800)
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1500)

  // Quick views menu, with the heron-filtered grid behind it
  await page
    .getByRole('button', { name: /Detections/ })
    .first()
    .click()
  await page.waitForTimeout(1200)
  await shoot('39-media-quickviews')

  // Switch to Favorites: first remove the accidental Dan favorite
  await page.locator('text=Favorites').first().click()
  await page.waitForTimeout(2500)
  await imagesSettled(page)
  // Open each favorite; unfavorite anything labeled Dan
  const tiles = page.locator('img:visible')
  const n = await tiles.count()
  console.log('favorite tiles:', n)
  for (let i = 1; i < Math.min(n, 4); i++) {
    await tiles.nth(i).click({ force: true })
    await page.waitForTimeout(1800)
    const isDan = await page.evaluate(() =>
      [...document.querySelectorAll('[class*=z-]')].some((el) => el.textContent.includes('Dan'))
    )
    const unfav = page.locator('[aria-label="Remove from favorites"]')
    if (isDan && (await unfav.count())) {
      await unfav.click()
      await page.waitForTimeout(800)
      console.log('unfavorited a Dan item')
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1200)
  }
  await page.waitForTimeout(1500)
  await imagesSettled(page)
  await shoot('40-media-favorites')

  // --- Zoomed sequence-grouping slider from the demo study settings ---
  const demo = page.locator('a', { hasText: 'Demo - Kruger National Park' }).first()
  await demo.click()
  await page.waitForTimeout(2000)
  const demoBase = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${demoBase}/settings`)
  await page.waitForTimeout(2500)
  const section = page.locator('section', { hasText: 'Sequence Grouping' }).first()
  await section.screenshot({
    path: 'scripts/manual-shots/raw/41-sequence-grouping-slider.png'
  })
  console.log('slider section captured')
}
