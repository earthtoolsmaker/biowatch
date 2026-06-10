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
  await imagesSettled(page)

  // --- The Favorites quick view should be active from the previous run ---
  // Open the Dan favorite (first tile) and unfavorite it
  const danPos = await page.evaluate(() => {
    const label = [...document.querySelectorAll('*')].find(
      (el) =>
        el.children.length === 0 &&
        el.textContent.trim() === 'Dan' &&
        el.getBoundingClientRect().x < 1100 &&
        el.getBoundingClientRect().y > 80
    )
    if (!label) return null
    const card = label.closest('div')
    const r = card.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y - 60 }
  })
  console.log('dan tile at:', JSON.stringify(danPos))
  if (danPos) {
    await page.mouse.click(danPos.x, danPos.y)
    await page.waitForTimeout(2500)
    const unfav = page.locator('[aria-label="Remove from favorites"]')
    console.log('unfav button count:', await unfav.count())
    if (await unfav.count()) {
      await unfav.click()
      await page.waitForTimeout(1000)
      console.log('unfavorited Dan')
    }
    await page.locator('[aria-label="Close modal"]').click()
    await page.waitForTimeout(2000)
  }
  await imagesSettled(page)
  await shoot('40-media-favorites')

  // --- Re-shoot the video viewer with player controls visible ---
  // Open the heron video favorite (tile with the play badge)
  const tiles = page.locator('img:visible')
  const n = await tiles.count()
  await tiles.nth(n - 1).click({ force: true })
  await page.waitForTimeout(2500)
  let foundVideo = false
  for (let i = 0; i < 6; i++) {
    const state = await page.evaluate(() => {
      const v = [...document.querySelectorAll('video')].find(
        (el) => el.getBoundingClientRect().width > 600
      )
      return v ? v.readyState : -1
    })
    if (state >= 0) {
      foundVideo = true
      break
    }
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(1500)
  }
  console.log('video in viewer:', foundVideo)
  await page
    .waitForFunction(
      () => {
        const v = [...document.querySelectorAll('video')].find(
          (el) => el.getBoundingClientRect().width > 600
        )
        return v && v.readyState >= 2
      },
      null,
      { timeout: 30000 }
    )
    .catch(() => {})
  // Hover the player so its controls are visible, then capture
  const vbox = await page.evaluate(() => {
    const v = [...document.querySelectorAll('video')].find(
      (el) => el.getBoundingClientRect().width > 600
    )
    const r = v.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height - 40 }
  })
  await page.mouse.move(vbox.x, vbox.y)
  await page.waitForTimeout(1500)
  await shoot('38-gallery-video')
}
