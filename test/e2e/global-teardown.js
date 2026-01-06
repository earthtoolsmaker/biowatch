/**
 * Global teardown for E2E tests
 * Optional cleanup after tests complete
 *
 * Note: We intentionally don't clean up here to allow debugging failed tests.
 * The global-setup.js cleans before tests, ensuring fresh state for each run.
 */
module.exports = async () => {
  console.log('E2E Teardown: Complete')
}
