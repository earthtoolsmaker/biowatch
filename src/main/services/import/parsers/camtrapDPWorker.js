/**
 * Worker thread entry point for the CamtrapDP / GBIF import.
 *
 * Running the import in a worker isolates `better-sqlite3`'s synchronous
 * transactions from the main process event loop. While the import runs,
 * main stays responsive to IPC (cancel, other UI actions), and progress
 * messages flush to the renderer in real time.
 *
 * Posts back `{ type: 'progress' | 'result' | 'error', ... }` messages.
 */
import { parentPort, workerData } from 'worker_threads'
import { importCamTrapDatasetWithPath } from './camtrapDP.js'

async function run() {
  return await importCamTrapDatasetWithPath(
    workerData.camtrapDpDirPath,
    workerData.biowatchDataPath,
    workerData.id,
    (payload) => parentPort.postMessage({ type: 'progress', payload }),
    workerData.options || {}
  )
}

run()
  .then((result) => parentPort.postMessage({ type: 'result', result }))
  .catch((error) =>
    parentPort.postMessage({
      type: 'error',
      // Forward both message and name so the wrapper can rebuild a typed
      // error (e.g., AbortError) on the main side. Without the name the
      // IPC handler's `error.name === 'AbortError'` check would never match
      // and a cancelled import would surface as a generic error.
      error: { message: error.message, name: error.name }
    })
  )
