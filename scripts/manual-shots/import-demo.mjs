export default async function ({ page, shoot }) {
  // List GBIF and LILA dropdown options for dataset selection
  const options = await page.evaluate(() => {
    const selects = [...document.querySelectorAll('select')]
    return selects.map((s) => [...s.options].map((o) => o.textContent.trim()))
  })
  console.log(JSON.stringify(options, null, 2))

  await page.getByTestId('import-demo-btn').click()
  await page.waitForTimeout(2500)
  await shoot('01-demo-import-progress')

  // Wait until the import completes (study page appears) — up to 5 minutes
  for (let i = 0; i < 60; i++) {
    const url = page.url()
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 200))
    if (url.includes('/study/')) {
      console.log('study ready:', url)
      break
    }
    console.log('waiting...', url, txt.split('\n')[0])
    await page.waitForTimeout(5000)
  }
  await page.waitForTimeout(3000)
  await shoot('02-demo-overview-initial')
}
