async function imagesSettled(page, timeout = 15000) {
  try {
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, {
      timeout
    })
  } catch {
    // capture anyway
  }
}

export default async function ({ page, shoot }) {
  // Find the demo study id from the sidebar link
  await page.waitForTimeout(1000)
  const demoLink = page.locator('a', { hasText: 'Demo - Kruger National Park' }).first()
  await demoLink.click()
  await page.waitForTimeout(2500)
  await imagesSettled(page)
  await page.waitForTimeout(1000)
  await shoot('10-demo-overview')

  const studyUrl = page.url()
  const base = studyUrl.split('#')[1].replace(/\/$/, '')
  console.log('demo base:', base)

  for (const [tab, name, settle] of [
    ['explore', '11-demo-explore', 6000],
    ['media', '12-demo-media', 5000],
    ['deployments', '13-demo-deployments', 5000],
    ['sources', '14-demo-sources', 3000],
    ['settings', '15-demo-settings', 3000]
  ]) {
    await page.evaluate((h) => {
      window.location.hash = h
    }, `${base}/${tab}`)
    await page.waitForTimeout(settle)
    await imagesSettled(page)
    await shoot(name)
  }
}
