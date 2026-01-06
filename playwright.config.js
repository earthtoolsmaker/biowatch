const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './test/e2e',
  globalSetup: './test/e2e/global-setup.js',
  globalTeardown: './test/e2e/global-teardown.js',
  timeout: 120000, // 2 minutes per test (demo download can be slow)
  expect: {
    timeout: 10000
  },
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Electron tests must run serially
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  // Single project - tests run alphabetically (demo-import before study-management)
  // With workers: 1 and worker-scoped fixtures, app stays open across all tests
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.spec.js'
    }
  ]
})
