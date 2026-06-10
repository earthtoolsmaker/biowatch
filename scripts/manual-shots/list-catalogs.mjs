export default async function ({ page, shoot }) {
  await page.evaluate(() => {
    window.location.hash = '#/import'
  })
  await page.waitForTimeout(1500)

  // Open GBIF combobox and scrape its options
  const combos = page.locator('[role="combobox"]')
  await combos.nth(1).click()
  await page.waitForTimeout(800)
  await shoot('04-gbif-catalog-open')
  const gbifOptions = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"], [role="listbox"] *')]
      .map((o) => o.textContent.trim())
      .filter((t, i, a) => t && a.indexOf(t) === i)
      .slice(0, 60)
  )
  console.log('GBIF:', JSON.stringify(gbifOptions, null, 1))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // Open LILA combobox and scrape its options
  await combos.nth(2).click()
  await page.waitForTimeout(800)
  await shoot('05-lila-catalog-open')
  const lilaOptions = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"], [role="listbox"] *')]
      .map((o) => o.textContent.trim())
      .filter((t, i, a) => t && a.indexOf(t) === i)
      .slice(0, 60)
  )
  console.log('LILA:', JSON.stringify(lilaOptions, null, 1))
  await page.keyboard.press('Escape')
}
