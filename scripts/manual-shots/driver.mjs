/**
 * CDP driver for capturing Biowatch manual screenshots.
 *
 * Connects to the dev app (started with --remoteDebuggingPort 9222),
 * emulates a MacBook Pro 14" viewport (1512x982 @2x) and exposes
 * helpers to navigate and capture retina screenshots.
 *
 * Usage: node scripts/manual-shots/driver.mjs <script.mjs>
 *   The given script is imported and its default export called with
 *   { page, shoot, cdp }.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const OUT_DIR = resolve('scripts/manual-shots/raw')
const VIEWPORT = { width: 1512, height: 982, deviceScaleFactor: 2 }

export async function connect() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const contexts = browser.contexts()
  const pages = contexts.flatMap((c) => c.pages())
  const page = pages.find((p) => !p.url().startsWith('devtools://'))
  if (!page) throw new Error('No app page found over CDP')

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: VIEWPORT.deviceScaleFactor,
    mobile: false
  })

  mkdirSync(OUT_DIR, { recursive: true })

  async function shoot(name) {
    // Let layout/animations settle before capturing
    await page.waitForTimeout(400)
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    })
    const file = join(OUT_DIR, `${name}.png`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    console.log(`shot: ${file}`)
    return file
  }

  return { browser, page, cdp, shoot }
}

const scriptPath = process.argv[2]
if (scriptPath) {
  const mod = await import(resolve(scriptPath))
  const ctx = await connect()
  try {
    await mod.default(ctx)
  } finally {
    await ctx.browser.close()
  }
}
