export default async function ({ page, shoot }) {
  const seattle = page.locator('a', { hasText: 'Seattle' }).first()
  await seattle.click()
  await page.waitForTimeout(2500)
  const base = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/media`)
  await page.waitForTimeout(3500)

  // Find a grid card with a play badge (video tile) and open it
  const pos = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg')]
    for (const s of svgs) {
      const cls = s.getAttribute('class') || ''
      if (!/play/i.test(cls)) continue
      const r = s.getBoundingClientRect()
      if (r.x > 100 && r.x < 1100 && r.y > 80 && r.width > 0) {
        return { x: r.x, y: r.y }
      }
    }
    return null
  })
  console.log('play badge at:', JSON.stringify(pos))
  if (!pos) throw new Error('no video tile found')
  await page.mouse.click(pos.x - 60, pos.y - 60)
  await page.waitForTimeout(3000)

  await page
    .waitForFunction(
      () => {
        const v = [...document.querySelectorAll('video')].find(
          (el) => el.getBoundingClientRect().width > 600
        )
        return v && v.readyState >= 2
      },
      null,
      { timeout: 45000 }
    )
    .catch(() => {})

  const vbox = await page.evaluate(() => {
    const v = [...document.querySelectorAll('video')].find(
      (el) => el.getBoundingClientRect().width > 600
    )
    if (!v) return null
    const r = v.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height - 40 }
  })
  console.log('video box:', JSON.stringify(vbox))
  if (vbox) {
    await page.mouse.move(vbox.x, vbox.y)
    await page.waitForTimeout(1500)
  }
  await shoot('38-gallery-video')
}
