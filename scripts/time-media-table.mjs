/**
 * Measure Media-tab Table view scroll performance over CDP.
 *
 * Boots a study's Media tab in table view, scrolls to load many sequences, then
 * reports:
 *   - rendered [role=row] count (virtualization proof: should stay bounded even
 *     after loading hundreds of sequences),
 *   - long-task count + total blocking time during a scripted scroll,
 *   - frame-interval stats (jank).
 *
 * Prereq: dev app running with CDP, e.g. `CAP=0 PORT=9222 scripts/dev-debug.sh`.
 * Usage: node scripts/time-media-table.mjs [studyId]
 * Env: PORT (default 9222)
 */
import { chromium } from 'playwright-core'

const PORT = process.env.PORT || '9222'
const STUDY_ID = process.argv[2] || '7deea39a-0452-4642-bb38-a0f16cc335ce'

async function findPage(browser) {
  const pages = browser.contexts().flatMap((c) => c.pages())
  for (const p of pages) {
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
  console.error('No Biowatch renderer found over CDP. Is the dev app running with the debug port?')
  process.exit(1)
}

console.log(`Booting Media table: #/study/${STUDY_ID}/media?view=table`)
await page.evaluate((id) => {
  window.location.hash = `#/study/${id}/media?view=table`
}, STUDY_ID)
await page.reload({ waitUntil: 'commit', timeout: 20000 })

// Wait for the table header + at least one data row to appear.
await page.waitForFunction(() => document.querySelectorAll('[role="row"]').length > 1, {
  timeout: 30000
})

// Locate the scroll container (nearest scrollable ancestor of the table header).
const scrollLoadResult = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const header = [...document.querySelectorAll('[role="row"]')].find(
    (r) => r.textContent.includes('Species') && r.textContent.includes('Reviewed')
  )
  if (!header) return { error: 'no header row found' }
  // Nearest scrollable ancestor (by overflow style) — may not be scrollable yet
  // when only the first page has loaded, so don't gate on scrollHeight here.
  let el = header.parentElement
  while (el && el !== document.body) {
    const s = getComputedStyle(el)
    if (/(auto|scroll)/.test(s.overflowY)) break
    el = el.parentElement
  }
  if (!el || el === document.body) return { error: 'no scroll container found' }
  window.__scroller = el
  // Scroll to the bottom repeatedly to trigger infinite-scroll page loads.
  let lastHeight = 0
  for (let i = 0; i < 25; i++) {
    el.scrollTop = el.scrollHeight
    await sleep(450)
    if (el.scrollHeight === lastHeight) {
      // No growth two rounds in a row → probably exhausted.
      el.scrollTop = el.scrollHeight
      await sleep(450)
      if (el.scrollHeight === lastHeight) break
    }
    lastHeight = el.scrollHeight
  }
  return {
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    renderedRows: document.querySelectorAll('[role="row"]').length - 1 // minus header
  }
})
console.log('After scroll-loading:', JSON.stringify(scrollLoadResult))

// Measure jank during a scripted scroll up→down using long tasks + rAF intervals.
const perf = await page.evaluate(async () => {
  const el = window.__scroller
  if (!el) return { error: 'no scroller' }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  let longTasks = 0
  let blockingMs = 0
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      longTasks++
      blockingMs += Math.max(0, e.duration - 50)
    }
  })
  try {
    po.observe({ entryTypes: ['longtask'] })
  } catch {
    /* longtask may be unsupported */
  }

  const frames = []
  let last = performance.now()
  let raf
  const tick = () => {
    const now = performance.now()
    frames.push(now - last)
    last = now
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  // Scripted scroll: sweep down then up in steps to exercise virtualization.
  const max = el.scrollHeight - el.clientHeight
  const t0 = performance.now()
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y <= max; y += 400) {
      el.scrollTop = y
      await sleep(16)
    }
    for (let y = max; y >= 0; y -= 400) {
      el.scrollTop = y
      await sleep(16)
    }
  }
  const durationMs = performance.now() - t0
  cancelAnimationFrame(raf)
  po.disconnect()

  const intervals = frames.filter((f) => f > 0)
  intervals.sort((a, b) => a - b)
  const pct = (p) =>
    intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * p))] || 0
  const janky = intervals.filter((f) => f > 50).length
  return {
    durationMs: Math.round(durationMs),
    frames: intervals.length,
    medianFrameMs: Math.round(pct(0.5) * 10) / 10,
    p95FrameMs: Math.round(pct(0.95) * 10) / 10,
    worstFrameMs: Math.round((intervals[intervals.length - 1] || 0) * 10) / 10,
    jankyFrames_gt50ms: janky,
    longTasks,
    totalBlockingMs: Math.round(blockingMs)
  }
})
console.log('Scroll perf:', JSON.stringify(perf, null, 2))

await browser.close()
console.log('done')
