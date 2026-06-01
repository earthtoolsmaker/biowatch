/**
 * Reproduce the sequence-worker OOM (ERR_WORKER_OUT_OF_MEMORY) on large studies
 * by attaching to a running Biowatch dev renderer over CDP.
 *
 * Two modes:
 *   explore (default) — boots the app straight into the study's Explore tab and
 *     lets the real UI fire ALL its concurrent work (species-distribution +
 *     timeseries on the slow JS path, heatmap, daily-activity, overview-stats,
 *     map markers, cached images). This is the real-world crash path.
 *   ipc — directly invokes species-distribution + timeseries with a positive
 *     gapSeconds (forces the slow path) without the renderer-side load. Useful
 *     for attributing heap growth to a single worker.
 *
 * The OOM only fatally crashes when the worker's V8 old-space ceiling is below
 * the slow path's ~1-1.5GB footprint. To reproduce on a 60GB/4GB-default box,
 * relaunch dev with a constrained worker heap:
 *   SEQ_WORKER_MAX_OLD_MB=950 npm run dev -- --remoteDebuggingPort 9222
 *
 * Usage:
 *   node scripts/repro-seq-oom.mjs [studyId] [gapSeconds]
 *
 * Env:
 *   REPRO_PORT   CDP port (default 9222)
 *   REPRO_MODE   'explore' (default) | 'ipc'
 *   REPRO_WAIT   seconds to watch the explore tab (default 60)
 */

import { chromium } from 'playwright-core'
import { readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const PORT = process.env.REPRO_PORT || '9222'
const MODE = process.env.REPRO_MODE || 'explore'
const WAIT_S = Number(process.env.REPRO_WAIT || 60)
const STUDY_ID = process.argv[2] || '7deea39a-0452-4642-bb38-a0f16cc335ce'
const GAP_SECONDS = Number(process.argv[3] ?? 120)
const MAIN_LOG = join(homedir(), '.config', 'biowatch', 'logs', 'main.log')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function logSize() {
  try {
    return statSync(MAIN_LOG).size
  } catch {
    return 0
  }
}

function newLogLines(fromByte) {
  try {
    return readFileSync(MAIN_LOG)
      .subarray(fromByte)
      .toString('utf8')
      .split('\n')
      .filter(
        (l) =>
          l.includes('seq-worker') ||
          l.includes('OUT_OF_MEMORY') ||
          l.includes('heap out of memory') ||
          l.includes('rows')
      )
  } catch {
    return []
  }
}

const OOM_RE = /OUT_OF_MEMORY|worker exited|heap out of memory/i

async function portAlive() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, {
      signal: AbortSignal.timeout(2000)
    })
    return res.ok
  } catch {
    return false
  }
}

async function findPage(browser) {
  const pages = browser.contexts().flatMap((c) => c.pages())
  for (const p of pages) {
    try {
      if (await p.evaluate(() => typeof window.api?.getSequenceGap === 'function')) return p
    } catch {
      // page may be mid-navigation; skip
    }
  }
  return null
}

async function runExplore(browser, page, startByte) {
  // Report the stored gap — the Explore tab passes no gap, so the worker uses
  // metadata; a positive value here is what sends it down the OOM-prone path.
  let storedGap = null
  try {
    storedGap = await page.evaluate((id) => window.api.getSequenceGap(id), STUDY_ID)
  } catch {
    /* ignore */
  }
  console.log(`Stored sequenceGap for study: ${JSON.stringify(storedGap)}`)
  // Non-destructive: we do NOT mutate the study's stored gap. A positive stored
  // gap is exactly the real-world condition that sends the Explore tab down the
  // slow path; if it's null/0 this study uses the SQL fast path and won't OOM
  // here (use REPRO_MODE=ipc with an explicit gap to force it).
  const gapVal = storedGap?.data ?? storedGap
  if (!(typeof gapVal === 'number' && gapVal > 0)) {
    console.log(
      `⚠ Stored gap is not positive — Explore tab will use the fast path. ` +
        `Run with REPRO_MODE=ipc to force the slow path.`
    )
  }

  let crashed = false
  page.on('crash', () => {
    crashed = true
  })

  const base = page.url().split('#')[0]
  const target = `#/study/${STUDY_ID}/explore`
  console.log(`Booting Explore tab: ${base}${target}\n`)
  try {
    await page.evaluate((h) => {
      window.location.hash = h
    }, target)
    await page.reload({ waitUntil: 'commit', timeout: 15000 })
  } catch (e) {
    console.log(`(navigation interrupted: ${e.message})`)
    crashed = true
  }

  const deadline = Date.now() + WAIT_S * 1000
  let reproduced = false
  while (Date.now() < deadline) {
    if (crashed || !(await portAlive())) {
      reproduced = true
      console.log('→ App/renderer went down while loading the Explore tab (OOM crash).')
      break
    }
    if (newLogLines(startByte).some((l) => OOM_RE.test(l))) {
      reproduced = true
      console.log('→ Worker OOM detected in main.log while loading the Explore tab.')
      break
    }
    await sleep(1000)
  }
  return reproduced
}

async function runIpc(page) {
  console.log(`Study: ${STUDY_ID}  gapSeconds=${GAP_SECONDS} (positive → slow path)\n`)
  let reproduced = false
  try {
    const outcomes = await page.evaluate(
      async ({ studyId, gap }) => {
        const call = async (label, fn) => {
          const t = performance.now()
          try {
            const res = await fn()
            return { label, ok: true, ms: Math.round(performance.now() - t), error: res?.error }
          } catch (e) {
            return { label, ok: false, ms: Math.round(performance.now() - t), error: String(e) }
          }
        }
        return Promise.all([
          call('species-distribution', () =>
            window.api.getSequenceAwareSpeciesDistribution(studyId, gap, null)
          ),
          call('timeseries', () => window.api.getSequenceAwareTimeseries(studyId, [], gap, null))
        ])
      },
      { studyId: STUDY_ID, gap: GAP_SECONDS }
    )
    for (const o of outcomes) {
      const err = o.error || ''
      if (OOM_RE.test(err)) reproduced = true
      console.log(
        `  ${o.label}: ${o.ok && !o.error ? 'OK' : 'ERROR'} (${o.ms}ms)` +
          (err ? `\n      ${err}` : '')
      )
    }
  } catch (e) {
    console.log(`=== IPC call aborted: ${e.message} ===`)
    console.log('   → page/app closed mid-call: the worker OOM crashed the process.')
    reproduced = true
  }
  return reproduced
}

async function main() {
  console.log(`Attaching to CDP on http://127.0.0.1:${PORT} (mode=${MODE}) ...`)
  let browser
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  } catch (e) {
    console.error(`\n✗ Could not connect on port ${PORT}: ${e.message}`)
    console.error('  Relaunch dev with: npm run dev -- --remoteDebuggingPort ' + PORT)
    process.exit(2)
  }

  const page = await findPage(browser)
  if (!page) {
    console.error('✗ No renderer page exposing window.api was found.')
    process.exit(2)
  }
  console.log(`Driving page: ${page.url()}`)

  const startByte = logSize()
  const reproduced =
    MODE === 'ipc' ? await runIpc(page) : await runExplore(browser, page, startByte)

  console.log('\n=== New [seq-worker:*] / OOM log lines ===')
  for (const l of newLogLines(startByte)) console.log('  ' + l)

  await browser.close().catch(() => {})
  console.log(`\n${reproduced ? '✓ Reproduced the worker OOM.' : '— No OOM this run.'}`)
  process.exit(reproduced ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(3)
})
