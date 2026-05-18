import { existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'

import { getMergeImportFolder, getMergePrefix } from './helpers.js'

const URL_RE = /^https?:\/\//i

function studyDbPath(biowatchDataPath, studyId) {
  return join(biowatchDataPath, 'studies', studyId, 'study.db')
}

/**
 * Pure read-only pre-flight for `mergeStudy`.
 *
 * @param {object} args
 * @param {string} args.biowatchDataPath
 * @param {string} args.targetStudyId
 * @param {string} args.sourceStudyId
 */
export function mergePreflight({ biowatchDataPath, targetStudyId, sourceStudyId }) {
  const aDb = new Database(studyDbPath(biowatchDataPath, targetStudyId), { readonly: true })
  const bDb = new Database(studyDbPath(biowatchDataPath, sourceStudyId), { readonly: true })
  try {
    const mergeKey = getMergeImportFolder(sourceStudyId)
    const prefix = getMergePrefix(sourceStudyId)
    const alreadyMergedMedia = !!aDb
      .prepare('SELECT 1 FROM media WHERE importFolder = ? LIMIT 1')
      .get(mergeKey)
    const alreadyMergedDeployment = !!aDb
      .prepare('SELECT 1 FROM deployments WHERE deploymentID LIKE ? LIMIT 1')
      .get(`${prefix}%`)
    const alreadyMerged = alreadyMergedMedia || alreadyMergedDeployment

    const deploymentCount = bDb.prepare('SELECT COUNT(*) AS n FROM deployments').get().n
    const mediaCount = bDb.prepare('SELECT COUNT(*) AS n FROM media').get().n
    const observationCount = bDb.prepare('SELECT COUNT(*) AS n FROM observations').get().n
    const renameCount = deploymentCount

    const bStudyRoot = join(biowatchDataPath, 'studies', sourceStudyId) + '/'
    const ownedByBiowatchCount = bDb
      .prepare(
        `SELECT COUNT(*) AS n FROM media
         WHERE filePath IS NOT NULL AND substr(filePath, 1, ?) = ?`
      )
      .get(bStudyRoot.length, bStudyRoot).n

    let missingFileCount = 0
    const mediaRows = bDb.prepare('SELECT filePath FROM media').all()
    for (const { filePath } of mediaRows) {
      if (!filePath || URL_RE.test(filePath)) continue
      if (!existsSync(filePath)) missingFileCount++
    }

    return {
      deploymentCount,
      mediaCount,
      observationCount,
      ownedByBiowatchCount,
      missingFileCount,
      renameCount,
      alreadyMerged
    }
  } finally {
    aDb.close()
    bDb.close()
  }
}
