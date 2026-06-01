/**
 * Shared helper to run a task on the sequences worker thread.
 *
 * Each call spawns a fresh worker that opens its own readonly DB connection,
 * executes the task, posts the result, and exits. Used by IPC handlers that
 * would otherwise block the main event loop on heavy SQLite work.
 */

import { join } from 'path'
import { Worker } from 'worker_threads'
import log from '../logger.js'

/**
 * @param {Object} workerData - Task parameters passed to the worker. Must
 *   include at minimum `{ type, dbPath }`. `studyId` is only read by tasks
 *   that resolve sequenceGap from metadata (species-distribution, timeseries,
 *   heatmap, daily-activity); best-media ignores it. Any other fields are
 *   forwarded verbatim to the switch in worker.js.
 * @returns {Promise<*>} The worker's posted result, or rejects with the
 *   worker's error.
 */
export function runInWorker(workerData) {
  return new Promise((resolve, reject) => {
    // __dirname here resolves to `out/main/` at runtime because the main
    // bundle flattens all of src/main/**/* into that directory. The worker
    // is a separate rollup input (see electron.vite.config.mjs) and lands
    // at out/main/sequences-worker.js.
    const workerPath = join(__dirname, 'sequences-worker.js')
    // Optional heap cap (MB) for the worker's V8 old space. Unset in normal
    // operation; used to reproduce / guard against the row-dump OOM on large
    // studies (positive-gap slow path can balloon past 1.5GB).
    const maxOldMb = Number(process.env.SEQ_WORKER_MAX_OLD_MB) || 0
    const options = { workerData }
    if (maxOldMb > 0) {
      options.resourceLimits = { maxOldGenerationSizeMb: maxOldMb }
    }
    const worker = new Worker(workerPath, options)
    // Tag rejections with the task type so an OOM crash names which of the
    // (often several concurrent) workers died, independent of which IPC
    // handler's catch block logs it.
    const tag = `[seq-worker:${workerData?.type ?? 'unknown'}]`

    worker.on('message', (result) => {
      if (result.error) {
        reject(new Error(`${tag} ${result.error}`))
      } else {
        resolve(result.data)
      }
    })

    worker.on('error', (error) => {
      log.error(`${tag} worker error:`, error)
      reject(error)
    })

    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`${tag} worker exited with code ${code}`))
      }
    })
  })
}
