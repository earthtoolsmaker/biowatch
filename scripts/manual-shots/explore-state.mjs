export default async function ({ page, shoot }) {
  console.log('url:', page.url())
  await page.waitForTimeout(1500)
  await shoot('00-initial-state')
  const text = await page.evaluate(() => document.body.innerText.slice(0, 600))
  console.log('body text:', text)
}
