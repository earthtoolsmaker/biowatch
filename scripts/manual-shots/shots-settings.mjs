async function imagesSettled(page, timeout = 10000) {
  try {
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, {
      timeout
    })
  } catch {
    /* capture anyway */
  }
}

export default async function ({ page, shoot }) {
  // Global settings page
  await page.evaluate(() => {
    window.location.hash = '#/settings'
  })
  await page.waitForTimeout(3000)
  await imagesSettled(page)
  await shoot('23-settings-page')

  // Look for model zoo / AI models section navigation
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll('a, button, h1, h2, h3')]
      .map((e) => e.textContent.trim())
      .filter((t) => t && t.length < 50)
      .slice(0, 50)
  )
  console.log(JSON.stringify(sections, null, 1))
}
