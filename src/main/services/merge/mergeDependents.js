import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'

import { getStudyDatabaseStatus } from '../../database/study-readiness.js'
import log from '../logger.js'
import { getMergeImportFolder } from './helpers.js'

/**
 * Return the list of available local studies that would lose access to files
 * if `sourceStudyId` is deleted. Unavailable databases are skipped and logged;
 * an empty list does not rule out dependencies in those skipped studies.
 *
 * @param {{ biowatchDataPath: string, sourceStudyId: string }} args
 * @returns {Array<{ studyId: string, title: string, brokenMediaCount: number }>}
 */
export function getAtRiskMergeBreaks({ biowatchDataPath, sourceStudyId }) {
  const studiesRoot = join(biowatchDataPath, 'studies')
  if (!existsSync(studiesRoot)) return []
  const mergeKey = getMergeImportFolder(sourceStudyId)
  const bStudyRoot = join(studiesRoot, sourceStudyId) + '/'
  const out = []
  for (const studyId of readdirSync(studiesRoot)) {
    if (studyId === sourceStudyId) continue
    const dbPath = join(studiesRoot, studyId, 'study.db')
    if (!existsSync(dbPath)) continue
    const database = getStudyDatabaseStatus(dbPath)
    if (database.status !== 'ready') {
      log.warn(
        `Skipping unavailable study ${studyId} during deletion dependency scan: ${database.status}`
      )
      continue
    }
    const db = new Database(dbPath, { readonly: true })
    try {
      const brokenMediaCount = db
        .prepare(
          `SELECT COUNT(*) AS n FROM media
           WHERE importFolder = ?
             AND filePath IS NOT NULL
             AND substr(filePath, 1, ?) = ?`
        )
        .get(mergeKey, bStudyRoot.length, bStudyRoot).n
      if (brokenMediaCount > 0) {
        const meta = db.prepare('SELECT title FROM metadata LIMIT 1').get()
        out.push({ studyId, title: meta?.title || studyId, brokenMediaCount })
      }
    } finally {
      db.close()
    }
  }
  return out
}
