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
    // Edge case: merges where every media was missing leave only deployments
    // behind. Deduplicate short prefixes server-side (SQL DISTINCT on the
    // substring) instead of pulling every deployment row into JS — a target
    // study with 500k merged deployments would otherwise materialize a 500k
    // string array just to derive at most a handful of prefixes.
    //
    // The deploymentID format is `study:<uuid-short>:<original-id>` where
    // `uuid-short` is the first 8 chars of the source UUID. We can't
    // reconstruct the full UUID, so we emit `__short:<short>` sentinels and
    // let the caller compare against candidate first-8-chars.
    for (const { short } of db
      .prepare(
        `SELECT DISTINCT substr(deploymentID, 7, 8) AS short
         FROM deployments
         WHERE deploymentID LIKE 'study:________:%'`
      )
      .iterate()) {
      if (short) ids.add(`__short:${short}`)
    }
    return [...ids]
  } finally {
    db.close()
  }
}
