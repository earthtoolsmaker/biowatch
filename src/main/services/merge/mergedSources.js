import { existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'

/**
 * Return the set of source-study UUIDs already merged into `targetStudyId`.
 * One DB open, one SQL — the StudyPicker calls this once on open to mark
 * candidates as "Already merged".
 *
 * Detection scans `media.importFolder` for the `merge:<uuid>` convention,
 * and also `deployments.deploymentID` for the `study:<uuid-short>:` prefix
 * (covers merges where every media file was missing on disk so nothing in
 * media ended up referencing the source).
 *
 * @param {{ biowatchDataPath: string, targetStudyId: string }} args
 * @returns {string[]} source-study UUIDs
 */
export function listMergedSourceIds({ biowatchDataPath, targetStudyId }) {
  const dbPath = join(biowatchDataPath, 'studies', targetStudyId, 'study.db')
  if (!existsSync(dbPath)) return []
  const db = new Database(dbPath, { readonly: true })
  try {
    const ids = new Set()
    for (const { importFolder } of db
      .prepare(
        `SELECT importFolder FROM media
         WHERE importFolder LIKE 'merge:%'
         GROUP BY importFolder`
      )
      .all()) {
      ids.add(importFolder.slice('merge:'.length))
    }
    // Edge case: merges where every media was missing leave only deployments behind.
    for (const { deploymentID } of db
      .prepare(
        `SELECT deploymentID FROM deployments
         WHERE deploymentID LIKE 'study:%:%'`
      )
      .all()) {
      // Format is "study:<uuid-short>:<original-id>" — we can't reconstruct the
      // full UUID from the short prefix, so we only flag candidates whose
      // first 8 chars match. The caller is responsible for the comparison.
      const short = deploymentID.split(':')[1]
      if (short) ids.add(`__short:${short}`)
    }
    return [...ids]
  } finally {
    db.close()
  }
}
