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

  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/media`)
  await page.waitForTimeout(4000)

  // Grid view + filter to Impala via the species rail
  await page.getByRole('button', { name: 'Grid' }).first().click()
  await page.waitForTimeout(2000)
  const impala = page.locator('text=Impala').first()
  await impala.click()
  await page.waitForTimeout(3000)
  await imagesSettled(page)
  await shoot('18-demo-media-grid')

  // Open the gallery viewer on the first visible thumbnail
  await page.locator('img:visible').nth(1).click({ force: true })
  await page.waitForTimeout(2500)
  await imagesSettled(page)
  await shoot('20-demo-gallery-viewer')

  // Toggle bounding boxes on if the control offers it
  const showBboxes = page.locator('[aria-label="Show bounding boxes"]')
  if (await showBboxes.count()) {
    await showBboxes.click()
    await page.waitForTimeout(1200)
  }
  await shoot('21-demo-gallery-bboxes')

  // Keyboard shortcuts overlay
  const shortcuts = page.locator('[aria-label="Toggle keyboard shortcuts"]')
  if (await shortcuts.count()) {
    await shortcuts.click()
    await page.waitForTimeout(1000)
    await shoot('22-demo-gallery-shortcuts')
  }
}
