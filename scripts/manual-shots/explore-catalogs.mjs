export default async function ({ page, shoot }) {
  // Go back to the import page (it becomes "new study" picker once studies exist)
  await page.evaluate(() => {
    window.location.hash = '#/import'
  })
  await page.waitForTimeout(2000)
  await shoot('03-import-page-with-study')

  // Open the GBIF dropdown (custom combobox) and scrape options
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="combobox"]')].map((b, i) => ({
      i,
      text: b.textContent.trim().slice(0, 80),
      role: b.getAttribute('role')
    }))
  )
  console.log(JSON.stringify(buttons, null, 2))
}
