/**
 * Measure RENDERED frame rate during continuous Table-view scrolling, with row
 * images visible vs hidden. A JS CPU profile can't see compositor image-decode
 * cost; counting actual painted frames (via CDP screencast) can. If FPS jumps
 * sharply when images are hidden, image decode on row-mount is the bottleneck.
 *
 * Usage: node scripts/fps-media-table.mjs [studyId]   (PORT env, default 9222)
 */
import { chromium } from 'playwright-core'

const PORT = process.env.PORT || '9222'
const STUDY_ID = process.argv[2] || '7deea39a-0452-4642-bb38-a0f16cc335ce'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findPage(browser) {
  for (const p of browser.contexts().flatMap((c) => c.pages())) {
    try {
      if (await p.evaluate(() => typeof window.api?.getSequenceGap === 'function')) return p
    } catch {
      /* skip */
    }
  }
  return null
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
const page = await findPage(browser)
if (!page) {
  console.error('No renderer found over CDP.')
  process.exit(1)
}

await page.evaluate((id) => {
  window.location.hash = `#/study/${id}/media?view=table`
}, STUDY_ID)
await page.reload({ waitUntil: 'commit', timeout: 20000 })
await page.waitForFunction(() => document.querySelectorAll('[role="row"]').length > 1, {
  timeout: 30000
})

// Locate scroller + preload pages.
await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const header = [...document.querySelectorAll('[role="row"]')].find(
    (r) => r.textContent.includes('Species') && r.textContent.includes('Reviewed')
  )
  let el = header.parentElement
  while (el && el !== document.body) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) break
    el = el.parentElement
  }
  window.__scroller = el
  for (let i = 0; i < 14; i++) {
    el.scrollTop = el.scrollHeight
    await sleep(500)
  }
  el.scrollTop = 0
})

const session = await page.context().newCDPSession(page)

async function measureFps(label) {
  let frames = 0
  const onFrame = async (params) => {
    frames++
    try {
      await session.send('Page.screencastFrameAck', { sessionId: params.sessionId })
    } catch {
      /* ignore */
    }
  }
  session.on('Page.screencastFrame', onFrame)
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 30, everyNthFrame: 1 })
  const t0 = Date.now()
  // Continuous scroll: nudge scrollTop every animation frame for ~3.5s within
  // the middle of loaded content (avoid the bottom so we don't trigger loads).
  await page.evaluate(async () => {
    const el = window.__scroller
    const max = Math.max(0, el.scrollHeight - el.clientHeight - 1200)
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    let y = 0
    let dir = 1
    const end = performance.now() + 3500
    while (performance.now() < end) {
      y += dir * 40
      if (y >= max) {
        y = max
        dir = -1
      } else if (y <= 0) {
        y = 0
        dir = 1
      }
      el.scrollTop = y
      await new Promise((r) => requestAnimationFrame(r))
    }
  })
  const secs = (Date.now() - t0) / 1000
  await session.send('Page.stopScreencast')
  session.off('Page.screencastFrame', onFrame)
  await sleep(300)
  console.log(`${label}: ${frames} frames in ${secs.toFixed(1)}s = ${(frames / secs).toFixed(1)} FPS`)
  return frames / secs
}

const withImages = await measureFps('images VISIBLE   ')
// Hide all row thumbnails and re-measure.
await page.addStyleTag({ content: '[role="row"] img { display: none !important; }' })
await sleep(300)
const noImages = await measureFps('images HIDDEN    ')

console.log(
  `\nDelta: hiding images ${noImages > withImages ? 'improved' : 'changed'} FPS by ` +
    `${(noImages - withImages).toFixed(1)} (${withImages.toFixed(1)} → ${noImages.toFixed(1)}).`
)
console.log(
  noImages - withImages > 8
    ? '→ Image decode on row-mount IS a major scroll bottleneck.'
    : '→ Images are NOT the dominant scroll cost; look elsewhere.'
)

await browser.close()
console.log('done')
