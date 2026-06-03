/**
 * CPU-profile the Media-tab Table view during scroll to find the hot path.
 * Pre-loads several pages, then profiles a scroll that stays WITHIN already
 * loaded content (avoids the very bottom) so we isolate pure scroll/render cost
 * from page-load (fetchNextPage / bbox refetch) cost.
 *
 * Usage: node scripts/profile-media-table.mjs [studyId]   (PORT env, default 9222)
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

// Pre-load a chunk of pages so there's content to scroll through.
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
  for (let i = 0; i < 12; i++) {
    el.scrollTop = el.scrollHeight
    await sleep(500)
  }
  el.scrollTop = 0
  await sleep(300)
})

const info = await page.evaluate(() => ({
  scrollHeight: window.__scroller.scrollHeight,
  clientHeight: window.__scroller.clientHeight,
  rendered: document.querySelectorAll('[role="row"]').length - 1
}))
console.log('Loaded:', JSON.stringify(info))

const session = await page.context().newCDPSession(page)
await session.send('Profiler.enable')
await session.send('Profiler.setSamplingInterval', { interval: 200 })
await session.send('Profiler.start')

// Scroll within the MIDDLE of loaded content (avoid the bottom 1200px so we
// don't trigger fetchNextPage) to isolate pure scroll/render cost.
await page.evaluate(async () => {
  const el = window.__scroller
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const top = 0
  const bottom = Math.max(0, el.scrollHeight - el.clientHeight)
  for (let pass = 0; pass < 2; pass++) {
    for (let y = top; y <= bottom; y += 300) {
      el.scrollTop = y
      await sleep(24)
    }
    for (let y = bottom; y >= top; y -= 300) {
      el.scrollTop = y
      await sleep(24)
    }
  }
})

const { profile } = await session.send('Profiler.stop')

// Aggregate self-time by function from the sampled profile.
const nodeById = new Map(profile.nodes.map((n) => [n.id, n]))
const selfTicks = new Map()
for (const id of profile.samples) selfTicks.set(id, (selfTicks.get(id) || 0) + 1)
const totalSamples = profile.samples.length
// timeDeltas are microseconds between samples; approximate per-sample cost.
const usPerSample =
  profile.timeDeltas && profile.timeDeltas.length
    ? profile.timeDeltas.reduce((a, b) => a + b, 0) / profile.timeDeltas.length
    : 200

const byFn = new Map()
for (const [id, ticks] of selfTicks) {
  const n = nodeById.get(id)
  if (!n) continue
  const cf = n.callFrame
  const name = cf.functionName || '(anonymous)'
  const loc = `${(cf.url || '').split('/').slice(-1)[0]}:${cf.lineNumber + 1}`
  const key = `${name}  ${loc}`
  byFn.set(key, (byFn.get(key) || 0) + ticks)
}
const top = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)
console.log(`\nTotal samples: ${totalSamples}  (~${Math.round(usPerSample)}us/sample)`)
console.log('Top self-time functions during mid-content scroll:')
for (const [key, ticks] of top) {
  const ms = Math.round((ticks * usPerSample) / 1000)
  const pct = ((ticks / totalSamples) * 100).toFixed(1)
  console.log(`  ${String(ms).padStart(5)}ms  ${String(pct).padStart(5)}%  ${key}`)
}

await browser.close()
console.log('done')
