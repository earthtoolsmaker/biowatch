import { writeFileSync } from 'fs'

export default async function ({ page, cdp }) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  const demo = page.locator('a', { hasText: 'Demo - Kruger National Park' }).first()
  await demo.click()
  await page.waitForTimeout(2000)
  const base = page.url().split('#')[1].replace(/\/$/, '')
  await page.evaluate((h) => {
    window.location.hash = h
  }, `${base}/settings`)
  await page.waitForTimeout(2500)

  // Nudge the native range input to a meaningful gap via the keyboard
  const range = page.locator('input[type="range"]').first()
  await range.focus()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(1200)
  // Blur the input so the focus ring doesn't show in the capture
  await page.evaluate(() => document.activeElement?.blur())
  await page.waitForTimeout(500)

  const section = page.locator('section', { hasText: 'Sequence Grouping' }).first()
  const box = await section.boundingBox()
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: {
      x: box.x - 12,
      y: box.y - 8,
      width: box.width + 24,
      height: box.height + 16,
      scale: 2
    }
  })
  writeFileSync(
    'scripts/manual-shots/raw/41-sequence-grouping-slider.png',
    Buffer.from(data, 'base64')
  )
  console.log(
    'captured, state:',
    await page.evaluate(() => document.body.innerText.match(/Sequence grouping[\s\S]{0,50}/)?.[0])
  )

  // Restore to Off
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(100)
  }
  await page.waitForTimeout(800)
  console.log(
    'restored:',
    await page.evaluate(() => document.body.innerText.match(/Sequence grouping[\s\S]{0,40}/)?.[0])
  )
}
