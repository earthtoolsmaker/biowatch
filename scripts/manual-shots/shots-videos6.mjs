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

  // Open the viewer, then arrow through items until a video player shows
  await page.locator('img:visible').nth(1).click({ force: true })
  await page.waitForTimeout(2500)
  let foundVideo = false
  for (let i = 0; i < 14; i++) {
    const hasVideo = await page.evaluate(() => {
      const v = [...document.querySelectorAll('video')].find(
        (el) => el.getBoundingClientRect().width > 600
      )
      return v ? v.readyState : -1
    })
    if (hasVideo >= 0) {
      // wait until it can render frames
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
      foundVideo = true
      break
    }
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(1500)
  }
  console.log('video found in viewer:', foundVideo)
  await page.waitForTimeout(4000)
  await shoot('38-gallery-video')

  // Favorite the heron video
  const fav = page.locator('[aria-label="Add to favorites"]')
  if (await fav.count()) {
    await fav.click()
    await page.waitForTimeout(800)
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1500)

  // Quick views dropdown
  await page
    .getByRole('button', { name: /Quick views/i })
    .first()
    .click()
  await page.waitForTimeout(1200)
  await shoot('39-media-quickviews')

  // Favorites quick view — unfavorite Dan leftovers first
  await page.locator('text=Favorites').first().click()
  await page.waitForTimeout(2500)
  await imagesSettled(page)
  const tiles = page.locator('img:visible')
  const n = await tiles.count()
  console.log('favorite tiles:', n)
  for (let i = n - 1; i >= 1; i--) {
    await tiles.nth(i).click({ force: true })
    await page.waitForTimeout(1800)
    const isDan = await page.evaluate(() => {
      const rail = document.querySelector('[class*=Observation], aside') || document.body
      return rail.textContent.includes('Dan')
    })
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
