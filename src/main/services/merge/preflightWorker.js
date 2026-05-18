/**
 * Worker thread entry point for `mergePreflight`.
 *
 * Pre-flight walks B's media table calling `fs.existsSync` per row — fast
 * per call but slow over millions of rows. Running it in a worker keeps the
 * main event loop free.
 */
import { parentPort, workerData } from 'worker_threads'

import { mergePreflight } from './preflight.js'

try {
  const result = mergePreflight({
    biowatchDataPath: workerData.biowatchDataPath,
    targetStudyId: workerData.targetStudyId,
    sourceStudyId: workerData.sourceStudyId
  })
  parentPort.postMessage({ type: 'result', result })
} catch (error) {
  parentPort.postMessage({ type: 'error', error: error.message })
}
