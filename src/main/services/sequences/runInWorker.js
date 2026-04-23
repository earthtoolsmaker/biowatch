/**
 * Shared helper to run a task on the sequences worker thread.
 *
 * Each call spawns a fresh worker that opens its own readonly DB connection,
 * executes the task, posts the result, and exits. Used by IPC handlers that
 * would otherwise block the main event loop on heavy SQLite work.
 */

import { join } from 'path'
import { Worker } from 'worker_threads'

/**
 * @param {Object} workerData - Task parameters passed to the worker (must
 *   include at least { type, dbPath, studyId }; other fields are forwarded
 *   verbatim to the switch in worker.js).
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
    const worker = new Worker(workerPath, { workerData })

    worker.on('message', (result) => {
      if (result.error) {
        reject(new Error(result.error))
      } else {
        resolve(result.data)
      }
    })

    worker.on('error', reject)

    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Sequence worker exited with code ${code}`))
      }
    })
  })
}
