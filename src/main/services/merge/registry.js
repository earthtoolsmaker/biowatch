/**
 * Per-target-study registry for in-flight merge workers.
 *
 * Created with `createMergeRegistry()` so callers control the lifetime — no
 * module-level mutable state. The IPC layer instantiates one inside
 * `registerStudyIPCHandlers()`; tests can spin up isolated registries.
 */
export function createMergeRegistry() {
  const workers = new Map()

  return {
    has(studyId) {
      return workers.has(studyId)
    },

    /**
     * Track a worker for the given target study. Returns a release function
     * the caller invokes when the merge settles (success, error, or exit).
     */
    register(studyId, worker) {
      workers.set(studyId, worker)
      return () => {
        if (workers.get(studyId) === worker) workers.delete(studyId)
      }
    },

    /**
     * Terminate the worker for `studyId` if one is registered. SQLite WAL
     * recovery rolls back any uncommitted transaction on next DB open, so
     * A's data stays consistent.
     */
    async cancel(studyId) {
      const worker = workers.get(studyId)
      if (!worker) return { cancelled: false, reason: 'no-active-merge' }
      await worker.terminate()
      workers.delete(studyId)
      return { cancelled: true }
    }
  }
}
