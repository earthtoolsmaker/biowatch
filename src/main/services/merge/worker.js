/**
 * Worker thread entry point for the merge orchestration.
 *
 * Running the merge in a worker isolates SQLite's synchronous transaction
 * from the main process event loop. That gives us two wins:
 *  1. Main stays responsive to IPC (cancel, other UI actions) while the
 *     merge runs.
 *  2. `worker.terminate()` from main is an instant kill — SQLite WAL
 *     recovery rolls back the uncommitted transaction on next DB open,
 *     leaving A's data unchanged. This is how merge cancellation works.
 *
 * Posts back `{ type: 'progress' | 'result' | 'error', ... }` messages.
 */
import { parentPort, workerData } from 'worker_threads'

import { mergeStudy } from './index.js'

try {
  const result = mergeStudy({
    biowatchDataPath: workerData.biowatchDataPath,
    targetStudyId: workerData.targetStudyId,
    sourceStudyId: workerData.sourceStudyId,
    reviewed: workerData.reviewed,
    onProgress: (payload) => parentPort.postMessage({ type: 'progress', payload })
  })
  parentPort.postMessage({ type: 'result', result })
} catch (error) {
  parentPort.postMessage({ type: 'error', error: error.message })
}
