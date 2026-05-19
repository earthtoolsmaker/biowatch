/**
 * Spawn the CamtrapDP / GBIF import worker and route its messages.
 *
 * Mirrors src/main/services/sequences/runInWorker.js. The bundled worker
 * file lands at `out/main/camtrap-import-worker.js` (see the rollup input
 * registered in electron.vite.config.mjs), which is the same directory the
 * main bundle resolves __dirname to at runtime.
 */
import { join } from 'path'
import { Worker } from 'worker_threads'

import log from '../logger.js'

/**
 * @param {Object} args
 * @param {string} args.camtrapDpDirPath
 * @param {string} args.id
 * @param {string} args.biowatchDataPath
 * @param {Object} args.options - { nameOverride, importFolderOverride }
 * @param {function} args.onProgress - Called with progress payloads.
 * @param {AbortSignal} [args.signal] - Aborting terminates the worker.
 * @returns {Promise<{data, synthesized, dbPath}>}
 */
export function runCamtrapImportInWorker({
  camtrapDpDirPath,
  id,
  biowatchDataPath,
  options,
  onProgress,
  signal
}) {
  return new Promise((resolve, reject) => {
    const workerPath = join(__dirname, 'camtrap-import-worker.js')
    log.info(`camtrap-import worker: spawning from ${workerPath} for study ${id}`)
    const worker = new Worker(workerPath, {
      workerData: {
        camtrapDpDirPath,
        biowatchDataPath,
        id,
        options
      }
    })

    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }

    const onAbort = async () => {
      log.info(`camtrap-import worker: abort signal received for study ${id}, terminating`)
      try {
        await worker.terminate()
      } catch {
        /* noop */
      }
      finish(reject, Object.assign(new Error('Import cancelled'), { name: 'AbortError' }))
    }

    if (signal) {
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }

    worker.on('message', (msg) => {
      if (msg.type === 'progress') {
        try {
          onProgress?.(msg.payload)
        } catch (err) {
          log.warn('onProgress threw:', err.message)
        }
      } else if (msg.type === 'result') {
        finish(resolve, msg.result)
      } else if (msg.type === 'error') {
        log.error('camtrap-import worker reported error:', msg.error)
        finish(reject, new Error(msg.error))
      }
    })
    worker.on('error', (err) => {
      log.error('camtrap-import worker error event:', err)
      finish(reject, err)
    })
    worker.on('exit', (code) => {
      if (!settled) {
        finish(reject, new Error(`camtrap-import worker exited with code ${code}`))
      }
    })
  })
}
