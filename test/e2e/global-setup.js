const path = require('path')
const fs = require('fs')

// Isolated test userData directory - must match fixtures.js
const TEST_USER_DATA_DIR = path.join(__dirname, '../../.e2e-test-data')

/**
 * Global setup for E2E tests
 * Cleans the isolated test data directory before tests run to ensure a fresh state.
 * This is safe because it only affects the test directory, not real user data.
 */
module.exports = async () => {
  console.log('E2E Setup: Starting...')

  // Clean the entire test userData directory (safe - it's isolated from real data)
  if (fs.existsSync(TEST_USER_DATA_DIR)) {
    fs.rmSync(TEST_USER_DATA_DIR, { recursive: true, force: true })
    console.log('E2E Setup: Cleaned test data at', TEST_USER_DATA_DIR)
  } else {
    console.log('E2E Setup: No existing test data to clean at', TEST_USER_DATA_DIR)
  }

  console.log('E2E Setup: Complete')
}
