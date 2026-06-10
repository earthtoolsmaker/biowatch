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
  // Clear the studies-sidebar search polluted by the previous run
  const sidebarSearch = page.locator('input[placeholder*="Search studies"]')
  if (await sidebarSearch.count()) {
    await sidebarSearch.fill('')
    await page.waitForTimeout(800)
  }

  const seattle = page.locator('a', { hasText: 'Seattle' }).first()
  await seattle.click()
  await page.waitForTimeout(2500)
  const base = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/media`)
  await page.waitForTimeout(3500)

  // Reset filters left over from the previous run
  const clearAll = page.locator('text=Clear all').first()
  if (await clearAll.count()) {
    await clearAll.click()
    await page.waitForTimeout(2000)
  }

  await page.getByRole('button', { name: 'Grid' }).first().click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Videos' }).first().click()
  await page.waitForTimeout(2500)

  // Open the species search in the filter rail (magnifier next to SPECIES)
  const opened = await page.evaluate(() => {
    const header = [...document.querySelectorAll('*')].find(
      (el) => el.textContent.trim() === 'SPECIES' && el.children.length === 0
    )
    const headerRow = header?.closest('div')?.parentElement
    const buttons = headerRow ? [...headerRow.querySelectorAll('svg')] : []
    const target = buttons[buttons.length - 1]
    if (!target) return false
    const r = target.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  console.log('species search icon at:', JSON.stringify(opened))
  if (opened) {
    await page.mouse.click(opened.x, opened.y)
    await page.waitForTimeout(800)
    await page.keyboard.type('heron')
    await page.waitForTimeout(1500)
  }
  // Click the Heron row in the rail
  const heron = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter(
      (el) => el.children.length === 0 && el.textContent.trim() === 'Heron'
    )
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (r.x > 1100 && r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    return null
  })
  console.log('heron rail row at:', JSON.stringify(heron))
  if (heron) {
    await page.mouse.click(heron.x, heron.y)
    await page.waitForTimeout(3000)
  }
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

  // Quick views menu with the heron grid behind it
  await page
    .getByRole('button', { name: /Detections|Blank|Favorites|No timestamp|Vehicle/ })
    .first()
    .click()
  await page.waitForTimeout(1200)
  await shoot('39-media-quickviews')
}
