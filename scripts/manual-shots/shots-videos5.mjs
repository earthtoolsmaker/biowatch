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
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/media`)
  await page.waitForTimeout(3500)

  // Remove the location-05 chip
  const locChip = page.locator('text=location-05').first()
  if (await locChip.count()) {
    const x = locChip.locator('xpath=following-sibling::*[1]')
    // chips render label + X button together; click the chip's X svg
    const pos = await page.evaluate(() => {
      const chip = [...document.querySelectorAll('*')].find(
        (el) => el.children.length === 0 && el.textContent.trim() === 'location-05'
      )
      const btn = chip?.parentElement?.querySelector('svg')
      if (!btn) return null
      const r = btn.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    console.log('location chip x:', JSON.stringify(pos), (await x.count()) > 0)
    if (pos) {
      await page.mouse.click(pos.x, pos.y)
      await page.waitForTimeout(1500)
    }
  }

  // Clear the Favorites quick view via its dropdown
  const qv = page.getByRole('button', { name: /Favorites|Detections|Blank/ }).first()
  if (await qv.count()) {
    await qv.click()
    await page.waitForTimeout(1000)
    const clear = page.locator('text=Clear quick view').first()
    if (await clear.count()) {
      await clear.click()
      await page.waitForTimeout(1500)
    } else {
      await page.keyboard.press('Escape')
    }
  }

  // Ensure: Grid + Videos + Heron (heron chip may already be active)
  await page.getByRole('button', { name: 'Grid' }).first().click()
  await page.waitForTimeout(1200)
  const videosChip = page.locator('text=Videos').first()
  const toolbar = await page.evaluate(() => document.body.innerText.slice(0, 400))
  console.log('toolbar state:', toolbar.split('\n').slice(0, 8).join(' | '))
  if (!(await page.locator('.text-blue-600, [aria-pressed]').count())) {
    // noop — just log
  }
  if ((await videosChip.count()) === 0) {
    await page.getByRole('button', { name: 'Videos' }).first().click()
    await page.waitForTimeout(1500)
  }
  await page.waitForTimeout(2500)
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

  // Favorites quick view — unfavorite any Dan leftovers, then shoot
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
