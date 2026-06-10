export default async function ({ page }) {
  // Modal may already be open with the phrase filled from the previous run
  const modal = page.getByTestId('delete-modal')
  if (!(await modal.count())) {
    const dup = '/study/6e5ff33f-b7aa-4bf2-b8df-4871d6aef9b5'
    await page.evaluate((h) => {
      window.location.hash = h
    }, `${dup}/settings`)
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: 'Delete' }).first().click()
    await page.waitForTimeout(1000)
  }
  await page.getByTestId('delete-confirm-input').fill('delete this study')
  await page.waitForTimeout(300)
  await page.getByTestId('delete-confirm-btn').click()
  await page.waitForTimeout(3000)
  const studies = await page.evaluate(() =>
    [...document.querySelectorAll('a')].map((a) => a.textContent.trim()).filter(Boolean)
  )
  console.log('sidebar:', JSON.stringify(studies.slice(0, 10)))
}
