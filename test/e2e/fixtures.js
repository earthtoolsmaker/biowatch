const { test: base, _electron: electron } = require('@playwright/test')
const path = require('path')

// Isolated test userData directory - keeps test data separate from real user data
const TEST_USER_DATA_DIR = path.join(__dirname, '../../.e2e-test-data')

// Build launch args - add --no-sandbox in CI (required for GitHub Actions)
const launchArgs = [
  path.join(__dirname, '../../out/main/index.js'),
  `--user-data-dir=${TEST_USER_DATA_DIR}`
]
if (process.env.CI) {
  launchArgs.push('--no-sandbox')
}

const test = base.extend({
  // Worker-scoped: app starts once and is reused across all tests in the worker
  electronApp: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const electronApp = await electron.launch({
        args: launchArgs,
        env: {
          ...process.env,
          NODE_ENV: 'test'
        }
      })
      await use(electronApp)
      // Cleanup happens automatically when worker exits
      await electronApp.close()
    },
    { scope: 'worker' }
  ],
  // Window fixture - also worker-scoped to reuse across tests
  window: [
    async ({ electronApp }, use) => {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await use(window)
    },
    { scope: 'worker' }
  ]
})

module.exports = { test, expect: require('@playwright/test').expect }
