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
  const demoLink = page.locator('a', { hasText: 'Demo - Kruger National Park' }).first()
  await demoLink.click()
  await page.waitForTimeout(2000)
  const base = page.url().split('#')[1].replace(/\/$/, '')

  // Retry species hovercard with a daylight species and full image settle
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/explore`)
  await page.waitForTimeout(6000)
  const zebra = page.locator('text=Plains Zebra').first()
  await zebra.hover()
  await page.waitForTimeout(2000)
  await imagesSettled(page, 8000)
  await page.waitForTimeout(800)
  await shoot('16-explore-species-hovercard')

  // --- Media tab: grid view ---
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/media`)
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Grid' }).first().click()
  await page.waitForTimeout(3000)
  await imagesSettled(page)
  await shoot('18-demo-media-grid')

  // --- Filters drawer open ---
  await page.getByRole('button', { name: 'Filters' }).first().click()
  await page.waitForTimeout(1500)
  await shoot('19-demo-media-filters')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)

  // --- Open gallery viewer on a wildlife image (annotation view) ---
  // Filter to a species first so the photo has animals in it
  const impala = page
    .locator('aside, [class*=rail], [class*=sidebar]')
    .locator('text=Impala')
    .first()
  if (await impala.count()) {
    await impala.click()
    await page.waitForTimeout(2500)
  }
  await imagesSettled(page)
  const firstThumb = page.locator('img').nth(2)
  await firstThumb.click()
  await page.waitForTimeout(2500)
  await imagesSettled(page)
  await shoot('20-demo-gallery-viewer')

  // Show bounding boxes if not already shown
  const bboxToggle = page.locator('[aria-label="Show bounding boxes"]')
  if (await bboxToggle.count()) {
    await bboxToggle.click()
    await page.waitForTimeout(1000)
  }
  await shoot('21-demo-gallery-bboxes')

  // Keyboard shortcuts overlay
  const shortcuts = page.locator('[aria-label="Toggle keyboard shortcuts"]')
  if (await shortcuts.count()) {
    await shortcuts.click()
    await page.waitForTimeout(1000)
    await shoot('22-demo-gallery-shortcuts')
    await shortcuts.click()
  }
}
