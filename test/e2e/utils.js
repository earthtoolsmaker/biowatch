const fs = require('fs')
const path = require('path')

/**
 * Get the userData path for the test instance
 */
async function getUserDataPath(electronApp) {
  return electronApp.evaluate(async ({ app }) => {
    return app.getPath('userData')
  })
}

/**
 * Clean up test data between tests
 */
async function cleanupTestData(electronApp) {
  const userDataPath = await getUserDataPath(electronApp)
  // Correct path: biowatch-data/studies (not just studies)
  const studiesPath = path.join(userDataPath, 'biowatch-data', 'studies')
  if (fs.existsSync(studiesPath)) {
    fs.rmSync(studiesPath, { recursive: true, force: true })
  }
}

/**
 * Wait for the app to be ready (studies list loaded)
 */
async function waitForAppReady(electronApp) {
  const page = await electronApp.firstWindow()
  // Wait for the sidebar to be visible (indicates app is ready)
  await page.waitForSelector('[data-testid="studies-sidebar"]', {
    timeout: 30000
  })
}

module.exports = { getUserDataPath, cleanupTestData, waitForAppReady }
