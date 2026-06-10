/**
 * Frame raw app captures as macOS-style windows on a gradient backdrop.
 *
 * Usage: node scripts/manual-shots/frame.mjs <input.png> <output.png> [title] [--gradient]
 *
 * Input is a 2x retina capture of a 1512x982 viewport. Output is a 2x PNG
 * of the capture wrapped in macOS window chrome (traffic lights, titlebar,
 * rounded corners, soft shadow). Background is transparent by default so the
 * image blends with the manual's light and dark themes; pass --gradient for
 * an opaque gradient backdrop.
 */
import { chromium } from 'playwright-core'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const args = process.argv.slice(2).filter((a) => a !== '--gradient')
const gradient = process.argv.includes('--gradient')
const [input, output, title = 'Biowatch'] = args
if (!input || !output) {
  console.error('usage: node frame.mjs <input.png> <output.png> [title] [--gradient]')
  process.exit(1)
}

const APP_W = 1512 // logical width of the capture
const PAD = 72 // backdrop padding around the window
const TITLEBAR = 36
const dataUri = `data:image/png;base64,${readFileSync(input).toString('base64')}`

const html = `<!doctype html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${APP_W + PAD * 2}px;
    padding: ${PAD}px;
    background: ${
      gradient
        ? `radial-gradient(120% 140% at 85% 10%, #dbeafe 0%, transparent 50%),
      radial-gradient(120% 140% at 10% 95%, #cffafe 0%, transparent 55%),
      linear-gradient(135deg, #eff6ff 0%, #e0f2fe 45%, #f0f9ff 100%)`
        : 'transparent'
    };
    font-family: -apple-system, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
  }
  .window {
    border-radius: 12px;
    overflow: hidden;
    box-shadow:
      0 0 0 1px rgba(15, 23, 42, 0.08),
      0 24px 48px -12px rgba(15, 23, 42, 0.28),
      0 8px 16px -8px rgba(15, 23, 42, 0.18);
    background: #fff;
  }
  .titlebar {
    height: ${TITLEBAR}px;
    background: linear-gradient(#fafafa, #f0f0f1);
    border-bottom: 1px solid #e2e2e4;
    display: flex;
    align-items: center;
    position: relative;
  }
  .lights { display: flex; gap: 8px; padding-left: 14px; }
  .light { width: 12px; height: 12px; border-radius: 50%; }
  .red { background: #ff5f57; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.12); }
  .yellow { background: #febc2e; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.12); }
  .green { background: #28c840; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.12); }
  .title {
    position: absolute; left: 0; right: 0; text-align: center;
    font-size: 13px; font-weight: 600; color: #6b7280; pointer-events: none;
  }
  img { display: block; width: ${APP_W}px; }
</style></head>
<body>
  <div class="window">
    <div class="titlebar">
      <div class="lights"><div class="light red"></div><div class="light yellow"></div><div class="light green"></div></div>
      <div class="title">${title}</div>
    </div>
    <img src="${dataUri}" />
  </div>
</body></html>`

const executablePath = join(homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux64/chrome')
const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({
  viewport: { width: APP_W + PAD * 2, height: 982 + TITLEBAR + PAD * 2 },
  deviceScaleFactor: 2
})
await page.setContent(html)
await page.waitForTimeout(300)
await page.screenshot({ path: output, fullPage: true, omitBackground: !gradient })
await browser.close()
console.log(`framed: ${output}`)
