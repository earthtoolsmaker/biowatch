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

  // Inspect and clear persisted media-filter state for a clean slate
  const keys = await page.evaluate(() => Object.keys(localStorage))
  console.log('localStorage keys:', JSON.stringify(keys.slice(0, 40)))
  await page.evaluate(() => {
    Object.keys(localStorage)
      .filter((k) => /media|quickview|filter/i.test(k))
      .forEach((k) => localStorage.removeItem(k))
  })
  await page.reload()
  await page.waitForTimeout(3000)

  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/media`)
  await page.waitForTimeout(3500)
  await page.getByRole('button', { name: 'Grid' }).first().click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Videos' }).first().click()
  await page.waitForTimeout(2500)

  // Species search: magnifier icon in the rail's SPECIES header
  const icon = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg.lucide-search, svg[class*=search]')]
    for (const s of svgs) {
      const r = s.getBoundingClientRect()
      if (r.x > 1100 && r.y < 300 && r.width > 0)
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    return null
  })
  console.log('rail search icon:', JSON.stringify(icon))
  if (icon) {
    await page.mouse.click(icon.x, icon.y)
    await page.waitForTimeout(800)
    await page.keyboard.type('heron')
    await page.waitForTimeout(1500)
  }
  const heron = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter(
      (el) => el.children.length === 0 && /^Heron$/.test(el.textContent.trim())
    )
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (r.x > 1100 && r.width > 0 && r.height > 0)
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    return null
  })
  console.log('heron row:', JSON.stringify(heron))
  if (!heron) throw new Error('Heron row not found')
  await page.mouse.click(heron.x, heron.y)
  await page.waitForTimeout(3000)
  await imagesSettled(page)
  await shoot('37-media-videos')

  await page.locator('img:visible').nth(1).click({ force: true })
  await page.waitForTimeout(2000)
  await page.waitForSelector('video', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(8000)
  await shoot('38-gallery-video')

  const fav = page.locator('[aria-label="Add to favorites"]')
  if (await fav.count()) {
    await fav.click()
    await page.waitForTimeout(800)
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1500)

  await page
    .getByRole('button', { name: /Detections|Blank|Favorites|No timestamp|Vehicle/ })
    .first()
    .click()
  await page.waitForTimeout(1200)
  await shoot('39-media-quickviews')

  // Favorites quick view — first remove the accidental Dan favorite (db flag)
  await page.locator('text=Favorites').first().click()
  await page.waitForTimeout(2500)
  await imagesSettled(page)
  const tiles = page.locator('img:visible')
  const n = await tiles.count()
  console.log('favorite tiles:', n)
  for (let i = n - 1; i >= 1; i--) {
    await tiles.nth(i).click({ force: true })
    await page.waitForTimeout(1800)
    const isDan = await page.evaluate(() => document.body.innerText.includes('Dan'))
    const unfav = page.locator('[aria-label="Remove from favorites"]')
    if (isDan && (await unfav.count())) {
      await unfav.click()
      await page.waitForTimeout(800)
      console.log('unfavorited a Dan item at index', i)
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1200)
  }
  await page.waitForTimeout(1500)
  await imagesSettled(page)
  await shoot('40-media-favorites')
}
