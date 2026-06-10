export default async function ({ page }) {
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && el.textContent.trim().startsWith('AWD'))
      .map((el) => el.textContent.trim())
  )
  console.log(JSON.stringify([...new Set(rows)]))
}
