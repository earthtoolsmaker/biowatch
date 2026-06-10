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

  // Set the slider to a meaningful gap by clicking ~35% along its track
  const slider = page.locator('[role="slider"]').first()
  const track = await slider.locator('xpath=ancestor::span[1]').boundingBox()
  console.log('track:', JSON.stringify(track))
  if (track && track.width > 200) {
    await page.mouse.click(track.x + track.width * 0.35, track.y + track.height / 2)
    await page.waitForTimeout(1500)
  }

  // Retina clip of the Sequence Grouping section via CDP
  const section = page.locator('section', { hasText: 'Sequence Grouping' }).first()
  const box = await section.boundingBox()
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x - 12, y: box.y - 8, width: box.width + 24, height: box.height + 16, scale: 2 }
  })
  writeFileSync(
    'scripts/manual-shots/raw/41-sequence-grouping-slider.png',
    Buffer.from(data, 'base64')
  )
  console.log(
    'slider clip captured, state:',
    await page.evaluate(() => document.body.innerText.match(/Sequence grouping[\s\S]{0,60}/)?.[0])
  )

  // Restore the slider to Off (drag handle to the far left)
  const hbox = await slider.boundingBox()
  await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2)
  await page.mouse.down()
  await page.mouse.move(track.x - 10, hbox.y + hbox.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(1000)
  console.log(
    'restored:',
    await page.evaluate(() => document.body.innerText.match(/Sequence grouping[\s\S]{0,40}/)?.[0])
  )
}
