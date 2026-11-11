const path = require('path')
const { test: base, expect } = require('./fixtures')

const test = base.extend({
  window: [
    async ({ electronApp }, use) => {
      const ready = electronApp.waitForEvent('window')
      await electronApp.evaluate(({ BrowserWindow }) => {
        const window = new BrowserWindow({ width: 900, height: 900, show: true })
        window.loadURL('about:blank')
      })
      const window = await ready
      await use(window)
      await window.close()
    },
    { scope: 'worker' }
  ]
})

let server
let fixtureUrl
test.beforeAll(async () => {
  const [{ createServer }, { default: react }, { default: tailwindcss }] = await Promise.all([
    import('vite'),
    import('@vitejs/plugin-react'),
    import('@tailwindcss/vite')
  ])
  server = await createServer({
    configFile: false,
    root: path.resolve(__dirname, '../..'),
    plugins: [react(), tailwindcss()],
    server: { host: '127.0.0.1', port: 0 }
  })
  await server.listen()
  fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/test/e2e/fixtures/camera-time.html`
})
test.afterAll(async () => {
  await server?.close()
})
test.beforeEach(async ({ window }) => {
  await window.goto(fixtureUrl)
  await window.getByRole('button', { name: 'Deployment settings', exact: true }).click()
})

test('resolve a floating camera clock, retain the selection, and clear it explicitly', async ({
  window
}) => {
  await expect(window.getByText('3 media have no known instant', { exact: false })).toBeVisible()
  const input = window.getByRole('textbox', { name: 'Camera time setting' })
  await input.fill('Europe/Paris')
  await window.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(input).toHaveValue('Europe/Paris')
  await expect(window.getByText('3 media have no known instant', { exact: false })).toHaveCount(0)
  expect(await window.evaluate(() => window.cameraTimeCalls[0])).toEqual({
    study: 'camera-clock-fixture',
    id: 'camera',
    timeZone: 'Europe/Paris'
  })
  await input.fill('')
  await window.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(window.getByText('3 media have no known instant', { exact: false })).toBeVisible()
  expect(await window.evaluate(() => window.cameraTimeCalls.at(-1).timeZone)).toBeNull()
})

test('backend validation errors stay visible without silently changing the clock', async ({
  window
}) => {
  const input = window.getByRole('textbox', { name: 'Camera time setting' })
  await input.fill('not-a-zone')
  await window.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    window.getByText('Use an IANA timezone, UTC, or a fixed offset', { exact: true })
  ).toBeVisible()
  await expect(input).toHaveValue('not-a-zone')
  await expect(window.getByText('3 media have no known instant', { exact: false })).toBeVisible()
})
