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
  const seattle = page.locator('a', { hasText: 'Seattle' }).first()
  await seattle.click()
  await page.waitForTimeout(2500)
  const base = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/media`)
  await page.waitForTimeout(3500)
  await imagesSettled(page)

  // Remove every Dan favorite (Favorites quick view is active)
  for (let round = 0; round < 5; round++) {
    const danPos = await page.evaluate(() => {
      const label = [...document.querySelectorAll('*')].find((el) => {
        if (el.children.length > 0) return false
        if (el.textContent.trim() !== 'Dan') return false
        const r = el.getBoundingClientRect()
        return r.x > 100 && r.x < 1100 && r.y > 80 && r.width > 0
      })
      if (!label) return null
      const r = label.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y - 60 }
    })
    if (!danPos) break
    await page.mouse.click(danPos.x, danPos.y)
    await page.waitForTimeout(2200)
    const unfav = page.locator('[aria-label="Remove from favorites"]')
    if (await unfav.count()) {
      await unfav.click()
      await page.waitForTimeout(1000)
      console.log('unfavorited Dan, round', round)
    }
    await page.locator('[aria-label="Close modal"]').click()
    await page.waitForTimeout(2000)
  }

  // Park the mouse away from any hover target, then capture
  await page.mouse.move(650, 950)
  await page.waitForTimeout(2000)
  await imagesSettled(page)
  await shoot('40-media-favorites')
}
